using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace CollabBoard.Api.Boards;

/// <summary>One item on a board. Mirrors the web app's Shape type (web/src/app/board/model/shapes.ts).</summary>
public sealed class Shape
{
    public required string Id { get; set; }

    /// <summary>"" for a placeholder: a shape we've seen updates for but not its add yet (see ADR 0005).</summary>
    public required string Kind { get; set; }
    public double X { get; set; }
    public double Y { get; set; }
    public double W { get; set; }
    public double H { get; set; }
    public required string Color { get; set; }
    public double Z { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Text { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double[]? Points { get; set; }

    /// <summary>Deleted shapes stay as tombstones, so a delete merges correctly with edits made at the same time.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public bool Deleted { get; set; }

    /// <summary>Timestamp of the last write to each field.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public Dictionary<string, string>? Clock { get; set; }

    public Shape Clone()
    {
        var copy = (Shape)MemberwiseClone();
        copy.Points = Points?.ToArray();
        copy.Clock = Clock is null ? null : new Dictionary<string, string>(Clock);
        return copy;
    }
}

/// <summary>
/// A change to a board, as sent by the web app: add a shape, update some of its fields, or delete it.
/// <see cref="Ts"/> is the hybrid logical clock timestamp the change was made at (ADR 0005).
/// </summary>
public sealed class BoardOp
{
    public required string Type { get; set; }
    public Shape? Shape { get; set; }
    public string? Id { get; set; }
    public JsonElement? Patch { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Ts { get; set; }
}

public sealed class BoardOpException(string message) : Exception(message);

/// <summary>
/// Merges operations into a board. Shared by every board store, so they behave identically, and the
/// same rules as the web app's crdt.ts: every field keeps the value with the newest timestamp, so
/// the result doesn't depend on the order changes arrive in (ADR 0005).
/// </summary>
public static partial class BoardOps
{
    public const int MaxShapes = 5_000;
    /// <summary>Including tombstones.</summary>
    public const int MaxStoredShapes = 20_000;
    public const int MaxOpsPerRequest = 500;
    public const int MaxTextLength = 2_000;
    public const int MaxPathNumbers = 20_000;
    private const double MaxCoordinate = 1_000_000;
    private static readonly TimeSpan MaxClockSkew = TimeSpan.FromMinutes(5);

    private static readonly HashSet<string> Kinds = ["rect", "ellipse", "sticky", "path"];

    /// <summary>Timestamps for operations that arrive without one (older clients, tests, scripts).</summary>
    private static readonly ServerClock Clock = new();

    public static bool IsVisible(Shape shape) => !shape.Deleted && shape.Kind != "";

    /// <summary>
    /// Merges <paramref name="ops"/> into <paramref name="shapes"/> in place. Operations without a timestamp
    /// are given one (written back to the op, so it is broadcast with it). Invalid input throws.
    /// </summary>
    public static void Apply(List<Shape> shapes, IReadOnlyList<BoardOp> ops, DateTimeOffset? now = null)
    {
        if (ops.Count > MaxOpsPerRequest)
        {
            throw new BoardOpException($"At most {MaxOpsPerRequest} operations per request.");
        }

        var latestAllowed = (now ?? DateTimeOffset.UtcNow) + MaxClockSkew;
        var index = shapes.Select((s, i) => (s.Id, i)).ToDictionary(p => p.Id, p => p.i);
        var touched = new HashSet<string>();

        foreach (var op in ops)
        {
            if (op.Ts is null)
            {
                op.Ts = Clock.Tick();
            }
            else if (HybridTimestamp.Parse(op.Ts) is not { } ts)
            {
                throw new BoardOpException("Invalid timestamp.");
            }
            else if (ts.Wall > latestAllowed.ToUnixTimeMilliseconds())
            {
                throw new BoardOpException("Timestamp is too far in the future; check the device clock.");
            }
            else
            {
                Clock.Observe(ts);
            }

            var id = op.Type switch
            {
                "add" => (op.Shape ?? throw new BoardOpException("'add' needs a shape.")).Id,
                "update" or "delete" => op.Id ?? throw new BoardOpException($"'{op.Type}' needs an id."),
                _ => throw new BoardOpException($"Unknown operation '{op.Type}'."),
            };

            if (!index.TryGetValue(id, out var i))
            {
                if (shapes.Count >= MaxStoredShapes)
                {
                    throw new BoardOpException($"A board holds at most {MaxShapes} shapes.");
                }

                i = shapes.Count;
                index[id] = i;
                shapes.Add(new Shape { Id = id, Kind = "", Color = "#000000" });
            }

            var shape = shapes[i].Clone();
            switch (op.Type)
            {
                case "add":
                    MergeAdd(shape, op.Shape!, op.Ts);
                    break;
                case "update":
                    MergeUpdate(shape, op.Patch, op.Ts);
                    break;
                case "delete":
                    Merge(shape, "deleted", op.Ts, s => s.Deleted = true);
                    break;
            }

            shapes[i] = shape;
            touched.Add(id);
        }

        foreach (var id in touched)
        {
            var shape = shapes[index[id]];
            if (IsVisible(shape))
            {
                Validate(shape);
            }
        }

        if (shapes.Count(IsVisible) > MaxShapes)
        {
            throw new BoardOpException($"A board holds at most {MaxShapes} shapes.");
        }
    }

    private static void MergeAdd(Shape shape, Shape added, string ts)
    {
        Validate(added);
        Merge(shape, "kind", ts, s => s.Kind = added.Kind);
        Merge(shape, "x", ts, s => s.X = added.X);
        Merge(shape, "y", ts, s => s.Y = added.Y);
        Merge(shape, "w", ts, s => s.W = added.W);
        Merge(shape, "h", ts, s => s.H = added.H);
        Merge(shape, "z", ts, s => s.Z = added.Z);
        Merge(shape, "color", ts, s => s.Color = added.Color);
        Merge(shape, "text", ts, s => s.Text = added.Text);
        Merge(shape, "points", ts, s => s.Points = added.Points?.ToArray());
        Merge(shape, "deleted", ts, s => s.Deleted = false);
    }

    private static void MergeUpdate(Shape shape, JsonElement? patchElement, string ts)
    {
        if (patchElement is not { ValueKind: JsonValueKind.Object } patch)
        {
            throw new BoardOpException("'update' needs a patch object.");
        }

        // Check the values on their own first, so a bad patch is rejected even if it loses the merge.
        Validate(ApplyPatch(new Shape { Id = "check", Kind = "rect", Color = "#000000" }, patch));

        foreach (var field in patch.EnumerateObject())
        {
            Merge(shape, field.Name, ts, s => SetField(s, field));
        }
    }

    /// <summary>Last writer wins: the write happens only if it is newer than the field's last write.</summary>
    private static void Merge(Shape shape, string field, string ts, Action<Shape> write)
    {
        shape.Clock ??= new Dictionary<string, string>();
        if (!shape.Clock.TryGetValue(field, out var current) || string.CompareOrdinal(ts, current) > 0)
        {
            write(shape);
            shape.Clock[field] = ts;
        }
    }

    private static Shape ApplyPatch(Shape shape, JsonElement patch)
    {
        foreach (var field in patch.EnumerateObject())
        {
            SetField(shape, field);
        }

        return shape;
    }

    private static void SetField(Shape shape, JsonProperty field)
    {
        switch (field.Name)
        {
            case "x": shape.X = Number(field); break;
            case "y": shape.Y = Number(field); break;
            case "w": shape.W = Number(field); break;
            case "h": shape.H = Number(field); break;
            case "z": shape.Z = Number(field); break;
            case "color": shape.Color = field.Value.GetString() ?? throw Invalid(field); break;
            case "text": shape.Text = field.Value.ValueKind == JsonValueKind.Null ? null : field.Value.GetString(); break;
            case "points":
                shape.Points = field.Value.ValueKind == JsonValueKind.Null
                    ? null
                    : field.Value.EnumerateArray().Select(v => v.GetDouble()).ToArray();
                break;
            default:
                throw new BoardOpException($"Field '{field.Name}' can't be updated.");
        }
    }
    private static double Number(JsonProperty field) =>
        field.Value.ValueKind == JsonValueKind.Number ? field.Value.GetDouble() : throw Invalid(field);

    private static BoardOpException Invalid(JsonProperty field) => new($"Invalid value for '{field.Name}'.");

    private static void Validate(Shape shape)
    {
        if (string.IsNullOrWhiteSpace(shape.Id) || shape.Id.Length > 64)
        {
            throw new BoardOpException("Shape ids must be 1–64 characters.");
        }

        if (!Kinds.Contains(shape.Kind))
        {
            throw new BoardOpException($"Unknown shape kind '{shape.Kind}'.");
        }

        if (!ColorPattern().IsMatch(shape.Color))
        {
            throw new BoardOpException("Colours must look like #a1b2c3.");
        }

        foreach (var v in new[] { shape.X, shape.Y, shape.W, shape.H, shape.Z })
        {
            if (!double.IsFinite(v) || Math.Abs(v) > MaxCoordinate)
            {
                throw new BoardOpException("Coordinates must be finite and within ±1,000,000.");
            }
        }

        if (shape.W < 0 || shape.H < 0)
        {
            throw new BoardOpException("Width and height can't be negative.");
        }

        if (shape.Text is { Length: > MaxTextLength })
        {
            throw new BoardOpException($"Text is limited to {MaxTextLength} characters.");
        }

        if (shape.Points is { } points && (points.Length > MaxPathNumbers || points.Length % 2 != 0 || points.Any(p => !double.IsFinite(p))))
        {
            throw new BoardOpException($"A path needs pairs of finite numbers, at most {MaxPathNumbers}.");
        }
    }

    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex ColorPattern();
}

/// <summary>A parsed hybrid logical clock timestamp, <c>{wall ms:13}:{counter:4}:{client}</c>. See web/src/app/board/model/clock.ts.</summary>
public readonly partial record struct HybridTimestamp(long Wall, int Counter, string ClientId)
{
    public override string ToString() => $"{Wall:D13}:{Counter:D4}:{ClientId}";

    public static HybridTimestamp? Parse(string value)
    {
        var match = Pattern().Match(value);
        return match.Success
            ? new HybridTimestamp(long.Parse(match.Groups[1].Value), int.Parse(match.Groups[2].Value), match.Groups[3].Value)
            : null;
    }

    [GeneratedRegex("^(\\d{13}):(\\d{4}):([a-z0-9]{1,24})$")]
    private static partial Regex Pattern();
}

/// <summary>The server's own hybrid logical clock, used for operations sent without a timestamp.</summary>
public sealed class ServerClock(Func<long>? now = null)
{
    private readonly Func<long> _now = now ?? (() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    private readonly object _lock = new();
    private long _wall;
    private int _counter;

    public string Tick()
    {
        lock (_lock)
        {
            var physical = _now();
            if (physical > _wall)
            {
                _wall = physical;
                _counter = 0;
            }
            else if (++_counter > 9999)
            {
                _wall++; // keep the counter at four digits so timestamps still sort as strings
                _counter = 0;
            }

            return new HybridTimestamp(_wall, _counter, "server").ToString();
        }
    }

    public void Observe(HybridTimestamp ts)
    {
        lock (_lock)
        {
            if (ts.Wall > _wall || (ts.Wall == _wall && ts.Counter > _counter))
            {
                _wall = ts.Wall;
                _counter = ts.Counter;
            }
        }
    }
}
