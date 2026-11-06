# Collab Board

[![CI](https://github.com/shubhiofficial-17/collab-board/actions/workflows/ci.yml/badge.svg)](https://github.com/shubhiofficial-17/collab-board/actions/workflows/ci.yml)

A real-time collaborative whiteboard: draw shapes, add sticky notes and see other people's cursors live.

Built with **Angular 18** (standalone components, signals), **.NET 8** (minimal APIs, SignalR) and **MongoDB**.

## Status

| Milestone | Scope | Status |
|---|---|---|
| 1. Skeleton | .NET API, Angular app, Docker Compose, CI | ✅ Done |
| 2. Canvas | Shapes, sticky notes, freehand drawing, select and move, pan and zoom, undo/redo | ✅ Done |
| 3. Persistence | Boards saved in MongoDB as operations, with optimistic concurrency; rename and delete | ✅ Done |
| 4. Real time | Live sync between users, presence avatars and live cursors (SignalR), auto-reconnect with resync | ✅ Done |
| 5a. Conflict-free merging | Per-field last-writer-wins with hybrid logical clocks; same result in any order | ✅ Done |
| 5b. Offline editing | Boards open from a local copy without a connection; edits are kept on the device and sent when back online | ✅ Done |
| 6a. Accounts | Email and password sign-in with a session cookie; boards belong to their creator | ✅ Done |
| 6b. Sharing | Invite links for editors and viewers, view-only mode, managing who has access | ✅ Done |
| 7. History | Automatic and named versions, preview, restore (live for everyone, and undoable) | ✅ Done |
| 8. AI | Turn a prompt into a diagram | ⏳ Next |
| 9. Quality | End-to-end tests, load tests, deployment | Planned |

## Using the board

| Action | How |
|---|---|
| Tools | Toolbar, or keys: **V** select, **H** pan, **R** rectangle, **O** ellipse, **S** sticky note, **P** pen |
| Edit a sticky note | Double-click it. **Ctrl+Enter** saves, **Esc** cancels |
| Move | Drag a shape; **Shift+click** to select several |
| Delete | **Delete** or **Backspace** |
| Undo / redo | **Ctrl+Z** / **Ctrl+Shift+Z** (or **Ctrl+Y**) |
| Pan | Scroll, drag with **Space** held, middle mouse button, or the pan tool |
| Zoom | **Ctrl+scroll** or pinch, or the toolbar |

## Run it

```bash
docker compose up --build
```

Open http://localhost:8080, then open the same board in a second window to see live sync and cursors. Boards are stored in MongoDB (a Docker volume keeps them across restarts).

### Develop

```bash
cd server && dotnet run --project CollabBoard.Api   # API on http://localhost:5080 (in-memory storage unless ConnectionStrings__Mongo is set)
cd web && npm install && npm start                  # app on http://localhost:4200 (proxies /api)
```

### Test

```bash
cd server && dotnet test
cd web && npm test
```

## Layout

```
server/   .NET 8 API (CollabBoard.Api) and its tests
web/      Angular 18 app
docs/adr/ Architecture Decision Records
```

## License

MIT
