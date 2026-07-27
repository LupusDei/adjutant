import CoreGraphics

/// PURE layout math for the Mission Control map (adj-208.3.2).
///
/// Deliberately free of SwiftUI: every function is deterministic geometry over
/// `CoreGraphics` primitives, so it is trivially unit-tested and the Canvas
/// renderer (adj-208.3.3) consumes verified positions rather than inlining math.
///
/// Coordinate space is top-left origin (SwiftUI/Canvas convention): `y` grows
/// downward, so the coordinator hub sits at LARGE `y` (the base) and active-epic
/// nodes rise toward SMALL `y` (the top).
enum MissionControlLayout {

    /// Beacon color KEY derived from a project's rolled-up status.
    ///
    /// The pure layer intentionally does not know about SwiftUI `Color` — it emits
    /// a semantic key and the view maps it to a `CRTTheme` token. This keeps the
    /// math testable and the palette swappable in one place.
    enum BeaconKey: String, Equatable {
        case green    // on_track
        case amber    // needs_input
        case red      // blocked
        case neutral  // unknown / absent
    }

    // MARK: - Stream X positions

    /// Evenly distributes `count` project streams across the drawable width, inset by
    /// `margin` on both sides.
    ///
    /// - A single stream is centered horizontally.
    /// - Two or more streams span from the left inset to the right inset with equal gaps.
    /// - `count <= 0` yields an empty array.
    /// - Degenerate inputs (`2*margin >= width`) clamp the usable width to zero rather
    ///   than producing negative gaps or NaN — positions collapse to the margin.
    static func streamXPositions(count: Int, width: CGFloat, margin: CGFloat) -> [CGFloat] {
        guard count > 0 else { return [] }
        guard count > 1 else { return [width / 2] }

        let usable = max(0, width - 2 * margin)
        let step = usable / CGFloat(count - 1)
        return (0..<count).map { margin + step * CGFloat($0) }
    }

    // MARK: - Completion ring

    /// Clamps a raw completion `percent` (0…1) to a safe arc fraction (0…1).
    /// Guards against out-of-range rollup values so the ring never over/under-draws.
    static func completionArcFraction(percent: CGFloat) -> CGFloat {
        min(max(percent, 0), 1)
    }

    /// End angle (radians) for a completion ring arc that begins at `startAngle` and
    /// sweeps clockwise by the clamped completion fraction. `startAngle` defaults to
    /// −π/2 (12 o'clock), the natural top-of-ring start.
    static func completionArcEndAngle(percent: CGFloat, startAngle: CGFloat = -.pi / 2) -> CGFloat {
        startAngle + completionArcFraction(percent: percent) * 2 * .pi
    }

    // MARK: - Remaining-work badge

    /// Scales a per-project remaining-work badge so heavier backlogs read as larger.
    ///
    /// Returns `minScale` at zero remaining, interpolates linearly, and saturates at
    /// `maxScale` once `remaining` reaches `saturationCount`. Guards negative counts
    /// (→ `minScale`) and a non-positive `saturationCount` (→ `maxScale`, no divide-by-zero).
    static func remainingBadgeScale(
        remaining: Int,
        minScale: CGFloat = 1.0,
        maxScale: CGFloat = 1.6,
        saturationCount: Int = 20
    ) -> CGFloat {
        guard remaining > 0 else { return minScale }
        guard saturationCount > 0 else { return maxScale }
        let t = min(CGFloat(remaining) / CGFloat(saturationCount), 1)
        return minScale + (maxScale - minScale) * t
    }

    // MARK: - Status beacon

    /// Maps a rollup `status` string (`on_track` | `needs_input` | `blocked`) to a
    /// beacon color key. Any unrecognized/empty value is `.neutral` (fail-soft).
    static func beaconKey(forStatus status: String) -> BeaconKey {
        switch status {
        case "on_track":    return .green
        case "needs_input": return .amber
        case "blocked":     return .red
        default:            return .neutral
        }
    }

    // MARK: - Fixed anchors

    /// The coordinator hub anchor — bottom-center, inset from the base by `margin`.
    static func hubAnchor(size: CGSize, margin: CGFloat) -> CGPoint {
        CGPoint(x: size.width / 2, y: size.height - margin)
    }

    /// The backlog / queued-epic reservoir anchor — shares the base line with the hub
    /// but sits at the right inset, reading as work waiting to feed the coordinator.
    static func backlogAnchor(size: CGSize, margin: CGFloat) -> CGPoint {
        CGPoint(x: size.width - margin, y: size.height - margin)
    }

    /// Position of a project's active-epic node.
    ///
    /// Encodes the proposal's signature "distance to done" cue in the stream HEIGHT: the node
    /// stays on its stream's `streamX`, and its `y` interpolates by completion so the stream
    /// length reads as remaining work at a glance.
    /// - A far-from-done epic (`completionFraction` → 0) rises to `topMargin` (TALL stream).
    /// - A nearly-done epic (`completionFraction` → 1) sits at `topMargin + band` (SHORT stream,
    ///   "coming in to land" at the hub).
    /// `completionFraction` is clamped to 0…1.
    static func epicNodePosition(
        streamX: CGFloat,
        completionFraction: CGFloat,
        topMargin: CGFloat,
        band: CGFloat
    ) -> CGPoint {
        let f = min(max(completionFraction, 0), 1)
        return CGPoint(x: streamX, y: topMargin + f * band)
    }
}
