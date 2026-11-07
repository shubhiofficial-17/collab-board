using MongoDB.Bson.Serialization.Attributes;
using MongoDB.Driver;

namespace CollabBoard.Api.Boards;

/// <summary>
/// One MongoDB document per board, holding all its shapes. A board is read and written as a whole
/// far more often than individual shapes are queried, which is exactly what documents are good at.
/// See ADR 0003.
/// </summary>
public sealed class MongoBoardStore(IMongoDatabase database, TimeProvider time, ILogger<MongoBoardStore> logger) : IBoardStore
{
    private const int MaxConflictRetries = 10;

    private readonly IMongoCollection<BoardDocument> _boards = database.GetCollection<BoardDocument>("boards");

    public async Task<Board> CreateAsync(string title, string ownerId, CancellationToken ct)
    {
        var now = time.GetUtcNow().UtcDateTime;
        var doc = new BoardDocument
        {
            Id = BoardIds.New(),
            Title = title,
            CreatedAt = now,
            UpdatedAt = now,
            Members = [new BoardMember(ownerId, BoardRoles.Owner)],
        };
        await _boards.InsertOneAsync(doc, cancellationToken: ct);
        return doc.ToBoard();
    }

    public async Task<BoardContent?> GetAsync(string id, CancellationToken ct)
    {
        var doc = await _boards.Find(b => b.Id == id).FirstOrDefaultAsync(ct);
        return doc?.ToContent();
    }

    public async Task<IReadOnlyList<BoardMember>?> GetMembersAsync(string id, CancellationToken ct)
    {
        var doc = await _boards.Find(b => b.Id == id)
            .Project<BoardDocument>(Builders<BoardDocument>.Projection.Exclude(b => b.Shapes))
            .FirstOrDefaultAsync(ct);
        return doc?.Members;
    }

    public async Task<IReadOnlyList<Board>> ListAsync(string userId, CancellationToken ct)
    {
        // Shapes can be large; lists only need the summary fields.
        var docs = await _boards.Find(Builders<BoardDocument>.Filter.ElemMatch(b => b.Members, m => m.UserId == userId))
            .Project<BoardDocument>(Builders<BoardDocument>.Projection.Exclude(b => b.Shapes))
            .SortByDescending(b => b.UpdatedAt)
            .Limit(200)
            .ToListAsync(ct);
        return docs.Select(d => d.ToBoard()).ToList();
    }

    public async Task<Board?> RenameAsync(string id, string title, CancellationToken ct)
    {
        var doc = await _boards.FindOneAndUpdateAsync<BoardDocument, BoardDocument>(
            b => b.Id == id,
            Builders<BoardDocument>.Update.Set(b => b.Title, title).Set(b => b.UpdatedAt, time.GetUtcNow().UtcDateTime),
            new FindOneAndUpdateOptions<BoardDocument, BoardDocument>
            {
                ReturnDocument = ReturnDocument.After,
                Projection = Builders<BoardDocument>.Projection.Exclude(b => b.Shapes),
            },
            ct);
        return doc?.ToBoard();
    }

    public async Task<bool> DeleteAsync(string id, CancellationToken ct) =>
        (await _boards.DeleteOneAsync(b => b.Id == id, ct)).DeletedCount == 1;

    public async Task<bool> SetMemberAsync(string id, BoardMember member, CancellationToken ct)
    {
        var filter = Builders<BoardDocument>.Filter;
        for (var attempt = 0; attempt < 3; attempt++)
        {
            // Already a member: change the role in place.
            var changed = await _boards.UpdateOneAsync(
                filter.Eq(b => b.Id, id) & filter.ElemMatch(b => b.Members, m => m.UserId == member.UserId),
                Builders<BoardDocument>.Update.Set("members.$.role", member.Role),
                cancellationToken: ct);
            if (changed.MatchedCount == 1)
            {
                return true;
            }

            // Not a member yet: add, unless someone else just did (then go round again).
            var added = await _boards.UpdateOneAsync(
                filter.Eq(b => b.Id, id) & filter.Not(filter.ElemMatch(b => b.Members, m => m.UserId == member.UserId)),
                Builders<BoardDocument>.Update.Push(b => b.Members, member),
                cancellationToken: ct);
            if (added.MatchedCount == 1)
            {
                return true;
            }

            if (await GetMembersAsync(id, ct) is null)
            {
                return false;
            }
        }

        throw new InvalidOperationException($"Couldn't update the members of board {id}.");
    }

    public async Task<IReadOnlyList<ShareLink>?> GetShareLinksAsync(string id, CancellationToken ct)
    {
        var doc = await _boards.Find(b => b.Id == id)
            .Project<BoardDocument>(Builders<BoardDocument>.Projection.Exclude(b => b.Shapes))
            .FirstOrDefaultAsync(ct);
        return doc?.ShareLinks;
    }

    public async Task<bool> SetShareLinkAsync(string id, string role, string? token, CancellationToken ct)
    {
        // Remove the old link for the role, then add the new one. Two updates, but only the owner
        // changes links, and a lost race just leaves one of the two new links in place.
        var removed = await _boards.UpdateOneAsync(
            b => b.Id == id,
            Builders<BoardDocument>.Update.PullFilter(b => b.ShareLinks, l => l.Role == role),
            cancellationToken: ct);
        if (removed.MatchedCount == 0)
        {
            return false;
        }

        if (token is not null)
        {
            await _boards.UpdateOneAsync(
                b => b.Id == id,
                Builders<BoardDocument>.Update.Push(b => b.ShareLinks, new ShareLink(token, role)),
                cancellationToken: ct);
        }

        return true;
    }

