# Collab Board

[![CI](https://github.com/shubhiofficial-17/collab-board/actions/workflows/ci.yml/badge.svg)](https://github.com/shubhiofficial-17/collab-board/actions/workflows/ci.yml)

A real-time collaborative whiteboard: draw shapes, add sticky notes and see other people's cursors live.

Built with **Angular 18** (standalone components, signals), **.NET 8** (minimal APIs, SignalR) and **MongoDB**.

## Status

| Milestone | Scope | Status |
|---|---|---|
| 1. Skeleton | .NET API, Angular app, Docker Compose, CI | ✅ Done |
| 2. Canvas | Shapes, sticky notes, freehand drawing, select and move, pan and zoom, undo/redo | ⏳ Next |
| 3. Persistence | Boards saved in MongoDB | Planned |
| 4. Real time | Live sync between users, presence and cursors (SignalR) | Planned |
| 5. Conflict-free editing | CRDTs and offline editing | Planned |
| 6. Accounts and sharing | Sign-in, invite links, viewer and editor roles | Planned |
| 7. History | Version history and restore | Planned |
| 8. AI | Turn a prompt into a diagram | Planned |
| 9. Quality | End-to-end tests, load tests, deployment | Planned |

## Run it

```bash
docker compose up --build
```

Open http://localhost:8080.

### Develop

```bash
cd server && dotnet run --project CollabBoard.Api   # API on http://localhost:5080
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
