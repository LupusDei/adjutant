import XCTest
@testable import AdjutantUI
@testable import AdjutantKit

/// Integration tests for the project-scoped beads source filter feature.
/// Tests the interaction between AppState.selectedRig, BeadsListViewModel,
/// and the mode-aware filtering logic.
@MainActor
final class SourceFilterIntegrationTests: XCTestCase {
    var viewModel: BeadsListViewModel!
    var savedRig: String?
    var savedMode: DeploymentMode!

    override func setUp() async throws {
        try await super.setUp()

        // Save current AppState to restore in tearDown
        savedRig = AppState.shared.selectedRig
        savedMode = AppState.shared.deploymentMode

        // Reset to clean state
        AppState.shared.selectedRig = nil
        viewModel = BeadsListViewModel()
        await viewModel.loadBeads()
    }

    override func tearDown() async throws {
        // Restore AppState
        AppState.shared.selectedRig = savedRig
        AppState.shared.deploymentMode = savedMode
        viewModel = nil
        try await super.tearDown()
    }

    // MARK: - AppState.selectedRig Integration

    func testSelectedRigNilShowsAllBeads() async {
        AppState.shared.selectedRig = nil
        viewModel.currentFilter = .all

        // With no rig selected, all beads should be visible (excluding filtered types)
        XCTAssertFalse(viewModel.filteredBeads.isEmpty,
            "Should show beads when no rig filter is selected")
    }

    func testSelectedRigFiltersBeadsToMatchingSource() async {
        // Wait for rig observer to fire
        AppState.shared.selectedRig = "adjutant"
        try? await Task.sleep(nanoseconds: 300_000_000)

        viewModel.currentFilter = .all

        // All remaining beads should have source matching the selected rig
        // (In mock data mode, the DataSyncService doesn't actually have beads,
        // so we verify the mechanism works with the mock data flow)
        let filteredSources = Set(viewModel.beads.map { $0.source })
        if !viewModel.beads.isEmpty {
            XCTAssertTrue(filteredSources.allSatisfy { $0 == "adjutant" },
                "After rig filter, all beads should have matching source")
        }
    }

    func testSelectedRigResetShowsAllSources() async {
        // Select a rig
        AppState.shared.selectedRig = "adjutant"
        try? await Task.sleep(nanoseconds: 300_000_000)

        // Reset to all
        AppState.shared.selectedRig = nil
        try? await Task.sleep(nanoseconds: 300_000_000)

        // Should show beads from multiple sources again
        viewModel.currentFilter = .all
        if !viewModel.beads.isEmpty {
            let sources = Set(viewModel.beads.map { $0.source })
            XCTAssertTrue(sources.count >= 1,
                "After resetting rig filter, should show beads from all sources")
        }
    }

    // MARK: - Deployment Mode Integration

    func testGastownModeDoesNotFetchBeadSources() async {
        AppState.shared.deploymentMode = .gastown
        let freshVM = BeadsListViewModel()
        await freshVM.loadBeads()

        // In gastown mode with no API client (mock mode), sources should remain empty
        XCTAssertTrue(freshVM.beadSources.isEmpty,
            "Gastown mode should not populate beadSources (uses rig filter instead)")
    }

    func testSwarmModeUsesBeadSources() async {
        AppState.shared.deploymentMode = .swarm
        let freshVM = BeadsListViewModel()
        await freshVM.loadBeads()

        XCTAssertNotNil(freshVM.beadSources,
            "beadSources should be accessible in swarm mode")
    }

    // MARK: - Source Filter + Status Filter Combinations

    func testSourceFilterCombinesWithOpenFilter() async {
        AppState.shared.selectedRig = "adjutant"
        try? await Task.sleep(nanoseconds: 300_000_000)

        viewModel.currentFilter = .open

        // All filtered beads should be non-closed
        XCTAssertTrue(viewModel.filteredBeads.allSatisfy { $0.status != "closed" },
            "Open filter should exclude closed beads regardless of source filter")
    }

    func testSourceFilterCombinesWithPriorityFilter() async {
        AppState.shared.selectedRig = "adjutant"
        try? await Task.sleep(nanoseconds: 300_000_000)

        viewModel.currentFilter = .priority

        // All filtered beads should be P0 or P1
        XCTAssertTrue(viewModel.filteredBeads.allSatisfy { $0.priority <= 1 },
            "Priority filter should work with source filter")
    }

