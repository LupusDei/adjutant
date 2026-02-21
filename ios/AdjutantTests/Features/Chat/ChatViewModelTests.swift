import XCTest
import Combine
import AdjutantKit
@testable import AdjutantUI

@MainActor
final class ChatViewModelTests: XCTestCase {
    private var viewModel: ChatViewModel!
    private var mockAPIClient: APIClient!
    private var cancellables: Set<AnyCancellable>!

    override func setUp() async throws {
        cancellables = Set<AnyCancellable>()
        mockAPIClient = createMockAPIClient()
        viewModel = ChatViewModel(apiClient: mockAPIClient)
    }

    override func tearDown() async throws {
        viewModel = nil
        mockAPIClient = nil
        cancellables = nil
        MockURLProtocol.mockHandler = nil
    }

    // MARK: - Initial State Tests

    func testInitialState() {
        XCTAssertTrue(viewModel.messages.isEmpty)
        XCTAssertEqual(viewModel.inputText, "")
        XCTAssertEqual(viewModel.selectedRecipient, "mayor/")
        XCTAssertTrue(viewModel.availableRecipients.isEmpty)
        XCTAssertFalse(viewModel.isTyping)
        XCTAssertFalse(viewModel.isRecordingVoice)
        XCTAssertTrue(viewModel.hasMoreHistory)
        XCTAssertFalse(viewModel.isLoadingHistory)
        XCTAssertEqual(viewModel.connectionState, .disconnected)
        XCTAssertNil(viewModel.streamingText)
    }

    // MARK: - Connection State Tests

    func testInitialConnectionState() {
        XCTAssertEqual(viewModel.communicationMethod, .http)
        XCTAssertEqual(viewModel.connectionState, .connecting)
        XCTAssertFalse(viewModel.isStreamActive)
        XCTAssertNil(viewModel.lastPollTime)
    }

    func testRefreshUpdatesConnectionStateToConnected() async {
        let testMessages = [
            createTestMessage(id: "test-1", agentId: "mayor/", role: .agent)
        ]
        MockURLProtocol.mockHandler = mockMessagesResponse(messages: testMessages)

        await viewModel.refresh()

        XCTAssertEqual(viewModel.connectionState, .connected)
        XCTAssertNotNil(viewModel.lastPollTime)
    }

    func testServerURLReturnsHost() {
        let url = viewModel.serverURL
        XCTAssertFalse(url.isEmpty)
    }

    // MARK: - Message Loading Tests

    func testRefreshLoadsMessagesFromGetMessages() async {
        let testMessages = [
            createTestMessage(id: "test-1", agentId: "mayor/", role: .agent),
            createTestMessage(id: "test-2", agentId: "user", role: .user, recipient: "mayor/")
        ]

        MockURLProtocol.mockHandler = mockMessagesResponse(messages: testMessages)

        await viewModel.refresh()

        XCTAssertEqual(viewModel.messages.count, 2)
        XCTAssertFalse(viewModel.isLoading)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testRefreshCallsGetMessagesWithAgentId() async {
        var capturedURL: URL?

        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            return self.mockMessagesResponse(messages: [])(request)
        }

        await viewModel.refresh()

        // Should call /api/messages?agentId=mayor/
        let components = URLComponents(url: capturedURL!, resolvingAgainstBaseURL: false)!
        let agentParam = components.queryItems?.first(where: { $0.name == "agentId" })
        XCTAssertEqual(agentParam?.value, "mayor/")
    }

    func testMessagesSortedOldestFirst() async {
        let now = Date()
        let testMessages = [
            createTestMessage(id: "test-new", agentId: "mayor/", role: .agent, date: now),
            createTestMessage(id: "test-old", agentId: "mayor/", role: .agent, date: now.addingTimeInterval(-3600))
        ]

        MockURLProtocol.mockHandler = mockMessagesResponse(messages: testMessages)

        await viewModel.refresh()

        XCTAssertEqual(viewModel.messages.first?.id, "test-old")
        XCTAssertEqual(viewModel.messages.last?.id, "test-new")
    }

    func testHasMoreHistoryReflectsServerResponse() async {
        MockURLProtocol.mockHandler = mockMessagesResponse(messages: [], hasMore: true)

        await viewModel.refresh()

        XCTAssertTrue(viewModel.hasMoreHistory)
    }

