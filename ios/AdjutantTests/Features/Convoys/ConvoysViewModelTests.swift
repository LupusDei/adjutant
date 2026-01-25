import XCTest
@testable import Adjutant
@testable import AdjutantKit

@MainActor
final class ConvoysViewModelTests: XCTestCase {

    // MARK: - Properties

    private var sut: ConvoysViewModel!
    private var mockAPIClient: MockAPIClient!

    // MARK: - Setup

    override func setUp() async throws {
        try await super.setUp()
        mockAPIClient = MockAPIClient()
    }

    override func tearDown() async throws {
        sut = nil
        mockAPIClient = nil
        try await super.tearDown()
    }

    // MARK: - Initialization Tests

    func testInit_hasEmptyState() async {
        // Given/When
        sut = ConvoysViewModel(apiClient: mockAPIClient)

        // Then
        XCTAssertTrue(sut.convoys.isEmpty)
        XCTAssertTrue(sut.filteredConvoys.isEmpty)
        XCTAssertEqual(sut.sortOption, .latestActivity)
        XCTAssertTrue(sut.expandedConvoyIds.isEmpty)
        XCTAssertEqual(sut.totalProgress, 0)
        XCTAssertEqual(sut.incompleteCount, 0)
        XCTAssertTrue(sut.isEmpty)
    }

    // MARK: - Refresh Tests

    func testRefresh_success_loadsConvoys() async {
        // Given
        let convoys = createTestConvoys()
        mockAPIClient.getConvoysResult = .success(convoys)
        sut = ConvoysViewModel(apiClient: mockAPIClient)

        // When
        await sut.refresh()

        // Then
        XCTAssertEqual(sut.convoys.count, convoys.count)
        XCTAssertFalse(sut.filteredConvoys.isEmpty)
        XCTAssertFalse(sut.isEmpty)
    }

    func testRefresh_failure_setsError() async {
        // Given
        mockAPIClient.getConvoysResult = .failure(APIClientError.networkError("Connection failed"))
        sut = ConvoysViewModel(apiClient: mockAPIClient)

        // When
        await sut.refresh()

        // Then
        XCTAssertTrue(sut.convoys.isEmpty)
        XCTAssertNotNil(sut.errorMessage)
    }

    // MARK: - Sorting Tests

    func testSort_byLeastComplete_sortsByPercentage() async {
        // Given
        let convoys = [
            createConvoy(id: "high", progress: ConvoyProgress(completed: 9, total: 10)),
            createConvoy(id: "low", progress: ConvoyProgress(completed: 1, total: 10)),
            createConvoy(id: "mid", progress: ConvoyProgress(completed: 5, total: 10))
        ]
        mockAPIClient.getConvoysResult = .success(convoys)
        sut = ConvoysViewModel(apiClient: mockAPIClient)
        await sut.refresh()

        // When
        sut.sortOption = .leastComplete

        // Then
        XCTAssertEqual(sut.filteredConvoys.first?.id, "low")
        XCTAssertEqual(sut.filteredConvoys.last?.id, "high")
    }

    func testSort_byConvoyId_sortsAlphabetically() async {
        // Given
        let convoys = [
            createConvoy(id: "convoy-c"),
            createConvoy(id: "convoy-a"),
            createConvoy(id: "convoy-b")
        ]
        mockAPIClient.getConvoysResult = .success(convoys)
        sut = ConvoysViewModel(apiClient: mockAPIClient)
        await sut.refresh()

        // When
        sut.sortOption = .convoyId

        // Then
        XCTAssertEqual(sut.filteredConvoys.map { $0.id }, ["convoy-a", "convoy-b", "convoy-c"])
    }

    func testSort_byUrgency_sortsByPriority() async {
        // Given
        let convoys = [
            createConvoy(id: "low", trackedIssues: [
                TrackedIssue(id: "i1", title: "Low priority", status: "open", priority: 3)
            ]),
            createConvoy(id: "high", trackedIssues: [
                TrackedIssue(id: "i2", title: "High priority", status: "open", priority: 0)
            ]),
            createConvoy(id: "medium", trackedIssues: [
                TrackedIssue(id: "i3", title: "Medium priority", status: "open", priority: 2)
            ])
        ]
        mockAPIClient.getConvoysResult = .success(convoys)
        sut = ConvoysViewModel(apiClient: mockAPIClient)
        await sut.refresh()

        // When
        sut.sortOption = .urgency

        // Then
        XCTAssertEqual(sut.filteredConvoys.first?.id, "high")
        XCTAssertEqual(sut.filteredConvoys.last?.id, "low")
    }

