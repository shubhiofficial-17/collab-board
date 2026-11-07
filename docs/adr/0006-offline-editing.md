# 6. Offline editing

## Status

Accepted

## Context

Since milestone 4, unsaved changes are kept in memory and retried when the connection comes back. But
reloading the tab, or opening a board while offline, lost them or failed outright. With conflict-free
merging in place (ADR 0005), sending changes late is safe, so the remaining work is keeping them.

## Decision

- `OfflineCache` keeps, per board, in `localStorage`:
  - the last known copy of the board, **including tombstones and clocks**, written shortly after changes settle;
  - the changes not yet confirmed by the server, written every time that list changes.
- Opening a board:
  - Server reachable: load the server copy, merge any changes left over from last time on top, and send them.
  - Server unreachable (no response or 5xx) and a local copy exists: open the local copy, marked
    "Offline copy". Editing works as usual; changes queue up and are kept on the device.
  - Board not found (4xx): show "not found" and forget the local copy.
- Coming back: the browser's `online` event, a reconnect of the live connection, or the Retry button
  send the queued changes and reload the server copy. The reload merges with the unsaved changes, so
  nothing flickers or gets lost, whatever order things happen in.
- `localStorage` rather than IndexedDB: it's synchronous and simple, and a board (at most a few
  thousand shapes) fits comfortably. Storage errors are ignored; the cache is a convenience, not
  the source of truth.

## Consequences

- A board opened at least once on a device can be opened and edited there without a connection, and
  survives reloads with unsaved changes.
- Boards never opened on the device can't be opened offline, and creating or renaming boards still
  needs a connection.
- If several tabs edit the same board offline, each keeps its own pending changes; they merge on the
  server without conflicts, but the last tab to write the cache wins its local copy until it reloads.
- No service worker yet, so the app shell itself must already be loaded (or cached by the browser).
  Adding one is a natural step for the deployment milestone.