    func testHasMoreHistoryFalseWhenServerSaysNoMore() async {
        MockURLProtocol.mockHandler = mockMessagesResponse(messages: [], hasMore: false)

        await viewModel.refresh()

        XCTAssertFalse(viewModel.hasMoreHistory)
    }

    // MARK: - Agent Scoping Tests

    func testSetRecipientClearsMessagesAndRefreshes() async {
        // Load initial messages
        let initialMessages = [
            createTestMessage(id: "test-1", agentId: "mayor/", role: .agent)
        ]
        MockURLProtocol.mockHandler = mockMessagesResponse(messages: initialMessages)
        await viewModel.refresh()
        XCTAssertEqual(viewModel.messages.count, 1)

        // Switch recipient
        let newMessages = [
            createTestMessage(id: "test-2", agentId: "coder", role: .agent)
        ]
        MockURLProtocol.mockHandler = mockMessagesResponse(messages: newMessages)
        await viewModel.setRecipient("coder")

        XCTAssertEqual(viewModel.selectedRecipient, "coder")
        XCTAssertEqual(viewModel.messages.count, 1)
        XCTAssertEqual(viewModel.messages.first?.agentId, "coder")
    }

    func testSetRecipientSameRecipientDoesNothing() async {
        var refreshCount = 0
        MockURLProtocol.mockHandler = { request in
            refreshCount += 1
            return self.mockMessagesResponse(messages: [])(request)
        }

        await viewModel.setRecipient("mayor/") // Same as default
        XCTAssertEqual(refreshCount, 0)
    }

    // MARK: - Send Message Tests

    func testSendMessageClearsInputImmediately() async {
        viewModel.inputText = "Hello Agent"
        MockURLProtocol.mockHandler = mockMessagesResponse(messages: [])

        let task = Task {
            await viewModel.sendMessage()
        }

        try? await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(viewModel.inputText, "")

        await task.value
    }

    func testSendMessageCreatesOptimisticPersistentMessage() async {
        viewModel.inputText = "Test message"
        MockURLProtocol.mockHandler = mockMessagesResponse(messages: [])

        await viewModel.sendMessage()

        // Should have an optimistic local message
        let localMessages = viewModel.messages.filter { $0.id.hasPrefix("local-") }
        XCTAssertEqual(localMessages.count, 1)
        XCTAssertEqual(localMessages.first?.body, "Test message")
        XCTAssertEqual(localMessages.first?.role, .user)
        XCTAssertEqual(localMessages.first?.deliveryStatus, .pending)
    }

    func testSendMessageWithEmptyInputDoesNothing() async {
        viewModel.inputText = "   "
        await viewModel.sendMessage()
        XCTAssertTrue(viewModel.messages.isEmpty)
    }

    func testCanSendIsFalseWhenInputEmpty() {
        viewModel.inputText = ""
        XCTAssertFalse(viewModel.canSend)

        viewModel.inputText = "   "
        XCTAssertFalse(viewModel.canSend)
    }

    func testCanSendIsTrueWhenInputHasText() {
        viewModel.inputText = "Hello"
        XCTAssertTrue(viewModel.canSend)
    }

    // MARK: - Outgoing Message Detection Tests

    func testIsOutgoingForUserMessage() {
        let userMsg = createTestMessage(id: "test", agentId: "user", role: .user, recipient: "mayor/")
        XCTAssertTrue(viewModel.isOutgoing(userMsg))
    }

    func testIsOutgoingFalseForAgentMessage() {
        let agentMsg = createTestMessage(id: "test", agentId: "mayor/", role: .agent)
        XCTAssertFalse(viewModel.isOutgoing(agentMsg))
    }

    // MARK: - Recipient Display Name Tests

    func testRecipientDisplayNameForMayor() {
        XCTAssertEqual(viewModel.recipientDisplayName, "MAYOR")
    }

    // MARK: - Load More History Tests

    func testLoadMoreHistorySetsLoadingState() async {
        MockURLProtocol.mockHandler = mockMessagesResponse(messages: [])

        let expectation = XCTestExpectation(description: "isLoadingHistory changes")
        var loadingStates: [Bool] = []

        viewModel.$isLoadingHistory
            .sink { isLoading in
                loadingStates.append(isLoading)
                if loadingStates.count == 3 {
                    expectation.fulfill()
                }
            }
            .store(in: &cancellables)

        await viewModel.loadMoreHistory()

        await fulfillment(of: [expectation], timeout: 2.0)
        XCTAssertEqual(loadingStates, [false, true, false])
    }

