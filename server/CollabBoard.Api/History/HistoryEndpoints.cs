using System.Security.Claims;
using CollabBoard.Api.Boards;

namespace CollabBoard.Api.History;

public sealed record SaveVersionRequest(string? Name);

public static class HistoryEndpoints
{
    public const int MaxNameLength = 80;

    public static void MapHistoryEndpoints(this IEndpointRouteBuilder app)
    {
        var versions = app.MapGroup("/api/boards/{id}/versions").RequireAuthorization();

        versions.MapGet("/", async (string id, ClaimsPrincipal user, IBoardStore store, IVersionStore history, CancellationToken ct) =>
            await BoardEndpoints.RequireRole(id, BoardRoles.Viewer, user, store, ct) ?? Results.Ok(await history.ListAsync(id, ct)));

        versions.MapGet("/{versionId}", async (string id, string versionId, ClaimsPrincipal user, IBoardStore store, IVersionStore history, CancellationToken ct) =>
        {
            if (await BoardEndpoints.RequireRole(id, BoardRoles.Viewer, user, store, ct) is { } denied)
            {
                return denied;
            }

            return await history.GetAsync(id, versionId, ct) is { } v
                ? Results.Ok(new VersionDetail(v.Id, v.Name, new DateTimeOffset(v.CreatedAt, TimeSpan.Zero), v.Shapes))
                : Results.NotFound();
        });

        versions.MapPost("/", async (string id, SaveVersionRequest request, ClaimsPrincipal user, IBoardStore store, BoardHistory history, CancellationToken ct) =>
        {
            var name = request.Name?.Trim();
            if (string.IsNullOrEmpty(name) || name.Length > MaxNameLength)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = [$"Give the version a name of at most {MaxNameLength} characters."] });
            }

            if (await BoardEndpoints.RequireRole(id, BoardRoles.Editor, user, store, ct) is { } denied)
            {
                return denied;
            }

            return await history.SaveAsync(id, name, user.Identity?.Name, ct) is { } saved ? Results.Ok(saved) : Results.NotFound();
        });

        versions.MapPost("/{versionId}/restore", async (string id, string versionId, ClaimsPrincipal user, IBoardStore store, BoardHistory history, CancellationToken ct) =>
        {
            if (await BoardEndpoints.RequireRole(id, BoardRoles.Editor, user, store, ct) is { } denied)
            {
                return denied;
            }

            return await history.RestoreAsync(id, versionId, user.Identity?.Name, ct) is { } result ? Results.Ok(result) : Results.NotFound();
        });
    }
}
