# 11. End-to-end tests, load testing and production settings

## Status

Accepted

## Context

Each part has unit and integration tests, but nothing checked that the pieces work together through
nginx, cookies and WebSockets the way a browser uses them, and nothing measured how many people a
server can take. A few settings only matter in production (HTTPS behind a proxy, brute-force limits).

## Decision

- **Playwright end-to-end tests** (`e2e/`) run in CI against the real stack started with
  `docker compose up`: signing up, drawing and reloading, undo, two people editing live through an
  invite link (separate browser contexts, so separate cookies), a viewer's read-only board, and a
  stranger being refused. This replaces the job that only built the images.
- **A k6 load test** (`loadtest/boards.js`) simulates groups of five people editing the same board
  (frequent moves, occasional new notes) with thresholds on save and load latency. It isn't run in CI
  (shared runners make timings meaningless) but is the check before a deployment.
- **Production settings:**
  - `ForwardedHeaders:Enabled` makes the API trust `X-Forwarded-For/Proto` from nginx, so the session
    cookie is `Secure` behind HTTPS and rate limits see real client addresses.
  - Sign-in and sign-up are limited per IP (20 a minute by default).
  - nginx adds a Content-Security-Policy (no inline scripts; Angular's critical-CSS inlining is turned
    off because it relies on an inline `onload` handler), `nosniff`, a referrer policy, long caching for
    hashed bundles and no caching for `index.html`.
- `docs/deploy.md` describes a single-server setup with Caddy for HTTPS, and the managed-service
  options for scaling out.

## Consequences

- CI takes a few minutes longer, but catches problems no unit test can, like a proxy dropping the
  WebSocket upgrade or a cookie not being sent.
- End-to-end tests are the slowest and flakiest kind; they're kept to the main journeys, retried once
  in CI, and keep a trace on failure.
