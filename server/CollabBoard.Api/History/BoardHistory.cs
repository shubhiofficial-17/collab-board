using System.Collections.Concurrent;
using CollabBoard.Api.Boards;
using CollabBoard.Api.Realtime;

namespace CollabBoard.Api.History;

/// <summary>Takes versions of boards and restores them.</summary>
public sealed class BoardHistory(IBoardStore boards, IVersionStore versions, BoardChanges changes, TimeProvider time)
{
    /// <summary>While a board is being edited, a version is kept at most this often.</summary>
    public static readonly TimeSpan AutomaticInterval = TimeSpan.FromMinutes(10);

    public const int AutomaticVersionsKept = 50;

    // When each board last got a version, so most saves don't need to ask the database.
    private readonly ConcurrentDictionary<string, DateTime> _lastVersion = new();

    /// <summary>Saves a version now. Null if the board doesn't exist.</summary>
    public async Task<VersionSummary?> SaveAsync(string boardId, string? name, string? byName, CancellationToken ct)
    {
        if (await boards.GetAsync(boardId, ct) is not { } board)
        {
            return null;
        }

        var shapes = board.Shapes.Where(BoardOps.IsVisible).Select(Clean).ToList();
        var version = new BoardVersion
        {
            Id = BoardIds.New(),
            BoardId = boardId,
            Name = name,
            CreatedAt = time.GetUtcNow().UtcDateTime,
            CreatedByName = byName,
            ShapeCount = shapes.Count,
            Shapes = shapes,
        };
        await versions.AddAsync(version, ct);
        _lastVersion[boardId] = version.CreatedAt;
        if (name is null)
        {
            await versions.PruneAutomaticAsync(boardId, AutomaticVersionsKept, ct);
        }

        return version.ToSummary();
    }

    /// <summary>Called after each save: keeps a version if the last one is old enough.</summary>
    public async Task AfterChangeAsync(string boardId, CancellationToken ct)
    {
        if (!_lastVersion.TryGetValue(boardId, out var last))
        {
            last = await versions.LatestAsync(boardId, ct) ?? DateTime.MinValue;
            _lastVersion[boardId] = last;
        }

        if (time.GetUtcNow().UtcDateTime - last >= AutomaticInterval)
        {
            await SaveAsync(boardId, null, null, ct);
        }
    }

    /// <summary>
    /// Makes the board look like the version again. This is a normal change, merged and broadcast like
    /// any other, so it reaches everyone live, and the current state is saved as a version first, so
    /// restoring can be undone by restoring that one. Null if the board or version doesn't exist.
    /// </summary>
    public async Task<ApplyOpsResult?> RestoreAsync(string boardId, string versionId, string? byName, CancellationToken ct)
    {
        if (await versions.GetAsync(boardId, versionId, ct) is not { } version)
        {
            return null;
        }

        var label = version.Name ?? version.CreatedAt.ToString("yyyy-MM-dd HH:mm 'UTC'");
        if (await SaveAsync(boardId, $"Before restoring {label}", byName, ct) is null || await boards.GetAsync(boardId, ct) is not { } board)
        {
            return null;
        }

        var keep = version.Shapes.Select(s => s.Id).ToHashSet();
        var ops = version.Shapes.Select(s => new BoardOp { Type = "add", Shape = Clean(s) })
            .Concat(board.Shapes.Where(s => BoardOps.IsVisible(s) && !keep.Contains(s.Id)).Select(s => new BoardOp { Type = "delete", Id = s.Id }))
            .ToList();

        // Requests are capped at MaxOpsPerRequest, so large boards are restored in a few batches.
        ApplyOpsResult? result = new(board.Version);
        foreach (var batch in ops.Chunk(BoardOps.MaxOpsPerRequest))
        {
            result = await changes.ApplyAsync(boardId, batch, null, ct);
        }

        return result;
    }

    private static Shape Clean(Shape shape)
    {
        var copy = shape.Clone();
        copy.Clock = null;
        copy.Deleted = false;
        return copy;
    }
}
