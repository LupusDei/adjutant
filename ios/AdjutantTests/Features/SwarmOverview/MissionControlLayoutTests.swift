import XCTest
import CoreGraphics
@testable import AdjutantUI

/// Unit tests for the PURE Mission Control layout math (adj-208.3.2).
/// No SwiftUI — every function is deterministic geometry so it is trivially testable
/// and the Canvas renderer (adj-208.3.3) can consume verified positions.
final class MissionControlLayoutTests: XCTestCase {

    private let eps: CGFloat = 0.0001

    // MARK: - streamXPositions

    func testStreamXPositionsEmptyWhenZeroProjects() {
        XCTAssertEqual(MissionControlLayout.streamXPositions(count: 0, width: 300, margin: 30), [])
    }

    func testStreamXPositionsSingleProjectIsCentered() {
        let xs = MissionControlLayout.streamXPositions(count: 1, width: 300, margin: 30)
        XCTAssertEqual(xs.count, 1)
        XCTAssertEqual(xs[0], 150, accuracy: eps, "A single stream should sit at the horizontal center")
    }

    func testStreamXPositionsTwoProjectsSpanTheInsetWidth() {
        let xs = MissionControlLayout.streamXPositions(count: 2, width: 300, margin: 30)
        XCTAssertEqual(xs.count, 2)
        XCTAssertEqual(xs[0], 30, accuracy: eps, "First stream at the left inset")
        XCTAssertEqual(xs[1], 270, accuracy: eps, "Last stream at the right inset")
    }

    func testStreamXPositionsThreeProjectsAreEvenlySpaced() {
        let xs = MissionControlLayout.streamXPositions(count: 3, width: 300, margin: 30)
        XCTAssertEqual(xs, [30, 150, 270])
    }

    func testStreamXPositionsAreMonotonicAndWithinBounds() {
        let width: CGFloat = 500
        let margin: CGFloat = 40
        let xs = MissionControlLayout.streamXPositions(count: 6, width: width, margin: margin)
        for i in 1..<xs.count {
            XCTAssertGreaterThan(xs[i], xs[i - 1], "Positions must be strictly increasing")
        }
        for x in xs {
            XCTAssertGreaterThanOrEqual(x, margin - eps)
            XCTAssertLessThanOrEqual(x, width - margin + eps)
        }
    }

    func testStreamXPositionsClampsDegenerateWidth() {
        // margin*2 exceeds width — usable width clamps to 0, positions collapse to the margin (no NaN/negatives).
        let xs = MissionControlLayout.streamXPositions(count: 2, width: 40, margin: 30)
        XCTAssertEqual(xs.count, 2)
        for x in xs {
            XCTAssertEqual(x, 30, accuracy: eps)
            XCTAssertFalse(x.isNaN)
        }
    }

    // MARK: - completionArcFraction

    func testCompletionArcFractionPassesThroughInRange() {
        XCTAssertEqual(MissionControlLayout.completionArcFraction(percent: 0), 0, accuracy: eps)
        XCTAssertEqual(MissionControlLayout.completionArcFraction(percent: 0.5), 0.5, accuracy: eps)
        XCTAssertEqual(MissionControlLayout.completionArcFraction(percent: 1), 1, accuracy: eps)
    }

    func testCompletionArcFractionClampsOutOfRange() {
        XCTAssertEqual(MissionControlLayout.completionArcFraction(percent: -0.25), 0, accuracy: eps)
        XCTAssertEqual(MissionControlLayout.completionArcFraction(percent: 1.4), 1, accuracy: eps)
    }

    // MARK: - completionArcEndAngle

    func testCompletionArcEndAngleZeroEqualsStart() {
        let start: CGFloat = -.pi / 2
        XCTAssertEqual(
            MissionControlLayout.completionArcEndAngle(percent: 0, startAngle: start),
            start, accuracy: eps
        )
    }

    func testCompletionArcEndAngleFullIsStartPlusTwoPi() {
        let start: CGFloat = -.pi / 2
        XCTAssertEqual(
            MissionControlLayout.completionArcEndAngle(percent: 1, startAngle: start),
            start + 2 * .pi, accuracy: eps
        )
    }

