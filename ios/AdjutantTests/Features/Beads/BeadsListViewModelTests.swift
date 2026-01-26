import XCTest
@testable import Adjutant
@testable import AdjutantKit

@MainActor
final class BeadsListViewModelTests: XCTestCase {
    var viewModel: BeadsListViewModel!

    override func setUp() async throws {
        try await super.setUp()
        viewModel = BeadsListViewModel()
        // Load mock data
        await viewModel.loadBeads()
    }

    override func tearDown() async throws {
        viewModel = nil
        try await super.tearDown()
    }

    // MARK: - Initialization Tests

    func testInitialState() async {
        let freshVM = BeadsListViewModel()
        XCTAssertEqual(freshVM.currentFilter, .open)
        XCTAssertTrue(freshVM.searchText.isEmpty)
        XCTAssertFalse(freshVM.isSearching)
    }

    // MARK: - Data Loading Tests

    func testLoadBeadsLoadsMockData() async {
        XCTAssertFalse(viewModel.beads.isEmpty, "Should have loaded mock beads")
        XCTAssertEqual(viewModel.beads.count, BeadsListViewModel.mockBeads.count)
    }

    // MARK: - Filter Tests

    func testFilterAll() async {
        viewModel.currentFilter = .all
        XCTAssertEqual(viewModel.filteredBeads.count, viewModel.beads.count)
    }

    func testFilterOpen() async {
        viewModel.currentFilter = .open
        let openBeads = viewModel.filteredBeads
        XCTAssertTrue(openBeads.allSatisfy { $0.status != "closed" })
    }

    func testFilterAssigned() async {
        viewModel.currentFilter = .assigned
        let assignedBeads = viewModel.filteredBeads
        XCTAssertTrue(assignedBeads.allSatisfy { $0.assignee != nil && !$0.assignee!.isEmpty })
    }

    func testFilterPriority() async {
        viewModel.currentFilter = .priority
        let priorityBeads = viewModel.filteredBeads
        XCTAssertTrue(priorityBeads.allSatisfy { $0.priority <= 1 })
    }

    // MARK: - Search Tests

    func testSearchByTitle() async {
        viewModel.currentFilter = .all
        viewModel.searchText = "Beads Tracker"
        XCTAssertTrue(viewModel.filteredBeads.contains { $0.title.contains("Beads Tracker") })
    }

    func testSearchById() async {
        viewModel.currentFilter = .all
        viewModel.searchText = "adj-001"
        XCTAssertTrue(viewModel.filteredBeads.contains { $0.id == "adj-001" })
    }

    func testSearchCaseInsensitive() async {
        viewModel.currentFilter = .all
        viewModel.searchText = "BEADS"
        XCTAssertFalse(viewModel.filteredBeads.isEmpty, "Search should be case insensitive")
    }

    func testClearSearch() async {
        viewModel.currentFilter = .all
        viewModel.searchText = "nonexistent"
        XCTAssertTrue(viewModel.filteredBeads.isEmpty)

        viewModel.searchText = ""
        XCTAssertEqual(viewModel.filteredBeads.count, viewModel.beads.count)
    }

    // MARK: - Computed Properties Tests

    func testOpenCount() async {
        let expectedCount = viewModel.beads.filter { $0.status != "closed" }.count
        XCTAssertEqual(viewModel.openCount, expectedCount)
    }

    func testPriorityCount() async {
        let expectedCount = viewModel.beads.filter { $0.priority <= 1 }.count
        XCTAssertEqual(viewModel.priorityCount, expectedCount)
    }

    func testIsEmptyWhenNoResults() async {
        viewModel.searchText = "xyznonexistent123"
        XCTAssertTrue(viewModel.isEmpty)
    }

    func testEmptyStateMessage() async {
        // Test search empty state
        viewModel.searchText = "nonexistent"
        XCTAssertEqual(viewModel.emptyStateMessage, "No beads match your search")

        // Test filter-specific empty states
        viewModel.searchText = ""
        viewModel.currentFilter = .all
        // Note: This only applies when actually empty
    }

    // MARK: - Status Type Tests

    func testStatusTypeForClosed() async {
        let closedBead = viewModel.beads.first { $0.status == "closed" }
        if let bead = closedBead {
            let statusType = viewModel.statusType(for: bead)
            XCTAssertEqual(statusType, .offline)
        }
    }

