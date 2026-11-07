using System.Text.Json;
using CollabBoard.Api.Boards;

namespace CollabBoard.Api.Tests;

public sealed class BoardOpsTests
{
    private static Shape Rect(string id, double x = 0) => new() { Id = id, Kind = "rect", X = x, W = 10, H = 10, Color = "#fde68a", Z = 1 };

    private static BoardOp Update(string id, string patchJson, string? ts = null) =>
        new() { Type = "update", Id = id, Patch = JsonDocument.Parse(patchJson).RootElement, Ts = ts };

    private static string Ts(long n, string client = "a") => new HybridTimestamp(n, 0, client).ToString();

    private static List<string> Visible(List<Shape> shapes) => shapes.Where(BoardOps.IsVisible).Select(s => s.Id).ToList();

    [Fact]
    public void Adds_updates_and_deletes()
    {
        var shapes = new List<Shape> { Rect("a"), Rect("b") };

        BoardOps.Apply(shapes,
        [
            new BoardOp { Type = "add", Shape = Rect("c") },
            Update("a", """{"x": 50, "color": "#bfdbfe", "text": "hi"}"""),
            new BoardOp { Type = "delete", Id = "b" },
        ]);

        Assert.Equal(["a", "c"], Visible(shapes));
        Assert.True(shapes.Single(s => s.Id == "b").Deleted); // kept as a tombstone
        Assert.Equal(50, shapes[0].X);
        Assert.Equal("#bfdbfe", shapes[0].Color);
        Assert.Equal("hi", shapes[0].Text);
    }

    [Fact]
    public void Operations_on_unknown_shapes_leave_hidden_placeholders()
    {
        var shapes = new List<Shape> { Rect("a") };

        BoardOps.Apply(shapes, [Update("ghost", """{"x": 1}"""), new BoardOp { Type = "delete", Id = "ghost" }]);

        Assert.Equal(["a"], Visible(shapes));
    }

    [Fact]
    public void Each_field_keeps_its_newest_value()
    {
        var shapes = new List<Shape>();

        BoardOps.Apply(shapes,
        [
            new BoardOp { Type = "add", Shape = Rect("a"), Ts = Ts(1) },
            Update("a", """{"x": 5}""", Ts(3)),
            Update("a", """{"x": 9, "color": "#ffffff"}""", Ts(2, "b")),
        ], DateTimeOffset.FromUnixTimeMilliseconds(0));

        var a = Assert.Single(shapes);
        Assert.Equal(5, a.X);
        Assert.Equal("#ffffff", a.Color);
    }

    [Fact]
    public void An_older_add_does_not_undo_a_newer_delete()
    {
        var shapes = new List<Shape>();

        BoardOps.Apply(shapes,
        [
            new BoardOp { Type = "delete", Id = "a", Ts = Ts(2) },
            new BoardOp { Type = "add", Shape = Rect("a"), Ts = Ts(1) },
        ], DateTimeOffset.FromUnixTimeMilliseconds(0));

        Assert.Empty(Visible(shapes));
    }

    [Fact]
    public void Converges_whatever_order_changes_arrive_in()
    {
        var random = new Random(7);
        for (var round = 0; round < 30; round++)
        {
            var ops = new List<BoardOp>();
            for (var i = 0; i < 40; i++)
            {
                var id = $"s{random.Next(4)}";
                var ts = $"{Ts(random.Next(20), "abc"[random.Next(3)].ToString())}{i}";
                ops.Add(random.NextDouble() switch
                {
                    < 0.3 => new BoardOp { Type = "add", Shape = Rect(id, random.Next(100)), Ts = ts },
                    < 0.8 => Update(id, $$"""{"x": {{random.Next(100)}}}""", ts),
                    _ => new BoardOp { Type = "delete", Id = id, Ts = ts },
                });
            }

            var expected = Snapshot(ops);
            for (var shuffle = 0; shuffle < 5; shuffle++)
            {
                Assert.Equal(expected, Snapshot(ops.OrderBy(_ => random.Next()).ToList()));
            }
        }

        static string Snapshot(List<BoardOp> ops)
        {
            var shapes = new List<Shape>();
            foreach (var op in ops)
            {
                BoardOps.Apply(shapes, [op], DateTimeOffset.FromUnixTimeMilliseconds(0));
            }

            return string.Join(";", shapes.Where(BoardOps.IsVisible).OrderBy(s => s.Id).Select(s => $"{s.Id},{s.X},{s.Color}"));
        }
    }

    [Fact]
    public void Operations_without_a_timestamp_get_one()
    {
        var op = new BoardOp { Type = "add", Shape = Rect("a") };

        BoardOps.Apply([], [op]);

        Assert.NotNull(HybridTimestamp.Parse(op.Ts!));
    }

    [Theory]
    [InlineData("nonsense")]
    [InlineData("9999999999999:0000:a")]
    public void Bad_or_far_future_timestamps_are_rejected(string ts)
    {
        Assert.Throws<BoardOpException>(() => BoardOps.Apply([], [new BoardOp { Type = "add", Shape = Rect("a"), Ts = ts }]));
    }

    [Fact]
    public void Re_adding_an_existing_shape_replaces_it()
    {
        var shapes = new List<Shape> { Rect("a") };

        BoardOps.Apply(shapes, [new BoardOp { Type = "add", Shape = Rect("a", x: 99) }]);

        Assert.Equal(99, Assert.Single(shapes).X);
    }

    [Fact]
    public void Deleting_keeps_later_indexes_right()
    {
        var shapes = new List<Shape> { Rect("a"), Rect("b"), Rect("c") };

        BoardOps.Apply(shapes, [new BoardOp { Type = "delete", Id = "a" }, Update("c", """{"x": 5}""")]);

        Assert.Equal(5, shapes.Single(s => s.Id == "c").X);
    }

    [Theory]
    [InlineData("""{"x": "not a number"}""")]
    [InlineData("""{"color": "red"}""")]
    [InlineData("""{"w": -5}""")]
    [InlineData("""{"x": 1e12}""")]
    [InlineData("""{"kind": "rect"}""")]
    [InlineData("""{"points": [1, 2, 3]}""")]
    public void Invalid_updates_are_rejected(string patch)
    {
        var shapes = new List<Shape> { Rect("a") };

        Assert.Throws<BoardOpException>(() => BoardOps.Apply(shapes, [Update("a", patch)]));
    }

    [Fact]
    public void Unknown_kinds_and_operations_are_rejected()
    {
        var shapes = new List<Shape>();
        var triangle = Rect("a");
        triangle.Kind = "triangle";

        Assert.Throws<BoardOpException>(() => BoardOps.Apply(shapes, [new BoardOp { Type = "add", Shape = triangle }]));
        Assert.Throws<BoardOpException>(() => BoardOps.Apply(shapes, [new BoardOp { Type = "explode", Id = "a" }]));
    }

    [Fact]
    public void Text_length_is_limited()
    {
        var note = Rect("n");
        note.Kind = "sticky";
        note.Text = new string('x', BoardOps.MaxTextLength + 1);

        Assert.Throws<BoardOpException>(() => BoardOps.Apply([], [new BoardOp { Type = "add", Shape = note }]));
    }
}
