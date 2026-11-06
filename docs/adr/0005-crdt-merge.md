# 5. Merging concurrent edits with per-field timestamps

## Status

Accepted

## Context

Until now the server applied operations in the order its requests arrived, and each client applied
remote operations in the order they were broadcast. That mostly works while everyone is online, but:

- Two people editing the same shape at the same moment can end up seeing different results, because
  their local copy applied the operations in a different order from the server.
- After reconnecting, a client replays its unsaved operations on top of the server copy. If someone
  else changed the same shape in the meantime, which change wins depends on timing.
- Offline editing (milestone 5b) makes all of this much worse: changes can arrive minutes or hours late.

We want every copy of a board to end up the same once it has seen the same changes, regardless of
order, delays or duplicates.

## Decision

Treat a board as a CRDT: a map of shapes where **each field of each shape is a last-writer-wins
register**.

- Every operation carries a **hybrid logical clock** timestamp: `{wall ms:13}:{counter:4}:{client id}`.
  It sorts as a string, never goes backwards on one client, and after seeing someone's change, the
  next local timestamp is later than it. So an edit made in response to another always wins over it.
  The client id breaks ties, so no two changes compare equal.
- Each shape keeps a `clock` map: the timestamp of the last write to each field. An operation only
  writes a field if its timestamp is newer. Concurrent edits to different fields (one person moves a
  shape, another recolours it) both survive.
- Deleting sets a `deleted` field, merged like any other. Deleted shapes stay as hidden **tombstones**,
  so a late edit can't bring a shape back, and undoing a delete is just a newer add.
- An update that arrives before its shape's add creates a hidden **placeholder** that the add later
  fills in. With this, merging is commutative, associative and idempotent.
- Undo and redo produce new operations with new timestamps. They don't rewrite history.
- The web app (`model/crdt.ts`) and the server (`BoardOps.cs`) implement the same rules. The server
  validates shapes that end up visible, gives operations without a timestamp its own, and rejects
  timestamps more than five minutes in the future, so one bad clock can't win every future write.
- Both sides have a randomised test that shuffles the same operations and checks the result is identical.

## Consequences

- Copies converge, and resync after reconnecting is now simply "merge the server copy and my unsaved
  changes", which is idempotent.
- Offline editing becomes a matter of storing unsaved operations; no conflict resolution UI is needed.
- Last-writer-wins on a field level is coarse: two people typing in the same sticky note at once keep
  only the later text. A text CRDT (e.g. Yjs) per note could fix that later if needed.
- Tombstones and clocks make the stored board larger. A board keeps at most 20,000 shapes including
  tombstones; compacting old tombstones is left for later.
- Live previews during a drag are not timestamped; only the drag's final result is. Remote changes to
  the dragged shape can briefly be overwritten by the preview, and the final result then wins as the
  newest write, which is what the person dragging expects.
