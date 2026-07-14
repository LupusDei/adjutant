# Bridge — iOS Window-in-Window / Picture-in-Picture (adj-207)

The **Bridge** is the live avatar surface: a Runway-driven talking avatar the Commander can
open, float over the app, minimize, keep alive in the background, and pop out into a system
**Picture-in-Picture (PiP)** window that floats over *other* apps. This document is the
architecture reference for the iOS implementation — the persistent session/host model, the
single-session invariant, the background-audio model, the PiP hand-off ("session-swap") flow,
and the hard-won findings behind the non-obvious decisions.

> Scope: the iOS client (`ios/Adjutant/Sources/Features/Bridge/`). Backend routes live in
> `backend/src/routes/avatar.ts` and `backend/src/services/bridge-session-broker.ts`.

---

## 1. The load-bearing invariant: ONE session, ONE credit meter

There is **exactly one Runway avatar session (and therefore one credit meter) live at any
instant**, and closing from any state tears it down **exactly once**. Runway sessions cost
money per minute; a second concurrent session or a leaked meter is a double-billing bug, and a
missed teardown is a silent money leak. Everything below is in service of this invariant.

Every surface the avatar can occupy — full-screen, floating window, minimized-to-hidden,
backgrounded, and system PiP — is a **state of the one session**, never a new session. The one
place this can break is the PiP **session-swap** (§6), where the in-app session is *closed* and
a *fresh* native session is *started*; the swap is ordered so the two are never billing at once.

Regression nets that pin this:
- `BridgeSessionLifecycleTests` — one meter across every transition; teardown-once from any state.
- `BridgeInterruptionMatrixTests` — every interruption resolves to a defined state, no orphan.
- `BridgePiPAcceptanceTests` — the full open→float→navigate→background→PiP→foreground journey.

---

## 2. Architecture — persistent, app-root session + host

The avatar surface is hoisted **above** the SwiftUI navigation so it survives screen changes.

```
BridgeHostContainer (ZStack, app root)      // sits above the tab bar / nav stack
├── (behind)  native PiP sample-buffer layer  // mounted lazily, once PiP is first used
├── content   MainTabView / navigation …       // the Commander navigates freely here
└── (front)   BridgeFloatingWindowView         // the draggable/resizable avatar window
                 └── AvatarSurfaceView(webSurface)   // the WKWebView surface
```

- **`BridgeHostContainer`** (`BridgeHostContainer.swift`) — root container. The surface is a
  *sibling* of `content` in the ZStack, not a child of the navigation stack, so navigating
  `content` can never unmount or reload the avatar. When no session is active the overlay is
  absent (zero cost).
- **`BridgeHost`** (`@Observable`, `@MainActor`) — the app-root owner of the single
  `BridgeSession`, the reusable `BridgeWebSurface`, the floating-window model, the background
  audio coordinator, and (lazily) the PiP surface + hand-off coordinator. All Bridge intents
  (`open`/`close`/`show`/`hide`/`toggleFromLiveTab`) route through the one session.
- **`BridgeSession`** (`BridgeSession.swift`) — the single owner of the avatar stream and the
  state machine (§3). Pure reducer + injected `BridgeSurface` seam so the logic is unit-testable
  with a spy (no WKWebView, no LiveKit).

**Why app-root:** hoisting the host above navigation is what makes "the avatar keeps talking
while I move around the app" true — screen changes never touch the live surface
(`notePresentedContentChanged()` is a deliberate no-op).

### Modern-iOS conventions
- `@Observable` (Observation framework), not `ObservableObject`.
- `@MainActor` isolation on everything that drives UIKit/WebKit/AVKit/audio — one isolation
  domain, no cross-actor churn on the hot frame/interruption paths.
- **Pure state/logic separated from views** and fully unit-tested: `BridgeSessionReducer`,
  `BridgeWindowGeometry`/`BridgeWindowState`, `BridgeAudioPolicy`, `BridgePiPHandoffPolicy`.
