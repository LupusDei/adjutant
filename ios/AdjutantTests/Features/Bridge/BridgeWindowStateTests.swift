import XCTest
import CoreGraphics
@testable import AdjutantUI

/// Tests for the pure Bridge window geometry / state model (adj-207.2.1 / T004).
///
/// `BridgeWindowState` is the PURE, view-free core of the US1 floating window.
/// It owns the window mode (fullscreen / floating / pill), the floating frame,
/// and every geometry rule — drag translation, edge/corner snapping, resize
/// within min/max with a preserved aspect ratio, and safe-area + keyboard-inset
/// clamping. No SwiftUI / UIKit here: the math is exhaustively unit-testable in
/// isolation and the SwiftUI chrome (adj-207.2.2) merely renders `currentFrame`.
///
/// The load-bearing invariants pinned here:
///   1. Mode transitions (fullscreen ↔ floating ↔ pill, restore) preserve the
///      floating frame so the window returns exactly where the Commander left it.
///   2. Drag never lets the window escape the usable bounds (safe area + keyboard).
///   3. Snapping pulls a near-edge/corner window flush (with margin) once released.
///   4. Resize honours min/max and keeps the aspect ratio, anchored at the
///      corner opposite the drag handle.
///   5. Layout changes (rotation, keyboard) re-clamp the frame deterministically.
final class BridgeWindowStateTests: XCTestCase {

    // MARK: - Fixtures

    private func makeLayout(
        container: CGSize = CGSize(width: 400, height: 800),
        safe: BridgeWindowInsets = BridgeWindowInsets(top: 44, leading: 0, bottom: 34, trailing: 0),
        keyboard: CGFloat = 0
    ) -> BridgeWindowLayout {
        BridgeWindowLayout(
            containerSize: container,
            safeAreaInsets: safe,
            keyboardInset: keyboard,
            minSize: CGSize(width: 120, height: 160),
            maxSize: CGSize(width: 300, height: 400),
            aspectRatio: 0.75, // 3:4 portrait (width / height)
            pillSize: CGSize(width: 72, height: 72),
            snapThreshold: 24,
            margin: 12
        )
    }

    private func assertRect(
        _ actual: CGRect,
        _ expected: CGRect,
        accuracy: CGFloat = 0.001,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertEqual(actual.origin.x, expected.origin.x, accuracy: accuracy, "x", file: file, line: line)
        XCTAssertEqual(actual.origin.y, expected.origin.y, accuracy: accuracy, "y", file: file, line: line)
        XCTAssertEqual(actual.size.width, expected.size.width, accuracy: accuracy, "width", file: file, line: line)
        XCTAssertEqual(actual.size.height, expected.size.height, accuracy: accuracy, "height", file: file, line: line)
    }

    // MARK: - Content bounds (usable area)

    func testContentBoundsInsetsSafeAreaAndKeyboard() {
        let layout = makeLayout(keyboard: 100)
        let bounds = BridgeWindowGeometry.contentBounds(for: layout)
        // x: leading safe area; y: top safe area; width: container - leading - trailing;
        // height: container - top - bottom - keyboard.
        assertRect(bounds, CGRect(x: 0, y: 44, width: 400, height: 800 - 44 - 34 - 100))
    }

    // MARK: - Clamp

    func testClampMovesFrameInsideBounds() {
        let bounds = CGRect(x: 0, y: 44, width: 400, height: 722)
        // Frame poking off the top-left corner.
        let clamped = BridgeWindowGeometry.clamp(CGRect(x: -50, y: 0, width: 180, height: 240), within: bounds)
        assertRect(clamped, CGRect(x: 0, y: 44, width: 180, height: 240))
    }

    func testClampPushesFrameOffBottomRightBackIn() {
        let bounds = CGRect(x: 0, y: 44, width: 400, height: 722)
        let clamped = BridgeWindowGeometry.clamp(CGRect(x: 300, y: 700, width: 180, height: 240), within: bounds)
        // maxX must be 400 → x = 220; maxY must be 766 → y = 526.
        assertRect(clamped, CGRect(x: 220, y: 526, width: 180, height: 240))
    }

    func testClampShrinksFrameLargerThanBounds() {
        let bounds = CGRect(x: 0, y: 0, width: 100, height: 100)
        let clamped = BridgeWindowGeometry.clamp(CGRect(x: 0, y: 0, width: 200, height: 300), within: bounds)
        assertRect(clamped, CGRect(x: 0, y: 0, width: 100, height: 100))
    }

