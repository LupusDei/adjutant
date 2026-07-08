import XCTest
import CoreGraphics
@testable import AdjutantUI

/// Tests for the Bridge floating-window chrome logic (adj-207.2.2 / T005).
///
/// The SwiftUI `BridgeFloatingWindowView` is a thin declarative renderer; all of
/// its behaviour lives in `BridgeFloatingWindowModel` (an `@Observable` view
/// model) and the `BridgeWindowControlling` seam, which is where these tests aim.
/// The pure geometry is already covered by `BridgeWindowStateTests`; here we pin:
///   1. Drag / resize / snap intents plumb through to the rendered `currentFrame`.
///   2. Minimize-to-pill shows the LIVE state and tap-to-restore returns to the
///      exact prior floating frame.
///   3. Fullscreen ↔ floating toggling preserves the floating frame.
///   4. Compact controls (mute / end) route through the session control seam.
///   5. Rotation / keyboard layout changes re-clamp the window.
@MainActor
final class BridgeFloatingWindowViewTests: XCTestCase {

    // MARK: - Test doubles

    /// Records control-seam calls without a real WKWebView / LiveKit session.
    private final class SpyControls: BridgeWindowControlling {
        var isLive: Bool = true
        /// The mute values pushed through the seam (the actual mic side effect).
        var setMutedCalls: [Bool] = []
        var endCount = 0

        func setMuted(_ muted: Bool) {
            setMutedCalls.append(muted)
        }

        func end() {
            endCount += 1
        }
    }

    private func makeLayout(
        container: CGSize = CGSize(width: 400, height: 800),
        keyboard: CGFloat = 0
    ) -> BridgeWindowLayout {
        BridgeWindowLayout(
            containerSize: container,
            safeAreaInsets: BridgeWindowInsets(top: 44, leading: 0, bottom: 34, trailing: 0),
            keyboardInset: keyboard,
            minSize: CGSize(width: 120, height: 160),
            maxSize: CGSize(width: 300, height: 400),
            aspectRatio: 0.75,
            pillSize: CGSize(width: 72, height: 72),
            snapThreshold: 24,
            margin: 12
        )
    }

    private func makeModel(
        controls: SpyControls? = nil
    ) -> (BridgeFloatingWindowModel, SpyControls) {
        let controls = controls ?? SpyControls()
        var state = BridgeWindowState(layout: makeLayout())
        state.enterFloating()
        state.setFloatingFrame(CGRect(x: 30, y: 120, width: 180, height: 240))
        let model = BridgeFloatingWindowModel(state: state, controls: controls)
        return (model, controls)
    }

    // MARK: - Initial state

    func testInitialModeAndFrameReflectState() {
        let (model, _) = makeModel()
        XCTAssertTrue(model.isFloating)
        XCTAssertEqual(model.currentFrame.origin.x, 30, accuracy: 0.001)
        XCTAssertEqual(model.currentFrame.origin.y, 120, accuracy: 0.001)
        XCTAssertEqual(model.currentFrame.width, 180, accuracy: 0.001)
    }

    func testIsLiveReflectsControls() {
        let controls = SpyControls()
        controls.isLive = true
        let (model, _) = makeModel(controls: controls)
        XCTAssertTrue(model.isLive)
        controls.isLive = false
        XCTAssertFalse(model.isLive)
    }

    // MARK: - Drag / resize / snap plumb to currentFrame

    func testDragMovesAndClampsCurrentFrame() {
        let (model, _) = makeModel()
        model.dragFloating(by: CGSize(width: -100, height: -100))
        // (30,120) → (-70,20) → clamp to (0,44).
        XCTAssertEqual(model.currentFrame.origin.x, 0, accuracy: 0.001)
        XCTAssertEqual(model.currentFrame.origin.y, 44, accuracy: 0.001)
    }

    func testEndDragSnapsToEdge() {
        let (model, _) = makeModel()
        model.dragFloating(by: CGSize(width: -22, height: -68)) // → (8, 52) near top-left
        model.endDrag()
        XCTAssertEqual(model.currentFrame.origin.x, 12, accuracy: 0.001)
        XCTAssertEqual(model.currentFrame.origin.y, 56, accuracy: 0.001)
    }

    func testResizeGrowsWindowPreservingAspect() {
        let (model, _) = makeModel()
        model.setFloatingFrame(CGRect(x: 12, y: 56, width: 120, height: 160))
        model.resize(handle: .bottomRight, by: CGSize(width: 60, height: 0))
        XCTAssertEqual(model.currentFrame.width, 180, accuracy: 0.001)
        XCTAssertEqual(model.currentFrame.height, 240, accuracy: 0.001)
    }

    // MARK: - Minimize (to hidden) / reveal (adj-207.2.12)

