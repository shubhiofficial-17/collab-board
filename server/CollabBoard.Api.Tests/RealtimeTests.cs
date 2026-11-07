using System.Net.Http.Json;
using System.Threading.Channels;
using CollabBoard.Api.Boards;
using CollabBoard.Api.Realtime;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;

namespace CollabBoard.Api.Tests;

public sealed class RealtimeTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private sealed class Client(HubConnection connection) : IAsyncDisposable
    {
        public HubConnection Connection { get; } = connection;
        public Channel<OpsMessage> Ops { get; } = Channel.CreateUnbounded<OpsMessage>();
        public Channel<Participant> Joined { get; } = Channel.CreateUnbounded<Participant>();
        public Channel<string> Left { get; } = Channel.CreateUnbounded<string>();
        public Channel<CursorMessage> Cursors { get; } = Channel.CreateUnbounded<CursorMessage>();

        public ValueTask DisposeAsync() => Connection.DisposeAsync();
    }

    private async Task<Client> ConnectAsync(TestUser user)
    {
        var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(factory.Server.BaseAddress, BoardHub.Path), options =>
            {
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
                options.Transports = HttpTransportType.LongPolling;
                options.Headers["Cookie"] = user.Cookie;
            })
            .Build();

        var client = new Client(connection);
        connection.On<OpsMessage>("OpsApplied", m => client.Ops.Writer.TryWrite(m));
        connection.On<Participant>("ParticipantJoined", p => client.Joined.Writer.TryWrite(p));
        connection.On<string>("ParticipantLeft", id => client.Left.Writer.TryWrite(id));
        connection.On<CursorMessage>("CursorMoved", c => client.Cursors.Writer.TryWrite(c));
        await connection.StartAsync();
        return client;
    }

    private static async Task<T> Next<T>(Channel<T> channel)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        return await channel.Reader.ReadAsync(timeout.Token);
    }

    /// <summary>A board owned by <paramref name="owner"/>, which <paramref name="others"/> can edit.</summary>
    private async Task<string> NewBoardAsync(TestUser owner, params TestUser[] others)
    {
        var created = await owner.Client.PostAsJsonAsync("/api/boards", new { title = "Live" });
        var id = (await created.Content.ReadFromJsonAsync<Board>())!.Id;
        var store = factory.Services.GetRequiredService<IBoardStore>();
        foreach (var other in others)
        {
            await store.SetMemberAsync(id, new BoardMember(other.Me.Id, BoardRoles.Editor), CancellationToken.None);
        }

        return id;
    }

    [Fact]
    public async Task Saved_changes_reach_other_viewers_but_not_the_sender()
    {
        var aliceUser = await factory.SignUpAsync("Alice");
        var bobUser = await factory.SignUpAsync("Bob");
        var boardId = await NewBoardAsync(aliceUser, bobUser);
        await using var alice = await ConnectAsync(aliceUser);
        await using var bob = await ConnectAsync(bobUser);
        await alice.Connection.InvokeAsync<JoinResult>("JoinBoard", boardId, "Alice", "#e11d48");
        await bob.Connection.InvokeAsync<JoinResult>("JoinBoard", boardId, "Bob", "#2563eb");

        var save = await aliceUser.Client.SendAsync(new HttpRequestMessage(HttpMethod.Post, $"/api/boards/{boardId}/ops")
        {
            Headers = { { "X-Connection-Id", alice.Connection.ConnectionId } },
            Content = JsonContent.Create(new
            {
                ops = new object[] { new { type = "add", shape = new { id = "s1", kind = "rect", x = 1, y = 2, w = 3, h = 4, color = "#fde68a", z = 1 } } },
            }),
        });
        save.EnsureSuccessStatusCode();

        var received = await Next(bob.Ops);
        Assert.Equal(1, received.Version);
        Assert.Equal("s1", Assert.Single(received.Ops).Shape!.Id);
        Assert.Equal(alice.Connection.ConnectionId, received.From);
        Assert.False(alice.Ops.Reader.TryRead(out _));
    }

    [Fact]
    public async Task Presence_shows_who_joins_and_leaves()
    {
        var aliceUser = await factory.SignUpAsync("Alice");
        var bobUser = await factory.SignUpAsync("Bob");
        var boardId = await NewBoardAsync(aliceUser, bobUser);
        await using var alice = await ConnectAsync(aliceUser);
        var bob = await ConnectAsync(bobUser);

        // Names come from the accounts, not from what the client claims.
        var aliceJoin = await alice.Connection.InvokeAsync<JoinResult>("JoinBoard", boardId, "Someone else", "#e11d48");
        Assert.Equal("Alice", Assert.Single(aliceJoin.Participants).Name);

        var bobJoin = await bob.Connection.InvokeAsync<JoinResult>("JoinBoard", boardId, "Bob", "#2563eb");
        Assert.Equal(["Alice", "Bob"], bobJoin.Participants.Select(p => p.Name));
        Assert.Equal("Bob", (await Next(alice.Joined)).Name);

        var bobId = bob.Connection.ConnectionId;
        await bob.DisposeAsync(); // closing the tab
        Assert.Equal(bobId, await Next(alice.Left));
    }

    [Fact]
    public async Task Cursors_are_relayed_to_others_on_the_same_board_only()
    {
        var user = await factory.SignUpAsync("Sam"); // one person with three tabs open
        var boardId = await NewBoardAsync(user);
        var otherBoardId = await NewBoardAsync(user);
        await using var alice = await ConnectAsync(user);
        await using var bob = await ConnectAsync(user);
        await using var carol = await ConnectAsync(user);
        await alice.Connection.InvokeAsync<JoinResult>("JoinBoard", boardId, "Alice", "#e11d48");
        await bob.Connection.InvokeAsync<JoinResult>("JoinBoard", boardId, "Bob", "#2563eb");
        await carol.Connection.InvokeAsync<JoinResult>("JoinBoard", otherBoardId, "Carol", "#16a34a");

        await alice.Connection.InvokeAsync("MoveCursor", boardId, 120.5, 64.0);

        var cursor = await Next(bob.Cursors);
        Assert.Equal(new CursorMessage(alice.Connection.ConnectionId!, 120.5, 64.0), cursor);
        await Task.Delay(300);
        Assert.False(carol.Cursors.Reader.TryRead(out _));
        Assert.False(alice.Cursors.Reader.TryRead(out _));
    }

    [Fact]
    public async Task Joining_a_missing_board_fails()
    {
        await using var alice = await ConnectAsync(await factory.SignUpAsync());

        var error = await Assert.ThrowsAsync<HubException>(() => alice.Connection.InvokeAsync<JoinResult>("JoinBoard", "nope", "Alice", "#e11d48"));
        Assert.Contains("Board not found", error.Message);
    }

    [Fact]
    public async Task Joining_someone_elses_board_fails()
    {
        var boardId = await NewBoardAsync(await factory.SignUpAsync("Owner"));
        await using var stranger = await ConnectAsync(await factory.SignUpAsync("Stranger"));

        var error = await Assert.ThrowsAsync<HubException>(() => stranger.Connection.InvokeAsync<JoinResult>("JoinBoard", boardId, "S", "#e11d48"));
        Assert.Contains("Board not found", error.Message);
    }

    [Fact]
    public async Task Connecting_needs_you_to_be_signed_in()
    {
        var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(factory.Server.BaseAddress, BoardHub.Path), options =>
            {
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
                options.Transports = HttpTransportType.LongPolling;
            })
            .Build();

        await Assert.ThrowsAnyAsync<Exception>(() => connection.StartAsync());
    }
}
