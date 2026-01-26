import XCTest
@testable import AdjutantUI
@testable import AdjutantKit

@MainActor
final class CrewListViewModelTests: XCTestCase {

    // MARK: - Properties

    private var sut: CrewListViewModel!
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
        sut = CrewListViewModel(apiClient: mockAPIClient)

        // Then
        XCTAssertTrue(sut.allCrewMembers.isEmpty)
        XCTAssertTrue(sut.groupedCrewMembers.isEmpty)
        XCTAssertTrue(sut.searchText.isEmpty)
        XCTAssertNil(sut.selectedRig)
        XCTAssertTrue(sut.availableRigs.isEmpty)
        XCTAssertEqual(sut.displayedCount, 0)
        XCTAssertFalse(sut.hasActiveFilters)
    }

    // MARK: - Refresh Tests

    func testRefresh_success_loadsAgents() async {
        // Given
        let agents = createTestAgents()
        mockAPIClient.getAgentsResult = .success(agents)
        sut = CrewListViewModel(apiClient: mockAPIClient)

        // When
        await sut.refresh()

        // Then
        XCTAssertEqual(sut.allCrewMembers.count, agents.count)
        XCTAssertFalse(sut.groupedCrewMembers.isEmpty)
    }

    func testRefresh_failure_setsError() async {
        // Given
        mockAPIClient.getAgentsResult = .failure(APIClientError.networkError("Connection failed"))
        sut = CrewListViewModel(apiClient: mockAPIClient)

        // When
        await sut.refresh()

        // Then
        XCTAssertTrue(sut.allCrewMembers.isEmpty)
        XCTAssertNotNil(sut.errorMessage)
    }

    // MARK: - Grouping Tests

    func testGrouping_organizedByAgentType() async {
        // Given
        let agents = createTestAgents()
        mockAPIClient.getAgentsResult = .success(agents)
        sut = CrewListViewModel(apiClient: mockAPIClient)

        // When
        await sut.refresh()

        // Then
        // Should have groups for mayor, witness, and polecat
        let groupTypes = sut.groupedCrewMembers.map { $0.type }
        XCTAssertTrue(groupTypes.contains(.mayor))
        XCTAssertTrue(groupTypes.contains(.witness))
        XCTAssertTrue(groupTypes.contains(.polecat))
    }

    func testGrouping_sortedByHierarchy() async {
        // Given
        let agents = createTestAgents()
        mockAPIClient.getAgentsResult = .success(agents)
        sut = CrewListViewModel(apiClient: mockAPIClient)

        // When
        await sut.refresh()

        // Then
        // Mayor should come before Witness, Witness before Polecat
        let sortOrders = sut.groupedCrewMembers.map { $0.sortOrder }
        XCTAssertEqual(sortOrders, sortOrders.sorted())
    }

    func testGrouping_membersAlphabetized() async {
        // Given
        let agents = [
            createCrewMember(name: "Zeta", type: .polecat),
            createCrewMember(name: "Alpha", type: .polecat),
            createCrewMember(name: "Beta", type: .polecat)
        ]
        mockAPIClient.getAgentsResult = .success(agents)
        sut = CrewListViewModel(apiClient: mockAPIClient)

        // When
        await sut.refresh()

        // Then
        let polecatGroup = sut.groupedCrewMembers.first { $0.type == .polecat }
        XCTAssertNotNil(polecatGroup)
        let names = polecatGroup?.members.map { $0.name }
        XCTAssertEqual(names, ["Alpha", "Beta", "Zeta"])
    }

    // MARK: - Search Tests

    func testSearch_filtersByName() async {
        // Given
        let agents = createTestAgents()
        mockAPIClient.getAgentsResult = .success(agents)
        sut = CrewListViewModel(apiClient: mockAPIClient)
        await sut.refresh()

        // When
        sut.searchText = "Mayor"

        // Then
        XCTAssertEqual(sut.displayedCount, 1)
        XCTAssertTrue(sut.groupedCrewMembers.allSatisfy { group in
            group.members.allSatisfy { $0.name.lowercased().contains("mayor") }
        })
    }

    func testSearch_caseInsensitive() async {
        // Given
        let agents = createTestAgents()
        mockAPIClient.getAgentsResult = .success(agents)
        sut = CrewListViewModel(apiClient: mockAPIClient)
        await sut.refresh()

        // When
        sut.searchText = "MAYOR"

        // Then
        XCTAssertEqual(sut.displayedCount, 1)
    }

    func testSearch_filtersByCurrentTask() async {
        // Given
        let agents = [
            createCrewMember(name: "Worker1", type: .polecat, currentTask: "Building feature X"),
            createCrewMember(name: "Worker2", type: .polecat, currentTask: "Fixing bug Y")
        ]
        mockAPIClient.getAgentsResult = .success(agents)
        sut = CrewListViewModel(apiClient: mockAPIClient)
        await sut.refresh()

        // When
        sut.searchText = "feature"

        // Then
        XCTAssertEqual(sut.displayedCount, 1)
    }

    func testSearch_emptyResults() async {
        // Given
        let agents = createTestAgents()
        mockAPIClient.getAgentsResult = .success(agents)
        sut = CrewListViewModel(apiClient: mockAPIClient)
        await sut.refresh()

        // When
        sut.searchText = "nonexistent"

        // Then
        XCTAssertEqual(sut.displayedCount, 0)
        XCTAssertTrue(sut.groupedCrewMembers.isEmpty)
    }

    // MARK: - Rig Filter Tests

    func testRigFilter_filtersByRig() async {
        // Given
        let agents = [
            createCrewMember(name: "Worker1", type: .polecat, rig: "greenplace"),
            createCrewMember(name: "Worker2", type: .polecat, rig: "oldforge"),
            createCrewMember(name: "Worker3", type: .polecat, rig: "greenplace")
        ]
        mockAPIClient.getAgentsResult = .success(agents)
        sut = CrewListViewModel(apiClient: mockAPIClient)
        await sut.refresh()

        // When
        sut.selectedRig = "greenplace"

        // Then
        XCTAssertEqual(sut.displayedCount, 2)
    }

    func testRigFilter_updatesAvailableRigs() async {
        // Given
        let agents = [
            createCrewMember(name: "Worker1", type: .polecat, rig: "greenplace"),
            createCrewMember(name: "Worker2", type: .polecat, rig: "oldforge"),
            createCrewMember(name: "Worker3", type: .witness, rig: "greenplace")
        ]
        mockAPIClient.getAgentsResult = .success(agents)
        sut = CrewListViewModel(apiClient: mockAPIClient)

        // When
        await sut.refresh()

        // Then
        XCTAssertEqual(Set(sut.availableRigs), Set(["greenplace", "oldforge"]))
    }

    func testRigFilter_excludesNilRigs() async {
        // Given
        let agents = [
            createCrewMember(name: "Mayor", type: .mayor, rig: nil),
            createCrewMember(name: "Worker", type: .polecat, rig: "greenplace")
        ]
        mockAPIClient.getAgentsResult = .success(agents)
        sut = CrewListViewModel(apiClient: mockAPIClient)

        // When
        await sut.refresh()

        // Then
        XCTAssertEqual(sut.availableRigs, ["greenplace"])
    }

    // MARK: - Combined Filter Tests

    func testCombinedFilters_searchAndRig() async {
        // Given
        let agents = [
            createCrewMember(name: "Alpha", type: .polecat, rig: "greenplace"),
            createCrewMember(name: "Beta", type: .polecat, rig: "greenplace"),
            createCrewMember(name: "Alpha", type: .polecat, rig: "oldforge")
        ]
        mockAPIClient.getAgentsResult = .success(agents)
        sut = CrewListViewModel(apiClient: mockAPIClient)
        await sut.refresh()

        // When
        sut.searchText = "Alpha"
        sut.selectedRig = "greenplace"

        // Then
        XCTAssertEqual(sut.displayedCount, 1)
    }

    func testClearFilters_resetsAll() async {
        // Given
        let agents = createTestAgents()
        mockAPIClient.getAgentsResult = .success(agents)
        sut = CrewListViewModel(apiClient: mockAPIClient)
        await sut.refresh()
        sut.searchText = "test"
        sut.selectedRig = "greenplace"

        // When
        sut.clearFilters()

        // Then
        XCTAssertTrue(sut.searchText.isEmpty)
        XCTAssertNil(sut.selectedRig)
        XCTAssertFalse(sut.hasActiveFilters)
    }

    // MARK: - Has Active Filters Tests

    func testHasActiveFilters_withSearch_returnsTrue() async {
        // Given
        mockAPIClient.getAgentsResult = .success([])
        sut = CrewListViewModel(apiClient: mockAPIClient)

        // When
        sut.searchText = "test"

        // Then
        XCTAssertTrue(sut.hasActiveFilters)
    }

    func testHasActiveFilters_withRig_returnsTrue() async {
        // Given
        mockAPIClient.getAgentsResult = .success([])
        sut = CrewListViewModel(apiClient: mockAPIClient)

        // When
        sut.selectedRig = "greenplace"

        // Then
        XCTAssertTrue(sut.hasActiveFilters)
    }

    func testHasActiveFilters_noFilters_returnsFalse() async {
        // Given
        mockAPIClient.getAgentsResult = .success([])
        sut = CrewListViewModel(apiClient: mockAPIClient)

        // Then
        XCTAssertFalse(sut.hasActiveFilters)
    }

    // MARK: - Agent Type Group Tests

    func testAgentTypeGroup_displayNames() {
        // Given
        let groups: [(AgentType, String)] = [
            (.mayor, "MAYOR"),
            (.deacon, "DEACONS"),
            (.witness, "WITNESSES"),
            (.refinery, "REFINERIES"),
            (.crew, "CREW"),
            (.polecat, "POLECATS")
        ]

        // Then
        for (type, expectedName) in groups {
            let group = CrewListViewModel.AgentTypeGroup(type: type, members: [])
            XCTAssertEqual(group.displayName, expectedName)
        }
    }

    func testAgentTypeGroup_sortOrder() {
        // Given
        let types: [AgentType] = [.mayor, .deacon, .witness, .refinery, .crew, .polecat]

        // Then
        for (index, type) in types.enumerated() {
            let group = CrewListViewModel.AgentTypeGroup(type: type, members: [])
            XCTAssertEqual(group.sortOrder, index)
        }
    }

    // MARK: - Helper Methods

    private func createTestAgents() -> [CrewMember] {
        [
            createCrewMember(name: "Mayor", type: .mayor, rig: nil, status: .working),
            createCrewMember(name: "Witness", type: .witness, rig: "greenplace", status: .idle),
            createCrewMember(name: "Polecat-ABC", type: .polecat, rig: "greenplace", status: .working),
            createCrewMember(name: "Polecat-XYZ", type: .polecat, rig: "oldforge", status: .stuck)
        ]
    }

    private func createCrewMember(
        name: String,
        type: AgentType,
        rig: String? = "greenplace",
        status: CrewMemberStatus = .idle,
        currentTask: String? = nil,
        unreadMail: Int = 0
    ) -> CrewMember {
        CrewMember(
            id: "\(rig ?? "town")/\(name)",
            name: name,
            type: type,
            rig: rig,
            status: status,
            currentTask: currentTask,
            unreadMail: unreadMail,
            firstSubject: nil,
            firstFrom: nil,
            branch: nil
        )
    }
}

// MARK: - Mock API Client

private class MockAPIClient: APIClient {
    var getAgentsResult: Result<[CrewMember], Error>?

    override func getAgents() async throws -> [CrewMember] {
        guard let result = getAgentsResult else {
            throw APIClientError.networkError("Not configured")
        }
        return try result.get()
    }
}
