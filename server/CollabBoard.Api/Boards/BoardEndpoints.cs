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

        // Saves a batch of changes made in the editor. Applied atomically: all or nothing.
        boards.MapPost("/{id}/ops", async (string id, ApplyOpsRequest request, IBoardStore store, CancellationToken ct) =>
        {
            try
            {
                return await store.ApplyOpsAsync(id, request.Ops, ct) is { } result ? Results.Ok(result) : Results.NotFound();
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
