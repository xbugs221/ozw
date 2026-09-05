# tmux project/window lifecycle fix

## Root cause

The tmux identity combined project path with route/provider session identity, so every conversation became a top-level tmux session. WebSocket close detached the client but never scheduled the configured timeout, leaving all of those sessions resident.

## Resolution

- Derive the tmux session solely from the normalized full project path, with a readable suffix and collision-resistant hash.
- Derive a distinct window from provider and route/provider identity.
- Preserve both prior readable and base64 session names for reconnect compatibility.
- On disconnect, detach the relay and schedule target-window cleanup after five minutes.
- Compare tmux activity metadata and pane content before cleanup; changed targets receive another grace period.
- Kill only the selected window for the new layout. Legacy standalone sessions still use `kill-session`.

## Verification

- Runtime unit tests cover project reuse, window isolation, safe names, collisions, and legacy termination.
- Source contracts cover `new-window`, five-minute cleanup, activity-aware deferral, and window-scoped termination.
- Node and test TypeScript projects compile without errors.
- A real isolated tmux session was created with `codex_c1` and `pi_c2`; killing `codex_c1` left `pi_c2` intact, then the temporary session was removed.
