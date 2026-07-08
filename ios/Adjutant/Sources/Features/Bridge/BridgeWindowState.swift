import CoreGraphics

// MARK: - Layout inputs

/// Directional insets for the Bridge window's usable area. A pure value type
/// (no `UIEdgeInsets` / UIKit) so the geometry core stays view-free and testable.
/// `leading`/`trailing` are laid out left-to-right by the caller; the pure math
/// never needs to know about RTL.
struct BridgeWindowInsets: Equatable, Sendable {
    var top: CGFloat
    var leading: CGFloat
    var bottom: CGFloat
    var trailing: CGFloat

    init(top: CGFloat = 0, leading: CGFloat = 0, bottom: CGFloat = 0, trailing: CGFloat = 0) {
        self.top = top
        self.leading = leading
        self.bottom = bottom
        self.trailing = trailing
    }

    static let zero = BridgeWindowInsets()
}

/// Everything the geometry core needs to place the Bridge floating window: the
/// container it lives in, the safe-area + keyboard insets it must avoid, the
/// resize bounds + aspect ratio, the pill size, and the snap tuning. Purely
/// data — the SwiftUI chrome (adj-207.2.2) supplies live values from
/// `GeometryReader` / `safeAreaInsets` / keyboard observers.
struct BridgeWindowLayout: Equatable, Sendable {
    /// Full area the window may occupy (typically the app-root container size).
    var containerSize: CGSize
    /// Safe-area insets to keep the floating window clear of notch / home bar.
    var safeAreaInsets: BridgeWindowInsets
    /// Extra bottom inset when the keyboard is visible (0 when hidden).
    var keyboardInset: CGFloat
    /// Smallest allowed floating size (must share `aspectRatio`).
    var minSize: CGSize
    /// Largest allowed floating size (must share `aspectRatio`).
    var maxSize: CGSize
    /// Preserved width / height ratio while resizing.
    var aspectRatio: CGFloat
    /// The minimized pill/bubble size.
    var pillSize: CGSize
    /// Distance (pt) within which a released window snaps flush to an edge.
    var snapThreshold: CGFloat
    /// Gap kept between a snapped/clamped window and the usable-bounds edge.
    var margin: CGFloat

    init(
        containerSize: CGSize,
        safeAreaInsets: BridgeWindowInsets = .zero,
        keyboardInset: CGFloat = 0,
        minSize: CGSize = CGSize(width: 120, height: 160),
        maxSize: CGSize = CGSize(width: 300, height: 400),
        aspectRatio: CGFloat = 0.75,
        pillSize: CGSize = CGSize(width: 72, height: 72),
        snapThreshold: CGFloat = 24,
        margin: CGFloat = 12
    ) {
        self.containerSize = containerSize
        self.safeAreaInsets = safeAreaInsets
        self.keyboardInset = keyboardInset
        self.minSize = minSize
        self.maxSize = maxSize
        self.aspectRatio = aspectRatio
        self.pillSize = pillSize
        self.snapThreshold = snapThreshold
        self.margin = margin
    }
}

// MARK: - Window mode & corners

/// Which surface mode the Bridge window is presenting.
///
/// `fullscreen` fills the whole container (the surface deliberately ignores the
/// safe area); `floating` is the draggable/resizable window; `pill` is the
/// minimized live bubble. All three are pure states of the SAME session —
/// switching mode never touches the underlying stream (Foundational invariant).
enum BridgeWindowMode: Equatable, Sendable {
    case fullscreen
    case floating
    /// Minimized: the Bridge surface + ALL chrome are hidden entirely — nothing
    /// floats (adj-207.2.12). The session stays LIVE in the background; the
    /// bottom-tab LIVE item is the sole re-entry (`reveal`). Replaces the old pill.
    case hidden
}

/// The eight-less-four resize grips: the four corners of the floating window.
/// Dragging a corner resizes while anchoring the OPPOSITE corner in place.
enum BridgeWindowResizeHandle: Equatable, Sendable {
    case topLeft
    case topRight
    case bottomLeft
    case bottomRight
}

