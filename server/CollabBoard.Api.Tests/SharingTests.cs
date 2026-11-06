using System.Net;
using System.Net.Http.Json;
using CollabBoard.Api.Boards;
using Microsoft.AspNetCore.Mvc.Testing;

namespace CollabBoard.Api.Tests;

public sealed class SharingTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private static readonly object AddShape = new
    {
        ops = new object[] { new { type = "add", shape = new { id = "s1", kind = "rect", x = 0, y = 0, w = 1, h = 1, color = "#fde68a", z = 1 } } },
    };

    private static async Task<Board> NewBoardAsync(TestUser owner) =>
        (await (await owner.Client.PostAsJsonAsync("/api/boards", new { title = "Shared" })).Content.ReadFromJsonAsync<Board>())!;

    private static async Task<ShareLink> LinkAsync(TestUser owner, string boardId, string role)
    {
        var response = await owner.Client.PostAsJsonAsync($"/api/boards/{boardId}/links", new { role });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<ShareLink>())!;
    }

    private static Task<HttpResponseMessage> AcceptAsync(TestUser user, string token) =>
        user.Client.PostAsync($"/api/invites/{token}/accept", null);

    [Fact]
    public async Task An_editor_link_lets_people_edit()
    {
        var owner = await factory.SignUpAsync("Owner");
        var friend = await factory.SignUpAsync("Friend");
        var board = await NewBoardAsync(owner);
        var link = await LinkAsync(owner, board.Id, BoardRoles.Editor);

        var accepted = await (await AcceptAsync(friend, link.Token)).Content.ReadFromJsonAsync<AcceptedInvite>();

        Assert.Equal(new AcceptedInvite(board.Id, BoardRoles.Editor), accepted);
        Assert.Equal(HttpStatusCode.OK, (await friend.Client.PostAsJsonAsync($"/api/boards/{board.Id}/ops", AddShape)).StatusCode);
        Assert.Contains((await friend.Client.GetFromJsonAsync<List<Board>>("/api/boards"))!, b => b.Id == board.Id);
    }

    [Fact]
    public async Task A_viewer_link_lets_people_look_but_not_change()
    {
        var owner = await factory.SignUpAsync();
        var viewer = await factory.SignUpAsync();
        var board = await NewBoardAsync(owner);
        await AcceptAsync(viewer, (await LinkAsync(owner, board.Id, BoardRoles.Viewer)).Token);

        Assert.Equal(HttpStatusCode.OK, (await viewer.Client.GetAsync($"/api/boards/{board.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await viewer.Client.PostAsJsonAsync($"/api/boards/{board.Id}/ops", AddShape)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await viewer.Client.PatchAsJsonAsync($"/api/boards/{board.Id}", new { title = "Mine" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await viewer.Client.GetAsync($"/api/boards/{board.Id}/sharing")).StatusCode);
    }

    [Fact]
    public async Task A_viewer_link_never_downgrades_an_editor()
    {
        var owner = await factory.SignUpAsync();
        var editor = await factory.SignUpAsync();
        var board = await NewBoardAsync(owner);
        await AcceptAsync(editor, (await LinkAsync(owner, board.Id, BoardRoles.Editor)).Token);

        var accepted = await (await AcceptAsync(editor, (await LinkAsync(owner, board.Id, BoardRoles.Viewer)).Token))
            .Content.ReadFromJsonAsync<AcceptedInvite>();

        Assert.Equal(BoardRoles.Editor, accepted!.Role);
    }

    [Fact]
    public async Task Making_a_new_link_or_turning_it_off_revokes_the_old_one()
    {
        var owner = await factory.SignUpAsync();
        var board = await NewBoardAsync(owner);
        var first = await LinkAsync(owner, board.Id, BoardRoles.Editor);
        var second = await LinkAsync(owner, board.Id, BoardRoles.Editor);

        Assert.Equal(HttpStatusCode.NotFound, (await AcceptAsync(await factory.SignUpAsync(), first.Token)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await AcceptAsync(await factory.SignUpAsync(), second.Token)).StatusCode);

        await owner.Client.DeleteAsync($"/api/boards/{board.Id}/links/editor");
        Assert.Equal(HttpStatusCode.NotFound, (await AcceptAsync(await factory.SignUpAsync(), second.Token)).StatusCode);
    }

    [Fact]
    public async Task The_owner_manages_members_and_people_can_leave()
    {
        var owner = await factory.SignUpAsync("Owner");
        var friend = await factory.SignUpAsync("Friend");
        var board = await NewBoardAsync(owner);
        await AcceptAsync(friend, (await LinkAsync(owner, board.Id, BoardRoles.Viewer)).Token);

        var sharing = await owner.Client.GetFromJsonAsync<Sharing>($"/api/boards/{board.Id}/sharing");
        Assert.Equal(["Owner", "Friend"], sharing!.Members.Select(m => m.Name));
        Assert.Equal(BoardRoles.Viewer, Assert.Single(sharing.Links).Role);

        var promote = await owner.Client.PutAsJsonAsync($"/api/boards/{board.Id}/members/{friend.Me.Id}", new { role = "editor" });
        Assert.Equal(HttpStatusCode.NoContent, promote.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await friend.Client.PostAsJsonAsync($"/api/boards/{board.Id}/ops", AddShape)).StatusCode);

        Assert.Equal(HttpStatusCode.BadRequest,
            (await owner.Client.DeleteAsync($"/api/boards/{board.Id}/members/{owner.Me.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,
            (await friend.Client.DeleteAsync($"/api/boards/{board.Id}/members/{friend.Me.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await friend.Client.GetAsync($"/api/boards/{board.Id}")).StatusCode);
    }

    [Fact]
    public async Task Only_the_owner_can_share_or_delete()
    {
        var owner = await factory.SignUpAsync();
        var editor = await factory.SignUpAsync();
        var board = await NewBoardAsync(owner);
        await AcceptAsync(editor, (await LinkAsync(owner, board.Id, BoardRoles.Editor)).Token);

        Assert.Equal(HttpStatusCode.Forbidden, (await editor.Client.PostAsJsonAsync($"/api/boards/{board.Id}/links", new { role = "editor" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await editor.Client.DeleteAsync($"/api/boards/{board.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PostAsJsonAsync($"/api/boards/{board.Id}/links", new { role = "owner" })).StatusCode);
    }
}
