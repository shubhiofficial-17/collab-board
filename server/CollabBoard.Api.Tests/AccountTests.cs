using System.Net;
using System.Net.Http.Json;
using CollabBoard.Api.Accounts;
using Microsoft.AspNetCore.Mvc.Testing;

namespace CollabBoard.Api.Tests;

public sealed class AccountTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private HttpClient Anonymous() => factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });

    [Fact]
    public async Task Sign_up_signs_you_in()
    {
        var user = await factory.SignUpAsync("Ada");

        var me = await user.Client.GetFromJsonAsync<Me>("/api/account/me");

        Assert.Equal("Ada", me!.Name);
        Assert.Equal(user.Me.Id, me.Id);
    }

    [Fact]
    public async Task Sign_in_with_the_right_password_only()
    {
        var email = $"{Guid.NewGuid():N}@Example.com";
        (await Anonymous().PostAsJsonAsync("/api/account/signup", new { email, name = "Bo", password = "s3cret-pass" })).EnsureSuccessStatusCode();

        var wrong = await Anonymous().PostAsJsonAsync("/api/account/signin", new { email, password = "nope-nope" });
        var right = await Anonymous().PostAsJsonAsync("/api/account/signin", new { email = email.ToUpperInvariant(), password = "s3cret-pass" });

        Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);
        Assert.Equal(HttpStatusCode.OK, right.StatusCode);
        Assert.StartsWith("cb_auth=", TestUsers.SessionCookie(right));
    }

    [Fact]
    public async Task An_email_can_only_be_used_once()
    {
        var email = $"{Guid.NewGuid():N}@example.com";
        await Anonymous().PostAsJsonAsync("/api/account/signup", new { email, name = "One", password = "password1" });

        var again = await Anonymous().PostAsJsonAsync("/api/account/signup", new { email, name = "Two", password = "password2" });

        Assert.Equal(HttpStatusCode.BadRequest, again.StatusCode);
    }

    [Theory]
    [InlineData("not-an-email", "Name", "password1")]
    [InlineData("a@b.co", "", "password1")]
    [InlineData("a@b.co", "Name", "short")]
    public async Task Sign_up_input_is_validated(string email, string name, string password)
    {
        var response = await Anonymous().PostAsJsonAsync("/api/account/signup", new { email, name, password });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Boards_need_you_to_be_signed_in()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await Anonymous().GetAsync("/api/boards")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Anonymous().GetAsync("/api/account/me")).StatusCode);
    }

    [Fact]
    public void Password_hashes_verify_and_are_salted()
    {
        var first = Passwords.Hash("hunter22");
        var second = Passwords.Hash("hunter22");

        Assert.NotEqual(first, second);
        Assert.True(Passwords.Verify("hunter22", first));
        Assert.False(Passwords.Verify("hunter23", first));
        Assert.False(Passwords.Verify("hunter22", "garbage"));
    }
}
