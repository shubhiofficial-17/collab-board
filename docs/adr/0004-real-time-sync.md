# 0004 – Real-time sync: save over HTTP, broadcast over SignalR

**Status:** Accepted

## Context

Several people edit a board at once. Each needs to see the others' changes within a fraction of a second, see who else is there, and see where their cursors are. A dropped connection (laptop asleep, flaky Wi-Fi) must not lose edits or leave a stale board on screen.

## Decision

**Saving stays on HTTP; SignalR carries everything live.**

- Edits are still saved with `POST /api/boards/{id}/ops`, through the same queue with retries and validation as before (ADR 0003). After the server stores a batch, it **broadcasts the operations to everyone else on the board** through the SignalR hub (`OpsApplied`).
- The browser sends its SignalR connection id in an `X-Connection-Id` header, so the sender isn't sent back its own changes.
- Why not save through the hub? There would then be two save paths to keep consistent. HTTP already gives retries, status codes and a natural "offline" story. When the live connection is down, edits keep saving, and only live updates pause.

**One save at a time per board, in order.** `BoardChanges` holds a per-board lock around "store, then broadcast", so every viewer receives changes in the order they were stored, and SignalR keeps that order per connection.

**Remote changes skip undo.** `BoardState.applyRemote` applies other people's operations without touching this user's undo history: **undo only reverts your own changes**, as in Figma or Google Docs. Remotely deleted shapes leave the selection and close the sticky-note editor.

**Reconnecting.** The client reconnects automatically with backoff (up to minutes, so a sleeping laptop rejoins without a reload). After reconnecting it rejoins the board and **reloads it from the server**, since changes may have been missed. It then re-applies its own edits that haven't been saved yet (`BoardState.resync`) so they don't flicker away.

**Presence and cursors.**

- `JoinBoard` returns everyone currently on the board and announces the newcomer. Disconnecting announces the departure.
- Cursor positions are sent in **world coordinates**, so they land in the right place whatever each viewer's pan and zoom. They are relayed but never stored, and the sender throttles them to one every 50 ms, always including the final position.
- Each browser gets a friendly random name and colour, stored locally until accounts arrive in milestone 6.

**Scaling out.** With `ConnectionStrings:Redis` set, SignalR uses the Redis backplane, so broadcasts reach viewers connected to any server instance.

## Consequences

- Concurrent edits to the **same field** of the same shape resolve as **last write wins**, in server order. That's acceptable for whiteboards. Milestone 5 replaces it with CRDTs for conflict-free merging and offline editing.
- Presence is tracked per server instance. Behind several instances, each one only lists its own connections. A Redis-backed presence set would fix that when it's needed.
- The per-board save lock is per instance too. Across instances, MongoDB's optimistic concurrency (ADR 0003) still prevents lost updates, but broadcast order between instances isn't guaranteed. That's another reason for CRDTs next.