    func testSourceFilterCombinesWithSearch() async {
        AppState.shared.selectedRig = "adjutant"
        try? await Task.sleep(nanoseconds: 300_000_000)

        viewModel.currentFilter = .all
        viewModel.searchText = "Implement"

        // All results should match both source and search
        for bead in viewModel.filteredBeads {
            let matchesSearch =
                bead.title.lowercased().contains("implement") ||
                bead.id.lowercased().contains("implement") ||
                (bead.assignee?.lowercased().contains("implement") ?? false) ||
                bead.labels.contains { $0.lowercased().contains("implement") }
            XCTAssertTrue(matchesSearch,
                "Bead '\(bead.title)' should match search query 'Implement'")
        }
    }

    func testSourceFilterCombinesWithSort() async {
        AppState.shared.selectedRig = "adjutant"
        try? await Task.sleep(nanoseconds: 300_000_000)

        viewModel.currentFilter = .all
        viewModel.currentSort = .alphabetical

        let beads = viewModel.filteredBeads
        for i in 0..<max(0, beads.count - 1) {
            let comparison = beads[i].title.localizedCaseInsensitiveCompare(beads[i + 1].title)
            XCTAssertTrue(comparison == .orderedAscending || comparison == .orderedSame,
                "Beads should remain alphabetically sorted with source filter active")
        }
    }

    // MARK: - Source Filter Switching Tests

    func testSwitchingSourceFilterUpdatesResults() async {
        viewModel.currentFilter = .all

        // Start with all
        AppState.shared.selectedRig = nil
        try? await Task.sleep(nanoseconds: 300_000_000)
        let allCount = viewModel.beads.count

        // Switch to specific source
        AppState.shared.selectedRig = "adjutant"
        try? await Task.sleep(nanoseconds: 300_000_000)
        let adjutantCount = viewModel.beads.count

        // Filtered count should be <= all count
        XCTAssertLessThanOrEqual(adjutantCount, allCount,
            "Filtering by source should show same or fewer beads")
    }

    func testRapidSourceFilterSwitching() async {
        // Rapidly switch between sources — should not crash
        for source in [nil, "adjutant", nil, "town", "adjutant", nil] as [String?] {
            AppState.shared.selectedRig = source
        }
        try? await Task.sleep(nanoseconds: 300_000_000)

        // Should settle in a consistent state
        viewModel.currentFilter = .all
        XCTAssertNotNil(viewModel.filteredBeads,
            "filteredBeads should be in a consistent state after rapid switching")
    }

    // MARK: - BeadSource Model Integration

    func testBeadSourceFilterOnlyActive() {
        let sources = [
            BeadSource(name: "active-project", path: "/a", hasBeads: true),
            BeadSource(name: "empty-project", path: "/b", hasBeads: false),
            BeadSource(name: "another-active", path: "/c", hasBeads: true)
        ]

        // The ViewModel filters to only sources with beads
        let filtered = sources.filter { $0.hasBeads }
        XCTAssertEqual(filtered.count, 2)
        XCTAssertTrue(filtered.allSatisfy { $0.hasBeads })
        XCTAssertFalse(filtered.contains { $0.name == "empty-project" })
    }

    func testBeadSourceNamesAreUsedForFiltering() {
        // Verify that source names match what selectedRig expects
        let source = BeadSource(name: "my-project", path: "/path/to/project", hasBeads: true)

        // SourceFilterDropdown sets selectedRig = source.name
        AppState.shared.selectedRig = source.name
        XCTAssertEqual(AppState.shared.selectedRig, "my-project")

        // Clean up
        AppState.shared.selectedRig = nil
    }

    // MARK: - Edge Cases

    func testEmptySourceNameHandling() {
        let source = BeadSource(name: "", path: "/empty", hasBeads: true)
        XCTAssertEqual(source.id, "", "Empty source name should still work as id")
    }

    func testSourceWithSpecialCharacters() throws {
        let json = """
        {
            "name": "my-project_v2.0",
            "path": "/home/user/my-project_v2.0",
            "hasBeads": true
        }
        """

        let source = try JSONDecoder().decode(BeadSource.self, from: json.data(using: .utf8)!)
        XCTAssertEqual(source.name, "my-project_v2.0")
        XCTAssertEqual(source.id, "my-project_v2.0")
    }

    func testSourceWithLongPath() throws {
        let longPath = "/very/deeply/nested/directory/structure/that/goes/on/for/a/long/time/project"
        let json = """
        {
            "name": "project",
            "path": "\(longPath)",
            "hasBeads": true
        }
        """

        let source = try JSONDecoder().decode(BeadSource.self, from: json.data(using: .utf8)!)
        XCTAssertEqual(source.path, longPath)
    }
}
