using System.Collections.Concurrent;

namespace CollabBoard.Api.Boards;

public sealed record Board(string Id, string Title, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

public sealed record CreateBoardRequest(string? Title);

public interface IBoardStore
{
    Task<Board> CreateAsync(string title, CancellationToken ct);

    Task<Board?> GetAsync(string id, CancellationToken ct);

    /// <summary>Most recently updated first.</summary>
    Task<IReadOnlyList<Board>> ListAsync(CancellationToken ct);
}

/// <summary>Placeholder store for the skeleton; MongoDB replaces it in milestone 3.</summary>
public sealed class InMemoryBoardStore(TimeProvider time) : IBoardStore
{
    private readonly ConcurrentDictionary<string, Board> _boards = new();

    public Task<Board> CreateAsync(string title, CancellationToken ct)
    {
        var now = time.GetUtcNow();
        var board = new Board(BoardIds.New(), title, now, now);
        _boards[board.Id] = board;
        return Task.FromResult(board);
    }

    public Task<Board?> GetAsync(string id, CancellationToken ct) => Task.FromResult(_boards.GetValueOrDefault(id));

    public Task<IReadOnlyList<Board>> ListAsync(CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<Board>>(_boards.Values.OrderByDescending(b => b.UpdatedAt).ToList());
}

public static class BoardIds
{
    private const string Alphabet = "abcdefghijkmnpqrstuvwxyz23456789"; // no look-alikes (l, 1, o, 0)

    /// <summary>Short, URL-friendly, unguessable id: 12 characters from 32 symbols = 60 bits.</summary>
    public static string New() => System.Security.Cryptography.RandomNumberGenerator.GetString(Alphabet, 12);
}

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
            var title = string.IsNullOrWhiteSpace(request.Title) ? "Untitled board" : request.Title.Trim();
            if (title.Length > MaxTitleLength)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["title"] = [$"Use at most {MaxTitleLength} characters."],
                });
            }

            var board = await store.CreateAsync(title, ct);
            return Results.Created($"/api/boards/{board.Id}", board);
        });

        return boards;
    }
}
