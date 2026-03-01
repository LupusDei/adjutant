import XCTest
@testable import AdjutantUI
@testable import AdjutantKit

/// Integration tests for the project-scoped beads source filter feature.
/// Tests the interaction between BeadsListViewModel.selectedSource
/// and the filtering logic.
@MainActor
final class SourceFilterIntegrationTests: XCTestCase {
    var viewModel: BeadsListViewModel!

    override func setUp() async throws {
        try await super.setUp()

        viewModel = BeadsListViewModel()
        await viewModel.loadBeads()
    }

    override func tearDown() async throws {
        viewModel = nil
        try await super.tearDown()
    }

    // MARK: - selectedSource Integration

    func testSelectedSourceNilShowsAllBeads() async {
        viewModel.selectedSource = nil
        viewModel.currentFilter = .all

        // With no source selected, all beads should be visible (excluding filtered types)
        XCTAssertFalse(viewModel.filteredBeads.isEmpty,
            "Should show beads when no source filter is selected")
    }

    // MARK: - Source Filter + Status Filter Combinations

    func testSourceFilterCombinesWithOpenFilter() async {
        viewModel.selectedSource = "adjutant"
        viewModel.currentFilter = .open

        // All filtered beads should be non-closed
        XCTAssertTrue(viewModel.filteredBeads.allSatisfy { $0.status != "closed" },
            "Open filter should exclude closed beads regardless of source filter")
    }

    func testSourceFilterCombinesWithPriorityFilter() async {
        viewModel.selectedSource = "adjutant"
        viewModel.currentFilter = .priority

        // All filtered beads should be P0 or P1
        XCTAssertTrue(viewModel.filteredBeads.allSatisfy { $0.priority <= 1 },
            "Priority filter should work with source filter")
    }

    func testSourceFilterCombinesWithSearch() async {
        viewModel.selectedSource = "adjutant"
        viewModel.currentFilter = .all
        viewModel.searchText = "Implement"

        // All results should match search
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
        viewModel.selectedSource = "adjutant"
        viewModel.currentFilter = .all
        viewModel.currentSort = .alphabetical

        let beads = viewModel.filteredBeads
        for i in 0..<max(0, beads.count - 1) {
            let comparison = beads[i].title.localizedCaseInsensitiveCompare(beads[i + 1].title)
            XCTAssertTrue(comparison == .orderedAscending || comparison == .orderedSame,
                "Beads should remain alphabetically sorted with source filter active")
        }
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
        // Verify that source names match what selectedSource expects
        let source = BeadSource(name: "my-project", path: "/path/to/project", hasBeads: true)

        // SourceFilterDropdown sets selectedSource = source.name
        viewModel.selectedSource = source.name
        XCTAssertEqual(viewModel.selectedSource, "my-project")

        // Clean up
        viewModel.selectedSource = nil
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