// MARK: - Pure geometry

/// The load-bearing geometry math for the Bridge floating window, as free pure
/// functions. No SwiftUI / UIKit and no mutable state: every function maps
/// inputs → a new `CGRect`, so drag / snap / resize / clamp are all exhaustively
/// unit-testable in isolation (adj-207.2.1). `BridgeWindowState` composes these;
/// the view layer only renders the result.
enum BridgeWindowGeometry {

    /// The rectangle (container coordinates) the floating window must stay inside:
    /// the container inset by the safe area and, at the bottom, the keyboard.
    static func contentBounds(for layout: BridgeWindowLayout) -> CGRect {
        let left = layout.safeAreaInsets.leading
        let top = layout.safeAreaInsets.top
        let right = layout.containerSize.width - layout.safeAreaInsets.trailing
        let bottom = layout.containerSize.height
            - layout.safeAreaInsets.bottom
            - layout.keyboardInset
        return CGRect(
            x: left,
            y: top,
            width: max(0, right - left),
            height: max(0, bottom - top)
        )
    }

    /// Move `frame` fully inside `bounds`. Shrinks the frame first if it is larger
    /// than the bounds (e.g. keyboard shrank the usable area below the window),
    /// then repositions so no edge escapes.
    static func clamp(_ frame: CGRect, within bounds: CGRect) -> CGRect {
        var f = frame
        if f.width > bounds.width { f.size.width = bounds.width }
        if f.height > bounds.height { f.size.height = bounds.height }
        if f.minX < bounds.minX { f.origin.x = bounds.minX }
        if f.maxX > bounds.maxX { f.origin.x = bounds.maxX - f.width }
        if f.minY < bounds.minY { f.origin.y = bounds.minY }
        if f.maxY > bounds.maxY { f.origin.y = bounds.maxY - f.height }
        return f
    }

    /// Translate `frame` by `translation` and clamp back inside `bounds`.
    static func drag(_ frame: CGRect, by translation: CGSize, within bounds: CGRect) -> CGRect {
        let moved = frame.offsetBy(dx: translation.width, dy: translation.height)
        return clamp(moved, within: bounds)
    }

    /// Snap a released window flush (minus `margin`) to any bounds edge it is
    /// within `threshold` of. Horizontal and vertical snapping are independent, so
    /// a window near a corner snaps to that corner. Untouched otherwise.
    static func snap(
        _ frame: CGRect,
        within bounds: CGRect,
        threshold: CGFloat,
        margin: CGFloat
    ) -> CGRect {
        var f = clamp(frame, within: bounds)
        let leftGap = f.minX - bounds.minX
        let rightGap = bounds.maxX - f.maxX
        let topGap = f.minY - bounds.minY
        let bottomGap = bounds.maxY - f.maxY

        if leftGap <= threshold && leftGap <= rightGap {
            f.origin.x = bounds.minX + margin
        } else if rightGap <= threshold {
            f.origin.x = bounds.maxX - f.width - margin
        }

        if topGap <= threshold && topGap <= bottomGap {
            f.origin.y = bounds.minY + margin
        } else if bottomGap <= threshold {
            f.origin.y = bounds.maxY - f.height - margin
        }

        return clamp(f, within: bounds)
    }

