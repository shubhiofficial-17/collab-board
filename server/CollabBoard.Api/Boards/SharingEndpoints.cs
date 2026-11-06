using System.Security.Claims;
using System.Security.Cryptography;
using CollabBoard.Api.Accounts;

namespace CollabBoard.Api.Boards;

public sealed record SharingMember(string UserId, string Name, string Email, string Role);

public sealed record Sharing(IReadOnlyList<SharingMember> Members, IReadOnlyList<ShareLink> Links);

public sealed record CreateLinkRequest(string? Role);

public sealed record ChangeRoleRequest(string? Role);

public sealed record AcceptedInvite(string BoardId, string Role);

/// <summary>
/// Sharing a board: invite links per role, and managing who has access. Only the owner manages sharing;
/// anyone can leave a board. See ADR 0008.
/// </summary>
public static class SharingEndpoints
{
    public static void MapSharingEndpoints(this IEndpointRouteBuilder app)
    {
        var boards = app.MapGroup("/api/boards/{id}").RequireAuthorization();

        boards.MapGet("/sharing", async (string id, ClaimsPrincipal user, IBoardStore store, IUserStore users, CancellationToken ct) =>
        {
            if (await BoardEndpoints.RequireRole(id, BoardRoles.Owner, user, store, ct) is { } denied)
            {
                return denied;
            }

            var members = new List<SharingMember>();
            foreach (var member in await store.GetMembersAsync(id, ct) ?? Array.Empty<BoardMember>())
            {
                var account = await users.FindByIdAsync(member.UserId, ct);
                members.Add(new SharingMember(member.UserId, account?.Name ?? "Unknown", account?.Email ?? "", member.Role));
            }

            return Results.Ok(new Sharing(
                members.OrderByDescending(m => BoardRoles.Rank(m.Role)).ThenBy(m => m.Name).ToList(),
                await store.GetShareLinksAsync(id, ct) ?? Array.Empty<ShareLink>()));
        });

        // Creates the link for a role, replacing (and so revoking) any previous one.
        boards.MapPost("/links", async (string id, CreateLinkRequest request, ClaimsPrincipal user, IBoardStore store, CancellationToken ct) =>
        {
            if (!IsShareableRole(request.Role))
            {
                return BadRole();
            }

            if (await BoardEndpoints.RequireRole(id, BoardRoles.Owner, user, store, ct) is { } denied)
            {
                return denied;
            }

            var link = new ShareLink(NewToken(), request.Role!);
            await store.SetShareLinkAsync(id, link.Role, link.Token, ct);
            return Results.Ok(link);
        });

        boards.MapDelete("/links/{role}", async (string id, string role, ClaimsPrincipal user, IBoardStore store, CancellationToken ct) =>
        {
            if (await BoardEndpoints.RequireRole(id, BoardRoles.Owner, user, store, ct) is { } denied)
            {
                return denied;
            }

            await store.SetShareLinkAsync(id, role, null, ct);
            return Results.NoContent();
        });

        boards.MapPut("/members/{userId}", async (string id, string userId, ChangeRoleRequest request, ClaimsPrincipal user, IBoardStore store, CancellationToken ct) =>
        {
            if (!IsShareableRole(request.Role))
            {
                return BadRole();
            }

            if (await BoardEndpoints.RequireRole(id, BoardRoles.Owner, user, store, ct) is { } denied)
            {
                return denied;
            }

            var current = BoardRoles.RoleOf(await store.GetMembersAsync(id, ct), userId);
            if (current is null)
            {
                return Results.NotFound();
            }

            if (current == BoardRoles.Owner)
            {
                return Results.Problem("The owner's role can't be changed.", statusCode: StatusCodes.Status400BadRequest);
            }

            await store.SetMemberAsync(id, new BoardMember(userId, request.Role!), ct);
            return Results.NoContent();
        });

        // The owner removes someone, or someone leaves (removes themselves).
        boards.MapDelete("/members/{userId}", async (string id, string userId, ClaimsPrincipal user, IBoardStore store, CancellationToken ct) =>
        {
            var leaving = userId == user.Id();
            if (await BoardEndpoints.RequireRole(id, leaving ? BoardRoles.Viewer : BoardRoles.Owner, user, store, ct) is { } denied)
            {
                return denied;
            }

            if (BoardRoles.RoleOf(await store.GetMembersAsync(id, ct), userId) == BoardRoles.Owner)
            {
                return Results.Problem("The owner can't leave their own board; delete it instead.", statusCode: StatusCodes.Status400BadRequest);
            }

            await store.RemoveMemberAsync(id, userId, ct);
            return Results.NoContent();
        });

        app.MapPost("/api/invites/{token}/accept", async (string token, ClaimsPrincipal user, IBoardStore store, CancellationToken ct) =>
        {
            if (token.Length > 64 || await store.FindShareLinkAsync(token, ct) is not { } target)
            {
                return Results.Problem("This invite link is invalid or has been turned off.", statusCode: StatusCodes.Status404NotFound);
            }

            // Opening a viewer link never takes away edit rights someone already has.
            var current = BoardRoles.RoleOf(await store.GetMembersAsync(target.BoardId, ct), user.Id());
            var role = BoardRoles.Rank(current) >= BoardRoles.Rank(target.Role) ? current! : target.Role;
            if (role != current)
            {
                await store.SetMemberAsync(target.BoardId, new BoardMember(user.Id(), role), ct);
            }

            return Results.Ok(new AcceptedInvite(target.BoardId, role));
        }).RequireAuthorization();
    }

    private static bool IsShareableRole(string? role) => role is BoardRoles.Editor or BoardRoles.Viewer;

    private static IResult BadRole() =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["role"] = ["Use \"editor\" or \"viewer\"."] });

    /// <summary>192 random bits, URL-safe.</summary>
    private static string NewToken() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(24)).Replace('+', '-').Replace('/', '_');
}
