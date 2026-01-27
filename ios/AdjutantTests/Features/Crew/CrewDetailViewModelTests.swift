import XCTest
@testable import AdjutantUI
@testable import AdjutantKit

@MainActor
final class CrewDetailViewModelTests: XCTestCase {

    // MARK: - Properties

    private var sut: CrewDetailViewModel!
    private var mockAPIClient: MockTerminalAPIClient!

    // MARK: - Setup

    override func setUp() async throws {
        try await super.setUp()
        mockAPIClient = MockTerminalAPIClient()
    }

    override func tearDown() async throws {
        sut = nil
        mockAPIClient = nil
        try await super.tearDown()
    }

    // MARK: - Initialization Tests

    func testInit_withPolecat_setsHasTermTrue() async {
        // Given
        let member = createPolecatMember()

        // When
        sut = CrewDetailViewModel(member: member, apiClient: mockAPIClient)

        // Then
        XCTAssertTrue(sut.hasTerm)
    }

    func testInit_withNonPolecat_setsHasTermFalse() async {
        // Given
        let member = createMayorMember()

        // When
        sut = CrewDetailViewModel(member: member, apiClient: mockAPIClient)

        // Then
        XCTAssertFalse(sut.hasTerm)
    }

    func testInit_hasAutoScrollEnabled() async {
        // Given
        let member = createPolecatMember()

        // When
        sut = CrewDetailViewModel(member: member, apiClient: mockAPIClient)

        // Then
        XCTAssertTrue(sut.autoScrollEnabled)
    }

    func testInit_terminalContentIsNil() async {
        // Given
        let member = createPolecatMember()

        // When
        sut = CrewDetailViewModel(member: member, apiClient: mockAPIClient)

        // Then
        XCTAssertNil(sut.terminalContent)
    }

    // MARK: - Terminal Loading Tests

    func testLoadTerminal_success_setsContent() async {
        // Given
        let member = createPolecatMember()
        let expectedContent = "Terminal output here..."
        mockAPIClient.terminalResult = .success(TerminalCapture(
            content: expectedContent,
            sessionName: "gt-greenplace-polecat-abc",
            timestamp: "2026-01-25T12:00:00Z"
        ))
        sut = CrewDetailViewModel(member: member, apiClient: mockAPIClient)

        // When
        await sut.loadTerminal()

        // Then
        XCTAssertEqual(sut.terminalContent, expectedContent)
        XCTAssertEqual(sut.terminalSessionName, "gt-greenplace-polecat-abc")
        XCTAssertNotNil(sut.terminalTimestamp)
    }

    func testLoadTerminal_failure_setsError() async {
        // Given
        let member = createPolecatMember()
        mockAPIClient.terminalResult = .failure(APIClientError.networkError("Connection failed"))
        sut = CrewDetailViewModel(member: member, apiClient: mockAPIClient)

        // When
        await sut.loadTerminal()

        // Then
        XCTAssertNil(sut.terminalContent)
        XCTAssertNotNil(sut.errorMessage)
    }

    func testLoadTerminal_nonPolecat_doesNotLoad() async {
        // Given
        let member = createMayorMember()
        mockAPIClient.terminalResult = .success(TerminalCapture(
            content: "Should not see this",
            sessionName: "test",
            timestamp: "2026-01-25T12:00:00Z"
        ))
        sut = CrewDetailViewModel(member: member, apiClient: mockAPIClient)

        // When
        await sut.loadTerminal()

        // Then
        XCTAssertNil(sut.terminalContent)
        XCTAssertFalse(mockAPIClient.getTerminalCalled)
    }

    func testLoadTerminal_noRig_doesNotLoad() async {
        // Given
        let member = CrewMember(
            id: "polecat-orphan",
            name: "polecat-orphan",
            type: .polecat,
            rig: nil,
            status: .idle,
            unreadMail: 0
        )
        sut = CrewDetailViewModel(member: member, apiClient: mockAPIClient)

        // When
        await sut.loadTerminal()

        // Then
        XCTAssertNil(sut.terminalContent)
        XCTAssertFalse(mockAPIClient.getTerminalCalled)
    }

