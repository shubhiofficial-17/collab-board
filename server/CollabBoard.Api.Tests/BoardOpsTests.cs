using System.Text.Json;
using CollabBoard.Api.Boards;

namespace CollabBoard.Api.Tests;

public sealed class BoardOpsTests
{
    private static Shape Rect(string id, double x = 0) => new() { Id = id, Kind = "rect", X = x, W = 10, H = 10, Color = "#fde68a", Z = 1 };

    private static BoardOp Update(string id, string patchJson) =>
        new() { Type = "update", Id = id, Patch = JsonDocument.Parse(patchJson).RootElement };

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

        Assert.Equal(["a", "c"], shapes.Select(s => s.Id));
        Assert.Equal(50, shapes[0].X);
        Assert.Equal("#bfdbfe", shapes[0].Color);
        Assert.Equal("hi", shapes[0].Text);
    }

    [Fact]
    public void Operations_on_shapes_that_are_gone_are_skipped()
    {
        var shapes = new List<Shape> { Rect("a") };

        BoardOps.Apply(shapes, [Update("ghost", """{"x": 1}"""), new BoardOp { Type = "delete", Id = "ghost" }]);

        Assert.Single(shapes);
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
