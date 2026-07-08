# Tasks: Bridge Window-in-Window / PiP on iOS (adj-207)

Format: `T### [P] [USn] description in path`. `[P]` = parallelizable. Every non-exempt
task is TDD-shaped (XCTest RED→GREEN). iOS files under `ios/Adjutant/Sources/**` (SPM —
NO `.pbxproj` edits except Info.plist / version).

## Phase 1 — Foundational: persistent app-root Bridge host (adj-207.1)

- [ ] T001a [US-F] Write failing tests for the Bridge session state machine in
      `ios/AdjutantTests/Features/Bridge/BridgeSessionTests.swift` — transitions
      idle→connecting→live→backgrounded→closed, single-instance guard (opening while live
      is a no-op/focus), close tears down exactly once. Confirm RED.
- [ ] T001b [US-F] Implement `ios/Adjutant/Sources/Features/Bridge/BridgeSession.swift`
      (observable state machine + single-session invariant) until T001a is GREEN.
- [ ] T002a [US-F] Write failing tests in
      `ios/AdjutantTests/Features/Bridge/BridgeHostContainerTests.swift` — the host keeps
      the avatar surface mounted across a simulated navigation change (no unmount/recreate),
      and open/close/show/hide route through the session. Confirm RED.
- [ ] T002b [US-F] Implement
      `ios/Adjutant/Sources/Features/Bridge/BridgeHostContainer.swift` (root ZStack above
      navigation, owns the surface) + wire into `AdjutantApp`/root scene until GREEN.
- [ ] T003a [US-F] Write failing tests for the session-owned avatar surface in
      `ios/AdjutantTests/Features/Bridge/AvatarSurfaceReuseTests.swift` — the WKWebView
      instance is created once and REUSED across hide/show (no reload/reconnect). Confirm RED.
- [ ] T003b [US-F] Refactor `ios/Adjutant/Features/Avatar/AvatarOverlayView.swift` +
      `AvatarWebView` into a session-owned reusable surface until T003a is GREEN.

## Phase 2 — US1: In-app floating window (adj-207.2)

- [ ] T004a [P] [US1] Write failing tests for window geometry in
      `ios/AdjutantTests/Features/Bridge/BridgeWindowStateTests.swift` — drag translation,
      edge/corner snapping, resize within min/max + aspect, mode transitions
      (fullscreen↔floating↔pill), safe-area + keyboard-inset clamping. Confirm RED.
- [ ] T004b [US1] Implement `ios/Adjutant/Sources/Features/Bridge/BridgeWindowState.swift`
      (pure geometry/state) until T004a is GREEN.
- [ ] T005a [US1] Write failing tests in
      `ios/AdjutantTests/Features/Bridge/BridgeFloatingWindowViewTests.swift` — minimize-to-pill
      shows live state + tap-to-restore; compact controls (mute/end/restore) invoke the
      session; window stays above navigated content. Confirm RED.
- [ ] T005b [US1] Implement
      `ios/Adjutant/Sources/Features/Bridge/BridgeFloatingWindowView.swift`
      (drag/resize/minimize/restore chrome + rotation + frame persistence) until GREEN.

## Phase 3 — US2: iOS background audio, full duplex (adj-207.3)

