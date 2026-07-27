import XCTest
@testable import AdjutantUI

/// Tests for the Overview screen's top segmented control (adj-208.3.4).
/// The default segment MUST be Summary so existing Overview content is unchanged on first
/// appearance (spec US3); Mission Control is opt-in.
final class MissionControlSegmentTests: XCTestCase {

    func testDefaultSegmentIsSummary() {
        XCTAssertEqual(MissionControlSegment.defaultSegment, .summary,
                       "Overview must default to Summary — Mission Control is opt-in (US3)")
    }

    func testCasesAreSummaryThenMissionControl() {
        XCTAssertEqual(MissionControlSegment.allCases, [.summary, .missionControl],
                       "Summary is the leading segment")
    }

    func testSegmentTitles() {
        XCTAssertEqual(MissionControlSegment.summary.title, "Summary")
        XCTAssertEqual(MissionControlSegment.missionControl.title, "Mission Control")
    }
}
