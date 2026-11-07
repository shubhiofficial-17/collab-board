using CollabBoard.Api.Accounts;
using CollabBoard.Api.Boards;
using CollabBoard.Api.Realtime;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
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
    builder.Services.AddHostedService<MongoIndexInitializer>();
}
else
{
    builder.Services.AddSingleton<IBoardStore, InMemoryBoardStore>();
    builder.Services.AddSingleton<IUserStore, InMemoryUserStore>();
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

var app = builder.Build();

app.UseExceptionHandler();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));
app.MapAccountEndpoints();
app.MapBoardEndpoints();
app.MapSharingEndpoints();
app.MapHub<BoardHub>(BoardHub.Path);

app.Run();

/// <summary>Exposed for WebApplicationFactory in integration tests.</summary>
public partial class Program
{
}
