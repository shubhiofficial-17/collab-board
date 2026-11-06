using System.Collections.Concurrent;
using CollabBoard.Api.Accounts;
using CollabBoard.Api.Boards;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace CollabBoard.Api.Realtime;

/// <summary>Someone currently viewing a board.</summary>
public sealed record Participant(string ConnectionId, string Name, string Color);

/// <summary>Changes broadcast to everyone else on a board after they were saved.</summary>
public sealed record OpsMessage(IReadOnlyList<BoardOp> Ops, long Version, string? From);

public sealed record CursorMessage(string ConnectionId, double X, double Y);

public sealed record JoinResult(long Version, IReadOnlyList<Participant> Participants);

/// <summary>
/// Real-time channel for a board: presence (who's here), live cursors, and the stream of saved changes.
/// Changes themselves are saved over HTTP (POST /api/boards/{id}/ops) and broadcast from there, so the
/// save path has one implementation with retries and validation. See ADR 0004.
/// </summary>
[Authorize]
public sealed class BoardHub(IBoardStore store, PresenceTracker presence) : Hub
{
    public const string Path = "/hubs/board";

    public static string Group(string boardId) => $"board:{boardId}";

    public async Task<JoinResult> JoinBoard(string boardId, string name, string color)
    {
        var board = await store.GetAsync(boardId, Context.ConnectionAborted);
        if (board is null || BoardRoles.RoleOf(board.Members, Context.User!.Id()) is null)
        {
            throw new HubException("Board not found.");
        }

        // The account name, so people can't pose as someone else; the client's name is only a fallback.
        var accountName = Context.User?.Identity?.Name;
        var me = new Participant(Context.ConnectionId, Clean(accountName ?? name, 40, "Guest"), Clean(color, 7, "#4f46e5"));
        await Groups.AddToGroupAsync(Context.ConnectionId, Group(boardId));
        presence.Join(boardId, me);
        await Clients.OthersInGroup(Group(boardId)).SendAsync("ParticipantJoined", me);

        return new JoinResult(board.Version, presence.On(boardId));
    }

    public async Task LeaveBoard(string boardId)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, Group(boardId));
        if (presence.Leave(boardId, Context.ConnectionId))
        {
            await Clients.Group(Group(boardId)).SendAsync("ParticipantLeft", Context.ConnectionId);
        }
    }

    /// <summary>Relays the sender's cursor position (world coordinates). Not stored anywhere.</summary>
    public Task MoveCursor(string boardId, double x, double y)
    {
        if (!presence.IsOn(boardId, Context.ConnectionId) || !double.IsFinite(x) || !double.IsFinite(y))
        {
            return Task.CompletedTask;
        }

        return Clients.OthersInGroup(Group(boardId)).SendAsync("CursorMoved", new CursorMessage(Context.ConnectionId, x, y));
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        foreach (var boardId in presence.LeaveAll(Context.ConnectionId))
        {
            await Clients.Group(Group(boardId)).SendAsync("ParticipantLeft", Context.ConnectionId);
        }

        await base.OnDisconnectedAsync(exception);
    }

    private static string Clean(string? value, int max, string fallback)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrEmpty(trimmed) ? fallback : trimmed.Length > max ? trimmed[..max] : trimmed;
    }
}

/// <summary>
/// Who is on which board, for this server instance. With several instances behind a Redis backplane,
/// each one only knows its own connections; see ADR 0004.
/// </summary>
public sealed class PresenceTracker
{
    private readonly ConcurrentDictionary<string, ConcurrentDictionary<string, Participant>> _boards = new();

    public void Join(string boardId, Participant participant) =>
        _boards.GetOrAdd(boardId, _ => new())[participant.ConnectionId] = participant;

    public bool Leave(string boardId, string connectionId) =>
        _boards.TryGetValue(boardId, out var people) && people.TryRemove(connectionId, out _);

    public IReadOnlyList<string> LeaveAll(string connectionId) =>
        _boards.Where(b => b.Value.TryRemove(connectionId, out _)).Select(b => b.Key).ToList();

    public bool IsOn(string boardId, string connectionId) =>
        _boards.TryGetValue(boardId, out var people) && people.ContainsKey(connectionId);

    public IReadOnlyList<Participant> On(string boardId) =>
        _boards.TryGetValue(boardId, out var people) ? people.Values.OrderBy(p => p.Name).ToList() : [];
}

/// <summary>
/// Saves changes and broadcasts them, one batch at a time per board, so every viewer receives
/// changes in the order they were saved.
/// </summary>
public sealed class BoardChanges(IBoardStore store, IHubContext<BoardHub> hub)
{
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _locks = new();

    public async Task<ApplyOpsResult?> ApplyAsync(string boardId, IReadOnlyList<BoardOp> ops, string? originConnectionId, CancellationToken ct)
    {
        var gate = _locks.GetOrAdd(boardId, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(ct);
        try
        {
            var result = await store.ApplyOpsAsync(boardId, ops, ct);
            if (result is null)
            {
                return null;
            }

            var group = hub.Clients.Group(BoardHub.Group(boardId));
            var message = new OpsMessage(ops, result.Version, originConnectionId);
            // The sender already has these changes; everyone else gets them.
            await (originConnectionId is null
                ? group.SendAsync("OpsApplied", message, CancellationToken.None)
                : hub.Clients.GroupExcept(BoardHub.Group(boardId), originConnectionId).SendAsync("OpsApplied", message, CancellationToken.None));
            return result;
        }
        finally
        {
            gate.Release();
        }
    }
}
