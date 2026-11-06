using System.Net;
using System.Net.Http.Json;
using CollabBoard.Api.Boards;
using Microsoft.AspNetCore.Mvc.Testing;

namespace CollabBoard.Api.Tests;

public sealed class BoardApiTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task Health_endpoint_reports_ok()
    {
        var response = await factory.CreateClient().GetAsync("/api/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Created_board_can_be_fetched_and_is_listed()
    {
        var client = factory.CreateClient();

        var created = await client.PostAsJsonAsync("/api/boards", new { title = "  Sprint retro  " });
        var board = await created.Content.ReadFromJsonAsync<Board>();

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal("Sprint retro", board!.Title);
        Assert.Equal($"/api/boards/{board.Id}", created.Headers.Location!.ToString());

        var fetched = await client.GetFromJsonAsync<Board>($"/api/boards/{board.Id}");
        Assert.Equal(board, fetched);

        var all = await client.GetFromJsonAsync<List<Board>>("/api/boards");
        Assert.Contains(all!, b => b.Id == board.Id);
    }

    [Fact]
    public async Task Missing_title_gets_a_default()
    {
        var created = await factory.CreateClient().PostAsJsonAsync("/api/boards", new { });

        Assert.Equal("Untitled board", (await created.Content.ReadFromJsonAsync<Board>())!.Title);
    }

    [Fact]
    public async Task Overlong_title_is_rejected()
    {
        var response = await factory.CreateClient().PostAsJsonAsync("/api/boards", new { title = new string('x', 121) });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Unknown_board_is_404()
    {
        var response = await factory.CreateClient().GetAsync("/api/boards/doesnotexist");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public void Board_ids_are_short_and_unambiguous()
    {
        var ids = Enumerable.Range(0, 1000).Select(_ => BoardIds.New()).ToList();

        Assert.All(ids, id => Assert.Matches("^[a-km-np-z2-9]{12}$", id));
        Assert.Equal(ids.Count, ids.Distinct().Count());
    }
}
