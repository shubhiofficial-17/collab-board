# 0003 – One MongoDB document per board, saved as operations

**Status:** Accepted

## Context

Boards must survive a page reload. A board is read and written as a whole: open a board, load everything on it. Shapes come in different kinds with different fields (sticky notes have text, paths have points). Editing produces a steady stream of small changes (ADR 0002).

## Decision

- **One document per board** in a `boards` collection: `{_id, title, createdAt, updatedAt, version, shapes: [...]}`.
  - Opening a board is a single read by primary key.
  - Different shape kinds sit side by side in one array without nullable columns per kind, which is where a document model fits better than tables.
  - A 16 MB document limit is far above the board limit (5,000 shapes, enforced by the API).
  - Board lists use a projection that leaves `shapes` out, and an index on `updatedAt` sorts them.
- **The web app saves operations, not snapshots.** `POST /api/boards/{id}/ops` takes the same add/update/delete operations the editor records for undo. A drag that moved a shape sends one small update, not the whole board. The same endpoint shape will carry real-time changes in milestone 4.
- **Validation lives in one place** (`BoardOps`), used by every store: known shape kinds, `#rrggbb` colours, finite coordinates within ±1,000,000, text up to 2,000 characters, at most 5,000 shapes and 500 operations per request. A batch is applied **all or nothing**: one invalid operation rejects the whole request with a 400 and changes nothing.
- **Optimistic concurrency.** Each save reads the board, applies the operations in memory, and writes the document back **only if `version` is unchanged**. If another writer got there first, the save re-reads and tries again (with a short random pause, up to 10 times). There are no locks, no lost updates, and validation stays in C# instead of being translated into MongoDB update operators.
- **Operations are forgiving about missing shapes.** An update or delete for a shape that no longer exists (someone else deleted it) is skipped, not an error, and re-adding an existing id replaces it, which makes redo safe to resend.
- **In the browser,** `BoardSync` saves changes in order, one request at a time. Changes made while a save is in flight are sent together in the next request. Network and server errors are retried with backoff and the changes are kept, while a 4xx (invalid change) is dropped and reported. The page warns before closing while changes are unsaved.

## Consequences

- Every save rewrites the whole board document. That's fine at whiteboard sizes. If boards grow very large, saves could switch to per-operation `$push` / `$set` / `$pull` updates with array filters.
- Under heavy concurrent editing of one board, writers retry against each other. Milestone 4 routes every change for a board through one server-side path, which removes most conflicts.