    func testMinimizeHidesEntirelyKeepingSessionLive() {
        let controls = SpyControls()
        controls.isLive = true
        let (model, spy) = makeModel(controls: controls)
        model.minimize()
        XCTAssertTrue(model.isHidden, "minimize hides — nothing floats")
        XCTAssertFalse(model.isFloating)
        XCTAssertTrue(model.isLive, "session stays live while hidden")
        // Presentation-only: minimize NEVER ends the session.
        XCTAssertEqual(spy.endCount, 0)
    }

    func testRevealReturnsToExactFloatingFrame() {
        let (model, _) = makeModel()
        let saved = model.currentFrame
        model.minimize()
        model.reveal()
        XCTAssertTrue(model.isFloating)
        XCTAssertEqual(model.currentFrame.origin.x, saved.origin.x, accuracy: 0.001)
        XCTAssertEqual(model.currentFrame.origin.y, saved.origin.y, accuracy: 0.001)
        XCTAssertEqual(model.currentFrame.width, saved.width, accuracy: 0.001)
    }

    // MARK: - Fullscreen toggle

    func testToggleFullscreenPreservesFloatingFrame() {
        let (model, _) = makeModel()
        let saved = model.currentFrame
        model.toggleFullscreen()
        XCTAssertTrue(model.isFullscreen)
        XCTAssertEqual(model.currentFrame.width, 400, accuracy: 0.001, "fullscreen fills container")
        model.toggleFullscreen()
        XCTAssertTrue(model.isFloating)
        XCTAssertEqual(model.currentFrame.origin.x, saved.origin.x, accuracy: 0.001)
        XCTAssertEqual(model.currentFrame.width, saved.width, accuracy: 0.001)
    }

    // MARK: - Compact controls route through the session seam

    func testToggleMuteUpdatesReactiveStateAndRoutesToControls() {
        // adj-207.2.10: the icon state lives on the @Observable model (reactive),
        // and the mute side effect is pushed through the seam.
        let (model, controls) = makeModel()
        XCTAssertFalse(model.isMuted)
        model.toggleMute()
        XCTAssertTrue(model.isMuted, "mute state flips immediately (reactive icon)")
        XCTAssertEqual(controls.setMutedCalls, [true], "mute side effect routed to the seam")
        model.toggleMute()
        XCTAssertFalse(model.isMuted)
        XCTAssertEqual(controls.setMutedCalls, [true, false])
    }

    func testEndRoutesThroughControls() {
        let (model, controls) = makeModel()
        model.end()
        XCTAssertEqual(controls.endCount, 1)
    }

    // MARK: - Layout changes

    func testUpdateLayoutKeyboardPushesWindowUp() {
        let (model, _) = makeModel()
        model.setFloatingFrame(CGRect(x: 12, y: 500, width: 180, height: 240))
        model.updateLayout(makeLayout(keyboard: 300))
        let bounds = BridgeWindowGeometry.contentBounds(for: makeLayout(keyboard: 300))
        XCTAssertLessThanOrEqual(model.currentFrame.maxY, bounds.maxY + 0.001)
    }

    func testUpdateLayoutRotationReclamps() {
        let (model, _) = makeModel()
        model.setFloatingFrame(CGRect(x: 12, y: 700, width: 180, height: 240))
        let landscape = makeLayout(container: CGSize(width: 800, height: 400))
        model.updateLayout(landscape)
        let bounds = BridgeWindowGeometry.contentBounds(for: landscape)
        XCTAssertTrue(bounds.contains(model.currentFrame))
    }

    // MARK: - Momentum / inertia on drag release (adj-207.2.4)

    func testEndDragWithMomentumFlingsToFarEdgeAndSnaps() {
        let (model, _) = makeModel()
        // Centred window; a fast fling to the right should carry it to the right
        // edge and snap flush (margin), not stop where the finger lifted.
        model.setFloatingFrame(CGRect(x: 110, y: 300, width: 180, height: 240))
        model.endDrag(momentum: CGSize(width: 1000, height: 0))
        // right edge: x = maxX(400) - width(180) - margin(12) = 208.
        XCTAssertEqual(model.currentFrame.minX, 208, accuracy: 0.001)
    }

    func testEndDragWithoutMomentumJustSnaps() {
        let (model, _) = makeModel()
        model.setFloatingFrame(CGRect(x: 8, y: 50, width: 180, height: 240))
        model.endDrag(momentum: .zero)
        XCTAssertEqual(model.currentFrame.origin.x, 12, accuracy: 0.001)
        XCTAssertEqual(model.currentFrame.origin.y, 56, accuracy: 0.001)
    }

    // MARK: - Chrome constants + adaptive controls (adj-207.2.5 / adj-207.2.7)

    func testChromeHitTargetMeetsHIGMinimum() {
        XCTAssertGreaterThanOrEqual(BridgeWindowChrome.hitTarget, 44, "controls must meet the 44pt HIG minimum")
    }

    func testExpandedControlsAdaptToWidth() {
        // Narrow windows drop the secondary control so the row never overflows or
        // collides with the resize grip; wide windows show the full set.
        XCTAssertFalse(BridgeWindowChrome.showsExpandedControls(availableWidth: 130))
        XCTAssertTrue(BridgeWindowChrome.showsExpandedControls(availableWidth: 320))
    }