    // MARK: - Drag

    func testDragTranslatesFrameByOffset() {
        let bounds = CGRect(x: 0, y: 44, width: 400, height: 722)
        let dragged = BridgeWindowGeometry.drag(
            CGRect(x: 50, y: 100, width: 180, height: 240),
            by: CGSize(width: 30, height: 40),
            within: bounds
        )
        assertRect(dragged, CGRect(x: 80, y: 140, width: 180, height: 240))
    }

    func testDragClampsAtBounds() {
        let bounds = CGRect(x: 0, y: 44, width: 400, height: 722)
        let dragged = BridgeWindowGeometry.drag(
            CGRect(x: 50, y: 100, width: 180, height: 240),
            by: CGSize(width: -100, height: -100),
            within: bounds
        )
        // -50 → clamp x to 0; 0 → clamp y to 44.
        assertRect(dragged, CGRect(x: 0, y: 44, width: 180, height: 240))
    }

    // MARK: - Snap

    func testSnapPullsNearLeftEdgeToMargin() {
        let bounds = CGRect(x: 0, y: 44, width: 400, height: 722)
        // leftGap = 10 (< threshold 24), far from top/bottom vertically-centred.
        let snapped = BridgeWindowGeometry.snap(
            CGRect(x: 10, y: 300, width: 180, height: 240),
            within: bounds, threshold: 24, margin: 12
        )
        XCTAssertEqual(snapped.minX, 12, accuracy: 0.001, "snaps flush-left with margin")
        XCTAssertEqual(snapped.minY, 300, accuracy: 0.001, "vertical untouched (not near an edge)")
    }

    func testSnapPullsNearTopLeftCorner() {
        let bounds = CGRect(x: 0, y: 44, width: 400, height: 722)
        // leftGap = 8, topGap = 50 - 44 = 6, both within threshold → corner snap.
        let snapped = BridgeWindowGeometry.snap(
            CGRect(x: 8, y: 50, width: 180, height: 240),
            within: bounds, threshold: 24, margin: 12
        )
        assertRect(snapped, CGRect(x: 12, y: 56, width: 180, height: 240))
    }

    func testSnapPullsNearBottomRightCorner() {
        let bounds = CGRect(x: 0, y: 44, width: 400, height: 722)
        // frame at (210, 520): rightGap = 400 - 390 = 10, bottomGap = 766 - 760 = 6.
        let snapped = BridgeWindowGeometry.snap(
            CGRect(x: 210, y: 520, width: 180, height: 240),
            within: bounds, threshold: 24, margin: 12
        )
        // right: x = 400 - 180 - 12 = 208; bottom: y = 766 - 240 - 12 = 514.
        assertRect(snapped, CGRect(x: 208, y: 514, width: 180, height: 240))
    }

    func testSnapLeavesCentredWindowUntouched() {
        let bounds = CGRect(x: 0, y: 44, width: 400, height: 722)
        let frame = CGRect(x: 110, y: 300, width: 180, height: 240)
        let snapped = BridgeWindowGeometry.snap(frame, within: bounds, threshold: 24, margin: 12)
        assertRect(snapped, frame)
    }

    // MARK: - Resize (min / max + aspect + anchor)

    func testResizeBottomRightGrowsAnchoringTopLeft() {
        let bounds = CGRect(x: 0, y: 44, width: 400, height: 722)
        let resized = BridgeWindowGeometry.resize(
            CGRect(x: 12, y: 56, width: 120, height: 160),
            handle: .bottomRight,
            by: CGSize(width: 60, height: 999),
            minSize: CGSize(width: 120, height: 160),
            maxSize: CGSize(width: 300, height: 400),
            aspectRatio: 0.75,
            within: bounds
        )
        // width 120+60=180 → height 180/0.75=240; top-left anchor stays.
        assertRect(resized, CGRect(x: 12, y: 56, width: 180, height: 240))
    }

    func testResizeClampsToMaxSizePreservingAspect() {
        let bounds = CGRect(x: 0, y: 44, width: 4000, height: 4000)
        let resized = BridgeWindowGeometry.resize(
            CGRect(x: 12, y: 56, width: 120, height: 160),
            handle: .bottomRight,
            by: CGSize(width: 5000, height: 5000),
            minSize: CGSize(width: 120, height: 160),
            maxSize: CGSize(width: 300, height: 400),
            aspectRatio: 0.75,
            within: bounds
        )
        assertRect(resized, CGRect(x: 12, y: 56, width: 300, height: 400))
    }

