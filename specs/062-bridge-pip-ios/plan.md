# Implementation Plan: Bridge Window-in-Window / PiP on iOS (adj-207)

## Architecture Overview

One persistent `BridgeSession` hosted **above** the app's navigation drives every surface
the avatar can occupy. Phase A keeps the existing `WKWebView` avatar and adds a floating
window + background audio. Phase B adds a **native LiveKit** rendering path so the avatar
video can enter a true system PiP over other apps. The two phases share the same session,
audio configuration, and single-session invariant.

```
                 ┌────────────────────────────────────────────┐
AdjutantApp root │  BridgeHostContainer  (ZStack above nav)     │
  (ZStack over   │   └─ BridgeSession (state machine, 1 only)   │
   Navigation/   │        ├─ Phase A surface: AvatarWebView     │  ← existing WKWebView (/avatar)
   TabView)      │        │     • full-screen  • floating  • pill│
                 │        └─ Phase B surface: NativeAvatarView  │  ← LiveKit track → AVSampleBufferDisplayLayer
                 │             + AVPictureInPictureController    │      → system PiP over other apps
                 │   BridgeAudioSession (AVAudioSession, duplex) │
                 └────────────────────────────────────────────┘
   /avatar broker  ──token/room──►  (Phase A: WKWebView self-connect)  &  (Phase B: native LiveKit join, SAME room)
```

## Key Decisions

1. **Hoist the session to the app root** (Foundational): the avatar surface must NOT be
   a child of a screen that unmounts on navigation. A `BridgeHostContainer` in a `ZStack`
   over the root `NavigationStack`/`TabView` owns it. This is the single largest structural
   change and the backbone for both phases.
2. **State machine, single-session invariant**: `BridgeSession` is the only owner of the
   stream. All surface transitions (full ↔ floating ↔ pill ↔ background ↔ PiP) are state
   changes on it; it guarantees exactly one Runway session / credit meter.
3. **Phase A on WKWebView**: floating window + background audio need no native LiveKit —
   reposition/resize the WKWebView-backed surface and configure `AVAudioSession`. Ships
   the user-visible value fast.