- **Injected seams** for every system dependency: `BridgeSurface`, `NativeAvatarRoomConnecting`,
  `PictureInPictureControlling`, `AudioSessionControlling`, `BridgeConnectTimeout`.

---

## 3. Session state machine

```
idle ──open──▶ connecting ──connected──▶ live ⇄ backgrounded
  ▲               │  │                     │           │
  │           failed/│                  close/       close/
  │          timeout │                  failed       failed
  │               ▼  ▼                     ▼           ▼
  └────────────  failed ◀───────────────  closed  ◀────┘
                  │ retry ▶ connecting
```

- `connecting` arms a **connect watchdog** (`BridgeConnectTimeout`, 20 s in production). If the
  surface never reaches `live`, it fails **visibly** rather than hanging on a black screen.
- `backgrounded` is a *live* session whose app was backgrounded — audio continues; returns to
  `live` on foreground. The surface is **never** hidden or torn down while backgrounded.
- `close` from any active state tears the surface down **exactly once**; it is idempotent.
- `failed` (load error / connect timeout / network drop) tears the surface down for a clean
  retry and offers `retry()` (→ `connecting`) or `close()`.

**Window modes** (`BridgeWindowMode`: `fullscreen` / `floating` / `hidden`) are **presentation
only** — switching mode never touches the stream. `hidden` (minimize-to-nothing) keeps the
session *live* in the background; the bottom-tab **LIVE** item is the sole re-entry
(`toggleFromLiveTab`). Geometry (drag/resize/snap/clamp) is pure math in `BridgeWindowGeometry`.

---

## 4. Background-audio model

`BridgeAudioSession` (`BridgeAudioSession.swift`) keeps voice alive while the app is
backgrounded, and degrades gracefully when full-duplex isn't possible. Decisions live in the
pure `BridgeAudioPolicy`; the `AVAudioSession` calls go through the injected
`AudioSessionControlling` seam.

- **Category** is always `.playAndRecord` — the only category that both plays avatar audio and
  captures the mic, and the one gated by the `audio` `UIBackgroundMode` for background
  continuation.
- **Full duplex** (default): mode `.voiceChat` (input processing + echo cancellation). The
  Commander can keep talking while backgrounded.
- **Listen-only fallback** (documented degrade, US2): mode `.default`, playback only. Entered
  automatically when **no input route is available** (mic permission denied / no device) or via
  `degradeToListenOnly(reason:)`. It keeps the same `.playAndRecord` category (so the background
  entitlement holds) and records a reason for the **visible listen-only indicator** — never a
  silent mic loss.
- **Interruptions** (phone call / Siri): `began` relinquishes the session (`setActive(false)`);
  `ended(shouldResume:)` reactivates **only** when the system grants `.shouldResume`.
- **Route changes** (AirPods/CarPlay): only `oldDeviceUnavailable` re-asserts the session so
  audio recovers on the new route; other reasons route automatically.

Lifecycle wiring: the session activates audio on `→ live` / `→ backgrounded` and stops it on
`→ closed` / `→ failed`. There is exactly one `BridgeAudioSession` app-wide; it is retained for
the app lifetime and torn down through the session-close path.

---

## 5. PiP surface composition

Built **lazily** on first use — never at launch — because constructing it eagerly spins up a
real LiveKit `Room()` + `AVPictureInPictureController`, which stalls launch on a headless
simulator. It is also only built on devices that actually support system PiP
(`BridgePiPController.isDevicePiPSupported`), so we never spin up LiveKit/AVKit where PiP is
impossible.

```
BridgePiPSurface  (BridgePiPHandoffTarget)
├── NativeAvatarClient        // read/consume LiveKit client → decoded avatar video frames
│     └── NativeAvatarRoomConnecting (LiveKitNativeAvatarRoom)   // injected seam
├── AvatarSampleBufferRenderer → AVSampleBufferDisplayLayer      // renders frames
└── BridgePiPController        // wraps AVPictureInPictureController (PictureInPictureControlling seam)
```