- [ ] T006a [P] [US2] Write failing tests in
      `ios/AdjutantTests/Features/Bridge/BridgeAudioSessionTests.swift` — configures
      `.playAndRecord` for background; interruption begin/end pauses/resumes; route change
      handled; full-duplex flag with listen-only fallback path. Confirm RED (inject an
      AVAudioSession seam so tests don't touch real hardware).
- [ ] T006b [US2] Implement
      `ios/Adjutant/Sources/Features/Bridge/BridgeAudioSession.swift` until T006a is GREEN.
- [ ] T007a [US2] Write failing tests in
      `ios/AdjutantTests/Features/Bridge/BridgeBackgroundAudioTests.swift` — on
      scenePhase→background while live, the session activates background audio and keeps the
      avatar audio path alive; foreground restores; a documented listen-only degrade sets the
      indicator flag. Confirm RED.
- [ ] T007b [US2] Implement the background-entry hook on `BridgeSession` + WKWebView audio
      keep-alive until T007a is GREEN. Manually verify voice continues with the app
      backgrounded (no visual PiP in this phase).

## Phase 4 — US3: Native LiveKit avatar + system PiP (adj-207.4)

- [ ] T008 [US3] [setup] Add the LiveKit Swift SDK as an SPM dependency (Package.swift /
      Xcode SPM). No behavior; scaffolding only.
- [ ] T009a [US3] Write failing tests in
      `ios/AdjutantTests/Features/Bridge/NativeAvatarClientTests.swift` — joins the SAME
      avatar room using a broker-provided token (mock the LiveKit room seam), exposes the
      remote avatar video track, and never starts a second Runway session. Confirm RED.
- [ ] T009b [US3] Implement
      `ios/Adjutant/Sources/Features/Bridge/NativeAvatarClient.swift` until T009a is GREEN.
- [ ] T010a [US3] Write failing tests in
      `ios/AdjutantTests/Features/Bridge/AvatarSampleBufferViewTests.swift` — incoming video
      frames are enqueued to an `AVSampleBufferDisplayLayer` (assert enqueue + stall/flush
      handling via a seam). Confirm RED.
- [ ] T010b [US3] Implement
      `ios/Adjutant/Sources/Features/Bridge/AvatarSampleBufferView.swift` until GREEN.
- [ ] T011a [US3] Write failing tests in
      `ios/AdjutantTests/Features/Bridge/BridgePiPControllerTests.swift` — wraps
      `AVPictureInPictureController` over the sample-buffer layer; start/stop; isPiPPossible
      gating; single-controller guard (mock the AVKit seam). Confirm RED.
- [ ] T011b [US3] Implement
      `ios/Adjutant/Sources/Features/Bridge/BridgePiPController.swift` until GREEN.
- [ ] T012a [US3] Write failing tests in
      `backend/tests/unit/avatar-native-token.test.ts` — a route vends a room-scoped token
      for a read-only NATIVE consumer of the EXISTING avatar session (no new Runway session;
      reuses the current room). Confirm RED.
- [ ] T012b [US3] Implement the native-consumer token in `backend/src/routes/avatar.ts`
      until T012a is GREEN. (Skip 12a/12b if the existing broker token already permits a
      second native subscriber — verify first; if so mark done with a note.)

## Phase 5 — US4: PiP hand-off UX (adj-207.5)

- [ ] T013a [US4] Write failing tests in
      `ios/AdjutantTests/Features/Bridge/BridgePiPHandoffTests.swift` — on background while
      live, auto-enter PiP; a manual "pop out" command enters PiP; entering while already in
      PiP is a no-op. Confirm RED.
- [ ] T013b [US4] Implement auto + manual PiP entry (scenePhase hook + control) on the
      session until T013a is GREEN.
- [ ] T014a [US4] Write failing tests in
      `ios/AdjutantTests/Features/Bridge/BridgePiPRestoreTests.swift` — on foreground, PiP
      restores into the in-app floating window without dropping the session; audio + mic stay
      continuous across the transition (assert no session teardown). Confirm RED.
- [ ] T014b [US4] Implement PiP→floating restore + continuity until T014a is GREEN.

## Phase 6 — Polish (adj-207.6)

- [ ] T015a [US6] Write failing tests in
      `ios/AdjutantTests/Features/Bridge/BridgeInterruptionMatrixTests.swift` — incoming
      call, Siri, another PiP app, low-power mode, mic-permission-denied, network
      drop/reconnect, backgrounding mid-connect: each resolves to a defined state (no crash,
      no orphaned session). Confirm RED.
- [ ] T015b [US6] Harden the session/audio/PiP handlers until T015a is GREEN.
- [ ] T016a [US6] Write failing tests in
      `ios/AdjutantTests/Features/Bridge/BridgeSessionLifecycleTests.swift` — exactly ONE
      session/credit-meter across full↔floating↔pill↔background↔PiP; close from any state
      tears down once. Confirm RED.
- [ ] T016b [US6] Fix any lifecycle/meter leaks until T016a is GREEN.
- [ ] T017 [US6] [docs] Write `docs/bridge-pip-ios.md` — architecture, single-session
      invariant, background-audio model (full-duplex + fallback), and the PiP hand-off flow.
- [ ] T018a [US6] Write a failing end-to-end acceptance test
      `ios/AdjutantTests/Features/Bridge/BridgePiPAcceptanceTests.swift` — open → float →
      navigate (session survives) → background (audio continues, auto-PiP) → foreground
      (restore) with ONE session throughout. Confirm RED.
- [ ] T018b [US6] Close any gaps until T018a is GREEN.
- [ ] T019 [US6] [setup] Bump `MARKETING_VERSION` + `CURRENT_PROJECT_VERSION` in
      `ios/Adjutant.xcodeproj/project.pbxproj`; confirm `xcodebuild` clean — the shippable
      build carrying Bridge window-in-window + background/PiP.

## TDD audit
```bash
npx --prefix backend tsx scripts/audit-tasks-md.ts --quiet
```