    func testLoadMoreHistoryUsesBeforeIdPagination() async {
        // First load some messages
        let messages = [createTestMessage(id: "msg-1", agentId: "mayor/", role: .agent)]
        MockURLProtocol.mockHandler = mockMessagesResponse(messages: messages)
        await viewModel.refresh()

        // Now load more - should pass beforeId
        var capturedURL: URL?
        MockURLProtocol.mockHandler = { request in
            capturedURL = request.url
            return self.mockMessagesResponse(messages: [], hasMore: false)(request)
        }

        await viewModel.loadMoreHistory()

        let components = URLComponents(url: capturedURL!, resolvingAgainstBaseURL: false)!
        let beforeIdParam = components.queryItems?.first(where: { $0.name == "beforeId" })
        XCTAssertEqual(beforeIdParam?.value, "msg-1")
    }

    // MARK: - Voice Transcription Tests

    func testSendVoiceTranscriptionSetsInputAndSends() async {
        MockURLProtocol.mockHandler = mockMessagesResponse(messages: [])

        await viewModel.sendVoiceTranscription("Voice message text")

        XCTAssertEqual(viewModel.inputText, "")
    }

    // MARK: - WebSocket Incoming Message Tests

    func testIncomingWebSocketMessageAppendsToMessages() async {
        // Load initial messages
        let initial = [createTestMessage(id: "msg-1", agentId: "mayor/", role: .agent)]
        MockURLProtocol.mockHandler = mockMessagesResponse(messages: initial)
        await viewModel.refresh()
        XCTAssertEqual(viewModel.messages.count, 1)

        // Simulate a WebSocket chat_message event by directly calling the service's publisher
        // The ChatViewModel subscribes to wsService.incomingMessage
        let wsService = ChatWebSocketService()
        let vm = ChatViewModel(apiClient: mockAPIClient, wsService: wsService)

        // Seed the VM with some initial messages via refresh
        MockURLProtocol.mockHandler = mockMessagesResponse(messages: initial)
        await vm.refresh()
        XCTAssertEqual(vm.messages.count, 1)

        // Simulate incoming WebSocket message for the selected agent
        let now = ISO8601DateFormatter().string(from: Date())
        let wsMessage = PersistentMessage(
            id: "ws-msg-1",
            agentId: "mayor/",
            recipient: "user",
            role: .agent,
            body: "WebSocket message",
            deliveryStatus: .delivered,
            createdAt: now,
            updatedAt: now
        )
        wsService.incomingMessage.send(wsMessage)

        // Give the main actor a chance to process
        try? await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(vm.messages.count, 2)
        XCTAssertTrue(vm.messages.contains(where: { $0.id == "ws-msg-1" }))
    }

    func testIncomingWebSocketMessageFromOtherAgentIsFiltered() async {
        let wsService = ChatWebSocketService()
        let vm = ChatViewModel(apiClient: mockAPIClient, wsService: wsService)

        let initial = [createTestMessage(id: "msg-1", agentId: "mayor/", role: .agent)]
        MockURLProtocol.mockHandler = mockMessagesResponse(messages: initial)
        await vm.refresh()
        XCTAssertEqual(vm.messages.count, 1)

        // Send a message from a different agent (not the selected "mayor/")
        let now = ISO8601DateFormatter().string(from: Date())
        let otherMessage = PersistentMessage(
            id: "ws-msg-other",
            agentId: "coder",
            recipient: "user",
            role: .agent,
            body: "From another agent",
            deliveryStatus: .delivered,
            createdAt: now,
            updatedAt: now
        )
        wsService.incomingMessage.send(otherMessage)

        try? await Task.sleep(nanoseconds: 50_000_000)

        // Should still be 1 message (the other agent's message was filtered)
        XCTAssertEqual(vm.messages.count, 1)
        XCTAssertFalse(vm.messages.contains(where: { $0.id == "ws-msg-other" }))
    }