    /// Resize `frame` by dragging `handle` by `translation`, keeping `aspectRatio`
    /// and staying within `[minSize, maxSize]`. The corner OPPOSITE the handle is
    /// held fixed. Width drives the resize; height is derived from the aspect and
    /// re-checked against the height bounds. Finally clamped inside `bounds`.
    static func resize(
        _ frame: CGRect,
        handle: BridgeWindowResizeHandle,
        by translation: CGSize,
        minSize: CGSize,
        maxSize: CGSize,
        aspectRatio: CGFloat,
        within bounds: CGRect
    ) -> CGRect {
        // Horizontal drag direction depends on which side the handle is on.
        let widthDelta: CGFloat
        switch handle {
        case .topRight, .bottomRight: widthDelta = translation.width
        case .topLeft, .bottomLeft: widthDelta = -translation.width
        }

        var newWidth = min(max(frame.width + widthDelta, minSize.width), maxSize.width)
        var newHeight = newWidth / aspectRatio
        if newHeight < minSize.height {
            newHeight = minSize.height
            newWidth = newHeight * aspectRatio
        } else if newHeight > maxSize.height {
            newHeight = maxSize.height
            newWidth = newHeight * aspectRatio
        }
        newWidth = min(max(newWidth, minSize.width), maxSize.width)

        // Anchor the corner opposite the dragged handle.
        let anchorX: CGFloat
        let anchorY: CGFloat
        switch handle {
        case .bottomRight: anchorX = frame.minX; anchorY = frame.minY // top-left fixed
        case .bottomLeft: anchorX = frame.maxX; anchorY = frame.minY  // top-right fixed
        case .topRight: anchorX = frame.minX; anchorY = frame.maxY    // bottom-left fixed
        case .topLeft: anchorX = frame.maxX; anchorY = frame.maxY     // bottom-right fixed
        }

        let originX: CGFloat
        let originY: CGFloat
        switch handle {
        case .bottomRight: originX = anchorX; originY = anchorY
        case .bottomLeft: originX = anchorX - newWidth; originY = anchorY
        case .topRight: originX = anchorX; originY = anchorY - newHeight
        case .topLeft: originX = anchorX - newWidth; originY = anchorY - newHeight
        }

        let resized = CGRect(x: originX, y: originY, width: newWidth, height: newHeight)
        return clamp(resized, within: bounds)
    }

    /// A sensible default floating frame: the max size (fitted to bounds, aspect
    /// preserved) parked in the bottom-trailing corner with margin.
    static func defaultFloatingFrame(for layout: BridgeWindowLayout) -> CGRect {
        let bounds = contentBounds(for: layout)
        var width = min(layout.maxSize.width, bounds.width - 2 * layout.margin)
        var height = width / layout.aspectRatio
        let maxHeight = min(layout.maxSize.height, bounds.height - 2 * layout.margin)
        if height > maxHeight {
            height = maxHeight
            width = height * layout.aspectRatio
        }
        width = max(width, layout.minSize.width)
        height = max(height, layout.minSize.height)
        let frame = CGRect(
            x: bounds.maxX - width - layout.margin,
            y: bounds.maxY - height - layout.margin,
            width: width,
            height: height
        )
        return clamp(frame, within: bounds)
    }
}

// MARK: - Window state (pure value model)

/// The pure, view-free state of the Bridge floating window (adj-207.2.1).
///
/// Owns the current `mode`, the persisted floating `frame`, and the pill corner,
/// and exposes value-semantic transitions that delegate all math to
/// `BridgeWindowGeometry`. The SwiftUI chrome (adj-207.2.2) holds one of these,
/// renders `currentFrame`, and feeds gestures back in — but every rule lives
/// here where it can be unit-tested without a running UI.
///
/// It never touches the `BridgeSession` / stream: mode changes are presentation
/// only, preserving the single-session invariant.
struct BridgeWindowState: Equatable, Sendable {
    /// Current presentation mode. Defaults to `.fullscreen` (the Bridge opens
    /// full-screen; the Commander shrinks it to a floating window).
    private(set) var mode: BridgeWindowMode

    /// The persisted floating-window frame (container coordinates). Retained
    /// across `fullscreen` / `hidden` so revealing returns exactly where the
    /// Commander left it.
    private(set) var floatingFrame: CGRect

    /// The last VISIBLE mode (fullscreen or floating). `reveal()` returns to it
    /// after a minimize-to-hidden, so re-entry restores the prior presentation
    /// (adj-207.2.12).
    private(set) var lastVisibleMode: BridgeWindowMode

