import XCTest
import Combine
import AdjutantKit
@testable import Adjutant

@MainActor
final class SessionChatViewModelTests: XCTestCase {
    private var viewModel: SessionChatViewModel!
    private var wsClient: WebSocketClient!
    private var cancellables: Set<AnyCancellable>!

    private let testSession = ManagedSession(
        id: "sess-test",
        name: "test-agent",
        tmuxSession: "gt-test",
        tmuxPane: "gt-test:0.0",
        projectPath: "/tmp/test",
        mode: .standalone,
        status: .idle,
        workspaceType: .primary,
        connectedClients: [],
        pipeActive: false,
        createdAt: "2026-02-15T00:00:00Z",
        lastActivity: "2026-02-15T00:00:00Z"
    )

    override func setUp() async throws {
        cancellables = Set<AnyCancellable>()
        wsClient = WebSocketClient(baseURL: URL(string: "http://localhost:4201/api")!)
        viewModel = SessionChatViewModel(session: testSession, wsClient: wsClient)
    }

    override func tearDown() async throws {
        viewModel = nil
        wsClient = nil
        cancellables = nil
    }

    // MARK: - Initial State

    func testInitialState() {
        XCTAssertEqual(viewModel.session.id, "sess-test")
        XCTAssertEqual(viewModel.session.name, "test-agent")
        XCTAssertTrue(viewModel.outputLines.isEmpty)
        XCTAssertFalse(viewModel.isConnected)
        XCTAssertEqual(viewModel.sessionStatus, "idle")
        XCTAssertEqual(viewModel.inputText, "")
        XCTAssertNil(viewModel.errorMessage)
        XCTAssertFalse(viewModel.isWaitingPermission)
    }

    // MARK: - Session Output

    func testSessionOutputAppendsLines() {
        // Simulate output events
        wsClient.sessionOutputSubject.send(SessionOutputEvent(
            sessionId: "sess-test",
            output: "Hello, world!"
        ))

        XCTAssertEqual(viewModel.outputLines.count, 1)
        XCTAssertEqual(viewModel.outputLines[0].text, "Hello, world!")
    }

    func testSessionOutputFiltersOtherSessions() {
        wsClient.sessionOutputSubject.send(SessionOutputEvent(
            sessionId: "other-session",
            output: "Should not appear"
        ))

        XCTAssertTrue(viewModel.outputLines.isEmpty)
    }

    func testSessionOutputTruncatesAtMax() {
        // Send more than maxOutputLines (5000)
        for i in 0..<5010 {
            wsClient.sessionOutputSubject.send(SessionOutputEvent(
                sessionId: "sess-test",
                output: "Line \(i)"
            ))
        }

        XCTAssertEqual(viewModel.outputLines.count, 5000)
        XCTAssertEqual(viewModel.outputLines.first?.text, "Line 10")
    }

    // MARK: - Session Connected

    func testSessionConnectedEvent() {
        wsClient.sessionConnectedSubject.send(SessionConnectedEvent(
            sessionId: "sess-test",
            buffer: ["replay line 1", "replay line 2"]
        ))

        XCTAssertTrue(viewModel.isConnected)
        XCTAssertEqual(viewModel.outputLines.count, 2)
        XCTAssertEqual(viewModel.outputLines[0].text, "replay line 1")
        XCTAssertEqual(viewModel.outputLines[1].text, "replay line 2")
    }

    func testSessionConnectedIgnoresOtherSessions() {
        wsClient.sessionConnectedSubject.send(SessionConnectedEvent(
            sessionId: "other-session",
            buffer: ["should not appear"]
        ))

        XCTAssertFalse(viewModel.isConnected)
        XCTAssertTrue(viewModel.outputLines.isEmpty)
    }

    // MARK: - Session Disconnected

    func testSessionDisconnected() {
        // First connect
        wsClient.sessionConnectedSubject.send(SessionConnectedEvent(
            sessionId: "sess-test",
            buffer: []
        ))
        XCTAssertTrue(viewModel.isConnected)

        // Then disconnect
        wsClient.sessionDisconnectedSubject.send("sess-test")
        XCTAssertFalse(viewModel.isConnected)
    }

    // MARK: - Session Status

    func testSessionStatusChange() {
        wsClient.sessionStatusSubject.send(SessionStatusEvent(
            sessionId: "sess-test",
            status: "working"
        ))

        XCTAssertEqual(viewModel.sessionStatus, "working")
        XCTAssertFalse(viewModel.isWaitingPermission)
    }

    func testSessionWaitingPermission() {
        wsClient.sessionStatusSubject.send(SessionStatusEvent(
            sessionId: "sess-test",
            status: "waiting_permission"
        ))

        XCTAssertEqual(viewModel.sessionStatus, "waiting_permission")
        XCTAssertTrue(viewModel.isWaitingPermission)
    }

    func testRespondToPermissionClearsFlag() {
        wsClient.sessionStatusSubject.send(SessionStatusEvent(
            sessionId: "sess-test",
            status: "waiting_permission"
        ))
        XCTAssertTrue(viewModel.isWaitingPermission)

        viewModel.respondToPermission(approved: true)
        XCTAssertFalse(viewModel.isWaitingPermission)
    }

    // MARK: - Input

    func testSendInputClearsText() {
        viewModel.inputText = "test command"
        viewModel.sendInput()
        XCTAssertEqual(viewModel.inputText, "")
    }

    func testSendInputIgnoresEmpty() {
        viewModel.inputText = ""
        viewModel.sendInput()
        XCTAssertEqual(viewModel.inputText, "")
    }

    func testSendInputIgnoresWhitespace() {
        viewModel.inputText = "   "
        viewModel.sendInput()
        XCTAssertEqual(viewModel.inputText, "")
    }

    // MARK: - Clear

    func testClearOutput() {
        wsClient.sessionOutputSubject.send(SessionOutputEvent(
            sessionId: "sess-test",
            output: "some output"
        ))
        XCTAssertFalse(viewModel.outputLines.isEmpty)

        viewModel.clearOutput()
        XCTAssertTrue(viewModel.outputLines.isEmpty)
    }

    func testClearError() {
        viewModel.clearError()
        XCTAssertNil(viewModel.errorMessage)
    }
}