    func testResizeClampsToMinSizePreservingAspect() {
        let bounds = CGRect(x: 0, y: 44, width: 400, height: 722)
        let resized = BridgeWindowGeometry.resize(
            CGRect(x: 100, y: 200, width: 200, height: 266.667),
            handle: .bottomRight,
            by: CGSize(width: -5000, height: -5000),
            minSize: CGSize(width: 120, height: 160),
            maxSize: CGSize(width: 300, height: 400),
            aspectRatio: 0.75,
            within: bounds
        )
        assertRect(resized, CGRect(x: 100, y: 200, width: 120, height: 160), accuracy: 0.01)
    }

    func testResizeBottomLeftAnchorsTopRight() {
        let bounds = CGRect(x: 0, y: 44, width: 400, height: 722)
        let resized = BridgeWindowGeometry.resize(
            CGRect(x: 100, y: 56, width: 120, height: 160),
            handle: .bottomLeft,
            by: CGSize(width: -60, height: 80),
            minSize: CGSize(width: 120, height: 160),
            maxSize: CGSize(width: 300, height: 400),
            aspectRatio: 0.75,
            within: bounds
        )
        // Dragging bottom-left leftwards grows width to 180; top-right (x=220,y=56) fixed.
        // origin.x = 220 - 180 = 40.
        assertRect(resized, CGRect(x: 40, y: 56, width: 180, height: 240))
    }

    func testResizeTopRightAnchorsBottomLeft() {
        let bounds = CGRect(x: 0, y: 44, width: 400, height: 722)
        let resized = BridgeWindowGeometry.resize(
            CGRect(x: 100, y: 300, width: 120, height: 160),
            handle: .topRight,
            by: CGSize(width: 60, height: -80),
            minSize: CGSize(width: 120, height: 160),
            maxSize: CGSize(width: 300, height: 400),
            aspectRatio: 0.75,
            within: bounds
        )
        // bottom-left (x=100, y=460) fixed; grow to 180x240 → origin.y = 460-240 = 220.
        assertRect(resized, CGRect(x: 100, y: 220, width: 180, height: 240))
    }

    func testResizeTopLeftAnchorsBottomRight() {
        let bounds = CGRect(x: 0, y: 44, width: 400, height: 722)
        let resized = BridgeWindowGeometry.resize(
            CGRect(x: 100, y: 300, width: 120, height: 160),
            handle: .topLeft,
            by: CGSize(width: -60, height: -80),
            minSize: CGSize(width: 120, height: 160),
            maxSize: CGSize(width: 300, height: 400),
            aspectRatio: 0.75,
            within: bounds
        )
        // bottom-right (x=220, y=460) fixed; grow to 180x240 → origin (40, 220).
        assertRect(resized, CGRect(x: 40, y: 220, width: 180, height: 240))
    }

    // MARK: - State: default + mode transitions

    func testDefaultStateIsFullscreen() {
        let state = BridgeWindowState(layout: makeLayout())
        XCTAssertEqual(state.mode, .fullscreen)
        // Fullscreen fills the whole container (surface ignores safe area).
        assertRect(state.currentFrame, CGRect(x: 0, y: 0, width: 400, height: 800))
    }

    func testEnterFloatingGivesDefaultFrameWithinBounds() {
        var state = BridgeWindowState(layout: makeLayout())
        state.enterFloating()
        XCTAssertEqual(state.mode, .floating)
        let bounds = BridgeWindowGeometry.contentBounds(for: makeLayout())
        XCTAssertTrue(bounds.contains(state.currentFrame), "default floating frame sits inside usable bounds")
        // Aspect preserved.
        XCTAssertEqual(state.currentFrame.width / state.currentFrame.height, 0.75, accuracy: 0.01)
    }

    func testToggleFullscreenPreservesFloatingFrame() {
        var state = BridgeWindowState(layout: makeLayout())
        state.enterFloating()
        state.setFloatingFrame(CGRect(x: 30, y: 120, width: 180, height: 240))
        let saved = state.currentFrame
        state.enterFullscreen()
        XCTAssertEqual(state.mode, .fullscreen)
        state.enterFloating()
        assertRect(state.currentFrame, saved)
    }