`BridgePiPHandoffCoordinator` ties `scenePhase` + the manual pop-out control to the pure
`BridgePiPHandoffPolicy` and applies the resulting action (`enterPiP` / `exitPiP` / `none`) to
the surface. The coordinator's target seam exposes **only** enter/exit-PiP + restore — there is
deliberately **no** "close session" or "stop audio" capability, so continuity is guaranteed by
construction.

---

## 6. The PiP hand-off — the "session-swap"

This is the subtle part. Entering PiP does **not** reuse the WKWebView's Runway session — it
performs a **session-swap**:

### Pop-out / auto-background → PiP
1. **Precondition** (pure policy): a *live* Bridge, PiP supported, not already in PiP, and — for
   the **auto** (background) hand-off — **not** in Low Power Mode (§7). A **manual** pop-out is
   not low-power-gated.
2. **Close the WKWebView session** (`closeInAppSession` → `session.close()`) — synchronously,
   **before** the native session is dispatched. This is what keeps the two sessions from ever
   billing at the same instant.
3. **Start a fresh native session**: `POST /avatar/native-session` starts a brand-new Runway
   session whose backend-handler slot is **free**, attaches the Adjutant **tool loop** to it
   (so tools work in PiP), and mints **frontend viewer** creds via Runway `/consume`.
4. The native client joins that room, subscribes to the avatar **video** track, and streams
   decoded frames into the `AVSampleBufferDisplayLayer`.
5. **Start PiP on the first rendered frame** (not on track subscription) — see the -1003 finding
   in §7.

### Restore (foreground, OS-close, or another app taking PiP)
1. The OS leaves PiP → `onDidStop` → `restoreInAppWindow()`.
2. **Re-open the WKWebView session** (`restoreWindow` → `session.open()`) — one session again.
3. **Release the native subscriber** (`client.stop()` → LiveKit disconnect).

Because `restoreWindow` reopens through the single-instance-guarded `session.open()`, a
duplicate restore (e.g. a late OS did-stop after an explicit exit) is a harmless no-op.

### Failed hand-off → restore, never orphan
If the native session fails or times out **after** step 2 has already closed the WKWebView
session, the Bridge would be left with **zero** sessions and an invisible error banner. So a
failed hand-off **restores the in-app window** (reopens the one WKWebView session) and surfaces
the error on it, so the Commander lands on a live session and can retry — never a dead black
screen (adj-207.6.1).

---

## 7. Hard-won findings (the gotchas)

These are the non-obvious constraints that shaped the design. Change them at your peril.

- **`connect_backend` allows only ONE backend handler per session.** The *live* WKWebView
  session's slot is already held by the Adjutant tool-loop attach, so a second backend handler
  on that session is impossible (`400 "A backend handler is already connected"`). That is *why*
  PiP starts a **fresh** session instead of joining the live one — the fresh session's slot is
  free.
- **A backend handler receives NO video.** Runway publishes the avatar video to **frontend /
  viewer** participants, not to backend handlers. The native PiP client therefore joins as a
  **frontend viewer** using **`/consume`** creds (`POST /avatar/native-session` →
  `getFrontendViewerCreds`), *not* `connect_backend`. `/consume` is single-use, which is fine —
  the fresh session's key is consumed exactly once, by the native client. (An earlier
  `native-token`/`connect_backend` approach reached `.live` but never rendered a frame — the
  signature of "audio only, no video track" — which is what pointed at this.)
- **Tools in PiP work** because `native-session` starts the fresh session *and* attaches the
  tool-loop backend handler exactly like a normal WKWebView session; the native client consumes
  as a frontend viewer, so the one backend-handler slot stays free for the loop. Result: the PiP
  avatar has video (native frontend) + audio + mic + tools.
- **autoSubscribe for the late agent.** The native frontend viewer joins *after* tracks are
  already published, so it must auto-subscribe to existing publications — otherwise it sits in a
  joined room with no frames. The room-state diagnostic (`NativeAvatarRoomState`) distinguishes
  "never joined" vs "joined, 0 remotes" vs "video published but not subscribed" vs "subscribed
  but no frames" so a device tap tells you exactly where the pipeline stops.