    // MARK: - Expand/Collapse Tests

    func testToggleExpanded_addsToSet() {
        // Given
        sut = ConvoysViewModel(apiClient: mockAPIClient)

        // When
        sut.toggleExpanded("convoy-1")

        // Then
        XCTAssertTrue(sut.isExpanded("convoy-1"))
    }

    func testToggleExpanded_removesFromSet() {
        // Given
        sut = ConvoysViewModel(apiClient: mockAPIClient)
        sut.toggleExpanded("convoy-1")

        // When
        sut.toggleExpanded("convoy-1")

        // Then
        XCTAssertFalse(sut.isExpanded("convoy-1"))
    }

    func testIsExpanded_returnsFalseForUnknown() {
        // Given
        sut = ConvoysViewModel(apiClient: mockAPIClient)

        // Then
        XCTAssertFalse(sut.isExpanded("unknown-convoy"))
    }

    // MARK: - Progress Tests

    func testTotalProgress_calculatesCorrectly() async {
        // Given
        let convoys = [
            createConvoy(id: "c1", progress: ConvoyProgress(completed: 5, total: 10)), // 50%
            createConvoy(id: "c2", progress: ConvoyProgress(completed: 3, total: 10))  // 30%
        ]
        mockAPIClient.getConvoysResult = .success(convoys)
        sut = ConvoysViewModel(apiClient: mockAPIClient)

        // When
        await sut.refresh()

        // Then
        // Total: 8 completed out of 20 = 40%
        XCTAssertEqual(sut.totalProgress, 0.4, accuracy: 0.01)
    }

    func testTotalProgress_emptyConvoys_returnsZero() async {
        // Given
        mockAPIClient.getConvoysResult = .success([])
        sut = ConvoysViewModel(apiClient: mockAPIClient)

        // When
        await sut.refresh()

        // Then
        XCTAssertEqual(sut.totalProgress, 0)
    }

    func testIncompleteCount_countsCorrectly() async {
        // Given
        let convoys = [
            createConvoy(id: "complete", progress: ConvoyProgress(completed: 10, total: 10)),
            createConvoy(id: "incomplete1", progress: ConvoyProgress(completed: 5, total: 10)),
            createConvoy(id: "incomplete2", progress: ConvoyProgress(completed: 0, total: 10))
        ]
        mockAPIClient.getConvoysResult = .success(convoys)
        sut = ConvoysViewModel(apiClient: mockAPIClient)

        // When
        await sut.refresh()

        // Then
        XCTAssertEqual(sut.incompleteCount, 2)
    }

    // MARK: - Mock Data Tests

    func testMockConvoys_isNotEmpty() {
        // Verify mock data exists for previews
        XCTAssertFalse(ConvoysViewModel.mockConvoys.isEmpty)
    }

    func testMockConvoys_hasValidData() {
        // Verify mock data is properly structured
        let mockConvoys = ConvoysViewModel.mockConvoys

        for convoy in mockConvoys {
            XCTAssertFalse(convoy.id.isEmpty)
            XCTAssertFalse(convoy.title.isEmpty)
            XCTAssertGreaterThanOrEqual(convoy.progress.total, convoy.progress.completed)
        }
    }

    // MARK: - Helper Methods

    private func createTestConvoys() -> [Convoy] {
        [
            createConvoy(id: "convoy-1", title: "First Convoy", rig: "adjutant"),
            createConvoy(id: "convoy-2", title: "Second Convoy", rig: "gastown"),
            createConvoy(id: "convoy-3", title: "Third Convoy", rig: nil)
        ]
    }

    private func createConvoy(
        id: String,
        title: String = "Test Convoy",
        status: String = "open",
        rig: String? = nil,
        progress: ConvoyProgress = ConvoyProgress(completed: 3, total: 10),
        trackedIssues: [TrackedIssue] = []
    ) -> Convoy {
        Convoy(
            id: id,
            title: title,
            status: status,
            rig: rig,
            progress: progress,
            trackedIssues: trackedIssues
        )
    }
}

// MARK: - Mock API Client

private class MockAPIClient: APIClient {
    var getConvoysResult: Result<[Convoy], Error>?

    override func getConvoys() async throws -> [Convoy] {
        guard let result = getConvoysResult else {
            throw APIClientError.networkError("Not configured")
        }
        return try result.get()
    }
}
