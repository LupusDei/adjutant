import XCTest
@testable import AdjutantUI
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
    // Note: Rig filtering is now done server-side via the API rig parameter.
    // These tests verify that changing the rig triggers a reload (not client-side filtering).

    func testSourceFilterChangeTriggersFetch() async {
        // Changing source filter should trigger loadBeads() with the new source parameter
        // For mock data, this still loads all mock beads (no server-side filtering simulation)
        let initialCount = viewModel.beads.count

        // Change source filter
        viewModel.selectedSource = "adjutant"

        // Wait for refetch
        try? await Task.sleep(nanoseconds: 200_000_000) // 0.2 seconds

        // With mock data, count remains same (real API would return filtered results)
        XCTAssertEqual(viewModel.beads.count, initialCount, "Mock data should still load all beads")

        // Clean up - reset to default
        viewModel.selectedSource = nil
    }

    // MARK: - Sort Tests

    func testDefaultSortIsLastUpdated() async {
        // Clear any saved preference
        UserDefaults.standard.removeObject(forKey: "beads_sort_preference")
        let freshVM = BeadsListViewModel()
        XCTAssertEqual(freshVM.currentSort, .lastUpdated)
    }

    func testSortDisplayNames() {
        XCTAssertEqual(BeadsListViewModel.BeadSort.lastUpdated.displayName, "LAST UPDATED")
        XCTAssertEqual(BeadsListViewModel.BeadSort.priority.displayName, "PRIORITY")
        XCTAssertEqual(BeadsListViewModel.BeadSort.createdDate.displayName, "CREATED")
        XCTAssertEqual(BeadsListViewModel.BeadSort.alphabetical.displayName, "A-Z")
        XCTAssertEqual(BeadsListViewModel.BeadSort.assignee.displayName, "ASSIGNEE")
    }

    func testSortSystemImages() {
        XCTAssertEqual(BeadsListViewModel.BeadSort.lastUpdated.systemImage, "clock.arrow.circlepath")
        XCTAssertEqual(BeadsListViewModel.BeadSort.priority.systemImage, "exclamationmark.triangle")
        XCTAssertEqual(BeadsListViewModel.BeadSort.createdDate.systemImage, "calendar")
        XCTAssertEqual(BeadsListViewModel.BeadSort.alphabetical.systemImage, "textformat.abc")
        XCTAssertEqual(BeadsListViewModel.BeadSort.assignee.systemImage, "person.fill")
    }

    func testSortByPriority() async {
        viewModel.currentFilter = .all
        viewModel.currentSort = .priority

        let beads = viewModel.filteredBeads
        // Verify beads are sorted by priority (ascending - P0 first)
        for i in 0..<(beads.count - 1) {
            XCTAssertLessThanOrEqual(beads[i].priority, beads[i + 1].priority,
                "Beads should be sorted by priority (P0 first)")
        }
    }

    func testSortByAlphabetical() async {
        viewModel.currentFilter = .all
        viewModel.currentSort = .alphabetical

        let beads = viewModel.filteredBeads
        // Verify beads are sorted alphabetically by title
        for i in 0..<(beads.count - 1) {
            let comparison = beads[i].title.localizedCaseInsensitiveCompare(beads[i + 1].title)
            XCTAssertTrue(comparison == .orderedAscending || comparison == .orderedSame,
                "Beads should be sorted alphabetically")
        }
    }

    func testSortByAssignee() async {
        viewModel.currentFilter = .all
        viewModel.currentSort = .assignee

        let beads = viewModel.filteredBeads
        // Verify assigned beads come before unassigned
        var foundUnassigned = false
        for bead in beads {
            if bead.assignee == nil || bead.assignee!.isEmpty {
                foundUnassigned = true
            } else if foundUnassigned {
                XCTFail("Assigned beads should come before unassigned beads")
            }
        }
    }

    func testSortPersistsToUserDefaults() async {
        viewModel.currentSort = .alphabetical

        let savedSort = UserDefaults.standard.string(forKey: "beads_sort_preference")
        XCTAssertEqual(savedSort, BeadsListViewModel.BeadSort.alphabetical.rawValue)
    }

    func testSortLoadsFromUserDefaults() async {
        // Save a preference
        UserDefaults.standard.set(BeadsListViewModel.BeadSort.priority.rawValue, forKey: "beads_sort_preference")

        // Create a new view model (should load the preference)
        let freshVM = BeadsListViewModel()
        XCTAssertEqual(freshVM.currentSort, .priority)

        // Clean up
        UserDefaults.standard.removeObject(forKey: "beads_sort_preference")
    }

    // MARK: - Bead Sources Tests

    func testBeadSourcesInitiallyEmpty() async {
        let freshVM = BeadsListViewModel()
        XCTAssertTrue(freshVM.beadSources.isEmpty, "beadSources should be empty on init")
    }

    func testBeadSourcesPropertyExists() async {
        // Verify the beadSources published property is accessible and typed correctly
        let sources: [BeadSource] = viewModel.beadSources
        XCTAssertNotNil(sources, "beadSources should be accessible")
    }

    // MARK: - Excluded Types Tests

    func testExcludedTypesFilterOutMessages() async {
        viewModel.currentFilter = .all
        let filtered = viewModel.filteredBeads
        XCTAssertTrue(filtered.allSatisfy { $0.type.lowercased() != "message" },
            "Messages should be excluded from filtered beads")
    }

    func testExcludedTypesFilterOutEpics() async {
        viewModel.currentFilter = .all
        let filtered = viewModel.filteredBeads
        XCTAssertTrue(filtered.allSatisfy { $0.type.lowercased() != "epic" },
            "Epics should be excluded from filtered beads")
    }

    func testExcludedTypesFilterOutAgents() async {
        viewModel.currentFilter = .all
        let filtered = viewModel.filteredBeads
        XCTAssertTrue(filtered.allSatisfy { $0.type.lowercased() != "agent" },
            "Agents should be excluded from filtered beads")
    }

    func testExcludedTypesFilterOutWisps() async {
        viewModel.currentFilter = .all
        let filtered = viewModel.filteredBeads
        XCTAssertTrue(filtered.allSatisfy { $0.type.lowercased() != "wisp" },
            "Wisps should be excluded from filtered beads")
    }

    func testExcludedTypesAllowFeatures() async {
        viewModel.currentFilter = .all
        let filtered = viewModel.filteredBeads
        XCTAssertTrue(filtered.contains { $0.type.lowercased() == "feature" },
            "Features should NOT be excluded from filtered beads")
    }

    func testExcludedTypesAllowBugs() async {
        viewModel.currentFilter = .all
        let filtered = viewModel.filteredBeads
        XCTAssertTrue(filtered.contains { $0.type.lowercased() == "bug" },
            "Bugs should NOT be excluded from filtered beads")
    }

    func testExcludedTypesAllowTasks() async {
        viewModel.currentFilter = .all
        let filtered = viewModel.filteredBeads
        XCTAssertTrue(filtered.contains { $0.type.lowercased() == "task" },
            "Tasks should NOT be excluded from filtered beads")
    }

    // MARK: - Combined Filter + Search Tests

    func testFilterOpenWithSearch() async {
        viewModel.currentFilter = .open
        viewModel.searchText = "adj"
        let results = viewModel.filteredBeads
        XCTAssertTrue(results.allSatisfy { $0.status != "closed" },
            "All results should be non-closed when filter is .open")
        XCTAssertTrue(results.allSatisfy {
            $0.title.lowercased().contains("adj") ||
            $0.id.lowercased().contains("adj") ||
            ($0.assignee?.lowercased().contains("adj") ?? false) ||
            $0.labels.contains { $0.lowercased().contains("adj") }
        }, "All results should match search query")
    }

    func testFilterPriorityWithSearch() async {
        viewModel.currentFilter = .priority
        viewModel.searchText = "adj"
        let results = viewModel.filteredBeads
        XCTAssertTrue(results.allSatisfy { $0.priority <= 1 },
            "All results should be P0 or P1")
    }

    func testFilterAssignedWithSearch() async {
        viewModel.currentFilter = .assigned
        viewModel.searchText = "adj"
        let results = viewModel.filteredBeads
        XCTAssertTrue(results.allSatisfy { $0.assignee != nil && !$0.assignee!.isEmpty },
            "All results should have assignee")
    }

    // MARK: - Combined Filter + Sort Tests

    func testFilterOpenSortByPriority() async {
        viewModel.currentFilter = .open
        viewModel.currentSort = .priority
        let beads = viewModel.filteredBeads

        // Verify all are non-closed
        XCTAssertTrue(beads.allSatisfy { $0.status != "closed" })

        // Verify sorted by priority ascending
        for i in 0..<max(0, beads.count - 1) {
            XCTAssertLessThanOrEqual(beads[i].priority, beads[i + 1].priority,
                "Open beads should be sorted by priority")
        }
    }

    func testFilterAllSortByCreatedDate() async {
        viewModel.currentFilter = .all
        viewModel.currentSort = .createdDate
        let beads = viewModel.filteredBeads

        // Verify sorted by created date descending (newest first)
        for i in 0..<max(0, beads.count - 1) {
            let dateA = beads[i].createdDate ?? Date.distantPast
            let dateB = beads[i + 1].createdDate ?? Date.distantPast
            XCTAssertGreaterThanOrEqual(dateA, dateB,
                "Beads should be sorted by created date (newest first)")
        }
    }

    func testFilterAllSortByLastUpdated() async {
        viewModel.currentFilter = .all
        viewModel.currentSort = .lastUpdated
        let beads = viewModel.filteredBeads

        // Verify sorted by updated/created date descending
        for i in 0..<max(0, beads.count - 1) {
            let dateA = beads[i].updatedDate ?? beads[i].createdDate ?? Date.distantPast
            let dateB = beads[i + 1].updatedDate ?? beads[i + 1].createdDate ?? Date.distantPast
            XCTAssertGreaterThanOrEqual(dateA, dateB,
                "Beads should be sorted by last updated date (newest first)")
        }
    }

    // MARK: - Search by Label Tests

    func testSearchByLabel() async {
        viewModel.currentFilter = .all
        viewModel.searchText = "ios"
        let results = viewModel.filteredBeads
        XCTAssertFalse(results.isEmpty, "Should find beads with 'ios' label")
        XCTAssertTrue(results.contains { bead in
            bead.labels.contains { $0.lowercased().contains("ios") }
        }, "Results should include beads matching label search")
    }

    func testSearchByAssignee() async {
        viewModel.currentFilter = .all
        viewModel.searchText = "flint"
        let results = viewModel.filteredBeads
        XCTAssertFalse(results.isEmpty, "Should find beads assigned to flint")
        XCTAssertTrue(results.allSatisfy {
            $0.title.lowercased().contains("flint") ||
            $0.id.lowercased().contains("flint") ||
            ($0.assignee?.lowercased().contains("flint") ?? false) ||
            $0.labels.contains { $0.lowercased().contains("flint") }
        })
    }

    // MARK: - Status Update Tests

    func testUpdateBeadStatusLocally() async {
        let beadToUpdate = viewModel.beads.first { $0.status == "open" }
        guard let bead = beadToUpdate else {
            XCTFail("Should have an open bead in mock data")
            return
        }

        viewModel.updateBeadStatusLocally(beadId: bead.id, newStatus: "in_progress")

        let updated = viewModel.beads.first { $0.id == bead.id }
        XCTAssertEqual(updated?.status, "in_progress",
            "Bead status should be updated locally")
    }

    func testUpdateBeadStatusLocallyPreservesOtherFields() async {
        let beadToUpdate = viewModel.beads.first { $0.status == "open" }
        guard let bead = beadToUpdate else {
            XCTFail("Should have an open bead in mock data")
            return
        }

        let originalTitle = bead.title
        let originalPriority = bead.priority
        let originalLabels = bead.labels

        viewModel.updateBeadStatusLocally(beadId: bead.id, newStatus: "closed")

        let updated = viewModel.beads.first { $0.id == bead.id }
        XCTAssertEqual(updated?.title, originalTitle, "Title should be preserved")
        XCTAssertEqual(updated?.priority, originalPriority, "Priority should be preserved")
        XCTAssertEqual(updated?.labels, originalLabels, "Labels should be preserved")
    }

    func testUpdateBeadStatusLocallyRefilters() async {
        viewModel.currentFilter = .open
        let initialCount = viewModel.filteredBeads.count

        let beadToClose = viewModel.filteredBeads.first
        guard let bead = beadToClose else {
            XCTFail("Should have a filtered bead")
            return
        }

        viewModel.updateBeadStatusLocally(beadId: bead.id, newStatus: "closed")

        XCTAssertEqual(viewModel.filteredBeads.count, initialCount - 1,
            "Closing a bead should remove it from open filter")
    }

    func testUpdateNonExistentBeadDoesNotCrash() async {
        // Should be a no-op, not crash
        viewModel.updateBeadStatusLocally(beadId: "nonexistent-id", newStatus: "closed")
        XCTAssertEqual(viewModel.beads.count, BeadsListViewModel.mockBeads.count,
            "Bead count should remain unchanged")
    }

    // MARK: - Empty State Tests

    func testEmptyStateMessageForAllFilter() async {
        viewModel.currentFilter = .all
        XCTAssertEqual(viewModel.emptyStateMessage, "No beads found")
    }

    func testEmptyStateMessageForOpenFilter() async {
        viewModel.currentFilter = .open
        XCTAssertEqual(viewModel.emptyStateMessage, "No open beads")
    }

    func testEmptyStateMessageForAssignedFilter() async {
        viewModel.currentFilter = .assigned
        XCTAssertEqual(viewModel.emptyStateMessage, "No assigned beads")
    }

    func testEmptyStateMessageForPriorityFilter() async {
        viewModel.currentFilter = .priority
        XCTAssertEqual(viewModel.emptyStateMessage, "No priority beads")
    }

    func testEmptyStateMessageForSearchOverridesFilter() async {
        viewModel.currentFilter = .priority
        viewModel.searchText = "nonexistent"
        XCTAssertEqual(viewModel.emptyStateMessage, "No beads match your search",
            "Search empty state should override filter-specific message")
    }

    // MARK: - Filter Enum Tests

    func testFilterIdentifiable() {
        for filter in BeadsListViewModel.BeadFilter.allCases {
            XCTAssertEqual(filter.id, filter.rawValue,
                "Filter id should equal rawValue")
        }
    }

    func testFilterCaseIterable() {
        let allCases = BeadsListViewModel.BeadFilter.allCases
        XCTAssertEqual(allCases.count, 4,
            "Should have exactly 4 filter options")
        XCTAssertTrue(allCases.contains(.all))
        XCTAssertTrue(allCases.contains(.open))
        XCTAssertTrue(allCases.contains(.assigned))
        XCTAssertTrue(allCases.contains(.priority))
    }

    // MARK: - Sort Enum Tests

    func testSortIdentifiable() {
        for sort in BeadsListViewModel.BeadSort.allCases {
            XCTAssertEqual(sort.id, sort.rawValue,
                "Sort id should equal rawValue")
        }
    }

    func testSortCaseIterable() {
        let allCases = BeadsListViewModel.BeadSort.allCases
        XCTAssertEqual(allCases.count, 5,
            "Should have exactly 5 sort options")
        XCTAssertTrue(allCases.contains(.lastUpdated))
        XCTAssertTrue(allCases.contains(.priority))
        XCTAssertTrue(allCases.contains(.createdDate))
        XCTAssertTrue(allCases.contains(.alphabetical))
        XCTAssertTrue(allCases.contains(.assignee))
    }

    // MARK: - Sort Stability Tests

    func testSortByPriorityTiebreaksByDate() async {
        viewModel.currentFilter = .all
        viewModel.currentSort = .priority
        let beads = viewModel.filteredBeads

        // Find consecutive beads with same priority
        for i in 0..<max(0, beads.count - 1) {
            if beads[i].priority == beads[i + 1].priority {
                // Same priority: should be sorted by last updated descending
                let dateA = beads[i].updatedDate ?? beads[i].createdDate ?? Date.distantPast
                let dateB = beads[i + 1].updatedDate ?? beads[i + 1].createdDate ?? Date.distantPast
                XCTAssertGreaterThanOrEqual(dateA, dateB,
                    "Same-priority beads should be sorted by last updated (newest first)")
            }
        }
    }

    func testSortByAssigneeTiebreaksByPriority() async {
        viewModel.currentFilter = .all
        viewModel.currentSort = .assignee
        let beads = viewModel.filteredBeads

        // Find consecutive beads with same assignee
        for i in 0..<max(0, beads.count - 1) {
            let assigneeA = beads[i].assignee ?? ""
            let assigneeB = beads[i + 1].assignee ?? ""
            if assigneeA == assigneeB && !assigneeA.isEmpty {
                XCTAssertLessThanOrEqual(beads[i].priority, beads[i + 1].priority,
                    "Same-assignee beads should be sorted by priority")
            }
        }
    }

    // MARK: - Mock Data Integrity Tests

    func testMockDataHasExpectedStatuses() {
        let statuses = Set(BeadsListViewModel.mockBeads.map { $0.status })
        XCTAssertTrue(statuses.contains("open"), "Mock data should contain open beads")
        XCTAssertTrue(statuses.contains("in_progress"), "Mock data should contain in_progress beads")
        XCTAssertTrue(statuses.contains("closed"), "Mock data should contain closed beads")
    }

    func testMockDataHasExpectedTypes() {
        let types = Set(BeadsListViewModel.mockBeads.map { $0.type })
        XCTAssertTrue(types.contains("feature"), "Mock data should contain features")
        XCTAssertTrue(types.contains("bug"), "Mock data should contain bugs")
        XCTAssertTrue(types.contains("task"), "Mock data should contain tasks")
    }

    func testMockDataHasMixedAssignment() {
        let assigned = BeadsListViewModel.mockBeads.filter { $0.assignee != nil && !$0.assignee!.isEmpty }
        let unassigned = BeadsListViewModel.mockBeads.filter { $0.assignee == nil || $0.assignee!.isEmpty }
        XCTAssertFalse(assigned.isEmpty, "Mock data should have assigned beads")
        XCTAssertFalse(unassigned.isEmpty, "Mock data should have unassigned beads")
    }

    func testMockDataHasMixedPriorities() {
        let priorities = Set(BeadsListViewModel.mockBeads.map { $0.priority })
        XCTAssertTrue(priorities.count > 1, "Mock data should have multiple priority levels")
        XCTAssertTrue(priorities.contains(where: { $0 <= 1 }), "Mock data should have high-priority beads")
        XCTAssertTrue(priorities.contains(where: { $0 > 1 }), "Mock data should have low-priority beads")
    }

    func testMockDataHasMixedSources() {
        let sources = Set(BeadsListViewModel.mockBeads.map { $0.source })
        XCTAssertTrue(sources.count > 1, "Mock data should have beads from multiple sources")
    }
}
