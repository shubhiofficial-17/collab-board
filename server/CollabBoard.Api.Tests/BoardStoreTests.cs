using System.Text.Json;
using CollabBoard.Api.Boards;
using Microsoft.Extensions.Logging.Abstractions;
using MongoDB.Driver;
using Testcontainers.MongoDb;

namespace CollabBoard.Api.Tests;

/// <summary>The same behaviour is required of the MongoDB and in-memory stores.</summary>
public abstract class BoardStoreContract
{
    protected abstract IBoardStore Store { get; }

    private static Shape Rect(string id) => new() { Id = id, Kind = "rect", W = 10, H = 10, Color = "#fde68a", Z = 1 };

    private static BoardOp Add(string id) => new() { Type = "add", Shape = Rect(id) };

    [Fact]
    public async Task Saves_shapes_and_bumps_the_version()
    {
        var board = await Store.CreateAsync("Plan", CancellationToken.None);

        var first = await Store.ApplyOpsAsync(board.Id, [Add("a"), Add("b")], CancellationToken.None);
        var second = await Store.ApplyOpsAsync(board.Id,
            [new BoardOp { Type = "update", Id = "a", Patch = JsonDocument.Parse("""{"x": 42, "text": "note"}""").RootElement }],
            CancellationToken.None);

        Assert.Equal(1, first!.Version);
        Assert.Equal(2, second!.Version);
        var content = await Store.GetAsync(board.Id, CancellationToken.None);
        Assert.Equal(2, content!.Version);
        Assert.Equal(["a", "b"], content.Shapes.Select(s => s.Id));
        Assert.Equal(42, content.Shapes[0].X);
        Assert.Equal("note", content.Shapes[0].Text);
    }

    [Fact]
    public async Task An_invalid_batch_changes_nothing()
    {
        var board = await Store.CreateAsync("Plan", CancellationToken.None);
        await Store.ApplyOpsAsync(board.Id, [Add("a")], CancellationToken.None);

        await Assert.ThrowsAsync<BoardOpException>(() => Store.ApplyOpsAsync(board.Id,
            [Add("b"), new BoardOp { Type = "explode", Id = "a" }], CancellationToken.None));

        var content = await Store.GetAsync(board.Id, CancellationToken.None);
        Assert.Equal(1, content!.Version);
        Assert.Equal(["a"], content.Shapes.Select(s => s.Id));
    }

    [Fact]
    public async Task Concurrent_writers_do_not_lose_each_others_changes()
    {
        var board = await Store.CreateAsync("Busy", CancellationToken.None);

        await Task.WhenAll(Enumerable.Range(0, 10)
            .Select(i => Store.ApplyOpsAsync(board.Id, [Add($"s{i}")], CancellationToken.None)));

        var content = await Store.GetAsync(board.Id, CancellationToken.None);
        Assert.Equal(10, content!.Shapes.Count);
        Assert.Equal(10, content.Version);
    }

    [Fact]
    public async Task Renames_lists_and_deletes()
    {
        var board = await Store.CreateAsync("Old", CancellationToken.None);

        var renamed = await Store.RenameAsync(board.Id, "New", CancellationToken.None);
        Assert.Equal("New", renamed!.Title);
        Assert.Contains(await Store.ListAsync(CancellationToken.None), b => b.Id == board.Id && b.Title == "New");

        Assert.True(await Store.DeleteAsync(board.Id, CancellationToken.None));
        Assert.Null(await Store.GetAsync(board.Id, CancellationToken.None));
        Assert.False(await Store.DeleteAsync(board.Id, CancellationToken.None));
        Assert.Null(await Store.ApplyOpsAsync(board.Id, [Add("x")], CancellationToken.None));
    }
}

public sealed class InMemoryBoardStoreTests : BoardStoreContract
{
    protected override IBoardStore Store { get; } = new InMemoryBoardStore(TimeProvider.System);
}

public sealed class MongoFixture : IAsyncLifetime
{
    private readonly MongoDbContainer _container = new MongoDbBuilder().WithImage("mongo:7").Build();

    public IMongoDatabase Database { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        MongoConventions.Register();
        Database = new MongoClient(_container.GetConnectionString()).GetDatabase("collab_tests");
        await MongoBoardStore.EnsureIndexesAsync(Database, CancellationToken.None);
    }

    public Task DisposeAsync() => _container.DisposeAsync().AsTask();
}

public sealed class MongoBoardStoreTests(MongoFixture mongo) : BoardStoreContract, IClassFixture<MongoFixture>
{
    protected override IBoardStore Store { get; } =
        new MongoBoardStore(mongo.Database, TimeProvider.System, NullLogger<MongoBoardStore>.Instance);
}
