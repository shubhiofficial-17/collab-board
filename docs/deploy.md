# Deploying Collab Board

The app is three containers: **web** (nginx serving the Angular build and proxying `/api` and `/hubs`),
**server** (.NET 8 API and SignalR hub) and **MongoDB**. `docker-compose.yml` is a working single-host
setup; the notes below are what to change for a real deployment.

## Single server (simplest)

1. A VM with Docker (2 vCPU / 4 GB is plenty to start).
2. Put a TLS-terminating proxy in front of the `web` container, e.g. Caddy:

   ```
   board.example.com {
     reverse_proxy localhost:8080
   }
   ```

   Caddy gets certificates automatically and sends `X-Forwarded-Proto: https`. nginx passes it on, and
   with `ForwardedHeaders__Enabled=true` the API marks the session cookie `Secure`.
3. `docker compose up -d --build`. Back up the `mongo-data` volume (or use a managed MongoDB, below)
   and keep the `auth-keys` volume: losing it signs everyone out.

## Managed services

| Piece | Option | Settings |
|---|---|---|
| Database | MongoDB Atlas | `ConnectionStrings__Mongo=mongodb+srv://…/collab` |
| API | Azure Container Apps / AWS App Runner / Fly.io | the `server` image, port 8080 |
| Web | same platform, or any static host with a proxy for `/api` and `/hubs` | the `web` image |
| Scale-out | 2+ API instances | `ConnectionStrings__Redis=…` (SignalR backplane, ADR 0004) and a shared `DataProtection__KeysPath` (or keys in a store such as Azure Blob) |

WebSockets must be allowed through every proxy and load balancer; SignalR falls back to long polling
if they aren't, which works but costs more. With several API instances, sticky sessions are needed
unless clients connect with WebSockets only.

## Configuration

| Setting | Purpose | Default |
|---|---|---|
| `ConnectionStrings__Mongo` | MongoDB; in-memory storage when empty | empty |
| `ConnectionStrings__Redis` | SignalR backplane for several instances | empty |
| `DataProtection__KeysPath` | where cookie encryption keys are kept | in memory |
| `ForwardedHeaders__Enabled` | trust `X-Forwarded-For/Proto` (only behind a proxy!) | `false` |
| `RateLimits__SignInPerMinute` | sign-in and sign-up attempts per IP per minute | `20` |
| `Ai__BaseUrl`, `Ai__ApiKey`, `Ai__Model` | AI diagrams via the LLM Gateway | off |

## Before going live

- [ ] HTTPS only, and the `auth-keys` volume (or key store) is persistent and backed up
- [ ] MongoDB not reachable from the internet; backups scheduled
- [ ] `ForwardedHeaders__Enabled=true` only when the API is reachable solely through the proxy
- [ ] Load test with `loadtest/boards.js` at the expected number of users
- [ ] Logs collected (containers write to stdout)
