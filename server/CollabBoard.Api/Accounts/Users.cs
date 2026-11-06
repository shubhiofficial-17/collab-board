using System.Collections.Concurrent;
using System.Security.Claims;
using System.Security.Cryptography;
using MongoDB.Bson.Serialization.Attributes;
using MongoDB.Driver;

namespace CollabBoard.Api.Accounts;

/// <summary>An account. Emails are stored lower-cased and are unique.</summary>
public sealed class User
{
    [BsonId]
    public required string Id { get; set; }

    public required string Email { get; set; }

    public required string Name { get; set; }

    public required string PasswordHash { get; set; }

    [BsonDateTimeOptions(Kind = DateTimeKind.Utc)]
    public DateTime CreatedAt { get; set; }
}

/// <summary>What the web app gets to know about the signed-in user.</summary>
public sealed record Me(string Id, string Email, string Name);

public interface IUserStore
{
    /// <summary>Returns false if the email is already taken.</summary>
    Task<bool> CreateAsync(User user, CancellationToken ct);

    Task<User?> FindByEmailAsync(string email, CancellationToken ct);

    Task<User?> FindByIdAsync(string id, CancellationToken ct);
}

public sealed class InMemoryUserStore : IUserStore
{
    private readonly ConcurrentDictionary<string, User> _byEmail = new();
    private readonly ConcurrentDictionary<string, User> _byId = new();

    public Task<bool> CreateAsync(User user, CancellationToken ct)
    {
        if (!_byEmail.TryAdd(user.Email, user))
        {
            return Task.FromResult(false);
        }

        _byId[user.Id] = user;
        return Task.FromResult(true);
    }

    public Task<User?> FindByEmailAsync(string email, CancellationToken ct) =>
        Task.FromResult(_byEmail.GetValueOrDefault(email));

    public Task<User?> FindByIdAsync(string id, CancellationToken ct) => Task.FromResult(_byId.GetValueOrDefault(id));
}

public sealed class MongoUserStore(IMongoDatabase database) : IUserStore
{
    private readonly IMongoCollection<User> _users = database.GetCollection<User>("users");

    public async Task<bool> CreateAsync(User user, CancellationToken ct)
    {
        try
        {
            await _users.InsertOneAsync(user, cancellationToken: ct);
            return true;
        }
        catch (MongoWriteException ex) when (ex.WriteError.Category == ServerErrorCategory.DuplicateKey)
        {
            return false;
        }
    }

    public async Task<User?> FindByEmailAsync(string email, CancellationToken ct) =>
        await _users.Find(u => u.Email == email).FirstOrDefaultAsync(ct);

    public async Task<User?> FindByIdAsync(string id, CancellationToken ct) =>
        await _users.Find(u => u.Id == id).FirstOrDefaultAsync(ct);

    public static Task EnsureIndexesAsync(IMongoDatabase database, CancellationToken ct) =>
        database.GetCollection<User>("users").Indexes.CreateOneAsync(
            new CreateIndexModel<User>(Builders<User>.IndexKeys.Ascending(u => u.Email), new CreateIndexOptions { Unique = true }),
            cancellationToken: ct);
}

/// <summary>PBKDF2-SHA256 password hashes, stored as <c>v1.{iterations}.{salt}.{hash}</c> so the cost can be raised later.</summary>
public static class Passwords
{
    private const int Iterations = 210_000; // OWASP's 2023 recommendation for PBKDF2-SHA256
    private const int SaltBytes = 16;
    private const int HashBytes = 32;

    public static string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltBytes);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, HashBytes);
        return $"v1.{Iterations}.{Convert.ToBase64String(salt)}.{Convert.ToBase64String(hash)}";
    }

    public static bool Verify(string password, string stored)
    {
        var parts = stored.Split('.');
        if (parts.Length != 4 || parts[0] != "v1" || !int.TryParse(parts[1], out var iterations))
        {
            return false;
        }

        var salt = Convert.FromBase64String(parts[2]);
        var expected = Convert.FromBase64String(parts[3]);
        var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, expected.Length);
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }
}

public static class UserClaims
{
    /// <summary>The signed-in user's id. Only call on endpoints that require sign-in.</summary>
    public static string Id(this ClaimsPrincipal user) =>
        user.FindFirstValue(ClaimTypes.NameIdentifier) ?? throw new InvalidOperationException("Not signed in.");

    public static Me ToMe(this ClaimsPrincipal user) =>
        new(user.Id(), user.FindFirstValue(ClaimTypes.Email) ?? "", user.FindFirstValue(ClaimTypes.Name) ?? "");
}