    // MARK: - Full-screen control bar sits at the bottom, clear of chrome (adj-207.2.11)

    func testFullscreenControlBarClearsSafeAreaAndWebRow() {
        // Padding = live safe-area bottom + a clearance that clears BOTH the home
        // indicator AND the web mic/cam row (pinned ~46pt + safe-area, ~44pt pills).
        let withHomeIndicator = BridgeWindowChrome.fullscreenControlBarBottomPadding(safeAreaBottom: 34)
        XCTAssertEqual(withHomeIndicator, 34 + BridgeWindowChrome.webControlsClearance, accuracy: 0.001)
        // Clearance must exceed the web row (46 offset + ~44 pill) so the native
        // bar sits ABOVE it without occluding.
        XCTAssertGreaterThanOrEqual(BridgeWindowChrome.webControlsClearance, 90)
        // Even with no home indicator (home-button devices), it still clears the row.
        XCTAssertGreaterThanOrEqual(
            BridgeWindowChrome.fullscreenControlBarBottomPadding(safeAreaBottom: 0), 90)
        // Never negative for odd inputs.
        XCTAssertGreaterThanOrEqual(
            BridgeWindowChrome.fullscreenControlBarBottomPadding(safeAreaBottom: -10),
            BridgeWindowChrome.webControlsClearance)
    }

    // MARK: - PiP pop-out routes through the injected hand-off (adj-207.2.13)

    func testPopOutToPiPRoutesThroughInjectedHandoff() {
        let (model, _) = makeModel()
        var popOutCount = 0
        model.onPopOutToPiP = { popOutCount += 1 }
        model.popOutToPiP()
        XCTAssertEqual(popOutCount, 1, "bottom-bar PiP button routes to the host hand-off")
    }

    func testPiPControlHiddenByDefault() {
        let (model, _) = makeModel()
        XCTAssertFalse(model.isPiPSupported, "no dead PiP button unless the host enables it")
    }

    // MARK: - Real session control adapter

    func testSessionControlsEndClosesSession() {
        let surface = NoopSurface()
        let session = BridgeSession(surface: surface)
        session.open()
        session.markConnected()
        let controls = BridgeSessionWindowControls(session: session)
        XCTAssertTrue(controls.isLive)
        controls.end()
        XCTAssertEqual(session.state, .closed)
        XCTAssertFalse(controls.isLive)
    }

    func testSessionControlsSetMutedFiresMicHook() {
        // adj-207.2.10: setMuted carries out the real mic side effect via the hook
        // the host wires to the surface's mic.
        let session = BridgeSession(surface: NoopSurface())
        session.open()
        session.markConnected()
        var muteEvents: [Bool] = []
        let controls = BridgeSessionWindowControls(session: session) { muteEvents.append($0) }
        controls.setMuted(true)
        controls.setMuted(false)
        XCTAssertEqual(muteEvents, [true, false])
    }

    func testMuteRoutesThroughSeamToSurfaceMicAndUpdatesState() {
        // End-to-end (adj-207.2.10): model.toggleMute → seam → (host-wired) surface
        // mic command, mirroring how the host maps `muted` → mic disabled.
        var micEnabledCommands: [Bool] = []
        let session = BridgeSession(surface: NoopSurface())
        session.open()
        session.markConnected()
        let controls = BridgeSessionWindowControls(session: session) { muted in
            micEnabledCommands.append(!muted) // host maps muted → setMicEnabled(!muted)
        }
        var state = BridgeWindowState(layout: makeLayout())
        state.enterFloating()
        let model = BridgeFloatingWindowModel(state: state, controls: controls)

        XCTAssertFalse(model.isMuted)
        model.toggleMute()
        XCTAssertTrue(model.isMuted, "state updates so the icon is reactive")
        XCTAssertEqual(micEnabledCommands, [false], "muting disables the mic on the surface")
        model.toggleMute()
        XCTAssertFalse(model.isMuted)
        XCTAssertEqual(micEnabledCommands, [false, true], "unmuting re-enables the mic")
    }

    func testSessionControlsIsLiveFalseBeforeConnect() {
        let session = BridgeSession(surface: NoopSurface())
        let controls = BridgeSessionWindowControls(session: session)
        XCTAssertFalse(controls.isLive, "idle session is not live")
        session.open()
        XCTAssertFalse(controls.isLive, "connecting is not yet live")
        session.markConnected()
        XCTAssertTrue(controls.isLive)
        session.enterBackground()
        XCTAssertTrue(controls.isLive, "backgrounded session is still live (audio continues)")
    }

    // MARK: - Minimal surface double

    private final class NoopSurface: BridgeSurface {
        var onReady: (() -> Void)?
        var onFailure: (() -> Void)?
        func prepare() {}
        func show() {}
        func hide() {}
        func teardown() {}
    }
}
