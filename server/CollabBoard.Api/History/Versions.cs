using System.Collections.Concurrent;
using MongoDB.Bson.Serialization.Attributes;
using MongoDB.Driver;
using CollabBoard.Api.Boards;

namespace CollabBoard.Api.History;

/// <summary>
/// A saved copy of a board's visible shapes at one moment. Named versions are saved by people;
/// unnamed ones are taken automatically while a board is being edited. See ADR 0009.
/// </summary>
public sealed class BoardVersion
{
    [BsonId]
    public required string Id { get; set; }

    public required string BoardId { get; set; }

    /// <summary>Null for automatic versions.</summary>
    public string? Name { get; set; }

    [BsonDateTimeOptions(Kind = DateTimeKind.Utc)]
    public DateTime CreatedAt { get; set; }

    public string? CreatedByName { get; set; }

    public int ShapeCount { get; set; }

    public List<Shape> Shapes { get; set; } = new();

    public VersionSummary ToSummary() =>
        new(Id, Name, new DateTimeOffset(CreatedAt, TimeSpan.Zero), CreatedByName, ShapeCount);
}

public sealed record VersionSummary(string Id, string? Name, DateTimeOffset CreatedAt, string? CreatedByName, int ShapeCount);

public sealed record VersionDetail(string Id, string? Name, DateTimeOffset CreatedAt, IReadOnlyList<Shape> Shapes);

public interface IVersionStore
{
    Task AddAsync(BoardVersion version, CancellationToken ct);

    /// <summary>Newest first, without shapes.</summary>
    Task<IReadOnlyList<VersionSummary>> ListAsync(string boardId, CancellationToken ct);

    Task<BoardVersion?> GetAsync(string boardId, string versionId, CancellationToken ct);

    Task<DateTime?> LatestAsync(string boardId, CancellationToken ct);

    /// <summary>Deletes automatic versions beyond the newest <paramref name="keep"/>. Named versions stay.</summary>
    Task PruneAutomaticAsync(string boardId, int keep, CancellationToken ct);
}

public sealed class InMemoryVersionStore : IVersionStore
{
    private readonly ConcurrentDictionary<string, List<BoardVersion>> _versions = new();

    private List<BoardVersion> For(string boardId) => _versions.GetOrAdd(boardId, _ => new List<BoardVersion>());

    public Task AddAsync(BoardVersion version, CancellationToken ct)
    {
        var list = For(version.BoardId);
        lock (list)
        {
            list.Add(version);
        }

        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<VersionSummary>> ListAsync(string boardId, CancellationToken ct)
    {
        var list = For(boardId);
        lock (list)
        {
            return Task.FromResult<IReadOnlyList<VersionSummary>>(
                list.OrderByDescending(v => v.CreatedAt).Take(100).Select(v => v.ToSummary()).ToList());
        }
    }

    public Task<BoardVersion?> GetAsync(string boardId, string versionId, CancellationToken ct)
    {
        var list = For(boardId);
        lock (list)
        {
            return Task.FromResult(list.FirstOrDefault(v => v.Id == versionId));
        }
    }

    public Task<DateTime?> LatestAsync(string boardId, CancellationToken ct)
    {
        var list = For(boardId);
        lock (list)
        {
            return Task.FromResult(list.Count == 0 ? (DateTime?)null : list.Max(v => v.CreatedAt));
        }
    }

    public Task PruneAutomaticAsync(string boardId, int keep, CancellationToken ct)
    {
        var list = For(boardId);
        lock (list)
        {
            var old = list.Where(v => v.Name is null).OrderByDescending(v => v.CreatedAt).Skip(keep).ToHashSet();
            list.RemoveAll(old.Contains);
        }

        return Task.CompletedTask;
    }
}

public sealed class MongoVersionStore(IMongoDatabase database) : IVersionStore
{
    private readonly IMongoCollection<BoardVersion> _versions = database.GetCollection<BoardVersion>("versions");

    public Task AddAsync(BoardVersion version, CancellationToken ct) => _versions.InsertOneAsync(version, cancellationToken: ct);

    public async Task<IReadOnlyList<VersionSummary>> ListAsync(string boardId, CancellationToken ct)
    {
        var docs = await _versions.Find(v => v.BoardId == boardId)
            .Project<BoardVersion>(Builders<BoardVersion>.Projection.Exclude(v => v.Shapes))
            .SortByDescending(v => v.CreatedAt)
            .Limit(100)
            .ToListAsync(ct);
        return docs.Select(v => v.ToSummary()).ToList();
    }

    public async Task<BoardVersion?> GetAsync(string boardId, string versionId, CancellationToken ct) =>
        await _versions.Find(v => v.Id == versionId && v.BoardId == boardId).FirstOrDefaultAsync(ct);

    public async Task<DateTime?> LatestAsync(string boardId, CancellationToken ct)
    {
        var latest = await _versions.Find(v => v.BoardId == boardId)
            .Project<BoardVersion>(Builders<BoardVersion>.Projection.Exclude(v => v.Shapes))
            .SortByDescending(v => v.CreatedAt)
            .FirstOrDefaultAsync(ct);
        return latest?.CreatedAt;
    }

    public async Task PruneAutomaticAsync(string boardId, int keep, CancellationToken ct)
    {
        var old = await _versions.Find(v => v.BoardId == boardId && v.Name == null)
            .SortByDescending(v => v.CreatedAt)
            .Skip(keep)
            .Project(v => v.Id)
            .ToListAsync(ct);
        if (old.Count > 0)
        {
            await _versions.DeleteManyAsync(v => old.Contains(v.Id), ct);
        }
    }

    public static Task EnsureIndexesAsync(IMongoDatabase database, CancellationToken ct) =>
        database.GetCollection<BoardVersion>("versions").Indexes.CreateOneAsync(
            new CreateIndexModel<BoardVersion>(Builders<BoardVersion>.IndexKeys.Ascending(v => v.BoardId).Descending(v => v.CreatedAt)),
            cancellationToken: ct);
}
