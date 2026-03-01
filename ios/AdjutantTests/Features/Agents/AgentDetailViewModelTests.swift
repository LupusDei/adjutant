import XCTest
@testable import AdjutantUI
@testable import AdjutantKit

@MainActor
final class AgentDetailViewModelTests: XCTestCase {

    // MARK: - Properties

    private var sut: AgentDetailViewModel!

    // MARK: - Setup

    override func setUp() async throws {
        try await super.setUp()
    }

    override func tearDown() async throws {
        sut = nil
        try await super.tearDown()
    }

    // MARK: - Initialization Tests

    func testInit_withSession_setsHasTermTrue() async {
        // Given
        let member = createAgentWithSession()

        // When
        sut = AgentDetailViewModel(member: member)

        // Then
        XCTAssertTrue(sut.hasTerm)
    }

    func testInit_withoutSession_setsHasTermFalse() async {
        // Given
        let member = createUserMember()

        // When
        sut = AgentDetailViewModel(member: member)

        // Then
        XCTAssertFalse(sut.hasTerm)
    }

    func testInit_hasAutoScrollEnabled() async {
        // Given
        let member = createAgentWithSession()

        // When
        sut = AgentDetailViewModel(member: member)

        // Then
        XCTAssertTrue(sut.autoScrollEnabled)
    }

    func testInit_terminalContentIsNil() async {
        // Given
        let member = createAgentWithSession()

        // When
        sut = AgentDetailViewModel(member: member)

        // Then
        XCTAssertNil(sut.terminalContent)
    }

    // MARK: - Terminal Loading Tests

    func testLoadTerminal_noSession_doesNotLoad() async {
        // Given
        let member = createAgentWithoutSession()
        sut = AgentDetailViewModel(member: member)

        // When
        await sut.loadTerminal()

        // Then
        XCTAssertNil(sut.terminalContent)
    }

    // MARK: - Status Display Tests

    func testStatusDisplayText_idle() async {
        // Given
        let member = createAgentWithSession(status: .idle)

        // When
        sut = AgentDetailViewModel(member: member)

        // Then
        XCTAssertEqual(sut.statusDisplayText, "IDLE")
    }

    func testStatusDisplayText_working() async {
        // Given
        let member = createAgentWithSession(status: .working)

        // When
        sut = AgentDetailViewModel(member: member)

        // Then
        XCTAssertEqual(sut.statusDisplayText, "WORKING")
    }

    func testStatusDisplayText_blocked() async {
        // Given
        let member = createAgentWithSession(status: .blocked)

        // When
        sut = AgentDetailViewModel(member: member)

        // Then
        XCTAssertEqual(sut.statusDisplayText, "BLOCKED")
    }

    func testStatusDisplayText_stuck() async {
        // Given
        let member = createAgentWithSession(status: .stuck)

        // When
        sut = AgentDetailViewModel(member: member)

        // Then
        XCTAssertEqual(sut.statusDisplayText, "STUCK")
    }

    func testStatusDisplayText_offline() async {
        // Given
        let member = createAgentWithSession(status: .offline)

        // When
        sut = AgentDetailViewModel(member: member)

        // Then
        XCTAssertEqual(sut.statusDisplayText, "OFFLINE")
    }

    // MARK: - Formatted Timestamp Tests

    func testFormattedTimestamp_noTimestamp_returnsEmpty() async {
        // Given
        let member = createAgentWithSession()
        sut = AgentDetailViewModel(member: member)

        // Then
        XCTAssertTrue(sut.formattedTimestamp.isEmpty)
    }

    // MARK: - Auto-scroll Toggle Tests

    func testAutoScrollEnabled_canToggle() async {
        // Given
        let member = createAgentWithSession()
        sut = AgentDetailViewModel(member: member)
        XCTAssertTrue(sut.autoScrollEnabled)

        // When
        sut.autoScrollEnabled = false

        // Then
        XCTAssertFalse(sut.autoScrollEnabled)

        // When
        sut.autoScrollEnabled = true

        // Then
        XCTAssertTrue(sut.autoScrollEnabled)
    }

    // MARK: - Helper Methods

    private func createAgentWithSession(status: CrewMemberStatus = .working) -> CrewMember {
        CrewMember(
            id: "agent-abc",
            name: "agent-abc",
            type: .agent,
            status: status,
            currentTask: "Working on feature",
            unreadMail: 0,
            branch: "feature/test",
            sessionId: "session-123"
        )
    }

    private func createAgentWithoutSession(status: CrewMemberStatus = .idle) -> CrewMember {
        CrewMember(
            id: "agent-orphan",
            name: "agent-orphan",
            type: .agent,
            status: status,
            unreadMail: 0
        )
    }

    private func createUserMember() -> CrewMember {
        CrewMember(
            id: "user",
            name: "User",
            type: .user,
            status: .working,
            currentTask: "Coordinating",
            unreadMail: 0
        )
    }
}
