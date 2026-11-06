# 8. Sharing with invite links

## Status

Accepted

## Context

Boards have members with roles since ADR 0007, but there was no way to add anyone. People expect to
share a board the way they share a document: send a link, and choose whether it allows editing.

## Decision

- Each board has **at most one invite link per role** (`editor`, `viewer`), stored on the board as a
  random 192-bit token. Anyone signed in who opens `/invite/{token}` becomes a member with that role.
- **Making a new link replaces the old one**, and links can be turned off. That is the revocation
  story: a leaked link is fixed with one click, without affecting people who already joined.
- Opening a viewer link never lowers someone's existing role.
- The owner sees everyone with access (names and emails), can switch people between editor and
  viewer, and can remove them. Anyone can leave a board; the owner can't (they delete it instead).
- Viewers get a read-only board: drags pan, the toolbar is hidden, and `BoardState` ignores local
  changes. The server enforces this regardless (403 on saves and renames), the UI just avoids
  offering what would fail. Viewers still see live changes and cursors.
- Links are looked up through an index on `shareLinks.token`.

## Consequences

- Sharing needs no email service and works for any account.
- A link is a bearer secret: anyone who has it can join. Fine for this kind of tool; invites
  addressed to a specific email, and link expiry, can be added later.
- Removing someone takes effect on their next request; an open live connection keeps receiving
  changes until it reconnects. Closing their connection on removal needs a user-to-connection map,
  which belongs with scaling work.