    /// The active layout (container / safe area / keyboard / bounds tuning).
    private(set) var layout: BridgeWindowLayout

    init(layout: BridgeWindowLayout, mode: BridgeWindowMode = .fullscreen) {
        self.layout = layout
        self.mode = mode
        self.floatingFrame = BridgeWindowGeometry.defaultFloatingFrame(for: layout)
        self.lastVisibleMode = (mode == .hidden) ? .fullscreen : mode
    }

    /// The usable bounds for the current layout.
    var contentBounds: CGRect { BridgeWindowGeometry.contentBounds(for: layout) }

    /// True while minimized to hidden — nothing floats; session stays live.
    var isHidden: Bool { mode == .hidden }

    /// The frame the view should render for the current mode. `hidden` keeps the
    /// full-screen frame so the (invisible, non-interactive) surface stays a
    /// stable size while minimized — the view composites it at zero opacity.
    var currentFrame: CGRect {
        switch mode {
        case .fullscreen, .hidden:
            return CGRect(origin: .zero, size: layout.containerSize)
        case .floating:
            return floatingFrame
        }
    }

    // MARK: Mode transitions

    /// Present full-screen. Preserves the floating frame for a later reveal.
    mutating func enterFullscreen() {
        mode = .fullscreen
        lastVisibleMode = .fullscreen
    }

    /// Present as the floating window (using the persisted / default frame).
    mutating func enterFloating() {
        mode = .floating
        lastVisibleMode = .floating
        floatingFrame = BridgeWindowGeometry.clamp(floatingFrame, within: contentBounds)
    }

    /// Minimize to HIDDEN (adj-207.2.12): the surface + all chrome vanish; nothing
    /// floats. Records the current visible mode so `reveal()` returns to it. Does
    /// NOT touch the session — it stays live (audio continues) — nor the floating
    /// frame, so revealing returns exactly where the Commander left it.
    mutating func minimize() {
        if mode != .hidden { lastVisibleMode = mode }
        mode = .hidden
    }

    /// Reveal from hidden back to the last visible mode (fullscreen or floating).
    mutating func reveal() {
        mode = lastVisibleMode
        if mode == .floating {
            floatingFrame = BridgeWindowGeometry.clamp(floatingFrame, within: contentBounds)
        }
    }

    // MARK: Frame edits

    /// Replace the floating frame (clamped into the usable bounds).
    mutating func setFloatingFrame(_ frame: CGRect) {
        floatingFrame = BridgeWindowGeometry.clamp(frame, within: contentBounds)
    }

    /// Drag the floating window by an offset, clamped to the usable bounds.
    mutating func dragFloating(by translation: CGSize) {
        floatingFrame = BridgeWindowGeometry.drag(floatingFrame, by: translation, within: contentBounds)
    }

    /// Called when a drag gesture ends — snap to a near edge/corner.
    mutating func endDrag() {
        floatingFrame = BridgeWindowGeometry.snap(
            floatingFrame,
            within: contentBounds,
            threshold: layout.snapThreshold,
            margin: layout.margin
        )
    }

    /// Resize the floating window by dragging a corner handle.
    mutating func resizeFloating(handle: BridgeWindowResizeHandle, by translation: CGSize) {
        floatingFrame = BridgeWindowGeometry.resize(
            floatingFrame,
            handle: handle,
            by: translation,
            minSize: layout.minSize,
            maxSize: layout.maxSize,
            aspectRatio: layout.aspectRatio,
            within: contentBounds
        )
    }

    // MARK: Environment changes

    /// Apply a new layout (rotation, safe-area or keyboard change) and re-clamp
    /// the floating frame into the new usable bounds.
    mutating func updateLayout(_ newLayout: BridgeWindowLayout) {
        layout = newLayout
        floatingFrame = BridgeWindowGeometry.clamp(floatingFrame, within: contentBounds)
    }
}