    func testCompletionArcEndAngleQuarterSweep() {
        XCTAssertEqual(
            MissionControlLayout.completionArcEndAngle(percent: 0.25, startAngle: 0),
            .pi / 2, accuracy: eps
        )
    }

    // MARK: - remainingBadgeScale

    func testRemainingBadgeScaleZeroIsMinimum() {
        XCTAssertEqual(
            MissionControlLayout.remainingBadgeScale(remaining: 0, minScale: 1.0, maxScale: 1.6, saturationCount: 20),
            1.0, accuracy: eps
        )
    }

    func testRemainingBadgeScaleSaturatesAtMaximum() {
        XCTAssertEqual(
            MissionControlLayout.remainingBadgeScale(remaining: 20, minScale: 1.0, maxScale: 1.6, saturationCount: 20),
            1.6, accuracy: eps
        )
        XCTAssertEqual(
            MissionControlLayout.remainingBadgeScale(remaining: 999, minScale: 1.0, maxScale: 1.6, saturationCount: 20),
            1.6, accuracy: eps, "Beyond saturation clamps to max"
        )
    }

    func testRemainingBadgeScaleInterpolatesLinearly() {
        XCTAssertEqual(
            MissionControlLayout.remainingBadgeScale(remaining: 10, minScale: 1.0, maxScale: 1.6, saturationCount: 20),
            1.3, accuracy: eps, "Half saturation → midpoint scale"
        )
    }

    func testRemainingBadgeScaleGuardsNegativeAndZeroSaturation() {
        XCTAssertEqual(
            MissionControlLayout.remainingBadgeScale(remaining: -5, minScale: 1.0, maxScale: 1.6, saturationCount: 20),
            1.0, accuracy: eps, "Negative remaining → min (no negative scaling)"
        )
        XCTAssertEqual(
            MissionControlLayout.remainingBadgeScale(remaining: 3, minScale: 1.0, maxScale: 1.6, saturationCount: 0),
            1.6, accuracy: eps, "Zero saturation guard → max (no divide-by-zero)"
        )
    }

    // MARK: - beaconKey

    func testBeaconKeyMapsKnownStatuses() {
        XCTAssertEqual(MissionControlLayout.beaconKey(forStatus: "on_track"), .green)
        XCTAssertEqual(MissionControlLayout.beaconKey(forStatus: "needs_input"), .amber)
        XCTAssertEqual(MissionControlLayout.beaconKey(forStatus: "blocked"), .red)
    }

    func testBeaconKeyUnknownStatusIsNeutral() {
        XCTAssertEqual(MissionControlLayout.beaconKey(forStatus: "on_fire"), .neutral)
        XCTAssertEqual(MissionControlLayout.beaconKey(forStatus: ""), .neutral)
    }

    // MARK: - hubAnchor / backlogAnchor / epicNodePosition

    func testHubAnchorIsBottomCenter() {
        let hub = MissionControlLayout.hubAnchor(size: CGSize(width: 300, height: 600), margin: 20)
        XCTAssertEqual(hub.x, 150, accuracy: eps, "Hub is horizontally centered")
        XCTAssertEqual(hub.y, 580, accuracy: eps, "Hub sits at the base, inset by margin")
    }

    func testBacklogAnchorIsAtBaseRight() {
        let backlog = MissionControlLayout.backlogAnchor(size: CGSize(width: 300, height: 600), margin: 20)
        XCTAssertEqual(backlog.x, 280, accuracy: eps, "Backlog reservoir sits at the right inset")
        XCTAssertEqual(backlog.y, 580, accuracy: eps, "Backlog shares the base line with the hub")
    }

    func testEpicNodeStaysOnItsStreamX() {
        for f in [CGFloat(0), 0.3, 0.5, 1.0] {
            let node = MissionControlLayout.epicNodePosition(streamX: 150, completionFraction: f, topMargin: 80, band: 64)
            XCTAssertEqual(node.x, 150, accuracy: eps, "Epic node always stays on its stream's x")
        }
    }

