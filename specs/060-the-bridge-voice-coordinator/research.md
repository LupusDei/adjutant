# Phase 0 Spike — Findings (adj-202.2)

Prototype scope (Commander-directed): build the harness to talk to the Adjutant character
(NOT wired to the coordinator/MCP yet) + an iOS overlay to open the avatar.

## Verified live against api.dev.runwayml.com (2026-06-27)

Character (avatar) ID: `8ac1dce0-cf52-4b72-bd3d-84ecc6a5f6c9`.

**Real-time avatar session flow (server-side, secret key never leaves the server):**

1. `POST /v1/realtime_sessions`
   headers: `Authorization: Bearer $RUNWAYML_API_SECRET`, `X-Runway-Version: 2024-11-06`
   body: `{ "model": "gwm1_avatars", "avatar": { "type": "custom", "avatarId": "<id>" } }`
   → `200 { "id": "<sessionId>" }`
2. Poll `GET /v1/realtime_sessions/{id}` → `{ status: "NOT_READY" }` then, after ~3–6s,
   `{ status: "READY", expiresAt, sessionKey: "stk_…" }`. **`sessionKey` only appears once READY.**
3. Browser connects with `{ sessionId, sessionKey }` via the Runway web SDK
   (`@runwayml/avatars-react` `<AvatarCall avatarId sessionId sessionKey />`), which handles LiveKit/WebRTC.

Notes: session TTL ≈ 5 min (`expiresAt`). The docs' `/consume` endpoint does NOT exist (404);
the SDK reads `sessionKey` from the READY session. Each session ≈ 2 credits up front.

## Built (this prototype)

- **Backend harness** (`backend/src/services/runway-avatar.ts`): `createReadyAvatarSession()` —
  create + poll to READY, returns `{ sessionId, sessionKey, avatarId, expiresAt }`. Unit-tested
  (happy/error/timeout/validation) with real response shapes.
- **Backend routes** (`backend/src/routes/avatar.ts`, public, pre-apiKeyAuth):
  `POST /avatar/connect` (server-side session) + `GET /avatar` (self-contained web client that
  loads `@runwayml/avatars-react` from esm.sh and renders the avatar). Route-tested.
- **iOS** (`ios/Adjutant/Features/Avatar/AvatarOverlayView.swift`): a "TALK TO THE ADJUTANT"
  button pinned at the very top of the Swarm Overview, opening a full-screen `WKWebView` overlay
  loading `<origin>/avatar` (mic/camera auto-granted; Info.plist usage strings added). Build
  number bumped 47 → 48 for a fresh TestFlight build.

## Still to validate (device test — the rest of the go/no-go)

- Live avatar **render + audio** in the iOS WKWebView (the esm.sh-loaded SDK + LiveKit over
  WebRTC). This cannot be verified headlessly; it needs a TestFlight/device run.
- Tool round-trip latency, result-injection reliability, 5-min renew UX — only meaningful once
  the tool bridge exists (Phase 1+). Deferred.

## Go / No-Go

**Conditional GO on the harness:** session creation + READY + sessionKey are proven against the
real API, and the official client contract (`AvatarCall` with `{avatarId, sessionId, sessionKey}`)
is what `/avatar/connect` returns. Remaining risk is purely the client render path, to be confirmed
on-device via the new build.