    func testIncomingWebSocketMessageDeduplicatesById() async {
        let wsService = ChatWebSocketService()
        let vm = ChatViewModel(apiClient: mockAPIClient, wsService: wsService)

        let initial = [createTestMessage(id: "msg-1", agentId: "mayor/", role: .agent)]
        MockURLProtocol.mockHandler = mockMessagesResponse(messages: initial)
        await vm.refresh()
        XCTAssertEqual(vm.messages.count, 1)

        // Send a message with the same ID that already exists
        let now = ISO8601DateFormatter().string(from: Date())
        let duplicate = PersistentMessage(
            id: "msg-1",
            agentId: "mayor/",
            recipient: "user",
            role: .agent,
            body: "Duplicate",
            deliveryStatus: .delivered,
            createdAt: now,
            updatedAt: now
        )
        wsService.incomingMessage.send(duplicate)

        try? await Task.sleep(nanoseconds: 50_000_000)

        // Should still be 1 message (duplicate was filtered)
        XCTAssertEqual(vm.messages.count, 1)
    }

    // MARK: - Error Handling Tests

    func testRefreshHandlesError() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 500,
            code: "SERVER_ERROR",
            message: "Internal server error"
        )

        await viewModel.refresh()

        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertFalse(viewModel.isLoading)
    }

    // MARK: - Subject Generation Tests

    func testShortMessage() {
        XCTAssertEqual(ChatViewModel.generateSubject(from: "Short"), "Short")
    }

    func testEmptyMessage() {
        XCTAssertEqual(ChatViewModel.generateSubject(from: ""), "Chat")
    }

    func testWhitespaceOnly() {
        XCTAssertEqual(ChatViewModel.generateSubject(from: "   "), "Chat")
    }

    func testExactly50Chars() {
        let text = String(repeating: "a", count: 50)
        XCTAssertEqual(ChatViewModel.generateSubject(from: text), text)
    }

    func testLongMessageTruncatesAtWordBoundary() {
        let text = "This is a very long message that should be truncated at word boundary for subject"
        let subject = ChatViewModel.generateSubject(from: text)
        XCTAssertTrue(subject.hasSuffix("..."))
        XCTAssertLessThanOrEqual(subject.count, 53)
    }

    func testLongMessageNoSpacesTruncatesAtCharLimit() {
        let text = String(repeating: "x", count: 60)
        let subject = ChatViewModel.generateSubject(from: text)
        XCTAssertTrue(subject.hasSuffix("..."))
        XCTAssertEqual(subject.count, 53)
    }

    // MARK: - Helpers

    private func createMockAPIClient() -> APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]

        let apiConfig = APIClientConfiguration(baseURL: URL(string: "http://test.local/api")!)
        return APIClient(configuration: apiConfig, urlSessionConfiguration: config)
    }

    private func createTestMessage(
        id: String,
        agentId: String,
        role: MessageRole,
        recipient: String? = nil,
        body: String = "Test message",
        date: Date = Date()
    ) -> PersistentMessage {
        let now = ISO8601DateFormatter().string(from: date)
        return PersistentMessage(
            id: id,
            agentId: agentId,
            recipient: recipient,
            role: role,
            body: body,
            deliveryStatus: .delivered,
            createdAt: now,
            updatedAt: now
        )
    }

    private func mockMessagesResponse(
        messages: [PersistentMessage],
        hasMore: Bool = false
    ) -> MockURLProtocol.MockHandler {
        { request in
            let items: [[String: Any]] = try messages.map { msg in
                let data = try JSONEncoder().encode(msg)
                return try JSONSerialization.jsonObject(with: data) as! [String: Any]
            }
            let envelope: [String: Any] = [
                "success": true,
                "data": [
                    "items": items,
                    "total": messages.count,
                    "hasMore": hasMore
                ],
                "timestamp": ISO8601DateFormatter().string(from: Date())
            ]
            let data = try JSONSerialization.data(withJSONObject: envelope)
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, data)
        }
    }
}

// MARK: - Speech Integration Tests

@MainActor
final class ChatViewModelSpeechTests: XCTestCase {
    private var viewModel: ChatViewModel!
    private var mockAPIClient: APIClient!
    private var mockSpeechService: MockSpeechRecognitionService!
    private var cancellables: Set<AnyCancellable>!

    override func setUp() async throws {
        cancellables = Set<AnyCancellable>()
        mockAPIClient = createMockAPIClient()
        mockSpeechService = MockSpeechRecognitionService()
        viewModel = ChatViewModel(apiClient: mockAPIClient, speechService: mockSpeechService)
    }

    override func tearDown() async throws {
        viewModel = nil
        mockAPIClient = nil
        mockSpeechService = nil
        cancellables = nil
        MockURLProtocol.mockHandler = nil
    }

    // MARK: - Initial State Tests

