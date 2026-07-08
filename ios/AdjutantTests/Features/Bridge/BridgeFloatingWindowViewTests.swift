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
        var isMuted: Bool = false
        var toggleMuteCount = 0
        var endCount = 0

        func toggleMute() {
            toggleMuteCount += 1
            isMuted.toggle()
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

    // MARK: - Minimize / restore

    func testMinimizeToPillShowsLiveAndPillFrame() {
        let controls = SpyControls()
        controls.isLive = true
        let (model, _) = makeModel(controls: controls)
        model.minimize()
        XCTAssertTrue(model.isPill)
        XCTAssertFalse(model.isFloating)
        XCTAssertTrue(model.isLive, "pill must reflect the live session")
        XCTAssertEqual(model.currentFrame.width, 72, accuracy: 0.001)
        XCTAssertEqual(model.currentFrame.height, 72, accuracy: 0.001)
    }

    func testRestoreReturnsToExactFloatingFrame() {
        let (model, _) = makeModel()
        let saved = model.currentFrame
        model.minimize()
        model.restore()
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

    func testToggleMuteRoutesThroughControls() {
        let (model, controls) = makeModel()
        XCTAssertFalse(model.isMuted)
        model.toggleMute()
        XCTAssertEqual(controls.toggleMuteCount, 1)
        XCTAssertTrue(model.isMuted)
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

    func testSessionControlsToggleMuteFlipsFlagAndFiresHook() {
        let surface = NoopSurface()
        let session = BridgeSession(surface: surface)
        session.open()
        session.markConnected()
        var muteEvents: [Bool] = []
        let controls = BridgeSessionWindowControls(session: session) { muteEvents.append($0) }
        XCTAssertFalse(controls.isMuted)
        controls.toggleMute()
        XCTAssertTrue(controls.isMuted)
        controls.toggleMute()
        XCTAssertFalse(controls.isMuted)
        XCTAssertEqual(muteEvents, [true, false])
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
        func prepare() {}
        func show() {}
        func hide() {}
        func teardown() {}
    }
}
