# GhostHint update notes

## Gameplay and reliability

- Added Easy, Medium, Hard, and Hardest prompt pools for both word and picture rounds.
- Added local SVG picture cards for the extra medium and hardest picture prompts.
- The server skips the remaining hosting block for a disconnected host, and a current host disconnect closes that round cleanly so a live match does not wait for them until the timer expires.
- Added a pending-guess guard and a server-response timeout so duplicate clicks/keyboard submits cannot race each other in the UI.
- Added room rejoin after Socket.IO reconnect, bounded WebRTC retry attempts, receive-only peer connections for players whose own camera/mic are off, and queued renegotiation when a call changes state.
- Separated remote audio playback from the remote video tiles. Voice-only calls can now play sound without rendering a black video tile, while video tiles are muted to prevent duplicate audio.

## Audio

- Raised the default background-music level and added Arcade Glow, Dreamwave, Pulse Bass, Retro Synth, Chillwave, and Boss Battle loops.
- Added custom soundtrack upload (up to 50 MB), stored locally in the browser using IndexedDB, with remove, volume, looping, and unsupported-file feedback.
- Background music no longer needs to stop/restart on every round-state update.
- Sound-effect and music volume remain independently adjustable.

## Camera and calling

- Added local mirrored self-view in video mode.
- Camera filter effects are processed on canvas and included in the outgoing WebRTC video stream, not only shown as a local CSS overlay.
- Added bright, warm, cool, monochrome, vivid, soft-focus, and natural filters, plus low/balanced/high capture quality.
- Enabled echo cancellation, noise suppression, and automatic gain control on microphone capture.
- Added safer camera start/stop cleanup and more stable remote-media handling.

## Verification

- `node --check server/index.js` passes.
- TypeScript/JSX parse checks pass and a strict-null TypeScript check against browser/React API stubs passes.
- Prompt-pool checks confirm that all 8 mode/difficulty combinations have prompts and all picture prompts have a corresponding SVG asset.
- A focused server test confirms that a disconnected host's block is skipped to the next available host.
- A complete Vite build and a live multi-device WebRTC test were not run here because the npm package registry timed out during dependency installation. Install dependencies and test with two or more browsers/devices before public deployment.
