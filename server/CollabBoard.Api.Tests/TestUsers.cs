using System.Net.Http.Json;
using CollabBoard.Api.Accounts;
using Microsoft.AspNetCore.Mvc.Testing;

namespace CollabBoard.Api.Tests;

/// <summary>A signed-up user with an HTTP client that sends their session cookie.</summary>
public sealed record TestUser(HttpClient Client, string Cookie, Me Me);

public static class TestUsers
{
    public static async Task<TestUser> SignUpAsync(this WebApplicationFactory<Program> factory, string name = "Tester")
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        var response = await client.PostAsJsonAsync("/api/account/signup", new
        {
            email = $"{Guid.NewGuid():N}@example.com",
            name,
            password = "correct horse battery",
        });
        response.EnsureSuccessStatusCode();

        var cookie = SessionCookie(response);
        client.DefaultRequestHeaders.Add("Cookie", cookie);
        return new TestUser(client, cookie, (await response.Content.ReadFromJsonAsync<Me>())!);
    }

    public static string SessionCookie(HttpResponseMessage response) =>
        response.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith("cb_auth=")).Split(';')[0];
}