    func testInitialSpeechState() {
        XCTAssertFalse(viewModel.isRecordingVoice)
        XCTAssertNil(viewModel.speechError)
    }

    // MARK: - Voice Toggle Tests

    func testToggleVoiceRecordingStartsRecording() {
        mockSpeechService.authorizationStatus = .authorized

        viewModel.toggleVoiceRecording()

        XCTAssertTrue(mockSpeechService.startRecordingCalled)
    }

    func testToggleVoiceRecordingStopsWhenAlreadyRecording() {
        mockSpeechService.authorizationStatus = .authorized
        mockSpeechService.state = .recording

        viewModel.toggleVoiceRecording()

        XCTAssertTrue(mockSpeechService.stopRecordingCalled)
    }

    func testToggleVoiceRecordingRequestsAuthorizationIfNeeded() async {
        mockSpeechService.authorizationStatus = .notDetermined
        mockSpeechService.authorizationToReturn = .authorized

        viewModel.toggleVoiceRecording()

        try? await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertTrue(mockSpeechService.requestAuthorizationCalled)
        XCTAssertTrue(mockSpeechService.startRecordingCalled)
    }

    func testToggleVoiceRecordingSetsErrorWhenAuthorizationDenied() async {
        mockSpeechService.authorizationStatus = .notDetermined
        mockSpeechService.authorizationToReturn = .denied

        viewModel.toggleVoiceRecording()

        try? await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertNotNil(viewModel.speechError)
    }

    func testToggleVoiceRecordingSetsErrorWhenServiceThrows() {
        mockSpeechService.authorizationStatus = .authorized
        mockSpeechService.shouldThrowOnStartRecording = true

        viewModel.toggleVoiceRecording()

        XCTAssertNotNil(viewModel.speechError)
    }

    // MARK: - Transcription Binding Tests

    func testTranscriptionUpdatesInputText() async {
        mockSpeechService.authorizationStatus = .authorized

        viewModel.toggleVoiceRecording()
        mockSpeechService.simulateTranscription("Hello world")

        try? await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertEqual(viewModel.inputText, "Hello world")
    }

    // MARK: - Recording State Binding Tests

    func testRecordingStateBindsToIsRecordingVoice() {
        let expectation = XCTestExpectation(description: "isRecordingVoice updated")

        viewModel.$isRecordingVoice
            .dropFirst()
            .sink { isRecording in
                if isRecording {
                    expectation.fulfill()
                }
            }
            .store(in: &cancellables)

        mockSpeechService.state = .recording

        wait(for: [expectation], timeout: 1.0)
        XCTAssertTrue(viewModel.isRecordingVoice)
    }

    // MARK: - Error Handling Tests

    func testSpeechErrorBindsFromState() {
        let expectation = XCTestExpectation(description: "speechError updated")

        viewModel.$speechError
            .dropFirst()
            .sink { error in
                if error != nil {
                    expectation.fulfill()
                }
            }
            .store(in: &cancellables)

        mockSpeechService.simulateError("Test error")

        wait(for: [expectation], timeout: 1.0)
        XCTAssertEqual(viewModel.speechError, "Test error")
    }

    func testClearSpeechError() {
        viewModel.toggleVoiceRecording()
        mockSpeechService.shouldThrowOnStartRecording = true

        mockSpeechService.simulateError("Test error")

        viewModel.clearSpeechError()

        XCTAssertNil(viewModel.speechError)
    }

    // MARK: - No Speech Service Tests

    func testToggleVoiceRecordingWithNoServiceSetsError() {
        let viewModelNoSpeech = ChatViewModel(apiClient: mockAPIClient, speechService: nil)

        viewModelNoSpeech.toggleVoiceRecording()

        XCTAssertNotNil(viewModelNoSpeech.speechError)
        XCTAssertEqual(viewModelNoSpeech.speechError, "Speech recognition not available")
    }

    // MARK: - Helpers

    private func createMockAPIClient() -> APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]

        let apiConfig = APIClientConfiguration(baseURL: URL(string: "http://test.local/api")!)
        return APIClient(configuration: apiConfig, urlSessionConfiguration: config)
    }
}

// MARK: - WebSocket Service Tests

@MainActor
final class ChatWebSocketServiceTests: XCTestCase {
    private var service: ChatWebSocketService!
    private var cancellables: Set<AnyCancellable>!

