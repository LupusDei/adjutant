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

    // MARK: - Edge-safe label centering (adj-208.3.4.1a)

    /// Clamps a centered label's x so its box `[c - width/2, c + width/2]` stays inside the safe
    /// span `[margin, drawWidth - margin]`.
    ///
    /// The outermost project streams sit AT the horizontal margin, so a label centered on the node
    /// would spill off the screen edge. This nudges the leftmost label right and the rightmost label
    /// left just enough to keep both edges on-screen. If the label is wider than the safe span (it
    /// cannot fit either way — the caller should also shrink/wrap the text), it is centered.
    static func clampedCenterX(desiredCenterX: CGFloat, labelWidth: CGFloat, drawWidth: CGFloat, margin: CGFloat) -> CGFloat {
        let half = labelWidth / 2
        let minCenter = margin + half
        let maxCenter = drawWidth - margin - half
        guard minCenter <= maxCenter else { return drawWidth / 2 }
        return min(max(desiredCenterX, minCenter), maxCenter)
    }

    // MARK: - Bottom band: hub caption + legend (adj-208.3.4.1b)

    /// Y positions for the bottom band — the hub's "COORDINATOR" caption and the shape legend.
    /// Guarantees the legend sits at least `minSeparation` BELOW the caption so they never collide,
    /// regardless of canvas height.
    static func bottomBand(
        height: CGFloat,
        hubY: CGFloat,
        hubRadius: CGFloat,
        captionGap: CGFloat = 11,
        bottomInset: CGFloat = 16,
        minSeparation: CGFloat = 20
    ) -> (captionY: CGFloat, legendY: CGFloat) {
        let captionY = hubY + hubRadius + captionGap
        let legendY = max(height - bottomInset, captionY + minSeparation)
        return (captionY: captionY, legendY: legendY)
    }

    // MARK: - Per-feature agentic intensity (adj-209.4.1)

    /// Visual "heat" for a project stream, derived from a normalized composite activity level
    /// (agents + report_progress cadence + in-progress beads; computed backend-side, 0…1).
    ///
    /// The proposal's signature cue is **busier ⇒ hotter**: an active stream must read as
    /// clearly hotter than an idle one at a glance, not marginally. Each channel therefore has
    /// a visible cold FLOOR (an idle stream still renders and drifts) plus generous HEADROOM so
    /// the hot end is a large multiple of the cold end.
    struct Intensity: Equatable {
        /// Stroke width of the stream path.
        let streamThickness: CGFloat
        /// Glow radius around the stream/nodes (0 at the cold floor is allowed).
        let glowRadius: CGFloat
        /// Animated flow speed multiplier (dashes/particles per second scale).
        let flowSpeed: CGFloat
    }

    /// Maps a composite `activityLevel` (clamped to 0…1) to a monotonic ``Intensity``.
    ///
    /// Monotonic and clamped on every channel. The mapping is a simple, auditable linear
    /// interpolation from a cold floor to a hot ceiling — chosen so the ratios have real
    /// headroom (thickness ~2.5x, flow ~3x, glow +8pt) rather than a subtle nudge. Linear (not
    /// eased) keeps `intensity` trivially monotonic and unit-testable; any easing belongs in the
    /// animation layer, not here.
    static func intensity(activityLevel: CGFloat) -> Intensity {
        let t = min(max(activityLevel, 0), 1)

        // Cold floor → hot ceiling. Floors keep an idle stream visible; ceilings give headroom.
        let thickness = lerp(2.0, 5.5, t)   // 2.75x
        let glow      = lerp(0.0, 9.0, t)   // +9pt of bloom at full heat
        let speed     = lerp(0.35, 1.6, t)  // ~4.5x faster flow when hot

        return Intensity(streamThickness: thickness, glowRadius: glow, flowSpeed: speed)
    }

    /// Linear interpolation helper (kept private to the pure layer).
    private static func lerp(_ a: CGFloat, _ b: CGFloat, _ t: CGFloat) -> CGFloat {
        a + (b - a) * t
    }

    // MARK: - Per-feature node layout (adj-209.4.1)

    /// Positions of a project's FEATURE nodes along (and fanned around) its stream.
    ///
    /// A project stream branches into its N in-progress features. Features are distributed
    /// **vertically** between the epic node (`epicY`, top) and the hub (`hubY`, bottom) so each
    /// occupies a distinct height, and **fanned horizontally** — evenly spread across ±`spread`/2
    /// and centered (mean offset 0) on the stream centerline (`streamX`) — so multiple features
    /// never stack into one dot. The fan is clamped to `[minX, maxX]` when provided, so the
    /// outermost streams' features never spill off-screen (mirrors ``clampedCenterX`` for labels).
    ///
    /// - `count <= 0` → empty.
    /// - A single feature sits exactly on the centerline, mid-band.
    /// - Nodes stay strictly inside the `[epicY, hubY]` band (never above the epic or below the hub).
    static func featureNodePositions(
        count: Int,
        streamX: CGFloat,
        epicY: CGFloat,
        hubY: CGFloat,
        spread: CGFloat,
        minX: CGFloat = -.greatestFiniteMagnitude,
        maxX: CGFloat = .greatestFiniteMagnitude
    ) -> [CGPoint] {
        guard count > 0 else { return [] }
        guard count > 1 else {
            let midY = (epicY + hubY) / 2
            let x = min(max(streamX, minX), maxX)
            return [CGPoint(x: x, y: midY)]
        }

        // Inset the band by a fraction of a slot so nodes never sit exactly on the epic/hub.
        let bandTop = epicY, bandBottom = hubY
        let span = bandBottom - bandTop
        let inset = span / CGFloat(count + 1)
        let usable = span - 2 * inset
        let step = usable / CGFloat(count - 1)

        let half = spread / 2
        return (0..<count).map { i -> CGPoint in
            let y = bandTop + inset + step * CGFloat(i)
            // Symmetric zig-zag around the centerline: -half, +half, -half/2, +half/2, ...
            // Even count straddles the line; odd count keeps the middle node centered.
            let offset = fanOffset(index: i, count: count, half: half)
            let x = min(max(streamX + offset, minX), maxX)
            return CGPoint(x: x, y: y)
        }
    }

    /// Symmetric horizontal fan offset for feature `index` of `count`, spanning ±`half`.
    /// Produces a balanced spread whose mean is 0 (centered on the stream) for any count.
    private static func fanOffset(index i: Int, count: Int, half: CGFloat) -> CGFloat {
        guard count > 1 else { return 0 }
        // Evenly space offsets across [-half, +half]; the midpoint lands on 0.
        let t = CGFloat(i) / CGFloat(count - 1)      // 0…1
        return -half + t * (2 * half)                 // -half…+half
    }
}
