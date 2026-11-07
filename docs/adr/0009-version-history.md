# 9. Version history

## Status

Accepted

## Context

People want to see how a board looked earlier and go back to it, especially once several people
edit it. Every change is already an operation (ADR 0002), but replaying a board's whole operation
log to show an old state would mean keeping every operation forever and replaying thousands of them.

## Decision

- Keep **snapshots** (versions) of the visible shapes, in a separate `versions` collection, indexed
  by board and time:
  - **automatic**: after a save, if the board's last version is at least 10 minutes old. The time of
    the last version is cached in memory, so most saves don't query for it. The newest 50 are kept.
  - **named**: saved by an editor ("Draft for review"), kept until the board is deleted.
- Versions are listed without their shapes; a version's shapes are only loaded to preview it.
- **Restoring is a normal change.** The server works out the operations that turn the current board
  into the version (re-add every shape in it, delete the rest), and applies them through the same
  path as any save, so they are timestamped, merged (ADR 0005) and broadcast live to everyone. Before
  restoring, the current board is saved as a version ("Before restoring …"), so a restore can be undone
  by restoring that one.
- Viewers can browse and preview history; only editors can save versions and restore.

## Consequences

- History is coarse: at most one automatic version per 10 minutes of editing, so a mistake can't be
  undone to the exact second. Combined with per-user undo, that covers the common cases.
- Storage grows with the number of versions; each is a full copy of a board's shapes. A 5,000-shape
  board is around 1 MB, so 50 automatic versions is fine, and pruning keeps it bounded.
- A restore larger than one request's limit (500 operations) is applied in several batches, which
  briefly shows a partly restored board to others.
- Old versions aren't deleted when a board is deleted yet; that cleanup belongs with a background job.
