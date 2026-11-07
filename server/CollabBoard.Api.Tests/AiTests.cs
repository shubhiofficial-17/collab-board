using System.Net;
using System.Net.Http.Json;
using CollabBoard.Api.Ai;
using CollabBoard.Api.Boards;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace CollabBoard.Api.Tests;

public sealed class DiagramGeneratorTests
{
    private const string Chain = """{"nodes":[{"id":"a","label":"Idea"},{"id":"b","label":"Build","group":2},{"id":"c","label":"Ship"}],"edges":[{"from":"a","to":"b"},{"from":"b","to":"c"}]}""";

    [Fact]
    public void Reads_json_even_inside_a_code_fence()
    {
        var spec = DiagramGenerator.Parse($"Here you go:\n```json\n{Chain}\n```");

        Assert.Equal(["a", "b", "c"], spec.Nodes.Select(n => n.Id));
        Assert.Equal(2, spec.Edges.Count);
    }

    [Fact]
    public void Drops_edges_to_unknown_nodes_and_duplicate_nodes()
    {
        var spec = DiagramGenerator.Parse("""
            {"nodes":[{"id":"a","label":"A"},{"id":"a","label":"Again"},{"id":"b","label":" "}],
             "edges":[{"from":"a","to":"zzz"},{"from":"a","to":"a"}]}
            """);

        Assert.Equal("A", Assert.Single(spec.Nodes).Label);
        Assert.Empty(spec.Edges);
    }

    [Theory]
    [InlineData("I can't help with that.")]
    [InlineData("""{"nodes":[]}""")]
    [InlineData("""{"nodes": "lots"}""")]
    public void Rejects_answers_without_a_diagram(string reply)
    {
        Assert.Throws<LlmException>(() => DiagramGenerator.Parse(reply));
    }

    [Fact]
    public void Lays_out_steps_top_to_bottom_as_valid_shapes()
    {
        var shapes = DiagramGenerator.Layout(DiagramGenerator.Parse(Chain), 1000, 500);

        var notes = shapes.Where(s => s.Kind == "sticky").ToList();
        var arrows = shapes.Where(s => s.Kind == "path").ToList();
        Assert.Equal(["Idea", "Build", "Ship"], notes.OrderBy(n => n.Y).Select(n => n.Text));
        Assert.Equal(2, arrows.Count);
        Assert.Equal(1000, notes.Average(n => n.X + n.W / 2), precision: 0);
        Assert.Equal(shapes.Count, shapes.Select(s => s.Id).Distinct().Count());

        // Everything must pass the same validation as shapes drawn by hand.
        BoardOps.Apply([], shapes.Select(s => new BoardOp { Type = "add", Shape = s }).ToList());
    }

    [Fact]
    public void Cycles_do_not_hang_the_layout()
    {
        var spec = DiagramGenerator.Parse("""
            {"nodes":[{"id":"a","label":"A"},{"id":"b","label":"B"}],"edges":[{"from":"a","to":"b"},{"from":"b","to":"a"}]}
            """);

        Assert.Equal(4, DiagramGenerator.Layout(spec, 0, 0).Count);
    }
}

public sealed class AiEndpointTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private sealed class FakeLlm(Func<string> reply) : ILlmClient
    {
        public string? LastPrompt { get; private set; }

        public Task<string> CompleteAsync(string system, string user, CancellationToken ct)
        {
            LastPrompt = user;
            return Task.FromResult(reply());
        }
    }

    private WebApplicationFactory<Program> WithLlm(FakeLlm llm) => factory.WithWebHostBuilder(builder =>
        builder.ConfigureTestServices(services =>
        {
            services.AddSingleton(new AiOptions { BaseUrl = "http://llm.test/v1" });
            services.AddSingleton<ILlmClient>(llm);
        }));

    private static async Task<string> NewBoardAsync(TestUser owner) =>
        (await (await owner.Client.PostAsJsonAsync("/api/boards", new { title = "AI" })).Content.ReadFromJsonAsync<Board>())!.Id;

    [Fact]
    public async Task Generates_shapes_without_saving_them()
    {
        var llm = new FakeLlm(() => """{"nodes":[{"id":"a","label":"Start"},{"id":"b","label":"End"}],"edges":[{"from":"a","to":"b"}]}""");
        var app = WithLlm(llm);
        var owner = await app.SignUpAsync();
        var board = await NewBoardAsync(owner);

        var response = await owner.Client.PostAsJsonAsync($"/api/boards/{board}/ai/diagram", new { prompt = "a two-step plan", x = 0, y = 0 });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<DiagramResult>();
        Assert.Equal(3, result!.Shapes.Count);
        Assert.Equal("a two-step plan", llm.LastPrompt);
        var content = await owner.Client.GetFromJsonAsync<BoardContent>($"/api/boards/{board}");
        Assert.Empty(content!.Shapes);
    }

    [Fact]
    public async Task A_bad_model_answer_is_a_502()
    {
        var app = WithLlm(new FakeLlm(() => "Sorry, no."));
        var owner = await app.SignUpAsync();
        var board = await NewBoardAsync(owner);

        var response = await owner.Client.PostAsJsonAsync($"/api/boards/{board}/ai/diagram", new { prompt = "anything", x = 0, y = 0 });

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
    }

    [Fact]
    public async Task Viewers_and_strangers_cannot_generate()
    {
        var app = WithLlm(new FakeLlm(() => "{}"));
        var owner = await app.SignUpAsync();
        var stranger = await app.SignUpAsync();
        var board = await NewBoardAsync(owner);

        var response = await stranger.Client.PostAsJsonAsync($"/api/boards/{board}/ai/diagram", new { prompt = "x", x = 0, y = 0 });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Is_off_until_configured()
    {
        var owner = await factory.SignUpAsync();
        var board = await NewBoardAsync(owner);

        var status = await owner.Client.GetFromJsonAsync<Dictionary<string, bool>>("/api/ai/status");
        var response = await owner.Client.PostAsJsonAsync($"/api/boards/{board}/ai/diagram", new { prompt = "x", x = 0, y = 0 });

        Assert.False(status!["enabled"]);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }
}
