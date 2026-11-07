# 10. Prompt to diagram

## Status

Accepted

## Context

A blank board is the hardest moment. Letting people describe what they want ("release process with
review and rollback") and get a first draft is a natural use of a language model, and a good place to
use the LLM Gateway built alongside this project.

## Decision

- The server calls an **OpenAI-compatible chat completions API**, configured by `Ai:BaseUrl`,
  `Ai:ApiKey` and `Ai:Model`. In practice that's the LLM Gateway, which handles provider keys,
  fallback, caching and cost limits, so this app needs none of that. Without a base URL the feature is
  off and the button isn't shown.
- **The model describes structure, not geometry.** It returns `{nodes, edges}` as JSON (JSON mode is
  requested, and the reply is still parsed defensively: text around the JSON is ignored, unknown edges
  dropped, limits of 30 nodes and 60 edges enforced). Models are bad at coordinates and good at
  structure, so the server lays it out: a layered layout (each node one row below the deepest node
  pointing at it, cycles bounded), sticky notes coloured by group, arrows as path shapes.
- **Nothing is saved by the AI endpoint.** It returns shapes; the browser adds them as one ordinary
  change. They go through the same validation, merging and real-time sync as hand-drawn shapes, and
  one undo removes the whole diagram.
- Only editors can generate. Each user gets 10 generations a minute (ASP.NET Core's rate limiter,
  partitioned by user), since every call costs money.
- The system prompt tells the model to treat the request as data; the output can only ever become
  shapes on the user's own board, which limits what a prompt injection could do.

## Consequences

- Diagram quality depends on the model; the layout is simple and works best for flows and trees.
- Tests use a fake model client, so CI needs no API key.
- Next steps could be "add to this diagram" (sending the selected shapes as context) and streaming
  progress for slow models.
