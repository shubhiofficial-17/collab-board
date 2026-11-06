using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace CollabBoard.Api.Boards;

/// <summary>One item on a board. Mirrors the web app's Shape type (web/src/app/board/model/shapes.ts).</summary>
public sealed class Shape
{
    public required string Id { get; set; }
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

    public Shape Clone()
    {
        var copy = (Shape)MemberwiseClone();
        copy.Points = Points?.ToArray();
        return copy;
    }
}

/// <summary>
/// A change to a board, as sent by the web app: add a shape, update some of its fields, or delete it.
/// See ADR 0002 for why every change is an operation.
/// </summary>
public sealed class BoardOp
{
    public required string Type { get; set; }
    public Shape? Shape { get; set; }
    public string? Id { get; set; }
    public JsonElement? Patch { get; set; }
}

public sealed class BoardOpException(string message) : Exception(message);

/// <summary>Validates and applies operations. Shared by every board store, so they behave identically.</summary>
public static partial class BoardOps
{
    public const int MaxShapes = 5_000;
    public const int MaxOpsPerRequest = 500;
    public const int MaxTextLength = 2_000;
    public const int MaxPathNumbers = 20_000;
    private const double MaxCoordinate = 1_000_000;

    private static readonly HashSet<string> Kinds = ["rect", "ellipse", "sticky", "path"];

    /// <summary>
    /// Applies <paramref name="ops"/> to <paramref name="shapes"/> in place. Updates and deletes of shapes
    /// that no longer exist are skipped (someone else may have deleted them); invalid input throws.
    /// </summary>
    public static void Apply(List<Shape> shapes, IReadOnlyList<BoardOp> ops)
    {
        if (ops.Count > MaxOpsPerRequest)
        {
            throw new BoardOpException($"At most {MaxOpsPerRequest} operations per request.");
        }

        var index = shapes.Select((s, i) => (s.Id, i)).ToDictionary(p => p.Id, p => p.i);

        foreach (var op in ops)
        {
            switch (op.Type)
            {
                case "add":
                {
                    var shape = op.Shape ?? throw new BoardOpException("'add' needs a shape.");
                    Validate(shape);
                    if (index.TryGetValue(shape.Id, out var existing))
                    {
                        shapes[existing] = shape; // re-adding (e.g. redo after undo) replaces
                    }
                    else
                    {
                        if (shapes.Count >= MaxShapes)
                        {
                            throw new BoardOpException($"A board holds at most {MaxShapes} shapes.");
                        }

                        index[shape.Id] = shapes.Count;
                        shapes.Add(shape);
                    }

                    break;
                }

                case "update":
                {
                    var id = op.Id ?? throw new BoardOpException("'update' needs an id.");
                    if (op.Patch is not { ValueKind: JsonValueKind.Object } patch)
                    {
                        throw new BoardOpException("'update' needs a patch object.");
                    }

                    if (index.TryGetValue(id, out var i))
                    {
                        var updated = ApplyPatch(shapes[i].Clone(), patch);
                        Validate(updated);
                        shapes[i] = updated;
                    }

                    break;
                }

                case "delete":
                {
                    var id = op.Id ?? throw new BoardOpException("'delete' needs an id.");
                    if (index.Remove(id, out var i))
                    {
                        shapes.RemoveAt(i);
                        foreach (var key in index.Keys.ToList())
                        {
                            if (index[key] > i)
                            {
                                index[key]--;
                            }
                        }
                    }

                    break;
                }

                default:
                    throw new BoardOpException($"Unknown operation '{op.Type}'.");
            }
        }
    }

    private static Shape ApplyPatch(Shape shape, JsonElement patch)
    {
        foreach (var field in patch.EnumerateObject())
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

        return shape;
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
