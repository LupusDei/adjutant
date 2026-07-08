# Feature Spec: The Bridge as Window-in-Window (Picture-in-Picture) on iOS

**Feature ID**: 062-bridge-pip-ios
**Root epic**: adj-207
**Priority**: P0
**Platform**: iOS only (web window-in-window / Document PiP is a **follow-on epic**, out of scope here)

## Summary

Make the Adjutant Bridge (the Runway GWM-1 conversational avatar) openable as a
**window-in-window** on iOS: the Commander can **view and talk to the Bridge while
exploring other content inside the app** (an in-app floating window), and the Bridge
**persists as a background task while using other apps** (system Picture-in-Picture +
background audio). Delivered in **two phases** on a **single persistent Bridge session**.

## Clarified Decisions (from the General)

- **Platform**: iOS only this epic (web is a follow-on).
- **Priority**: P0.
- **Session persistence**: exactly **one** Bridge session, kept alive across in-app
  navigation — no per-screen reconnect, no ~3–5s Runway re-provision on navigation.
- **Approach**: **phased**. Phase A ships first on the existing `WKWebView` avatar;
  Phase B adds true system PiP via a native client.
- **Window UX**: **draggable + resizable + minimize-to-a-pill** (with restore).
- **Phase-B trigger**: **both** — auto hand-off into system PiP when the app
  backgrounds **and** a manual "pop out" control.
- **Background audio**: **full duplex** — the mic stays live so the Commander can keep
  **talking** while backgrounded (documented fallback to listen-only only if iOS
  audio-session / WebRTC-in-background constraints make background mic unreliable).

## Technical Constraint (load-bearing)

The Bridge avatar is a backend-served web page at ORIGIN `/avatar` (LiveKit **WebRTC**
video/audio). iOS today renders it in a full-screen `WKWebView` (`AvatarOverlayView`).
**iOS system PiP (`AVPictureInPictureController`) does NOT work for WebRTC/`srcObject`
video inside a `WKWebView`** — it requires an `AVPlayerLayer`/`AVSampleBufferDisplayLayer`.
Therefore:
- **Phase A** (in-app floating window + background audio) stays on the `WKWebView`.
- **Phase B** (avatar video floating over *other apps*) requires a **native LiveKit iOS
  client** rendering the avatar video track into an `AVSampleBufferDisplayLayer` driven
  by `AVPictureInPictureController`.

## User Stories

### Foundational — Persistent app-root Bridge session (Priority: P0)
*As the system, I host exactly one Bridge session above the app's navigation so the
avatar stream survives while the Commander moves between screens.*

**Acceptance criteria**
- A single `BridgeSession` (lifecycle: idle → connecting → live → backgrounded → closed)
  owns the avatar surface; it is created once and reused.
- The avatar surface (WKWebView in Phase A) is mounted in a container **above** the
  SwiftUI navigation stack / tab bar, so navigating other screens does NOT unmount or
  reconnect it (verified: no re-`prepare`, no LiveKit reconnect on navigation).
- Open/close/show/hide are driven through the session; closing tears the stream down
  exactly once; re-opening reuses the pre-warmed session where available (adj-202.10).
- No duplicate sessions can exist (opening when live is a no-op / focus).

### US1 (Phase A) — In-app floating window (Priority: P0)
*As the Commander, I can shrink the Bridge into a draggable, resizable floating window
and keep talking to it while I browse other in-app screens.*

**Acceptance criteria**
- The Bridge can be toggled between full-screen and a **floating window**.
- The floating window is **draggable** (anywhere, with edge/corner snapping),
  **resizable** (min/max bounds, aspect preserved), and can **minimize to a pill/bubble**
  that shows it's live (and tap-to-restore).
- It stays visible and interactive **on top of other in-app screens** during navigation.
- Respects safe areas; avoids the keyboard; survives rotation.
- Mic/voice keep working in the floating + pill states; a compact control affordance
  (mute / end / restore) is reachable without full-screen.

### US2 (Phase A) — iOS background audio, full duplex (Priority: P0)
*As the Commander, when I leave the app the Bridge keeps talking and listening so the
conversation continues.*

**Acceptance criteria**
- `AVAudioSession` is configured (`playAndRecord`, appropriate options) so avatar
  **audio output continues** when the app is backgrounded (`UIBackgroundModes: audio`
  already declared).
- **Full-duplex**: the **mic stays live** in the background so the Commander can keep
  speaking; if WebRTC-in-background mic proves unreliable, the build degrades gracefully
  to **listen-only** with a clear indicator (documented decision, not a silent failure).
- Audio interruptions (phone call, Siri, other audio) and route changes (AirPods, CarPlay)
  are handled: pause/duck/resume correctly; the session recovers.
- Verified: voice continues with the app backgrounded (no visual PiP yet in this phase).

### US3 (Phase B) — Native LiveKit avatar + system PiP (Priority: P0)
*As the Commander, the Bridge avatar floats as a video bubble over other apps.*

**Acceptance criteria**
- A native LiveKit Swift client joins the **same** avatar room/session (token/room handoff
  from the existing `/avatar` broker — no second Runway session, no double credit burn).
- The avatar **video track renders into an `AVSampleBufferDisplayLayer`**.
- `AVPictureInPictureController` drives a **system PiP** window that floats over other
  apps; audio + mic continue via the Phase-A audio session.
- Credit metering / session lifecycle remain correct (one session, one meter) across the
  native path.

### US4 (Phase B) — PiP hand-off UX (Priority: P0)
*As the Commander, the Bridge auto-pops into system PiP when I leave the app, and I can
also pop it out manually — and it restores cleanly when I return.*

**Acceptance criteria**
- **Auto**: on app background, the live Bridge automatically enters system PiP.
- **Manual**: a "pop out" control enters system PiP on demand.
- On foreground, PiP **restores** back into the in-app floating window (or full-screen)
  without dropping the session; audio + mic stay continuous across the transition.
- PiP surface exposes the allowed controls (e.g. mute / end) where the OS permits.
- Only one PiP instance; entering PiP while already in PiP is a no-op.

## Non-Functional Requirements

- **Single session invariant**: never more than one Bridge session / Runway avatar /
  credit meter at a time, across floating ↔ full-screen ↔ background ↔ PiP transitions.
- **iOS build**: Swift Package Manager auto-discovers files under `Adjutant/` — do NOT
  add Swift files to `.pbxproj`; only project settings (Info.plist / version) may change
  the pbxproj.
- **Testing**: TDD (XCTest) at every layer; state-machine + transition logic unit-tested;
  build clean via `xcodebuild`; `./scripts/verify-before-push.sh` green.
- **Permissions**: mic permission and background-audio behavior handled with clear UX on
  denial.

## Out of Scope

- Web window-in-window / Document Picture-in-Picture (follow-on epic).
- Multiple simultaneous Bridge sessions / windows.
- Android.
- Changing the avatar/Runway backend contract beyond the token/room handoff needed for
  the native client.

## Success Criteria

The Commander opens the Bridge, shrinks it to a draggable/resizable floating window,
navigates other in-app screens while still talking to it, then leaves the app entirely —
the avatar continues as a system PiP bubble over other apps with audio + mic live — and
returns to the app to find the same session restored into the floating window. One
session throughout; shipped in a new iOS build.
