using CollabBoard.Api.Boards;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<IBoardStore, InMemoryBoardStore>();
builder.Services.AddProblemDetails();

var app = builder.Build();

app.UseExceptionHandler();

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));
app.MapBoardEndpoints();

app.Run();

/// <summary>Exposed for WebApplicationFactory in integration tests.</summary>
public partial class Program
{
}
