using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace CollabBoard.Api.Ai;

/// <summary>
/// Settings for the language model. Any OpenAI-compatible chat completions API works; the intended
/// one is the LLM Gateway (github.com/shubhiofficial-17/llm_gateway), which adds caching, budgets and
/// provider fallback in front of the real models.
/// </summary>
public sealed class AiOptions
{
    /// <summary>e.g. http://localhost:8080/v1. AI features are off when this is empty.</summary>
    public string? BaseUrl { get; set; }

    public string? ApiKey { get; set; }

    public string Model { get; set; } = "gpt-4o-mini";

    public int TimeoutSeconds { get; set; } = 30;

    public bool Enabled => !string.IsNullOrWhiteSpace(BaseUrl);
}

public interface ILlmClient
{
    /// <summary>Sends one system and one user message and returns the model's reply.</summary>
    Task<string> CompleteAsync(string system, string user, CancellationToken ct);
}

public sealed class LlmException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>Calls <c>{BaseUrl}/chat/completions</c> in the OpenAI format.</summary>
public sealed class OpenAiCompatibleClient(HttpClient http, AiOptions options) : ILlmClient
{
    public async Task<string> CompleteAsync(string system, string user, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{options.BaseUrl!.TrimEnd('/')}/chat/completions")
        {
            Content = JsonContent.Create(new ChatRequest(
                options.Model,
                [new ChatMessage("system", system), new ChatMessage("user", user)],
                Temperature: 0.2,
                ResponseFormat: new ResponseFormat("json_object"))),
        };
        if (!string.IsNullOrWhiteSpace(options.ApiKey))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", options.ApiKey);
        }

        HttpResponseMessage response;
        try
        {
            response = await http.SendAsync(request, ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            throw new LlmException("The language model couldn't be reached.", ex);
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                throw new LlmException($"The language model answered {(int)response.StatusCode}.");
            }

            var body = await response.Content.ReadFromJsonAsync<ChatResponse>(ct);
            return body?.Choices?.FirstOrDefault()?.Message?.Content ?? throw new LlmException("The language model sent an empty answer.");
        }
    }

    private sealed record ChatMessage(string Role, string Content);

    private sealed record ResponseFormat(string Type);

    private sealed record ChatRequest(
        string Model,
        IReadOnlyList<ChatMessage> Messages,
        double Temperature,
        [property: JsonPropertyName("response_format")] ResponseFormat ResponseFormat);

    private sealed record ChatResponse(IReadOnlyList<Choice>? Choices);

    private sealed record Choice(ChatMessage? Message);
}

internal static class AiJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
}
