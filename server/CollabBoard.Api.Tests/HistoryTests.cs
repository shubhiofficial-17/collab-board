using System.Net;
using System.Net.Http.Json;
using CollabBoard.Api.Boards;
using CollabBoard.Api.History;
using Microsoft.AspNetCore.Mvc.Testing;

namespace CollabBoard.Api.Tests;

public sealed class HistoryTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private static object Add(string id, double x = 0) => new
    {
        ops = new object[] { new { type = "add", shape = new { id, kind = "rect", x, y = 0, w = 10, h = 10, color = "#fde68a", z = 1 } } },
    };

    private static object Delete(string id) => new { ops = new object[] { new { type = "delete", id } } };

    private static async Task<string> NewBoardAsync(TestUser owner) =>
        (await (await owner.Client.PostAsJsonAsync("/api/boards", new { title = "History" })).Content.ReadFromJsonAsync<Board>())!.Id;

    private static async Task SaveAsync(TestUser user, string boardId, object ops) =>
        (await user.Client.PostAsJsonAsync($"/api/boards/{boardId}/ops", ops)).EnsureSuccessStatusCode();

    private static IEnumerable<string> Visible(BoardContent board) => board.Shapes.Where(BoardOps.IsVisible).Select(s => s.Id).Order();

    [Fact]
    public async Task Editing_a_board_keeps_an_automatic_version()
    {
        var owner = await factory.SignUpAsync();
        var board = await NewBoardAsync(owner);

        await SaveAsync(owner, board, Add("a"));

        var versions = await owner.Client.GetFromJsonAsync<List<VersionSummary>>($"/api/boards/{board}/versions");
        var auto = Assert.Single(versions!);
        Assert.Null(auto.Name);
        Assert.Equal(1, auto.ShapeCount);
    }

    [Fact]
    public async Task Named_versions_can_be_saved_and_opened()
    {
        var owner = await factory.SignUpAsync("Ada");
        var board = await NewBoardAsync(owner);
        await SaveAsync(owner, board, Add("a", x: 42));

        var saved = await (await owner.Client.PostAsJsonAsync($"/api/boards/{board}/versions", new { name = " Draft 1 " }))
            .Content.ReadFromJsonAsync<VersionSummary>();
        var detail = await owner.Client.GetFromJsonAsync<VersionDetail>($"/api/boards/{board}/versions/{saved!.Id}");

        Assert.Equal("Draft 1", saved.Name);
        Assert.Equal("Ada", saved.CreatedByName);
        Assert.Equal(42, Assert.Single(detail!.Shapes).X);
        Assert.Null(detail.Shapes[0].Clock);
    }

    [Fact]
    public async Task Restoring_brings_back_the_old_board_and_can_itself_be_undone()
    {
        var owner = await factory.SignUpAsync();
        var board = await NewBoardAsync(owner);
        await SaveAsync(owner, board, Add("a"));
        var v1 = await (await owner.Client.PostAsJsonAsync($"/api/boards/{board}/versions", new { name = "v1" }))
            .Content.ReadFromJsonAsync<VersionSummary>();
        await SaveAsync(owner, board, Delete("a"));
        await SaveAsync(owner, board, Add("b"));

        var restore = await owner.Client.PostAsync($"/api/boards/{board}/versions/{v1!.Id}/restore", null);

        Assert.Equal(HttpStatusCode.OK, restore.StatusCode);
        var content = await owner.Client.GetFromJsonAsync<BoardContent>($"/api/boards/{board}");
        Assert.Equal(["a"], Visible(content!));
        var versions = await owner.Client.GetFromJsonAsync<List<VersionSummary>>($"/api/boards/{board}/versions");
        var before = Assert.Single(versions!, v => v.Name == "Before restoring v1");
        Assert.Equal(1, before.ShapeCount); // just "b"
    }

    [Fact]
    public async Task Viewers_can_browse_history_but_not_restore()
    {
        var owner = await factory.SignUpAsync();
        var viewer = await factory.SignUpAsync();
        var board = await NewBoardAsync(owner);
        await SaveAsync(owner, board, Add("a"));
        var link = await (await owner.Client.PostAsJsonAsync($"/api/boards/{board}/links", new { role = "viewer" })).Content.ReadFromJsonAsync<ShareLink>();
        await viewer.Client.PostAsync($"/api/invites/{link!.Token}/accept", null);

        var versions = await viewer.Client.GetFromJsonAsync<List<VersionSummary>>($"/api/boards/{board}/versions");
        var restore = await viewer.Client.PostAsync($"/api/boards/{board}/versions/{versions![0].Id}/restore", null);
        var save = await viewer.Client.PostAsJsonAsync($"/api/boards/{board}/versions", new { name = "mine" });

        Assert.Equal(HttpStatusCode.Forbidden, restore.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, save.StatusCode);
    }

    [Fact]
    public async Task Pruning_keeps_named_versions_and_the_newest_automatic_ones()
    {
        var store = new InMemoryVersionStore();
        var start = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        for (var i = 0; i < 5; i++)
        {
            await store.AddAsync(new BoardVersion { Id = $"auto{i}", BoardId = "b", CreatedAt = start.AddMinutes(i) }, CancellationToken.None);
        }

        await store.AddAsync(new BoardVersion { Id = "named", BoardId = "b", Name = "Keep", CreatedAt = start }, CancellationToken.None);

        await store.PruneAutomaticAsync("b", 2, CancellationToken.None);

        var left = (await store.ListAsync("b", CancellationToken.None)).Select(v => v.Id).Order();
        Assert.Equal(["auto3", "auto4", "named"], left);
    }
}
