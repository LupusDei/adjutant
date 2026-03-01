import XCTest
@testable import AdjutantUI
@testable import AdjutantKit

@MainActor
final class AgentListViewModelTests: XCTestCase {

    // MARK: - Properties

    private var sut: AgentListViewModel!
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
        sut = AgentListViewModel(apiClient: mockAPIClient)

        // Then
        XCTAssertTrue(sut.allCrewMembers.isEmpty)
        XCTAssertTrue(sut.groupedCrewMembers.isEmpty)
        XCTAssertTrue(sut.searchText.isEmpty)
        XCTAssertEqual(sut.displayedCount, 0)
        XCTAssertFalse(sut.hasActiveFilters)
    }

    // MARK: - Refresh Tests

    func testRefresh_success_loadsAgents() async {
        // Given
        let agents = createTestAgents()
        mockAPIClient.getAgentsResult = .success(agents)
        sut = AgentListViewModel(apiClient: mockAPIClient)

        // When
        await sut.refresh()

        // Then
        XCTAssertEqual(sut.allCrewMembers.count, agents.count)
        XCTAssertFalse(sut.groupedCrewMembers.isEmpty)
    }

    func testRefresh_failure_setsError() async {
        // Given
        mockAPIClient.getAgentsResult = .failure(APIClientError.networkError("Connection failed"))
        sut = AgentListViewModel(apiClient: mockAPIClient)

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
        sut = AgentListViewModel(apiClient: mockAPIClient)

        // When
        await sut.refresh()

        // Then
        // Should have groups for user and agent
        let groupTypes = sut.groupedCrewMembers.map { $0.type }
        XCTAssertTrue(groupTypes.contains(.user))
        XCTAssertTrue(groupTypes.contains(.agent))
    }

    func testGrouping_sortedByHierarchy() async {
        // Given
        let agents = createTestAgents()
        mockAPIClient.getAgentsResult = .success(agents)
        sut = AgentListViewModel(apiClient: mockAPIClient)

        // When
        await sut.refresh()

        // Then
        // Agent should come before User
        let sortOrders = sut.groupedCrewMembers.map { $0.sortOrder }
        XCTAssertEqual(sortOrders, sortOrders.sorted())
    }

    func testGrouping_membersAlphabetized() async {
        // Given
        let agents = [
            createCrewMember(name: "Zeta", type: .agent),
            createCrewMember(name: "Alpha", type: .agent),
            createCrewMember(name: "Beta", type: .agent)
        ]
        mockAPIClient.getAgentsResult = .success(agents)
        sut = AgentListViewModel(apiClient: mockAPIClient)

        // When
        await sut.refresh()

        // Then
        let agentGroup = sut.groupedCrewMembers.first { $0.type == .agent }
        XCTAssertNotNil(agentGroup)
        let names = agentGroup?.members.map { $0.name }
        XCTAssertEqual(names, ["Alpha", "Beta", "Zeta"])
    }

    // MARK: - Search Tests

    func testSearch_filtersByName() async {
        // Given
        let agents = createTestAgents()
        mockAPIClient.getAgentsResult = .success(agents)
        sut = AgentListViewModel(apiClient: mockAPIClient)
        await sut.refresh()

        // When
        sut.searchText = "User"

        // Then
        XCTAssertEqual(sut.displayedCount, 1)
        XCTAssertTrue(sut.groupedCrewMembers.allSatisfy { group in
            group.members.allSatisfy { $0.name.lowercased().contains("user") }
        })
    }

    func testSearch_caseInsensitive() async {
        // Given
        let agents = createTestAgents()
        mockAPIClient.getAgentsResult = .success(agents)
        sut = AgentListViewModel(apiClient: mockAPIClient)
        await sut.refresh()

        // When
        sut.searchText = "USER"

        // Then
        XCTAssertEqual(sut.displayedCount, 1)
    }

    func testSearch_filtersByCurrentTask() async {
        // Given
        let agents = [
            createCrewMember(name: "Worker1", type: .agent, currentTask: "Building feature X"),
            createCrewMember(name: "Worker2", type: .agent, currentTask: "Fixing bug Y")
        ]
        mockAPIClient.getAgentsResult = .success(agents)
        sut = AgentListViewModel(apiClient: mockAPIClient)
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
        sut = AgentListViewModel(apiClient: mockAPIClient)
        await sut.refresh()

        // When
        sut.searchText = "nonexistent"

        // Then
        XCTAssertEqual(sut.displayedCount, 0)
        XCTAssertTrue(sut.groupedCrewMembers.isEmpty)
    }

    // MARK: - Filter Tests

    func testClearFilters_resetsAll() async {
        // Given
        let agents = createTestAgents()
        mockAPIClient.getAgentsResult = .success(agents)
        sut = AgentListViewModel(apiClient: mockAPIClient)
        await sut.refresh()
        sut.searchText = "test"

        // When
        sut.clearFilters()

        // Then
        XCTAssertTrue(sut.searchText.isEmpty)
        XCTAssertFalse(sut.hasActiveFilters)
    }

    // MARK: - Has Active Filters Tests

    func testHasActiveFilters_withSearch_returnsTrue() async {
        // Given
        mockAPIClient.getAgentsResult = .success([])
        sut = AgentListViewModel(apiClient: mockAPIClient)

        // When
        sut.searchText = "test"

        // Then
        XCTAssertTrue(sut.hasActiveFilters)
    }

    func testHasActiveFilters_noFilters_returnsFalse() async {
        // Given
        mockAPIClient.getAgentsResult = .success([])
        sut = AgentListViewModel(apiClient: mockAPIClient)

        // Then
        XCTAssertFalse(sut.hasActiveFilters)
    }

    // MARK: - Agent Type Group Tests

    func testAgentTypeGroup_displayNames() {
        // Given
        let groups: [(AgentType, String)] = [
            (.user, "USERS"),
            (.agent, "AGENTS")
        ]

        // Then
        for (type, expectedName) in groups {
            let group = AgentListViewModel.AgentTypeGroup(type: type, members: [])
            XCTAssertEqual(group.displayName, expectedName)
        }
    }

    func testAgentTypeGroup_sortOrder() {
        // Given - agent (0) comes before user (1)
        let types: [AgentType] = [.agent, .user]

        // Then
        for (index, type) in types.enumerated() {
            let group = AgentListViewModel.AgentTypeGroup(type: type, members: [])
            XCTAssertEqual(group.sortOrder, index)
        }
    }

    // MARK: - Helper Methods

    private func createTestAgents() -> [CrewMember] {
        [
            createCrewMember(name: "User", type: .user, status: .working),
            createCrewMember(name: "Agent-ABC", type: .agent, status: .working),
            createCrewMember(name: "Agent-XYZ", type: .agent, status: .stuck)
        ]
    }

    private func createCrewMember(
        name: String,
        type: AgentType,
        status: CrewMemberStatus = .idle,
        currentTask: String? = nil,
        unreadMail: Int = 0
    ) -> CrewMember {
        CrewMember(
            id: "town/\(name)",
            name: name,
            type: type,
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
