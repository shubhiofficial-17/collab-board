# 0001 – Stack and repository layout

**Status:** Accepted

## Context

Collab Board is a real-time collaborative whiteboard. It needs a rich browser client (drawing, panning and zooming, live cursors), a server that relays edits between many connected users, and durable storage for boards.

## Decision

- **One repository, two apps:**
  - `web/`: Angular 18 with standalone components and signals
  - `server/`: .NET 8 minimal APIs, with SignalR for real time from milestone 4
- **Angular with signals:** the board is a lot of fast-changing UI state (shapes, selection, viewport, other people's cursors). Signals update exactly what changed, without the overhead of zone-wide change detection on every pointer move.
- **.NET 8 + SignalR:** WebSockets with automatic fallbacks, groups (one per board) and a Redis backplane for scaling out, all built in.
- **MongoDB** (milestone 3): a board is a document with a list of shapes of different kinds. That maps naturally onto documents, with no fixed columns per shape type.
- **In production, nginx serves the built Angular app** and proxies `/api` and `/hubs` to the server, so the browser sees one origin and no CORS is needed. In development, `ng serve` proxies the same paths.
- **Board ids** are 12 random characters from an alphabet without look-alike characters (no `l`, `1`, `o`, `0`), which gives about 60 bits. They're short enough to share, and too many to guess.

## Consequences

- The two apps build, test and ship independently, with one CI workflow and one `docker compose up`.
- The server has an in-memory board store until MongoDB arrives in milestone 3.
