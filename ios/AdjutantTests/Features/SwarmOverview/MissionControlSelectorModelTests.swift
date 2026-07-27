import XCTest
@testable import AdjutantUI

/// Unit tests for the PURE selector presenter (adj-209.3.2, reconciled in adj-209.3.2.1).
///
/// This is the "extractable logic" the selector UI binds to: given the FULL available project
/// list and the current selection (`Set<String>?`, exactly as the ViewModel stores it — `nil`
/// == all), it produces the checkbox rows, the header button states, and a compact summary,
/// with NO SwiftUI. The `nil == all` contract is the single source of truth shared with
/// `MissionControlViewModel`.
final class MissionControlSelectorModelTests: XCTestCase {

    private let projects: [MissionControlSelectorModel.Project] = [
        .init(id: "adjutant", name: "Adjutant"),
        .init(id: "bloomfolio", name: "Bloomfolio"),
        .init(id: "runway", name: "Runway"),
    ]

    // MARK: - rows

    func testRowsPreserveOrderNameAndSelectionUnderAll() {
        let m = MissionControlSelectorModel(projects: projects, selectedIds: nil)
        XCTAssertEqual(m.rows.map(\.id), ["adjutant", "bloomfolio", "runway"])
        XCTAssertEqual(m.rows.map(\.name), ["Adjutant", "Bloomfolio", "Runway"])
        XCTAssertTrue(m.rows.allSatisfy(\.isSelected), "Every row selected when selection is nil (all)")
    }

    func testRowsReflectExplicitSubset() {
        let m = MissionControlSelectorModel(projects: projects, selectedIds: ["runway"])
        XCTAssertEqual(m.rows.first(where: { $0.id == "runway" })?.isSelected, true)
        XCTAssertEqual(m.rows.first(where: { $0.id == "adjutant" })?.isSelected, false)
        XCTAssertEqual(m.rows.first(where: { $0.id == "bloomfolio" })?.isSelected, false)
    }

    // MARK: - isSelected

    func testIsSelectedTreatsNilAsAll() {
        let m = MissionControlSelectorModel(projects: projects, selectedIds: nil)
        XCTAssertTrue(m.isSelected("bloomfolio"))
        XCTAssertTrue(m.isSelected("anything-at-all"))
    }

    // MARK: - button states

    func testIsAllSelectedTrueForNilAndForFullSet() {
        XCTAssertTrue(MissionControlSelectorModel(projects: projects, selectedIds: nil).isAllSelected)
        XCTAssertTrue(MissionControlSelectorModel(projects: projects, selectedIds: ["adjutant", "bloomfolio", "runway"]).isAllSelected)
    }

    func testIsAllSelectedFalseWhenAnyDeselected() {
        let m = MissionControlSelectorModel(projects: projects, selectedIds: ["adjutant", "runway"])
        XCTAssertFalse(m.isAllSelected)
    }

    func testIsNoneSelectedTrueOnlyForEmptySet() {
        XCTAssertTrue(MissionControlSelectorModel(projects: projects, selectedIds: []).isNoneSelected)
        XCTAssertFalse(MissionControlSelectorModel(projects: projects, selectedIds: nil).isNoneSelected)
        XCTAssertFalse(MissionControlSelectorModel(projects: projects, selectedIds: ["runway"]).isNoneSelected)
    }

    // MARK: - selectedCount + summary

    func testSelectedCountMatchesSelectedRows() {
        XCTAssertEqual(MissionControlSelectorModel(projects: projects, selectedIds: nil).selectedCount, 3)
        XCTAssertEqual(MissionControlSelectorModel(projects: projects, selectedIds: ["runway", "adjutant"]).selectedCount, 2)
        XCTAssertEqual(MissionControlSelectorModel(projects: projects, selectedIds: []).selectedCount, 0)
    }

    func testSummaryReadsAllNoneOrFraction() {
        XCTAssertEqual(MissionControlSelectorModel(projects: projects, selectedIds: nil).summary, "ALL PROJECTS")
        XCTAssertEqual(MissionControlSelectorModel(projects: projects, selectedIds: []).summary, "NONE")
        XCTAssertEqual(MissionControlSelectorModel(projects: projects, selectedIds: ["runway", "adjutant"]).summary, "2 / 3")
    }

    // MARK: - edge cases

    func testEmptyProjectsYieldsNoRowsAndSafeFlags() {
        let m = MissionControlSelectorModel(projects: [], selectedIds: nil)
        XCTAssertTrue(m.rows.isEmpty)
        XCTAssertEqual(m.selectedCount, 0)
        XCTAssertEqual(m.summary, "NO PROJECTS")
        XCTAssertFalse(m.isAllSelected, "No projects → 'select all' is a no-op, not an active state")
        XCTAssertTrue(m.isNoneSelected)
    }

    func testStaleSelectedIdIgnoredInCountAndRows() {
        // A persisted id for a project that has since disappeared must not create a phantom row/count.
        let m = MissionControlSelectorModel(projects: projects, selectedIds: ["runway", "ghost"])
        XCTAssertEqual(m.rows.count, 3, "Only currently-available projects get rows")
        XCTAssertEqual(m.selectedCount, 1, "Stale 'ghost' id is not counted")
        XCTAssertEqual(m.summary, "1 / 3")
    }
}
