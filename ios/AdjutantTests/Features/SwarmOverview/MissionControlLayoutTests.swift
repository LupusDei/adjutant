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
}
