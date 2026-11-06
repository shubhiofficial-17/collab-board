# 7. Accounts and board access

## Status

Accepted

## Context

Until now anyone who could reach the server could see and change every board. Sharing (6b) needs to
know who people are, and boards need owners.

## Decision

- **Email and password accounts**, kept in the same store as boards (a `users` collection in MongoDB
  with a unique index on the lower-cased email; in memory otherwise). Passwords are hashed with
  PBKDF2-SHA256, 210,000 iterations and a random salt, using only what .NET ships with. The stored
  format carries its parameters (`v1.{iterations}.{salt}.{hash}`) so the cost can be raised later.
  An unknown email is checked against a dummy hash, so it takes as long as a wrong password.
- **A session cookie, not tokens.** The web app and API share an origin (nginx proxies `/api` and
  `/hubs`), so ASP.NET Core cookie authentication fits: `HttpOnly` (scripts can't read it, so XSS
  can't steal it), `SameSite=Lax` (other sites can't make the browser send it with a POST), sliding
  30-day expiry. SignalR uses the same cookie with no extra code. The API answers 401/403 instead of
  redirecting to a login page.
- Cookies are encrypted with Data Protection keys, which are stored on a Docker volume when
  `DataProtection:KeysPath` is set, so restarts don't sign everyone out.
- **Boards have members**, each with a role: `owner`, `editor` or `viewer`. The creator is the owner.
  Every board endpoint and the hub check the caller's role: anyone without access gets 404 (so ids
  can't be probed), viewers get 403 when trying to change things, and only the owner can delete.
  `GetMembersAsync` reads just the members, so the check is cheap on every save.
- Names shown to others on a board now come from the account, not from what the browser claims.
- The web app keeps the signed-in user in local storage, so it still opens offline (5b), and clears
  cached boards on sign-out or when a different person signs in.

## Consequences

- Boards created before this change have no members and are no longer reachable; acceptable for a
  project that hasn't been deployed yet.
- No password reset, email verification, or rate limiting of sign-in attempts yet. Rate limiting
  (ASP.NET Core's built-in limiter) belongs with the deployment milestone; reset and verification
  need an email service.
- Sign in with Google or Microsoft could be added later as another authentication handler issuing
  the same cookie.