    public async Task<ShareLinkTarget?> FindShareLinkAsync(string token, CancellationToken ct)
    {
        var doc = await _boards.Find(Builders<BoardDocument>.Filter.ElemMatch(b => b.ShareLinks, l => l.Token == token))
            .Project<BoardDocument>(Builders<BoardDocument>.Projection.Exclude(b => b.Shapes))
            .FirstOrDefaultAsync(ct);
        return doc?.ShareLinks.FirstOrDefault(l => l.Token == token) is { } link ? new ShareLinkTarget(doc.Id, link.Role) : null;
    }

    public async Task<bool> RemoveMemberAsync(string id, string userId, CancellationToken ct) =>
        (await _boards.UpdateOneAsync(
            b => b.Id == id,
            Builders<BoardDocument>.Update.PullFilter(b => b.Members, m => m.UserId == userId),
            cancellationToken: ct)).MatchedCount == 1;

    /// <summary>
    /// Read, apply in memory, then write back only if nobody else wrote in between (the version still
    /// matches). On a conflict, re-read and try again. This keeps the validation logic in one place
    /// (BoardOps) instead of translating each operation into a MongoDB update.
    /// </summary>
    public async Task<ApplyOpsResult?> ApplyOpsAsync(string id, IReadOnlyList<BoardOp> ops, CancellationToken ct)
    {
        for (var attempt = 1; attempt <= MaxConflictRetries; attempt++)
        {
            var doc = await _boards.Find(b => b.Id == id).FirstOrDefaultAsync(ct);
            if (doc is null)
            {
                return null;
            }

            var expectedVersion = doc.Version;
            BoardOps.Apply(doc.Shapes, ops);
            doc.Version = expectedVersion + 1;
            doc.UpdatedAt = time.GetUtcNow().UtcDateTime;

            var result = await _boards.ReplaceOneAsync(
                b => b.Id == id && b.Version == expectedVersion, doc, cancellationToken: ct);
            if (result.MatchedCount == 1)
            {
                return new ApplyOpsResult(doc.Version);
            }

            logger.LogDebug("Write conflict on board {BoardId} (attempt {Attempt}); retrying", id, attempt);
            // Small random pause so competing writers don't collide again in lockstep.
            await Task.Delay(Random.Shared.Next(2, 10 * attempt), ct);
        }

        throw new InvalidOperationException($"Board {id} is changing too fast to save; gave up after {MaxConflictRetries} attempts.");
    }

    public static async Task EnsureIndexesAsync(IMongoDatabase database, CancellationToken ct)
    {
        var boards = database.GetCollection<BoardDocument>("boards");
        await boards.Indexes.CreateOneAsync(
            new CreateIndexModel<BoardDocument>(Builders<BoardDocument>.IndexKeys.Descending(b => b.UpdatedAt)),
            cancellationToken: ct);
        await boards.Indexes.CreateOneAsync(
            new CreateIndexModel<BoardDocument>(Builders<BoardDocument>.IndexKeys.Ascending("members.userId").Descending(b => b.UpdatedAt)),
            cancellationToken: ct);
        await boards.Indexes.CreateOneAsync(
            new CreateIndexModel<BoardDocument>(Builders<BoardDocument>.IndexKeys.Ascending("shareLinks.token"), new CreateIndexOptions { Sparse = true }),
            cancellationToken: ct);
    }
}

/// <summary>Storage shape of a board in MongoDB.</summary>
public sealed class BoardDocument
{
    [BsonId]
    public required string Id { get; set; }

    public required string Title { get; set; }

    [BsonDateTimeOptions(Kind = DateTimeKind.Utc)]
    public DateTime CreatedAt { get; set; }

    [BsonDateTimeOptions(Kind = DateTimeKind.Utc)]
    public DateTime UpdatedAt { get; set; }

    public long Version { get; set; }

    public List<Shape> Shapes { get; set; } = new();

    public List<BoardMember> Members { get; set; } = new();

    public List<ShareLink> ShareLinks { get; set; } = new();

    public Board ToBoard() =>
        new(Id, Title, new DateTimeOffset(CreatedAt, TimeSpan.Zero), new DateTimeOffset(UpdatedAt, TimeSpan.Zero), Members);

    public BoardContent ToContent()
    {
        var b = ToBoard();
        return new BoardContent(b.Id, b.Title, b.CreatedAt, b.UpdatedAt, Version, Shapes, Members);
    }
}

public static class MongoConventions
{
    private static int _registered;

    /// <summary>camelCase field names, and tolerate fields older or newer code doesn't know about.</summary>
    public static void Register()
    {
        if (Interlocked.Exchange(ref _registered, 1) == 1)
        {
            return;
        }

        MongoDB.Bson.Serialization.Conventions.ConventionRegistry.Register("collab-board", new MongoDB.Bson.Serialization.Conventions.ConventionPack
        {
            new MongoDB.Bson.Serialization.Conventions.CamelCaseElementNameConvention(),
            new MongoDB.Bson.Serialization.Conventions.IgnoreExtraElementsConvention(true),
        }, _ => true);
    }
}

/// <summary>Creates indexes once at startup.</summary>
public sealed class MongoIndexInitializer(IMongoDatabase database) : IHostedService
{
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        await MongoBoardStore.EnsureIndexesAsync(database, cancellationToken);
        await Accounts.MongoUserStore.EnsureIndexesAsync(database, cancellationToken);
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