    func testFarFromDoneEpicRisesToTopMargin() {
        // completion 0 → tallest stream → node at the top margin.
        let node = MissionControlLayout.epicNodePosition(streamX: 150, completionFraction: 0, topMargin: 80, band: 64)
        XCTAssertEqual(node.y, 80, accuracy: eps, "A far-from-done epic reaches the top (tall stream)")
    }

    func testNearlyDoneEpicSitsLowerNearHub() {
        // completion 1 → shortest stream → node dropped by the full band toward the hub.
        let node = MissionControlLayout.epicNodePosition(streamX: 150, completionFraction: 1, topMargin: 80, band: 64)
        XCTAssertEqual(node.y, 144, accuracy: eps, "A done epic sits topMargin+band (short stream)")
    }

    func testHalfDoneEpicIsMidBand() {
        let node = MissionControlLayout.epicNodePosition(streamX: 150, completionFraction: 0.5, topMargin: 80, band: 64)
        XCTAssertEqual(node.y, 112, accuracy: eps, "Half-done → half the band")
    }

    func testEpicNodeHeightIsMonotonicInCompletion() {
        // More complete ⇒ larger y (shorter stream) — never inverts.
        let a = MissionControlLayout.epicNodePosition(streamX: 0, completionFraction: 0.2, topMargin: 80, band: 64).y
        let b = MissionControlLayout.epicNodePosition(streamX: 0, completionFraction: 0.8, topMargin: 80, band: 64).y
        XCTAssertGreaterThan(b, a, "A more-complete epic sits lower (shorter stream)")
    }

    func testEpicNodeClampsCompletionFraction() {
        let over = MissionControlLayout.epicNodePosition(streamX: 0, completionFraction: 1.5, topMargin: 80, band: 64).y
        let under = MissionControlLayout.epicNodePosition(streamX: 0, completionFraction: -0.5, topMargin: 80, band: 64).y
        XCTAssertEqual(over, 144, accuracy: eps, "Over-100% clamps to the short end")
        XCTAssertEqual(under, 80, accuracy: eps, "Negative clamps to the tall end")
    }

    // MARK: - clampedCenterX (adj-208.3.4.1a — badges must not clip at either edge)

    func testClampedCenterKeepsLeftmostLabelOnScreen() {
        // Leftmost node sits AT the margin; a 120-wide badge centered there would spill to x=-14.
        let width: CGFloat = 402, margin: CGFloat = 46, labelWidth: CGFloat = 120
        let c = MissionControlLayout.clampedCenterX(desiredCenterX: margin, labelWidth: labelWidth, drawWidth: width, margin: margin)
        XCTAssertGreaterThanOrEqual(c - labelWidth / 2, margin - eps, "Left edge must not cross the safe margin")
        XCTAssertLessThanOrEqual(c + labelWidth / 2, width - margin + eps)
    }

    func testClampedCenterKeepsRightmostLabelOnScreen() {
        let width: CGFloat = 402, margin: CGFloat = 46, labelWidth: CGFloat = 120
        let c = MissionControlLayout.clampedCenterX(desiredCenterX: width - margin, labelWidth: labelWidth, drawWidth: width, margin: margin)
        XCTAssertLessThanOrEqual(c + labelWidth / 2, width - margin + eps, "Right edge must not cross the safe margin")
        XCTAssertGreaterThanOrEqual(c - labelWidth / 2, margin - eps)
    }

    func testClampedCenterLeavesCenteredLabelUntouched() {
        // A label that already fits centered is not moved.
        let c = MissionControlLayout.clampedCenterX(desiredCenterX: 201, labelWidth: 80, drawWidth: 402, margin: 46)
        XCTAssertEqual(c, 201, accuracy: eps)
    }

    func testClampedCenterCentersOverwideLabel() {
        // Label wider than the safe span can't fit either way → centered (caller shrinks text).
        let c = MissionControlLayout.clampedCenterX(desiredCenterX: 46, labelWidth: 400, drawWidth: 402, margin: 46)
        XCTAssertEqual(c, 201, accuracy: eps, "Overwide label is centered")
    }

