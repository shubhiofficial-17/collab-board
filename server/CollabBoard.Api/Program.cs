using CollabBoard.Api.Boards;
using CollabBoard.Api.Realtime;
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
    builder.Services.AddHostedService<MongoIndexInitializer>();
}
else
{
    builder.Services.AddSingleton<IBoardStore, InMemoryBoardStore>();
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

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));
app.MapBoardEndpoints();
app.MapHub<BoardHub>(BoardHub.Path);

app.Run();

/// <summary>Exposed for WebApplicationFactory in integration tests.</summary>
public partial class Program
{
}