    override func setUp() async throws {
        cancellables = Set<AnyCancellable>()
        service = ChatWebSocketService()
    }

    override func tearDown() async throws {
        service.disconnect()
        service = nil
        cancellables = nil
    }

    func testInitialState() {
        XCTAssertEqual(service.connectionState, .disconnected)
        XCTAssertFalse(service.isRemoteTyping)
        XCTAssertNil(service.activeStream)
        XCTAssertFalse(service.isConnected)
    }

    func testDisconnectClearsState() {
        service.disconnect()
        XCTAssertEqual(service.connectionState, .disconnected)
        XCTAssertFalse(service.isRemoteTyping)
        XCTAssertNil(service.activeStream)
    }
}

// MARK: - WebSocket Client Tests

final class WebSocketClientTests: XCTestCase {
    func testClientCreationWithHTTPURL() {
        let client = WebSocketClient(
            baseURL: URL(string: "http://localhost:4201/api")!,
            apiKey: nil
        )
        XCTAssertNotNil(client)
    }

    func testClientCreationWithHTTPSURL() {
        let client = WebSocketClient(
            baseURL: URL(string: "https://example.com/api")!,
            apiKey: "test-key"
        )
        XCTAssertNotNil(client)
    }

    func testInitialConnectionStateIsDisconnected() {
        let client = WebSocketClient(baseURL: URL(string: "http://localhost:4201/api")!)
        XCTAssertEqual(client.connectionStateSubject.value, .disconnected)
    }

    func testDisconnectSetsStateToDisconnected() {
        let client = WebSocketClient(baseURL: URL(string: "http://localhost:4201/api")!)
        client.disconnect()
        XCTAssertEqual(client.connectionStateSubject.value, .disconnected)
    }
}

// MARK: - WsServerMessage Decoding Tests

final class WsServerMessageDecodingTests: XCTestCase {
    private let decoder = JSONDecoder()

    func testDecodeAuthChallenge() throws {
        let json = "{\"type\":\"auth_challenge\"}".data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)
        XCTAssertEqual(msg.type, "auth_challenge")
    }

    func testDecodeConnected() throws {
        let json = "{\"type\":\"connected\",\"sessionId\":\"abc-123\",\"lastSeq\":42,\"serverTime\":\"2026-02-14T00:00:00Z\"}".data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)
        XCTAssertEqual(msg.type, "connected")
        XCTAssertEqual(msg.sessionId, "abc-123")
        XCTAssertEqual(msg.lastSeq, 42)
    }

    func testDecodeChatMessage() throws {
        let json = "{\"type\":\"message\",\"id\":\"msg-1\",\"seq\":5,\"from\":\"mayor/\",\"to\":\"user\",\"body\":\"Hello\",\"timestamp\":\"2026-02-14T00:00:00Z\"}".data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)
        XCTAssertEqual(msg.type, "message")
        XCTAssertEqual(msg.id, "msg-1")
        XCTAssertEqual(msg.seq, 5)
        XCTAssertEqual(msg.from, "mayor/")
        XCTAssertEqual(msg.body, "Hello")
    }

    func testDecodeChatMessageEvent() throws {
        let json = "{\"type\":\"chat_message\",\"id\":\"msg-2\",\"from\":\"coder\",\"to\":\"user\",\"body\":\"Build complete\",\"timestamp\":\"2026-02-21T00:00:00Z\"}".data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)
        XCTAssertEqual(msg.type, "chat_message")
        XCTAssertEqual(msg.id, "msg-2")
        XCTAssertEqual(msg.from, "coder")
        XCTAssertEqual(msg.body, "Build complete")
    }

    func testDecodeDelivered() throws {
        let json = "{\"type\":\"delivered\",\"messageId\":\"server-id\",\"clientId\":\"client-id\",\"timestamp\":\"2026-02-14T00:00:00Z\"}".data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)
        XCTAssertEqual(msg.type, "delivered")
        XCTAssertEqual(msg.messageId, "server-id")
        XCTAssertEqual(msg.clientId, "client-id")
    }

    func testDecodeTypingIndicator() throws {
        let json = "{\"type\":\"typing\",\"from\":\"mayor/\",\"state\":\"started\"}".data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)
        XCTAssertEqual(msg.type, "typing")
        XCTAssertEqual(msg.from, "mayor/")
        XCTAssertEqual(msg.state, "started")
    }

    func testDecodeStreamToken() throws {
        let json = "{\"type\":\"stream_token\",\"streamId\":\"stream-1\",\"token\":\"Hello \",\"from\":\"mayor/\"}".data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)
        XCTAssertEqual(msg.type, "stream_token")
        XCTAssertEqual(msg.streamId, "stream-1")
        XCTAssertEqual(msg.token, "Hello ")
    }

    func testDecodeStreamEnd() throws {
        let json = "{\"type\":\"stream_end\",\"streamId\":\"stream-1\",\"messageId\":\"msg-final\"}".data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)
        XCTAssertEqual(msg.type, "stream_end")
        XCTAssertEqual(msg.streamId, "stream-1")
        XCTAssertEqual(msg.messageId, "msg-final")
    }

    func testDecodeError() throws {
        let json = "{\"type\":\"error\",\"code\":\"rate_limited\",\"message\":\"Too many messages\"}".data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)
        XCTAssertEqual(msg.type, "error")
        XCTAssertEqual(msg.code, "rate_limited")
        XCTAssertEqual(msg.message, "Too many messages")
    }

    func testDecodeSyncResponse() throws {
        let json = "{\"type\":\"sync_response\",\"missed\":[{\"type\":\"message\",\"id\":\"m1\",\"seq\":1,\"body\":\"hi\"}]}".data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)
        XCTAssertEqual(msg.type, "sync_response")
        XCTAssertEqual(msg.missed?.count, 1)
        XCTAssertEqual(msg.missed?.first?.body, "hi")
    }

    func testDecodeMinimalMessage() throws {
        let json = "{\"type\":\"pong\"}".data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)
        XCTAssertEqual(msg.type, "pong")
        XCTAssertNil(msg.id)
        XCTAssertNil(msg.seq)
    }
}

