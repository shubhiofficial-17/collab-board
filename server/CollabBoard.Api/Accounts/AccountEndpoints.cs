using System.Security.Claims;
using CollabBoard.Api.Boards;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace CollabBoard.Api.Accounts;

public sealed record SignUpRequest(string? Email, string? Name, string? Password);

public sealed record SignInRequest(string? Email, string? Password);

/// <summary>
/// Email and password accounts with a session cookie (HttpOnly, SameSite=Lax). The web app and API are
/// served from the same origin, so a cookie is simpler and safer than tokens in JavaScript. See ADR 0007.
/// </summary>
public static class AccountEndpoints
{
    public const int MinPasswordLength = 8;
    public const string RateLimitPolicy = "sign-in";

    // Verified when the email is unknown, so a wrong email takes as long as a wrong password.
    private static readonly string DummyHash = Passwords.Hash(Guid.NewGuid().ToString());

    public static RouteGroupBuilder MapAccountEndpoints(this IEndpointRouteBuilder app)
    {
        var account = app.MapGroup("/api/account");

        account.MapPost("/signup", async (SignUpRequest request, IUserStore users, TimeProvider time, HttpContext http, CancellationToken ct) =>
        {
            var email = NormalizeEmail(request.Email);
            var name = request.Name?.Trim() ?? "";
            var errors = new Dictionary<string, string[]>();
            if (email is null)
            {
                errors["email"] = ["Enter a valid email address."];
            }

            if (name.Length is 0 or > 60)
            {
                errors["name"] = ["Enter a name of at most 60 characters."];
            }

            if (request.Password is not { Length: >= MinPasswordLength and <= 200 })
            {
                errors["password"] = [$"Use at least {MinPasswordLength} characters."];
            }

            if (errors.Count > 0)
            {
                return Results.ValidationProblem(errors);
            }

            var user = new User
            {
                Id = BoardIds.New(),
                Email = email!,
                Name = name,
                PasswordHash = Passwords.Hash(request.Password!),
                CreatedAt = time.GetUtcNow().UtcDateTime,
            };
            if (!await users.CreateAsync(user, ct))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["email"] = ["An account with this email already exists."] });
            }

            await SignInAsync(http, user);
            return Results.Ok(new Me(user.Id, user.Email, user.Name));
        }).RequireRateLimiting(RateLimitPolicy);

        account.MapPost("/signin", async (SignInRequest request, IUserStore users, HttpContext http, CancellationToken ct) =>
        {
            var email = NormalizeEmail(request.Email);
            var user = email is null ? null : await users.FindByEmailAsync(email, ct);
            var valid = Passwords.Verify(request.Password ?? "", user?.PasswordHash ?? DummyHash);
            if (user is null || !valid)
            {
                return Results.Problem("Wrong email or password.", statusCode: StatusCodes.Status401Unauthorized, title: "Sign-in failed");
            }

            await SignInAsync(http, user);
            return Results.Ok(new Me(user.Id, user.Email, user.Name));
        }).RequireRateLimiting(RateLimitPolicy);

        account.MapPost("/signout", async (HttpContext http) =>
        {
            await http.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.NoContent();
        });

        account.MapGet("/me", (ClaimsPrincipal user) =>
            user.Identity?.IsAuthenticated == true ? Results.Ok(user.ToMe()) : Results.Unauthorized());

        return account;
    }

    private static string? NormalizeEmail(string? raw)
    {
        var email = raw?.Trim().ToLowerInvariant();
        return email is { Length: >= 3 and <= 254 } && email.IndexOf('@') is > 0 and var at && at < email.Length - 1 && !email.Contains(' ')
            ? email
            : null;
    }

    private static Task SignInAsync(HttpContext http, User user)
    {
        var identity = new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, user.Id),
                new Claim(ClaimTypes.Email, user.Email),
                new Claim(ClaimTypes.Name, user.Name),
            ],
            CookieAuthenticationDefaults.AuthenticationScheme);
        return http.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity),
            new AuthenticationProperties { IsPersistent = true });
    }
}
