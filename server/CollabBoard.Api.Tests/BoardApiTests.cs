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
        var client = (await factory.SignUpAsync()).Client;

        var created = await client.PostAsJsonAsync("/api/boards", new { title = "  Sprint retro  " });
        var board = await created.Content.ReadFromJsonAsync<Board>();

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal("Sprint retro", board!.Title);
        Assert.Equal($"/api/boards/{board.Id}", created.Headers.Location!.ToString());

        var fetched = await client.GetFromJsonAsync<BoardContent>($"/api/boards/{board.Id}");
        Assert.Equal(board.Title, fetched!.Title);
        Assert.Empty(fetched.Shapes);
        Assert.Equal(0, fetched.Version);

        var all = await client.GetFromJsonAsync<List<Board>>("/api/boards");
        Assert.Contains(all!, b => b.Id == board.Id);
    }

    [Fact]
    public async Task Missing_title_gets_a_default()
    {
        var created = await (await factory.SignUpAsync()).Client.PostAsJsonAsync("/api/boards", new { });

        Assert.Equal("Untitled board", (await created.Content.ReadFromJsonAsync<Board>())!.Title);
    }

    [Fact]
    public async Task Overlong_title_is_rejected()
    {
        var response = await (await factory.SignUpAsync()).Client.PostAsJsonAsync("/api/boards", new { title = new string('x', 121) });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Unknown_board_is_404()
    {
        var response = await (await factory.SignUpAsync()).Client.GetAsync("/api/boards/doesnotexist");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public void Board_ids_are_short_and_unambiguous()
    {
        var ids = Enumerable.Range(0, 1000).Select(_ => BoardIds.New()).ToList();

        Assert.All(ids, id => Assert.Matches("^[a-km-np-z2-9]{12}$", id));
        Assert.Equal(ids.Count, ids.Distinct().Count());
    }

    [Fact]
    public async Task Saved_operations_come_back_when_the_board_is_opened()
    {
        var client = (await factory.SignUpAsync()).Client;
        var board = (await (await client.PostAsJsonAsync("/api/boards", new { title = "Ops" })).Content.ReadFromJsonAsync<Board>())!;

        var save = await client.PostAsJsonAsync($"/api/boards/{board.Id}/ops", new
        {
            ops = new object[]
            {
                new { type = "add", shape = new { id = "n1", kind = "sticky", x = 10, y = 20, w = 180, h = 140, color = "#fde68a", z = 1, text = "Hello" } },
                new { type = "update", id = "n1", patch = new { x = 15 } },
            },
        });

        Assert.Equal(HttpStatusCode.OK, save.StatusCode);
        var content = await client.GetFromJsonAsync<BoardContent>($"/api/boards/{board.Id}");
        var note = Assert.Single(content!.Shapes);
        Assert.Equal(15, note.X);
        Assert.Equal("Hello", note.Text);
        Assert.Equal(1, content.Version);
    }

    [Fact]
    public async Task Invalid_operations_get_a_400_problem()
    {
        var client = (await factory.SignUpAsync()).Client;
        var board = (await (await client.PostAsJsonAsync("/api/boards", new { })).Content.ReadFromJsonAsync<Board>())!;

        var response = await client.PostAsJsonAsync($"/api/boards/{board.Id}/ops", new
        {
            ops = new object[] { new { type = "add", shape = new { id = "x", kind = "hexagon", x = 0, y = 0, w = 1, h = 1, color = "#ffffff", z = 1 } } },
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("hexagon", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Boards_can_be_renamed_and_deleted()
    {
        var client = (await factory.SignUpAsync()).Client;
        var board = (await (await client.PostAsJsonAsync("/api/boards", new { title = "Draft" })).Content.ReadFromJsonAsync<Board>())!;

        var renamed = await client.PatchAsJsonAsync($"/api/boards/{board.Id}", new { title = "Final" });
        Assert.Equal("Final", (await renamed.Content.ReadFromJsonAsync<Board>())!.Title);

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/boards/{board.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/boards/{board.Id}")).StatusCode);
    }

    [Fact]
    public async Task Other_peoples_boards_are_invisible()
    {
        var alice = await factory.SignUpAsync("Alice");
        var bob = await factory.SignUpAsync("Bob");
        var board = (await (await alice.Client.PostAsJsonAsync("/api/boards", new { title = "Private" })).Content.ReadFromJsonAsync<Board>())!;

        Assert.Equal(BoardRoles.Owner, Assert.Single(board.Members).Role);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.Client.GetAsync($"/api/boards/{board.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.Client.DeleteAsync($"/api/boards/{board.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await bob.Client.PostAsJsonAsync($"/api/boards/{board.Id}/ops", new { ops = Array.Empty<object>() })).StatusCode);
        var bobsBoards = await bob.Client.GetFromJsonAsync<List<Board>>("/api/boards");
        Assert.DoesNotContain(bobsBoards!, b => b.Id == board.Id);
    }
}