    // MARK: - Status Display Tests

    func testStatusDisplayText_idle() async {
        // Given
        let member = createPolecatMember(status: .idle)

        // When
        sut = CrewDetailViewModel(member: member, apiClient: mockAPIClient)

        // Then
        XCTAssertEqual(sut.statusDisplayText, "IDLE")
    }

    func testStatusDisplayText_working() async {
        // Given
        let member = createPolecatMember(status: .working)

        // When
        sut = CrewDetailViewModel(member: member, apiClient: mockAPIClient)

        // Then
        XCTAssertEqual(sut.statusDisplayText, "WORKING")
    }

    func testStatusDisplayText_blocked() async {
        // Given
        let member = createPolecatMember(status: .blocked)

        // When
        sut = CrewDetailViewModel(member: member, apiClient: mockAPIClient)

        // Then
        XCTAssertEqual(sut.statusDisplayText, "BLOCKED")
    }

    func testStatusDisplayText_stuck() async {
        // Given
        let member = createPolecatMember(status: .stuck)

        // When
        sut = CrewDetailViewModel(member: member, apiClient: mockAPIClient)

        // Then
        XCTAssertEqual(sut.statusDisplayText, "STUCK")
    }

    func testStatusDisplayText_offline() async {
        // Given
        let member = createPolecatMember(status: .offline)

        // When
        sut = CrewDetailViewModel(member: member, apiClient: mockAPIClient)

        // Then
        XCTAssertEqual(sut.statusDisplayText, "OFFLINE")
    }

    // MARK: - Formatted Timestamp Tests

    func testFormattedTimestamp_withTimestamp_returnsFormatted() async {
        // Given
        let member = createPolecatMember()
        mockAPIClient.terminalResult = .success(TerminalCapture(
            content: "test",
            sessionName: "test",
            timestamp: "2026-01-25T14:30:00Z"
        ))
        sut = CrewDetailViewModel(member: member, apiClient: mockAPIClient)

        // When
        await sut.loadTerminal()

        // Then
        XCTAssertFalse(sut.formattedTimestamp.isEmpty)
    }

    func testFormattedTimestamp_noTimestamp_returnsEmpty() async {
        // Given
        let member = createPolecatMember()
        sut = CrewDetailViewModel(member: member, apiClient: mockAPIClient)

        // Then
        XCTAssertTrue(sut.formattedTimestamp.isEmpty)
    }

    // MARK: - Auto-scroll Toggle Tests

    func testAutoScrollEnabled_canToggle() async {
        // Given
        let member = createPolecatMember()
        sut = CrewDetailViewModel(member: member, apiClient: mockAPIClient)
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

    private func createPolecatMember(status: CrewMemberStatus = .working) -> CrewMember {
        CrewMember(
            id: "greenplace/polecat-abc",
            name: "polecat-abc",
            type: .polecat,
            rig: "greenplace",
            status: status,
            currentTask: "Working on feature",
            unreadMail: 0,
            branch: "feature/test"
        )
    }

    private func createMayorMember() -> CrewMember {
        CrewMember(
            id: "mayor/",
            name: "Mayor",
            type: .mayor,
            rig: nil,
            status: .working,
            currentTask: "Coordinating",
            unreadMail: 0
        )
    }
}

// MARK: - Mock API Client

private final class MockTerminalAPIClient: TerminalAPIProviding, @unchecked Sendable {
    var terminalResult: Result<TerminalCapture, Error>?
    var getTerminalCalled = false

    func getPolecatTerminal(rig: String, polecat: String) async throws -> TerminalCapture {
        getTerminalCalled = true
        guard let result = terminalResult else {
            throw APIClientError.networkError("Not configured")
        }
        return try result.get()
    }
}
