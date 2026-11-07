using CollabBoard.Api.Accounts;
using CollabBoard.Api.Ai;
using CollabBoard.Api.Boards;
using CollabBoard.Api.History;
using CollabBoard.Api.Realtime;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using System.Security.Claims;
using System.Threading.RateLimiting;
using MongoDB.Driver;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddProblemDetails();

// Storage: MongoDB when a connection string is set, otherwise in-memory (tests, quick local runs).
var mongo = builder.Configuration.GetConnectionString("Mongo");
if (!string.IsNullOrWhiteSpace(mongo))
{
    MongoConventions.Register();

    var url = MongoUrl.Create(mongo);
    builder.Services.AddSingleton<IMongoClient>(_ => new MongoClient(url));
    builder.Services.AddSingleton(sp => sp.GetRequiredService<IMongoClient>().GetDatabase(url.DatabaseName ?? "collab"));
    builder.Services.AddSingleton<IBoardStore, MongoBoardStore>();
    builder.Services.AddSingleton<IUserStore, MongoUserStore>();
    builder.Services.AddSingleton<IVersionStore, MongoVersionStore>();
    builder.Services.AddHostedService<MongoIndexInitializer>();
}
else
{
    builder.Services.AddSingleton<IBoardStore, InMemoryBoardStore>();
    builder.Services.AddSingleton<IUserStore, InMemoryUserStore>();
    builder.Services.AddSingleton<IVersionStore, InMemoryVersionStore>();
}

// Accounts: a session cookie. API calls get 401/403 instead of the default redirect to a login page.
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "cb_auth";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        options.ExpireTimeSpan = TimeSpan.FromDays(30);
        options.SlidingExpiration = true;
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = context =>
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        };
    });
builder.Services.AddAuthorization();

// Cookies are encrypted with Data Protection keys. Keep them on disk when configured (a Docker volume),
// so restarts and multiple instances don't sign everyone out.
var keysPath = builder.Configuration["DataProtection:KeysPath"];
if (!string.IsNullOrWhiteSpace(keysPath))
{
    builder.Services.AddDataProtection().PersistKeysToFileSystem(new DirectoryInfo(keysPath)).SetApplicationName("collab-board");
}

// Real time: SignalR, with a Redis backplane when several server instances share the load.
var signalR = builder.Services.AddSignalR();
var redis = builder.Configuration.GetConnectionString("Redis");
if (!string.IsNullOrWhiteSpace(redis))
{
    signalR.AddStackExchangeRedis(redis, options => options.Configuration.ChannelPrefix = StackExchange.Redis.RedisChannel.Literal("collab-board"));
}

builder.Services.AddSingleton<PresenceTracker>();
builder.Services.AddSingleton<BoardChanges>();
builder.Services.AddSingleton<BoardHistory>();

// AI: prompt to diagram through an OpenAI-compatible API (the LLM Gateway). Off unless Ai:BaseUrl is set.
builder.Services.AddAi(builder.Configuration);

builder.Services.AddRateLimiter(limiter =>
{
    limiter.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    // Sign-in and sign-up, per client address, to slow down password guessing. (Requests without an
    // address only come from the in-process test server.)
    var signInPerMinute = builder.Configuration.GetValue("RateLimits:SignInPerMinute", 20);
    limiter.AddPolicy(AccountEndpoints.RateLimitPolicy, context => context.Connection.RemoteIpAddress is { } ip
        ? RateLimitPartition.GetFixedWindowLimiter(ip.ToString(), _ => new FixedWindowRateLimiterOptions { PermitLimit = signInPerMinute, Window = TimeSpan.FromMinutes(1) })
        : RateLimitPartition.GetNoLimiter("test"));

    // Model calls cost money: each user gets a few per minute.
    limiter.AddPolicy(AiEndpoints.RateLimitPolicy, context => RateLimitPartition.GetFixedWindowLimiter(
        context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "anonymous",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }));
});

// Behind nginx (or another proxy): take the client's address and scheme from X-Forwarded-*, so
// rate limits see real clients and cookies are marked Secure when the site is served over HTTPS.
// Only turn this on when the server can't be reached except through the proxy.
var behindProxy = builder.Configuration.GetValue<bool>("ForwardedHeaders:Enabled");
if (behindProxy)
{
    builder.Services.Configure<ForwardedHeadersOptions>(options =>
    {
        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        options.KnownNetworks.Clear();
        options.KnownProxies.Clear();
    });
}

var app = builder.Build();

if (behindProxy)
{
    app.UseForwardedHeaders();
}

app.UseExceptionHandler();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));
app.MapAccountEndpoints();
app.MapBoardEndpoints();
app.MapSharingEndpoints();
app.MapHistoryEndpoints();
app.MapAiEndpoints();
app.MapHub<BoardHub>(BoardHub.Path);

app.Run();

/// <summary>Exposed for WebApplicationFactory in integration tests.</summary>
public partial class Program
{
}