    func testStatusTypeForBlocked() async {
        let blockedBead = viewModel.beads.first { $0.status == "blocked" }
        if let bead = blockedBead {
            let statusType = viewModel.statusType(for: bead)
            XCTAssertEqual(statusType, .warning)
        }
    }

    func testStatusTypeForInProgress() async {
        let inProgressBead = viewModel.beads.first { $0.status == "in_progress" }
        if let bead = inProgressBead {
            let statusType = viewModel.statusType(for: bead)
            XCTAssertEqual(statusType, .info)
        }
    }

    func testStatusTypeForOpen() async {
        let openBead = viewModel.beads.first { $0.status == "open" }
        if let bead = openBead {
            let statusType = viewModel.statusType(for: bead)
            XCTAssertEqual(statusType, .success)
        }
    }

    // MARK: - Filter Display Tests

    func testFilterDisplayNames() {
        XCTAssertEqual(BeadsListViewModel.BeadFilter.all.displayName, "ALL")
        XCTAssertEqual(BeadsListViewModel.BeadFilter.open.displayName, "OPEN")
        XCTAssertEqual(BeadsListViewModel.BeadFilter.assigned.displayName, "ASSIGNED")
        XCTAssertEqual(BeadsListViewModel.BeadFilter.priority.displayName, "PRIORITY")
    }

    func testFilterSystemImages() {
        XCTAssertEqual(BeadsListViewModel.BeadFilter.all.systemImage, "circle.grid.3x3")
        XCTAssertEqual(BeadsListViewModel.BeadFilter.open.systemImage, "circle")
        XCTAssertEqual(BeadsListViewModel.BeadFilter.assigned.systemImage, "person.fill")
        XCTAssertEqual(BeadsListViewModel.BeadFilter.priority.systemImage, "exclamationmark.triangle")
    }

    // MARK: - Rig Options Tests

    func testRigOptionsExtractsUniqueRigs() async {
        // Mock beads have "adjutant" and "town" sources
        // rigOptions should include "adjutant" but not "town" or "unknown"
        let rigOptions = viewModel.rigOptions
        XCTAssertTrue(rigOptions.contains("adjutant"), "Should contain adjutant rig")
        XCTAssertFalse(rigOptions.contains("town"), "Should not contain town")
        XCTAssertFalse(rigOptions.contains("unknown"), "Should not contain unknown")
    }

    func testRigOptionsAreSorted() async {
        let rigOptions = viewModel.rigOptions
        XCTAssertEqual(rigOptions, rigOptions.sorted(), "Rig options should be sorted alphabetically")
    }

    // MARK: - Rig Filter Tests

    func testRigFilterTownFiltersOnlyTownSource() async {
        // Set rig filter to town via AppState
        AppState.shared.selectedRig = "town"
        viewModel.currentFilter = .all

        // Wait for filter to apply
        try? await Task.sleep(nanoseconds: 100_000_000) // 0.1 seconds

        let filtered = viewModel.filteredBeads
        XCTAssertTrue(filtered.allSatisfy { $0.source == "town" }, "All beads should have 'town' source")

        // Clean up
        AppState.shared.selectedRig = nil
    }

    func testRigFilterSpecificRigFiltersCorrectly() async {
        // Set rig filter to adjutant via AppState
        AppState.shared.selectedRig = "adjutant"
        viewModel.currentFilter = .all

        // Wait for filter to apply
        try? await Task.sleep(nanoseconds: 100_000_000) // 0.1 seconds

        let filtered = viewModel.filteredBeads
        XCTAssertTrue(filtered.allSatisfy { $0.source == "adjutant" }, "All beads should have 'adjutant' source")

        // Clean up
        AppState.shared.selectedRig = nil
    }

    func testRigFilterNilShowsAllBeads() async {
        // Ensure rig filter is nil (ALL)
        AppState.shared.selectedRig = nil
        viewModel.currentFilter = .all

        // Wait for filter to apply
        try? await Task.sleep(nanoseconds: 100_000_000) // 0.1 seconds

        // All beads should be shown when rig filter is nil
        XCTAssertEqual(viewModel.filteredBeads.count, viewModel.beads.count, "All beads should be shown")
    }
}