- **PGPegasus `-1003` = start-before-render.** `AVPictureInPictureController.startPictureInPicture()`
  fails with `PGPegasusErrorDomain -1003` if the `AVSampleBufferDisplayLayer` is not yet
  rendering (no enqueued frame / off-screen / zero-size). Fix: **start PiP on the first enqueued
  frame** (`renderer.onFirstFrame` → `pip.start()`), gate it on `didReceiveFirstFrame`, and mount
  the sample-buffer layer full-window so it has a real on-screen frame. A start requested before
  frames flow is *remembered* (`isStartPending`) and fires the moment PiP becomes possible —
  never a silent no-op.
- **mXSS / self-contained pages** is a proposal-sharing concern, not Bridge — noted only to
  avoid confusion; the Bridge surface is a live WKWebView pointed at `/avatar`, not sanitized HTML.

---

## 8. Interruption / edge-case matrix

Each disruption resolves to a **defined** state — no crash, no orphaned session/meter, correct
pause/resume (`BridgeInterruptionMatrixTests`):

| Event | Defined behavior |
|---|---|
| Incoming call / Siri | Audio relinquished; resumes only when the system grants `.shouldResume`. Session kept. |
| Another app takes PiP | OS stops ours → restore the in-app window; release the native subscriber. One session. |
| Low Power Mode | **Auto** (background) PiP suppressed → audio-only background continuation. **Manual** pop-out honored. |
| Mic permission denied | Graceful **listen-only** degrade (playback continues) + visible indicator. Session kept. |
| Network drop (web) | → `failed` (surface torn down, meter released) → `retry()` reconnects. |
| Network drop (native, in PiP) | Failed hand-off **restores the in-app window** + visible error. No orphan. |
| Hand-off timeout | Same as above — restore + visible error, never a stuck/dead Bridge. |
| Backgrounding mid-connect | Session stays `connecting` (not backgrounded/closed); no PiP attempted; completes normally. |

---

## 9. File & test map

**Production** (`ios/Adjutant/Sources/Features/Bridge/`):
- `BridgeSession.swift` — the single session, pure reducer, connect watchdog.
- `BridgeHostContainer.swift` — app-root host + container view; unified close path.
- `BridgeWindowState.swift` / `BridgeFloatingWindowView.swift` — pure window geometry + chrome.
- `BridgeAudioSession.swift` — background audio, interruptions, listen-only fallback.
- `BridgePiPHandoff.swift` — pure hand-off policy + coordinator (low-power-gated auto hand-off).
- `BridgePiPSurface.swift` — the production hand-off target (session-swap, start-on-first-frame,
  restore-on-fail).
- `NativeAvatarClient.swift` — native LiveKit consumer + `/avatar/native-session` token provider.
- `BridgePiPController.swift` — `AVPictureInPictureController` wrapper (possibility gating,
  single-window guard, start-pending).
- `AvatarSampleBufferView.swift` — `AVSampleBufferDisplayLayer` renderer + hosting view.

**Tests** (`ios/AdjutantTests/Features/Bridge/`): `BridgeSessionTests`,
`BridgeSessionLifecycleTests`, `BridgeHostContainerTests`, `BridgeWindowStateTests`,
`BridgeFloatingWindowViewTests`, `BridgeAudioSessionTests`, `BridgeBackgroundAudioTests`,
`BridgePiPControllerTests`, `BridgePiPHandoffTests`, `BridgePiPRestoreTests`,
`BridgePiPSurfaceTests`, `NativeAvatarClientTests`, `BridgeInterruptionMatrixTests`,
`BridgePiPAcceptanceTests`.

**Backend**: `backend/src/routes/avatar.ts` (`/avatar`, `/avatar/native-session`,
`/avatar/native-token`), `backend/src/services/bridge-session-broker.ts`.
