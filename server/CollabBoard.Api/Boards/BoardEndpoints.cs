using System.Security.Claims;
using CollabBoard.Api.Accounts;
using CollabBoard.Api.Realtime;
using Microsoft.AspNetCore.Mvc;

namespace CollabBoard.Api.Boards;

public static class BoardEndpoints
{
    public const int MaxTitleLength = 120;

    public static RouteGroupBuilder MapBoardEndpoints(this IEndpointRouteBuilder app)
    {
        // Everything here needs a signed-in user. Boards someone can't access are reported as not found,
        // so ids can't be probed; boards they can see but not change get 403.
        var boards = app.MapGroup("/api/boards").RequireAuthorization();

        boards.MapGet("/", async (ClaimsPrincipal user, IBoardStore store, CancellationToken ct) =>
            Results.Ok(await store.ListAsync(user.Id(), ct)));

        boards.MapGet("/{id}", async (string id, ClaimsPrincipal user, IBoardStore store, CancellationToken ct) =>
            await store.GetAsync(id, ct) is { } board && BoardRoles.RoleOf(board.Members, user.Id()) is not null
                ? Results.Ok(board)
                : Results.NotFound());

        boards.MapPost("/", async (CreateBoardRequest request, ClaimsPrincipal user, IBoardStore store, CancellationToken ct) =>
        {
            if (!TryCleanTitle(request.Title, out var title, out var problem))
            {
                return problem;
            }

            var board = await store.CreateAsync(title, user.Id(), ct);
            return Results.Created($"/api/boards/{board.Id}", board);
        });

        boards.MapPatch("/{id}", async (string id, RenameBoardRequest request, ClaimsPrincipal user, IBoardStore store, CancellationToken ct) =>
        {
            if (!TryCleanTitle(request.Title, out var title, out var problem))
            {
                return problem;
            }

            if (await RequireRole(id, BoardRoles.Editor, user, store, ct) is { } denied)
            {
                return denied;
            }

            return await store.RenameAsync(id, title, ct) is { } board ? Results.Ok(board) : Results.NotFound();
        });

        boards.MapDelete("/{id}", async (string id, ClaimsPrincipal user, IBoardStore store, CancellationToken ct) =>
        {
            if (await RequireRole(id, BoardRoles.Owner, user, store, ct) is { } denied)
            {
                return denied;
            }

            return await store.DeleteAsync(id, ct) ? Results.NoContent() : Results.NotFound();
        });

        // Saves a batch of changes made in the editor, all or nothing, and broadcasts it to everyone else
        // viewing the board. X-Connection-Id is the sender's real-time connection, so it isn't echoed back.
        boards.MapPost("/{id}/ops", async (
            string id,
            ApplyOpsRequest request,
            [FromHeader(Name = "X-Connection-Id")] string? connectionId,
            ClaimsPrincipal user,
            IBoardStore store,
            BoardChanges changes,
            History.BoardHistory history,
            CancellationToken ct) =>
        {
            if (await RequireRole(id, BoardRoles.Editor, user, store, ct) is { } denied)
            {
                return denied;
            }

            try
            {
                if (await changes.ApplyAsync(id, request.Ops, connectionId, ct) is not { } result)
                {
                    return Results.NotFound();
                }

                await history.AfterChangeAsync(id, ct);
                return Results.Ok(result);
            }
            catch (BoardOpException ex)
            {
                return Results.Problem(ex.Message, statusCode: StatusCodes.Status400BadRequest, title: "Invalid operation");
            }
        });

        return boards;
    }

    /// <summary>Null if the user has at least <paramref name="role"/> on the board, otherwise the response to send.</summary>
    public static async Task<IResult?> RequireRole(string id, string role, ClaimsPrincipal user, IBoardStore store, CancellationToken ct)
    {
        var mine = BoardRoles.RoleOf(await store.GetMembersAsync(id, ct), user.Id());
        if (mine is null)
        {
            return Results.NotFound();
        }

        return BoardRoles.Rank(mine) >= BoardRoles.Rank(role)
            ? null
            : Results.Problem($"You need to be {(role == BoardRoles.Owner ? "the owner" : "an editor")} of this board to do that.",
                statusCode: StatusCodes.Status403Forbidden, title: "Not allowed");
    }

    private static bool TryCleanTitle(string? raw, out string title, out IResult problem)
    {
        title = string.IsNullOrWhiteSpace(raw) ? "Untitled board" : raw.Trim();
        problem = Results.Empty;
        if (title.Length <= MaxTitleLength)
        {
            return true;
        }

        problem = Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["title"] = [$"Use at most {MaxTitleLength} characters."],
        });
        return false;
    }
}
