using System.Collections.Concurrent;

namespace CollabBoard.Api.Boards;

/// <summary>A board without its shapes, for lists.</summary>
public sealed record Board(string Id, string Title, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, IReadOnlyList<BoardMember> Members);

/// <summary>Someone with access to a board, and what they may do (see <see cref="BoardRoles"/>).</summary>
public sealed record BoardMember(string UserId, string Role);

/// <summary>
/// An invite link: anyone signed in who opens it gets <see cref="Role"/> on the board. A board has at
/// most one link per role; making a new one replaces (and so revokes) the old one.
/// </summary>
public sealed record ShareLink(string Token, string Role);

/// <summary>The board a share link belongs to.</summary>
public sealed record ShareLinkTarget(string BoardId, string Role);

public static class BoardRoles
{
    public const string Owner = "owner";
    public const string Editor = "editor";
    public const string Viewer = "viewer";

    /// <summary>Owner can do everything, editors can change the board, viewers can only look.</summary>
    public static int Rank(string? role) => role switch
    {
        Owner => 3,
        Editor => 2,
        Viewer => 1,
        _ => 0,
    };

    public static string? RoleOf(IReadOnlyList<BoardMember>? members, string userId) =>
        members?.FirstOrDefault(m => m.UserId == userId)?.Role;
}

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
    IReadOnlyList<Shape> Shapes,
    IReadOnlyList<BoardMember> Members)
{
    [System.Text.Json.Serialization.JsonIgnore]
    public Board Summary => new(Id, Title, CreatedAt, UpdatedAt, Members);
}

public sealed record CreateBoardRequest(string? Title);

public sealed record RenameBoardRequest(string? Title);

public sealed record ApplyOpsRequest(IReadOnlyList<BoardOp> Ops);

public sealed record ApplyOpsResult(long Version);

public interface IBoardStore
{
    /// <summary>Creates a board owned by <paramref name="ownerId"/>.</summary>
    Task<Board> CreateAsync(string title, string ownerId, CancellationToken ct);

    Task<BoardContent?> GetAsync(string id, CancellationToken ct);

    /// <summary>Who has access, or null if the board doesn't exist. Cheaper than loading the whole board.</summary>
    Task<IReadOnlyList<BoardMember>?> GetMembersAsync(string id, CancellationToken ct);

    /// <summary>Boards <paramref name="userId"/> has access to, most recently updated first, without shapes.</summary>
    Task<IReadOnlyList<Board>> ListAsync(string userId, CancellationToken ct);

    Task<Board?> RenameAsync(string id, string title, CancellationToken ct);

    Task<bool> DeleteAsync(string id, CancellationToken ct);

    /// <summary>Gives someone access, or changes their role. False if the board doesn't exist.</summary>
    Task<bool> SetMemberAsync(string id, BoardMember member, CancellationToken ct);

    /// <summary>Takes someone's access away. False if the board doesn't exist.</summary>
    Task<bool> RemoveMemberAsync(string id, string userId, CancellationToken ct);

    /// <summary>The board's share links, or null if it doesn't exist.</summary>
    Task<IReadOnlyList<ShareLink>?> GetShareLinksAsync(string id, CancellationToken ct);

    /// <summary>Sets (or with a null token, removes) the board's link for a role. False if the board doesn't exist.</summary>
    Task<bool> SetShareLinkAsync(string id, string role, string? token, CancellationToken ct);

    Task<ShareLinkTarget?> FindShareLinkAsync(string token, CancellationToken ct);

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
        public List<ShareLink> Links { get; set; } = new();
        public List<Shape> Shapes { get; } = new();
        public long Version { get; set; }
    }

    public Task<Board> CreateAsync(string title, string ownerId, CancellationToken ct)
    {
        var now = time.GetUtcNow();
        var board = new Board(BoardIds.New(), title, now, now, [new BoardMember(ownerId, BoardRoles.Owner)]);
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
                entry.Shapes.Select(s => s.Clone()).ToList(), b.Members));
        }
    }

    public Task<IReadOnlyList<BoardMember>?> GetMembersAsync(string id, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<BoardMember>?>(_boards.TryGetValue(id, out var entry) ? entry.Board.Members : null);

    public Task<IReadOnlyList<Board>> ListAsync(string userId, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<Board>>(_boards.Values
            .Select(e => e.Board)
            .Where(b => BoardRoles.RoleOf(b.Members, userId) is not null)
            .OrderByDescending(b => b.UpdatedAt)
            .ToList());

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

    public Task<bool> SetMemberAsync(string id, BoardMember member, CancellationToken ct) =>
        UpdateMembers(id, members => [.. members.Where(m => m.UserId != member.UserId), member]);

    public Task<bool> RemoveMemberAsync(string id, string userId, CancellationToken ct) =>
        UpdateMembers(id, members => [.. members.Where(m => m.UserId != userId)]);

    public Task<IReadOnlyList<ShareLink>?> GetShareLinksAsync(string id, CancellationToken ct)
    {
        if (!_boards.TryGetValue(id, out var entry))
        {
            return Task.FromResult<IReadOnlyList<ShareLink>?>(null);
        }

        lock (entry)
        {
            return Task.FromResult<IReadOnlyList<ShareLink>?>(entry.Links.ToList());
        }
    }

    public Task<bool> SetShareLinkAsync(string id, string role, string? token, CancellationToken ct)
    {
        if (!_boards.TryGetValue(id, out var entry))
        {
            return Task.FromResult(false);
        }

        lock (entry)
        {
            entry.Links = [.. entry.Links.Where(l => l.Role != role)];
            if (token is not null)
            {
                entry.Links.Add(new ShareLink(token, role));
            }

            return Task.FromResult(true);
        }
    }

    public Task<ShareLinkTarget?> FindShareLinkAsync(string token, CancellationToken ct)
    {
        foreach (var (id, entry) in _boards)
        {
            lock (entry)
            {
                if (entry.Links.FirstOrDefault(l => l.Token == token) is { } link)
                {
                    return Task.FromResult<ShareLinkTarget?>(new ShareLinkTarget(id, link.Role));
                }
            }
        }

        return Task.FromResult<ShareLinkTarget?>(null);
    }

    private Task<bool> UpdateMembers(string id, Func<IReadOnlyList<BoardMember>, List<BoardMember>> change)
    {
        if (!_boards.TryGetValue(id, out var entry))
        {
            return Task.FromResult(false);
        }

        lock (entry)
        {
            entry.Board = entry.Board with { Members = change(entry.Board.Members) };
            return Task.FromResult(true);
        }
    }

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