// MARK: - WsClientMessage Encoding Tests

final class WsClientMessageEncodingTests: XCTestCase {
    private let encoder = JSONEncoder()

    func testEncodeAuthResponse() throws {
        let msg = WsClientMessage(type: "auth_response", apiKey: "test-key")
        let data = try encoder.encode(msg)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(json["type"] as? String, "auth_response")
        XCTAssertEqual(json["apiKey"] as? String, "test-key")
    }

    func testEncodeChatMessage() throws {
        let msg = WsClientMessage(type: "message", id: "client-1", to: "mayor/", body: "Hello")
        let data = try encoder.encode(msg)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(json["type"] as? String, "message")
        XCTAssertEqual(json["id"] as? String, "client-1")
        XCTAssertEqual(json["to"] as? String, "mayor/")
        XCTAssertEqual(json["body"] as? String, "Hello")
    }

    func testEncodeTyping() throws {
        let msg = WsClientMessage(type: "typing", state: "started")
        let data = try encoder.encode(msg)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(json["type"] as? String, "typing")
        XCTAssertEqual(json["state"] as? String, "started")
    }

    func testEncodeSync() throws {
        let msg = WsClientMessage(type: "sync", lastSeqSeen: 42)
        let data = try encoder.encode(msg)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(json["type"] as? String, "sync")
        XCTAssertEqual(json["lastSeqSeen"] as? Int, 42)
    }

    func testEncodeAck() throws {
        let msg = WsClientMessage(type: "ack", seq: 10)
        let data = try encoder.encode(msg)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(json["type"] as? String, "ack")
        XCTAssertEqual(json["seq"] as? Int, 10)
    }
}

// MARK: - StreamingResponse Tests

@MainActor
final class StreamingResponseTests: XCTestCase {
    func testAssembledText() {
        var stream = StreamingResponse(streamId: "s1", from: "mayor/")
        stream.tokens = ["Hello", " ", "world"]
        XCTAssertEqual(stream.assembledText, "Hello world")
    }

    func testEmptyStream() {
        let stream = StreamingResponse(streamId: "s1", from: "mayor/")
        XCTAssertEqual(stream.assembledText, "")
        XCTAssertFalse(stream.isComplete)
        XCTAssertNil(stream.messageId)
    }

    func testStreamCompletion() {
        var stream = StreamingResponse(streamId: "s1", from: "mayor/")
        stream.tokens = ["Done"]
        stream.isComplete = true
        stream.messageId = "msg-final"
        XCTAssertTrue(stream.isComplete)
        XCTAssertEqual(stream.messageId, "msg-final")
        XCTAssertEqual(stream.assembledText, "Done")
    }
}