4. **Phase B is a native rendering path, not a rewrite of the conversation**: the native
   LiveKit client joins the SAME avatar room (reuse the `/avatar` broker's token) purely to
   obtain the video track for `AVSampleBufferDisplayLayer` + `AVPictureInPictureController`.
   The `/avatar` page contract is preserved; we add a native consumer of the same session.
5. **Continuity over correctness theater**: audio + mic must remain unbroken across
   floating → background → PiP → foreground. Transitions are tested as a matrix.
6. **SPM discipline**: new Swift files live under `ios/Adjutant/Sources/**` (SPM-discovered);
   tests under `ios/AdjutantTests/**`; the ONLY `.pbxproj` edits are Info.plist keys +
   `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION`.

## Phases

### Phase 1 — Foundational: persistent app-root Bridge host (adj-207.1)
- `ios/Adjutant/Sources/Features/Bridge/BridgeSession.swift` — observable session state
  machine (idle/connecting/live/backgrounded/closed), single-instance guard, open/close.
- `ios/Adjutant/Sources/Features/Bridge/BridgeHostContainer.swift` — root `ZStack` host
  mounted above navigation; owns the avatar surface so it survives navigation.
- Refactor `Features/Avatar/AvatarOverlayView.swift` + `AvatarWebView` into a reusable
  surface owned by the session (keep the WKWebView instance alive across show/hide).
- Wire into `AdjutantApp`/root scene; a global "open Bridge" entry replaces the ad-hoc
  full-screen present.

### Phase 2 — US1: In-app floating window (adj-207.2)
- `BridgeWindowState.swift` — window mode (fullscreen/floating/pill), frame, drag/resize
  math, snapping, min/max, safe-area + keyboard avoidance (pure, unit-testable).
- `BridgeFloatingWindowView.swift` — SwiftUI chrome: drag gesture, resize handles,
  minimize-to-pill, restore, compact controls (mute/end/restore).
- Persist last window frame; rotation handling.

### Phase 3 — US2: iOS background audio, full duplex (adj-207.3)
- `ios/Adjutant/Sources/Features/Bridge/BridgeAudioSession.swift` — `AVAudioSession`
  (`.playAndRecord`, `.mixWithOthers`/`.allowBluetooth` as appropriate), activation on go-live,
  interruption + route-change handlers, full-duplex mic keep-alive, listen-only fallback flag.
- Ensure WKWebView media keeps running in background (audio mode); background-entry hook on
  `BridgeSession`.

### Phase 4 — US3: Native LiveKit avatar + system PiP (adj-207.4)
- Add the LiveKit Swift SDK via SPM (Package.swift / Xcode SPM — dependency add is `[setup]`).
- `NativeAvatarClient.swift` — join the SAME avatar room using a token from the `/avatar`
  broker (a small backend addition may be needed to vend a native-consumer token; see below).
- `AvatarSampleBufferView.swift` — render the remote avatar video track frames into an
  `AVSampleBufferDisplayLayer`.
- `BridgePiPController.swift` — wrap `AVPictureInPictureController` over that layer; start/stop.
- Backend (if required): `backend/src/routes/avatar.ts` — vend a room-scoped token for a
  native read-only consumer of the existing session (no new Runway session). TDD on the route.

### Phase 5 — US4: PiP hand-off UX (adj-207.5)
- Auto-enter PiP on `scenePhase`→background when live; manual "pop out" control.
- Restore PiP → in-app floating window on foreground; keep audio/mic continuous.
- PiP surface controls (mute/end) where OS-permitted; single-PiP guard.

### Phase 6 — Polish (adj-207.6)
- Interruption/edge-case matrix: incoming call, Siri, another PiP app, low-power mode,
  mic-permission denied, network drop/reconnect, backgrounding during connect.
- Session-lifecycle + credit-meter correctness across all transitions (one meter).
- Docs: `docs/bridge-pip-ios.md` (architecture, session invariant, audio model, PiP handoff).
- End-to-end acceptance test; **version bump** (`MARKETING_VERSION` + `CURRENT_PROJECT_VERSION`)
  as the shippable step.

## Parallelization

- Phase 1 blocks everything (the persistent host is the backbone).
- Phase A = US1 (adj-207.2) + US2 (adj-207.3) run in parallel after Phase 1 (different files).
- Phase B = US3 (adj-207.4) then US4 (adj-207.5). Per the "phased" decision, Phase B follows
  Phase A (US3 depends on US1+US2); a native-LiveKit spike may be researched earlier.
- Phase 6 depends on 2–5.

## Risks / Notes

- **Background WebRTC mic** (Phase A full-duplex): iOS may suspend WKWebView capture in
  background; US2 must verify and fall back to listen-only if needed (documented).
- **Native token handoff** (Phase B): confirm the `/avatar` broker can mint a second,
  room-scoped token for a read-only native consumer without spinning a new Runway session.
- **PiP + WebRTC frames**: `AVSampleBufferDisplayLayer` needs a steady frame pump from the
  LiveKit track renderer; watch for timing/stall handling.

## Bead Map

- `adj-207` — Root epic: Bridge window-in-window (PiP) on iOS [P0]
  - `adj-207.1` — Foundational: persistent app-root Bridge session/host
    - `adj-207.1.1` T001 BridgeSession state machine
    - `adj-207.1.2` T002 BridgeHostContainer (root ZStack above nav)
    - `adj-207.1.3` T003 session-owned reusable AvatarWebView surface
  - `adj-207.2` — US1 (Phase A): In-app floating window
    - `adj-207.2.1` T004 BridgeWindowState geometry
    - `adj-207.2.2` T005 BridgeFloatingWindowView
  - `adj-207.3` — US2 (Phase A): iOS background audio (full duplex)
    - `adj-207.3.1` T006 BridgeAudioSession
    - `adj-207.3.2` T007 background-entry hook + WKWebView audio keep-alive
  - `adj-207.4` — US3 (Phase B): Native LiveKit avatar + system PiP
    - `adj-207.4.1` T008 add LiveKit Swift SDK (SPM)
    - `adj-207.4.2` T009 NativeAvatarClient (same room via broker token)
    - `adj-207.4.3` T010 AvatarSampleBufferView (→ AVSampleBufferDisplayLayer)
    - `adj-207.4.4` T011 BridgePiPController (AVPictureInPictureController)
    - `adj-207.4.5` T012 backend native-consumer token
  - `adj-207.5` — US4 (Phase B): PiP hand-off UX (auto + manual)
    - `adj-207.5.1` T013 auto-enter PiP on background + manual pop-out
    - `adj-207.5.2` T014 PiP→floating restore + audio/mic continuity
  - `adj-207.6` — Polish [P1]
    - `adj-207.6.1` T015 interruption/edge-case matrix
    - `adj-207.6.2` T016 single-session/credit-meter lifecycle
    - `adj-207.6.3` T017 docs/bridge-pip-ios.md
    - `adj-207.6.4` T018 end-to-end acceptance
    - `adj-207.6.5` T019 version bump + shippable build

**Execution order** (from `bd ready`): start `adj-207.1.1` (persistent session — the backbone);
independent Phase-B prep (`.4.1` SDK add, `.4.5` backend token) + docs can run in parallel.
Foundational unblocks Phase A (US1 `.2` + US2 `.3`, parallel); Phase A unblocks the meaningful
Phase-B work (`.4.2`→`.4.3`→`.4.4`) → `.5` hand-off → `.6` Polish (version bump last).
