# 0002 – SVG rendering, and every change as an operation

**Status:** Accepted

## Context

The board needs:

- drawing (rectangles, ellipses, sticky notes, freehand strokes)
- selecting and moving shapes
- panning and zooming
- undo/redo

Later milestones add live sync with other users (milestone 4) and conflict-free merging (milestone 5). Both need a precise description of *what changed*, not just the new picture.

## Decision

**Render with SVG, not `<canvas>`.**

- Every shape is a DOM element, so hit-testing is free: the clicked element carries its shape id (`data-id`).
- Zooming stays crisp, because it's a single `transform` on one group.
- Sticky-note text is real HTML (`foreignObject`), so it wraps and can be edited.
- Screen readers and browser dev tools can see the shapes.
- The cost is performance at very large scale (tens of thousands of elements), where `<canvas>` wins. Whiteboards are typically hundreds to a few thousand shapes, so SVG is the better trade.

**Model every change as an operation:** `add`, `update` (a patch of changed fields) or `delete`.

- `applyOps` is pure: it returns a new map and never mutates. That fits Angular signals, where a new value triggers updates.
- **Undo/redo:** each step stores its forward operations and their inverse, computed by diffing the shapes before and after.
- **Gestures:** dragging a shape changes it on every pointer move, maybe hundreds of times. Those changes are applied live but recorded as **one** undo step when the drag ends, by diffing the state at the start of the gesture with the state at the end.
- The same operations are what milestone 4 will send to other users.

**State lives in a `BoardState` service made of signals,** provided once per board page. Derived values (drawing order, selection, can-undo) are `computed`, and components use `OnPush`, so a pointer move re-renders only what changed.

**World vs screen coordinates.** Shapes are stored in world coordinates. The viewport `{x, y, zoom}` maps them to the screen (`screen = world × zoom + offset`). Zooming keeps the point under the cursor fixed, so it feels anchored.

## Consequences

- Drawing logic (operations, geometry, viewport maths) is plain functions with unit tests, separate from the Angular components.
- Undo history is per browser tab and in memory. Persisting it, and deciding what undo means when several people edit, are later milestones.
