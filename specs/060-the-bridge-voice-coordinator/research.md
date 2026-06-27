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

---

## Addendum — Avatar read-only tool loop (adj-202.7)

### SDK finding: the RPC-with-return pattern is SERVER-SIDE

Investigated `runwayml/avatars-sdk-react` (`examples/nextjs-rpc-weather`,
`examples/nextjs-rpc-external-api`) and the published `@runwayml/avatars-node-rpc@0.1.0`
type defs. The mechanism that lets the avatar's model CALL a tool and use the result is:

1. **Declare the tools at session-create** (server-side) so the model knows they exist:
   ```ts
   tools: [{ type: 'backend_rpc', name, description,
             parameters: [{ name, type, description }], timeoutSeconds }]
   ```
2. **Serve the calls with a server-side handler** (`@runwayml/avatars-node-rpc`):
   ```ts
   const handler = await createRpcHandler({
     apiKey, sessionId,
     tools: { get_weather: async (args) => ({ /* result */ }) },
     onDisconnected, onError,
   });
   ```
   `createRpcHandler` calls `/connect_backend` with the apiKey+sessionId and joins the
   session's LiveKit room as a hidden participant, dispatching RPC calls to the handler
   functions. Each handler returns a `Record<string,unknown>` (the structured result the
   model narrates). Throwing returns the error to the worker so the avatar doesn't hang.

**`useClientEvent` is one-way** (avatar → client notify, no value back to the model) — it is
NOT a request/response RPC. There is no client-side RPC-with-return hook.

### Architecture chosen (diverges from the original "client RPC → postMessage" sketch)

Because the RPC handler runs in OUR authed backend, it dispatches **directly** to the
existing read-only `toolBridge.executeTool(...)` — no API key crosses to the browser, no
postMessage tool hop. This is the same control plane `/api/bridge/tool` wraps (no second
control plane). The live `/avatar` page needs NO change for the tool loop.

Pieces (all backend):
- `runway-client.ts` — `CreateRealtimeSessionInput.tools` → included in the create body.
- `bridge-rpc-tools.ts` — the five `backend_rpc` descriptors (mirror `BRIDGE_READONLY_TOOLS`)
  + a tool-aware persona (`composeBridgePersonality`) that tells GWM-1 to CALL the tools.
- `bridge-session-broker.ts` — `StartSessionOptions.tools` passthrough.
- `bridge-rpc-handler.ts` — `buildBridgeToolDispatch` (maps model args → `executeTool`,
  injects the session's default `projectId` for project-scoped tools, returns the structured
  envelope, never throws) + `createBridgeRpcManager` (one handler per live session; lazy
  dynamic import of `@runwayml/avatars-node-rpc` so unit tests + typecheck run without the
  native dep installed; injectable factory for tests).
- `routes/bridge.ts` — `POST /api/bridge/session` now tool-enables every session (tools +
  composed persona) and, on success, attaches the handler with the dashboard's selected
  `projectId`. `attach` never throws — a tool-loop hiccup cannot tear down a billable session.

**projectId context:** the avatar never speaks a UUID, so project-scoped tools
(`list_beads`/`get_project_state`/`get_auto_develop_status`) default to the session's selected
project (passed as `projectId` to `POST /api/bridge/session`). Fleet-wide tools
(`list_agents`/`list_questions`) treat it as an optional filter — so "what's the agent roster?"
works with no project selected.

### New dependency

`@runwayml/avatars-node-rpc@^0.1.0` (transitively `@livekit/rtc-node`, a native module) is
declared in `backend/package.json` and **must be `npm install`-ed at integration/deploy**. It
is loaded via a lazy, variable-specifier dynamic import, so the worktree's typecheck/tests/build
are green without it physically present; production resolves the real package at runtime.

### Scope notes / follow-ups

- **iOS / default `/avatar` mode** uses `POST /avatar/connect` (`createReadyAvatarSession`),
  which does NOT go through the broker and so has no tools/handler yet. Wiring it is the same
  server-side pattern (pass `tools`, attach a handler) but touches the live `avatar.ts` route —
  left to integration (fenix). The dashboard "THE BRIDGE" tab (external mode) IS covered.
- **Dashboard `AuthoritativeResultPanel` surfacing of avatar-invoked results:** the handler is
  server-side, so the browser doesn't see the call. The manager exposes an `onResult(sessionId,
  result)` sink ready to drive a WS broadcast (`bridge:tool-result`) that `BridgePanel` would
  subscribe to. Not yet wired (touches `ws-server.ts` + the BridgePanel fenix is actively
  editing) — pending the integration-owner's call. Primary acceptance (avatar answers grounded,
  no endless "querying") does not depend on it.

### On-device manual smoke (cannot be verified headless)

1. `cd backend && npm install` (pulls `@runwayml/avatars-node-rpc` + `@livekit/rtc-node`).
2. Start the backend with `RUNWAYML_API_SECRET` + `RUNWAY_AVATAR_ID` configured.
3. Open the dashboard → **THE BRIDGE** tab; (optionally) select a project; click **Open link**.
4. Wait for the avatar to connect (video streaming).
5. Say: **"What's the current agent roster?"**
   - EXPECT: within a few seconds the avatar narrates the real crew (names/status) — NOT an
     endless "querying the system". Backend log shows `bridge rpc handler attached` then a
     `list_agents` dispatch.
6. With a project selected, ask **"What's in progress on this project?"** → it calls
   `list_beads` for that project and answers. With no project: it should say a project must be
   selected (PROJECT_REQUIRED), not stall.