    func testMinimizeHidesThenRevealReturnsToFloatingFrame() {
        // adj-207.2.12: minimize hides entirely (nothing floats); reveal returns
        // to the exact prior floating frame.
        var state = BridgeWindowState(layout: makeLayout())
        state.enterFloating()
        state.setFloatingFrame(CGRect(x: 30, y: 120, width: 180, height: 240))
        let saved = state.currentFrame
        state.minimize()
        XCTAssertEqual(state.mode, .hidden)
        XCTAssertTrue(state.isHidden)
        state.reveal()
        XCTAssertEqual(state.mode, .floating, "reveal returns to the last visible mode")
        assertRect(state.currentFrame, saved)
    }

    func testMinimizeFromFullscreenRevealsToFullscreen() {
        var state = BridgeWindowState(layout: makeLayout()) // default fullscreen
        XCTAssertEqual(state.mode, .fullscreen)
        state.minimize()
        XCTAssertEqual(state.mode, .hidden)
        state.reveal()
        XCTAssertEqual(state.mode, .fullscreen, "reveal returns to fullscreen")
        assertRect(state.currentFrame, CGRect(x: 0, y: 0, width: 400, height: 800))
    }

    func testMinimizeIsIdempotentAndKeepsLastVisibleMode() {
        var state = BridgeWindowState(layout: makeLayout())
        state.enterFloating()
        state.minimize()
        state.minimize() // second minimize must not overwrite lastVisibleMode with .hidden
        state.reveal()
        XCTAssertEqual(state.mode, .floating)
    }

    // MARK: - State: drag / resize plumb through to floating frame

    func testStateDragFloatingMovesAndClamps() {
        var state = BridgeWindowState(layout: makeLayout())
        state.enterFloating()
        state.setFloatingFrame(CGRect(x: 50, y: 100, width: 180, height: 240))
        state.dragFloating(by: CGSize(width: -100, height: -100))
        assertRect(state.currentFrame, CGRect(x: 0, y: 44, width: 180, height: 240))
    }

    func testStateEndDragSnaps() {
        var state = BridgeWindowState(layout: makeLayout())
        state.enterFloating()
        state.setFloatingFrame(CGRect(x: 8, y: 50, width: 180, height: 240))
        state.endDrag()
        assertRect(state.currentFrame, CGRect(x: 12, y: 56, width: 180, height: 240))
    }

    func testStateResizeFloating() {
        var state = BridgeWindowState(layout: makeLayout())
        state.enterFloating()
        state.setFloatingFrame(CGRect(x: 12, y: 56, width: 120, height: 160))
        state.resizeFloating(handle: .bottomRight, by: CGSize(width: 60, height: 0))
        assertRect(state.currentFrame, CGRect(x: 12, y: 56, width: 180, height: 240))
    }

    // MARK: - Layout changes: rotation + keyboard re-clamp

    func testKeyboardInsetPushesWindowUp() {
        var state = BridgeWindowState(layout: makeLayout())
        state.enterFloating()
        state.setFloatingFrame(CGRect(x: 12, y: 500, width: 180, height: 240))
        // Raise a 300pt keyboard.
        state.updateLayout(makeLayout(keyboard: 300))
        let bounds = BridgeWindowGeometry.contentBounds(for: makeLayout(keyboard: 300))
        XCTAssertLessThanOrEqual(state.currentFrame.maxY, bounds.maxY + 0.001, "window clears the keyboard")
    }

    func testRotationReclampsFrameIntoNewBounds() {
        var state = BridgeWindowState(layout: makeLayout())
        state.enterFloating()
        state.setFloatingFrame(CGRect(x: 12, y: 500, width: 180, height: 240))
        // Rotate to landscape: 800 x 400.
        let landscape = makeLayout(container: CGSize(width: 800, height: 400))
        state.updateLayout(landscape)
        let bounds = BridgeWindowGeometry.contentBounds(for: landscape)
        XCTAssertTrue(bounds.contains(state.currentFrame), "frame re-clamped inside rotated bounds")
    }

    func testUpdateLayoutKeepsFullscreenFullContainer() {
        var state = BridgeWindowState(layout: makeLayout())
        let landscape = makeLayout(container: CGSize(width: 800, height: 400))
        state.updateLayout(landscape)
        assertRect(state.currentFrame, CGRect(x: 0, y: 0, width: 800, height: 400))
    }
}
