using System.Security.Claims;
using System.Threading.RateLimiting;
using CollabBoard.Api.Accounts;
using CollabBoard.Api.Boards;
using Microsoft.AspNetCore.RateLimiting;

namespace CollabBoard.Api.Ai;

public sealed record DiagramRequest(string? Prompt, double X, double Y);

public sealed record DiagramResult(IReadOnlyList<Shape> Shapes);

public static class AiEndpoints
{
    public const string RateLimitPolicy = "ai";

    public static IServiceCollection AddAi(this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection("Ai").Get<AiOptions>() ?? new AiOptions();
        services.AddSingleton(options);
        services.AddHttpClient<ILlmClient, OpenAiCompatibleClient>(http => http.Timeout = TimeSpan.FromSeconds(options.TimeoutSeconds));
        services.AddTransient<DiagramGenerator>();

        // Model calls cost money: each user gets a few per minute.
        services.AddRateLimiter(limiter =>
        {
            limiter.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            limiter.AddPolicy(RateLimitPolicy, context => RateLimitPartition.GetFixedWindowLimiter(
                context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "anonymous",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }));
        });
        return services;
    }

    public static void MapAiEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/ai/status", (AiOptions options) => Results.Ok(new { enabled = options.Enabled })).RequireAuthorization();

        // Returns shapes for the client to add to the board as an ordinary (undoable) change. Nothing is
        // saved here, so the generated diagram goes through the same validation and sync as anything drawn.
        app.MapPost("/api/boards/{id}/ai/diagram", async (
            string id,
            DiagramRequest request,
            ClaimsPrincipal user,
            IBoardStore store,
            AiOptions options,
            DiagramGenerator generator,
            ILoggerFactory loggers,
            CancellationToken ct) =>
        {
            if (!options.Enabled)
            {
                return Results.Problem("AI isn't set up on this server.", statusCode: StatusCodes.Status503ServiceUnavailable);
            }

            var prompt = request.Prompt?.Trim() ?? "";
            if (prompt.Length is 0 or > DiagramGenerator.MaxPromptLength || !double.IsFinite(request.X) || !double.IsFinite(request.Y))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["prompt"] = [$"Describe the diagram in at most {DiagramGenerator.MaxPromptLength} characters."],
                });
            }

            if (await BoardEndpoints.RequireRole(id, BoardRoles.Editor, user, store, ct) is { } denied)
            {
                return denied;
            }

            try
            {
                var x = Math.Clamp(request.X, -900_000, 900_000);
                var y = Math.Clamp(request.Y, -900_000, 900_000);
                return Results.Ok(new DiagramResult(await generator.GenerateAsync(prompt, x, y, ct)));
            }
            catch (LlmException ex)
            {
                loggers.CreateLogger("CollabBoard.Ai").LogWarning(ex, "Diagram generation failed for board {BoardId}", id);
                return Results.Problem($"{ex.Message} Try again or rephrase.", statusCode: StatusCodes.Status502BadGateway);
            }
        }).RequireAuthorization().RequireRateLimiting(RateLimitPolicy);
    }
}
