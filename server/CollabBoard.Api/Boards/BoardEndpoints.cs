using CollabBoard.Api.Realtime;
using Microsoft.AspNetCore.Mvc;

namespace CollabBoard.Api.Boards;

public static class BoardEndpoints
{
    public const int MaxTitleLength = 120;

    public static RouteGroupBuilder MapBoardEndpoints(this IEndpointRouteBuilder app)
    {
        var boards = app.MapGroup("/api/boards");

        boards.MapGet("/", async (IBoardStore store, CancellationToken ct) => Results.Ok(await store.ListAsync(ct)));

        boards.MapGet("/{id}", async (string id, IBoardStore store, CancellationToken ct) =>
            await store.GetAsync(id, ct) is { } board ? Results.Ok(board) : Results.NotFound());

        boards.MapPost("/", async (CreateBoardRequest request, IBoardStore store, CancellationToken ct) =>
        {
            if (!TryCleanTitle(request.Title, out var title, out var problem))
            {
                return problem;
            }

            var board = await store.CreateAsync(title, ct);
            return Results.Created($"/api/boards/{board.Id}", board);
        });

        boards.MapPatch("/{id}", async (string id, RenameBoardRequest request, IBoardStore store, CancellationToken ct) =>
        {
            if (!TryCleanTitle(request.Title, out var title, out var problem))
            {
                return problem;
            }

            return await store.RenameAsync(id, title, ct) is { } board ? Results.Ok(board) : Results.NotFound();
        });

        boards.MapDelete("/{id}", async (string id, IBoardStore store, CancellationToken ct) =>
            await store.DeleteAsync(id, ct) ? Results.NoContent() : Results.NotFound());

        // Saves a batch of changes made in the editor, all or nothing, and broadcasts it to everyone else
        // viewing the board. X-Connection-Id is the sender's real-time connection, so it isn't echoed back.
        boards.MapPost("/{id}/ops", async (
            string id,
            ApplyOpsRequest request,
            [FromHeader(Name = "X-Connection-Id")] string? connectionId,
            BoardChanges changes,
            CancellationToken ct) =>
        {
            try
            {
                return await changes.ApplyAsync(id, request.Ops, connectionId, ct) is { } result ? Results.Ok(result) : Results.NotFound();
            }
            catch (BoardOpException ex)
            {
                return Results.Problem(ex.Message, statusCode: StatusCodes.Status400BadRequest, title: "Invalid operation");
            }
        });

        return boards;
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
