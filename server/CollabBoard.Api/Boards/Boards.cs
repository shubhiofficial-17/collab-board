using System.Collections.Concurrent;

namespace CollabBoard.Api.Boards;

/// <summary>A board without its shapes, for lists.</summary>
public sealed record Board(string Id, string Title, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

/// <summary>
/// A board with everything on it. <see cref="Version"/> goes up by one with every saved change,
/// which lets stores detect concurrent writers (optimistic concurrency).
/// </summary>
public sealed record BoardContent(
    string Id,
    string Title,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    long Version,
    IReadOnlyList<Shape> Shapes)
{
    [System.Text.Json.Serialization.JsonIgnore]
    public Board Summary => new(Id, Title, CreatedAt, UpdatedAt);
}

public sealed record CreateBoardRequest(string? Title);

public sealed record RenameBoardRequest(string? Title);

public sealed record ApplyOpsRequest(IReadOnlyList<BoardOp> Ops);

public sealed record ApplyOpsResult(long Version);

public interface IBoardStore
{
    Task<Board> CreateAsync(string title, CancellationToken ct);

    Task<BoardContent?> GetAsync(string id, CancellationToken ct);

    /// <summary>Most recently updated first, without shapes.</summary>
    Task<IReadOnlyList<Board>> ListAsync(CancellationToken ct);

    Task<Board?> RenameAsync(string id, string title, CancellationToken ct);

    Task<bool> DeleteAsync(string id, CancellationToken ct);

    /// <summary>Applies operations atomically. Returns null if the board doesn't exist.</summary>
    Task<ApplyOpsResult?> ApplyOpsAsync(string id, IReadOnlyList<BoardOp> ops, CancellationToken ct);
}

/// <summary>Used when no MongoDB connection string is configured (tests, quick local runs).</summary>
public sealed class InMemoryBoardStore(TimeProvider time) : IBoardStore
{
    private readonly ConcurrentDictionary<string, Entry> _boards = new();

    private sealed class Entry(Board board)
    {
        public Board Board { get; set; } = board;
        public List<Shape> Shapes { get; } = new();
        public long Version { get; set; }
    }

    public Task<Board> CreateAsync(string title, CancellationToken ct)
    {
        var now = time.GetUtcNow();
        var board = new Board(BoardIds.New(), title, now, now);
        _boards[board.Id] = new Entry(board);
        return Task.FromResult(board);
    }

    public Task<BoardContent?> GetAsync(string id, CancellationToken ct)
    {
        if (!_boards.TryGetValue(id, out var entry))
        {
            return Task.FromResult<BoardContent?>(null);
        }

        lock (entry)
        {
            var b = entry.Board;
            return Task.FromResult<BoardContent?>(new BoardContent(b.Id, b.Title, b.CreatedAt, b.UpdatedAt, entry.Version,
                entry.Shapes.Select(s => s.Clone()).ToList()));
        }
    }

    public Task<IReadOnlyList<Board>> ListAsync(CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<Board>>(_boards.Values.Select(e => e.Board).OrderByDescending(b => b.UpdatedAt).ToList());

    public Task<Board?> RenameAsync(string id, string title, CancellationToken ct)
    {
        if (!_boards.TryGetValue(id, out var entry))
        {
            return Task.FromResult<Board?>(null);
        }

        lock (entry)
        {
            entry.Board = entry.Board with { Title = title, UpdatedAt = time.GetUtcNow() };
            return Task.FromResult<Board?>(entry.Board);
        }
    }

    public Task<bool> DeleteAsync(string id, CancellationToken ct) => Task.FromResult(_boards.TryRemove(id, out _));

    public Task<ApplyOpsResult?> ApplyOpsAsync(string id, IReadOnlyList<BoardOp> ops, CancellationToken ct)
    {
        if (!_boards.TryGetValue(id, out var entry))
        {
            return Task.FromResult<ApplyOpsResult?>(null);
        }

        lock (entry)
        {
            // Apply to a copy first so an invalid operation leaves the board untouched.
            var shapes = entry.Shapes.Select(s => s.Clone()).ToList();
            BoardOps.Apply(shapes, ops);
            entry.Shapes.Clear();
            entry.Shapes.AddRange(shapes);
            entry.Version++;
            entry.Board = entry.Board with { UpdatedAt = time.GetUtcNow() };
            return Task.FromResult<ApplyOpsResult?>(new ApplyOpsResult(entry.Version));
        }
    }
}

public static class BoardIds
{
    private const string Alphabet = "abcdefghijkmnpqrstuvwxyz23456789"; // no look-alikes (l, 1, o, 0)

    /// <summary>Short, URL-friendly, unguessable id: 12 characters from 32 symbols = 60 bits.</summary>
    public static string New() => System.Security.Cryptography.RandomNumberGenerator.GetString(Alphabet, 12);
}