    // MARK: - bottomBand (adj-208.3.4.1b — caption and legend must not overlap)

    func testBottomBandLegendIsBelowCaptionAtPortraitHeight() {
        let b = MissionControlLayout.bottomBand(height: 720, hubY: 646, hubRadius: 17)
        XCTAssertGreaterThan(b.legendY, b.captionY, "Legend sits below the hub caption")
        XCTAssertGreaterThanOrEqual(b.legendY - b.captionY, 20 - eps, "At least the minimum separation")
    }

    func testBottomBandSeparationHoldsAtShortHeight() {
        // Even when height is small enough that height-bottomInset would collide, separation is enforced.
        let b = MissionControlLayout.bottomBand(height: 480, hubY: 470, hubRadius: 17)
        XCTAssertGreaterThanOrEqual(b.legendY - b.captionY, 20 - eps,
                                    "Minimum separation holds regardless of height")
    }

    // MARK: - intensity(activityLevel:) — busier ⇒ hotter (adj-209.4.1)

    func testIntensityIsMonotonicAcrossThicknessGlowAndFlow() {
        // Every output channel must strictly increase from cold (0) to hot (1).
        let cold = MissionControlLayout.intensity(activityLevel: 0)
        let warm = MissionControlLayout.intensity(activityLevel: 0.5)
        let hot = MissionControlLayout.intensity(activityLevel: 1)

        XCTAssertLessThan(cold.streamThickness, warm.streamThickness)
        XCTAssertLessThan(warm.streamThickness, hot.streamThickness)

        XCTAssertLessThan(cold.glowRadius, warm.glowRadius)
        XCTAssertLessThan(warm.glowRadius, hot.glowRadius)

        XCTAssertLessThan(cold.flowSpeed, warm.flowSpeed)
        XCTAssertLessThan(warm.flowSpeed, hot.flowSpeed)
    }

    func testIntensityMonotonicOverFineSweep() {
        var prev = MissionControlLayout.intensity(activityLevel: 0)
        var a: CGFloat = 0.05
        while a <= 1.0 + eps {
            let cur = MissionControlLayout.intensity(activityLevel: a)
            XCTAssertGreaterThan(cur.streamThickness, prev.streamThickness - eps, "thickness non-decreasing at \(a)")
            XCTAssertGreaterThan(cur.glowRadius, prev.glowRadius - eps, "glow non-decreasing at \(a)")
            XCTAssertGreaterThan(cur.flowSpeed, prev.flowSpeed - eps, "flow non-decreasing at \(a)")
            prev = cur
            a += 0.05
        }
    }

    func testIntensityClampsBelowZeroToCold() {
        let low = MissionControlLayout.intensity(activityLevel: -3)
        let zero = MissionControlLayout.intensity(activityLevel: 0)
        XCTAssertEqual(low.streamThickness, zero.streamThickness, accuracy: eps)
        XCTAssertEqual(low.glowRadius, zero.glowRadius, accuracy: eps)
        XCTAssertEqual(low.flowSpeed, zero.flowSpeed, accuracy: eps)
    }

    func testIntensityClampsAboveOneToHot() {
        let high = MissionControlLayout.intensity(activityLevel: 5)
        let one = MissionControlLayout.intensity(activityLevel: 1)
        XCTAssertEqual(high.streamThickness, one.streamThickness, accuracy: eps)
        XCTAssertEqual(high.glowRadius, one.glowRadius, accuracy: eps)
        XCTAssertEqual(high.flowSpeed, one.flowSpeed, accuracy: eps)
    }

    func testIntensityColdFloorIsVisiblePositive() {
        // Even an idle stream must be drawable (non-zero thickness/flow) — never invisible.
        let cold = MissionControlLayout.intensity(activityLevel: 0)
        XCTAssertGreaterThan(cold.streamThickness, 0, "Idle stream still renders")
        XCTAssertGreaterThan(cold.flowSpeed, 0, "Idle stream still animates (slowly)")
        XCTAssertGreaterThanOrEqual(cold.glowRadius, 0)
    }

