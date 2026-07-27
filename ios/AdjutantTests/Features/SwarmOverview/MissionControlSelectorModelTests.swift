import XCTest
@testable import AdjutantUI

/// Unit tests for the PURE selector presenter (adj-209.3.2).
///
/// This is the "extractable logic" the selector UI binds to: given the available projects and the
/// current ``MissionControlSelection``, it produces the checkbox rows, the header button states
/// (Select all / Deselect all), and a compact summary — with NO SwiftUI. The view is then a thin
/// shell over verified output, and the selection → projectIds derivation (adj-209.3.1) stays the
/// single source of truth the ViewModel (adj-209.2.3) consumes.
final class MissionControlSelectorModelTests: XCTestCase {

    private let projects: [MissionControlSelectorModel.Project] = [
        .init(id: "adjutant", name: "Adjutant"),
        .init(id: "bloomfolio", name: "Bloomfolio"),
        .init(id: "runway", name: "Runway"),
    ]

    private var universe: [String] { projects.map(\.id) }

    // MARK: - rows

    func testRowsPreserveOrderNameAndSelectionUnderAll() {
        let m = MissionControlSelectorModel(projects: projects, selection: .all)
        XCTAssertEqual(m.rows.map(\.id), ["adjutant", "bloomfolio", "runway"])
        XCTAssertEqual(m.rows.map(\.name), ["Adjutant", "Bloomfolio", "Runway"])
        XCTAssertTrue(m.rows.allSatisfy(\.isSelected), "Every row selected under .all")
    }

    func testRowsReflectSubsetMembership() {
        let m = MissionControlSelectorModel(projects: projects, selection: .subset(["runway"]))
        XCTAssertEqual(m.rows.first(where: { $0.id == "runway" })?.isSelected, true)
        XCTAssertEqual(m.rows.first(where: { $0.id == "adjutant" })?.isSelected, false)
        XCTAssertEqual(m.rows.first(where: { $0.id == "bloomfolio" })?.isSelected, false)
    }

    // MARK: - button states

    func testIsAllSelectedTrueForAllAndForFullSubset() {
        XCTAssertTrue(MissionControlSelectorModel(projects: projects, selection: .all).isAllSelected)
        XCTAssertTrue(MissionControlSelectorModel(projects: projects, selection: .subset(Set(universe))).isAllSelected)
    }

    func testIsAllSelectedFalseWhenAnyDeselected() {
        let m = MissionControlSelectorModel(projects: projects, selection: .subset(["adjutant", "runway"]))
        XCTAssertFalse(m.isAllSelected)
    }

    func testIsNoneSelectedTrueOnlyForEmptySubset() {
        XCTAssertTrue(MissionControlSelectorModel(projects: projects, selection: .subset([])).isNoneSelected)
        XCTAssertFalse(MissionControlSelectorModel(projects: projects, selection: .all).isNoneSelected)
        XCTAssertFalse(MissionControlSelectorModel(projects: projects, selection: .subset(["runway"])).isNoneSelected)
    }

    // MARK: - selectedCount + summary

    func testSelectedCountMatchesSelectedRows() {
        XCTAssertEqual(MissionControlSelectorModel(projects: projects, selection: .all).selectedCount, 3)
        XCTAssertEqual(MissionControlSelectorModel(projects: projects, selection: .subset(["runway", "adjutant"])).selectedCount, 2)
        XCTAssertEqual(MissionControlSelectorModel(projects: projects, selection: .subset([])).selectedCount, 0)
    }

    func testSummaryReadsAllNoneOrFraction() {
        XCTAssertEqual(MissionControlSelectorModel(projects: projects, selection: .all).summary, "ALL PROJECTS")
        XCTAssertEqual(MissionControlSelectorModel(projects: projects, selection: .subset([])).summary, "NONE")
        XCTAssertEqual(MissionControlSelectorModel(projects: projects, selection: .subset(["runway", "adjutant"])).summary, "2 / 3")
    }

    // MARK: - projectIds passthrough (single source of truth = the selection)

    func testProjectIdsDelegatesToSelection() {
        XCTAssertNil(MissionControlSelectorModel(projects: projects, selection: .all).projectIds)
        XCTAssertEqual(MissionControlSelectorModel(projects: projects, selection: .subset(["runway"])).projectIds, ["runway"])
        XCTAssertEqual(MissionControlSelectorModel(projects: projects, selection: .subset([])).projectIds, [])
    }

    // MARK: - edge cases

    func testEmptyProjectsYieldsNoRowsAndSafeFlags() {
        let m = MissionControlSelectorModel(projects: [], selection: .all)
        XCTAssertTrue(m.rows.isEmpty)
        XCTAssertEqual(m.selectedCount, 0)
        XCTAssertEqual(m.summary, "NO PROJECTS")
        XCTAssertFalse(m.isAllSelected, "No projects → 'select all' is a no-op, not an enabled/active state")
        XCTAssertTrue(m.isNoneSelected)
    }

    func testStaleSubsetIdIgnoredInRows() {
        // A persisted id for a project that has since disappeared must not create a phantom row.
        let m = MissionControlSelectorModel(projects: projects, selection: .subset(["runway", "ghost"]))
        XCTAssertEqual(m.rows.count, 3, "Only currently-available projects get rows")
        XCTAssertEqual(m.selectedCount, 1, "Stale 'ghost' id is not counted")
        XCTAssertEqual(m.summary, "1 / 3")
    }
}