    func testHighActivityIsClearlyHotterThanLowWithHeadroom() {
        // The proposal's core cue: high must be *visibly* hotter, not marginally.
        // Require a strong multiplicative separation (headroom) on each channel.
        let low = MissionControlLayout.intensity(activityLevel: 0.1)
        let high = MissionControlLayout.intensity(activityLevel: 0.9)
        XCTAssertGreaterThan(high.streamThickness, low.streamThickness * 1.8,
                             "Hot stream is at least ~1.8x thicker than a barely-active one")
        XCTAssertGreaterThan(high.flowSpeed, low.flowSpeed * 1.8,
                             "Hot stream flows at least ~1.8x faster")
        XCTAssertGreaterThan(high.glowRadius, low.glowRadius + 4,
                             "Hot node glow has clear extra radius")
    }

    // MARK: - featureNodePositions — features fan out within a project stream (adj-209.4.1)

    func testFeatureNodePositionsCountMatchesInput() {
        let pts = MissionControlLayout.featureNodePositions(
            count: 4, streamX: 150, epicY: 90, hubY: 560, spread: 60
        )
        XCTAssertEqual(pts.count, 4)
    }

    func testFeatureNodePositionsEmptyForZero() {
        XCTAssertTrue(MissionControlLayout.featureNodePositions(
            count: 0, streamX: 150, epicY: 90, hubY: 560, spread: 60).isEmpty)
    }

    func testSingleFeatureSitsOnStreamCenterline() {
        let pts = MissionControlLayout.featureNodePositions(
            count: 1, streamX: 150, epicY: 90, hubY: 560, spread: 60)
        XCTAssertEqual(pts.count, 1)
        XCTAssertEqual(pts[0].x, 150, accuracy: eps, "A lone feature stays on the stream's x")
    }

    func testFeaturesFanSymmetricallyAroundStreamX() {
        let streamX: CGFloat = 200
        let pts = MissionControlLayout.featureNodePositions(
            count: 2, streamX: streamX, epicY: 90, hubY: 560, spread: 80)
        // Two features straddle the centerline with equal offset.
        let offsets = pts.map { $0.x - streamX }
        XCTAssertEqual(offsets[0], -offsets[1], accuracy: eps, "Fan is symmetric about the stream centerline")
        XCTAssertEqual((offsets[0] + offsets[1]) / 2, 0, accuracy: eps, "Mean x equals the stream centerline")
    }

    func testFeatureNodesStayWithinVerticalBandBetweenEpicAndHub() {
        let epicY: CGFloat = 90, hubY: CGFloat = 560
        let pts = MissionControlLayout.featureNodePositions(
            count: 5, streamX: 150, epicY: epicY, hubY: hubY, spread: 60)
        for p in pts {
            XCTAssertGreaterThanOrEqual(p.y, epicY - eps, "Feature never rises above the epic node")
            XCTAssertLessThanOrEqual(p.y, hubY + eps, "Feature never drops below the hub")
        }
    }

    func testFeatureNodesAreVerticallyDistinct() {
        // Distinct nodes must not stack on one y (would read as a single node).
        let pts = MissionControlLayout.featureNodePositions(
            count: 4, streamX: 150, epicY: 90, hubY: 560, spread: 60)
        let ys = pts.map { $0.y }
        for i in 1..<ys.count {
            XCTAssertNotEqual(ys[i], ys[i - 1], accuracy: 0.5, "Feature nodes occupy distinct vertical positions")
        }
    }

    func testFeatureFanStaysWithinHorizontalBoundsWhenClamped() {
        // Even with a large requested spread, a clamp keeps every node inside [margin, width-margin].
        let width: CGFloat = 402, margin: CGFloat = 46, streamX: CGFloat = margin // leftmost stream
        let pts = MissionControlLayout.featureNodePositions(
            count: 6, streamX: streamX, epicY: 90, hubY: 560, spread: 400,
            minX: margin, maxX: width - margin)
        for p in pts {
            XCTAssertGreaterThanOrEqual(p.x, margin - eps, "Feature node clamped inside the left margin")
            XCTAssertLessThanOrEqual(p.x, width - margin + eps, "Feature node clamped inside the right margin")
        }
    }
}
