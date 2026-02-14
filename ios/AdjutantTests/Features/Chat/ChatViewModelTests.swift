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
            createTestMessage(id: "test-1", from: "mayor/", to: "user")
        ]
        MockURLProtocol.mockHandler = mockMailResponse(messages: testMessages)

        await viewModel.refresh()

        XCTAssertEqual(viewModel.connectionState, .connected)
        XCTAssertNotNil(viewModel.lastPollTime)
    }

    func testServerURLReturnsHost() {
        // serverURL should return a host string
        let url = viewModel.serverURL
        XCTAssertFalse(url.isEmpty)
    }

    // MARK: - Message Loading Tests

    func testRefreshLoadsMessages() async {
        let testMessages = [
            createTestMessage(id: "test-1", from: "mayor/", to: "user"),
            createTestMessage(id: "test-2", from: "user", to: "mayor/")
        ]

        MockURLProtocol.mockHandler = mockMailResponse(messages: testMessages)

        await viewModel.refresh()

        XCTAssertEqual(viewModel.messages.count, 2)
        XCTAssertFalse(viewModel.isLoading)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testRefreshFiltersOnlySelectedRecipientMessages() async {
        let testMessages = [
            createTestMessage(id: "test-1", from: "mayor/", to: "user"),
            createTestMessage(id: "test-2", from: "other/", to: "user"), // Should be filtered out
            createTestMessage(id: "test-3", from: "user", to: "mayor/")
        ]

        MockURLProtocol.mockHandler = mockMailResponse(messages: testMessages)

        await viewModel.refresh()

        // Default recipient is "mayor/", so should filter to mayor messages
        XCTAssertEqual(viewModel.messages.count, 2)
        XCTAssertTrue(viewModel.messages.allSatisfy { $0.from == "mayor/" || $0.to == "mayor/" })
    }

    func testMessagesSortedOldestFirst() async {
        let now = Date()
        let testMessages = [
            createTestMessage(id: "test-new", from: "mayor/", to: "user", date: now),
            createTestMessage(id: "test-old", from: "mayor/", to: "user", date: now.addingTimeInterval(-3600))
        ]

        MockURLProtocol.mockHandler = mockMailResponse(messages: testMessages)

        await viewModel.refresh()

        XCTAssertEqual(viewModel.messages.first?.id, "test-old")
        XCTAssertEqual(viewModel.messages.last?.id, "test-new")
    }

    // MARK: - Send Message Tests

    func testSendMessageClearsInputImmediately() async {
        viewModel.inputText = "Hello Mayor"
        MockURLProtocol.mockHandler = mockSendMailSuccess()

        // Start sending but don't wait
        let task = Task {
            await viewModel.sendMessage()
        }

        // Input should be cleared immediately
        try? await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(viewModel.inputText, "")

        await task.value
    }

    func testSendMessageWithEmptyInputDoesNothing() async {
        viewModel.inputText = "   "

        var requestMade = false
        MockURLProtocol.mockHandler = { _ in
            requestMade = true
            return mockSendMailSuccess()
        }()

        await viewModel.sendMessage()

        XCTAssertFalse(requestMade)
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

    // MARK: - Subject Generation Tests

    func testSendMessageGeneratesSubjectFromBody() async {
        viewModel.inputText = "Hello Mayor, how are you today?"

        var capturedSubject: String?
        MockURLProtocol.mockHandler = { request in
            if let body = request.httpBody,
               let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any] {
                capturedSubject = json["subject"] as? String
            }
            return self.mockSendMailSuccess()
        }()

        await viewModel.sendMessage()

        XCTAssertEqual(capturedSubject, "Hello Mayor, how are you today?")
    }

    func testSendMessageTruncatesLongSubject() async {
        viewModel.inputText = "This is a very long message that should be truncated at the word boundary to form a subject line"

        var capturedSubject: String?
        MockURLProtocol.mockHandler = { request in
            if let body = request.httpBody,
               let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any] {
                capturedSubject = json["subject"] as? String
            }
            return self.mockSendMailSuccess()
        }()

        await viewModel.sendMessage()

        // Should be truncated at word boundary before 50 chars, with "..."
        XCTAssertNotNil(capturedSubject)
        XCTAssertTrue(capturedSubject!.hasSuffix("..."))
        XCTAssertLessThanOrEqual(capturedSubject!.count, 53) // 50 + "..."
    }

    // MARK: - Outgoing Message Detection Tests

    func testIsOutgoingForMessageToSelectedRecipient() {
        // Default recipient is "mayor/"
        let outgoingMessage = createTestMessage(id: "test", from: "user", to: "mayor/")
        XCTAssertTrue(viewModel.isOutgoing(outgoingMessage))
    }

    func testIsOutgoingFalseForMessageFromSelectedRecipient() {
        // Default recipient is "mayor/"
        let incomingMessage = createTestMessage(id: "test", from: "mayor/", to: "user")
        XCTAssertFalse(viewModel.isOutgoing(incomingMessage))
    }

    // MARK: - Recipient Display Name Tests

    func testRecipientDisplayNameForMayor() {
        // Default recipient is "mayor/"
        XCTAssertEqual(viewModel.recipientDisplayName, "MAYOR")
    }

    // MARK: - Load More History Tests

    func testLoadMoreHistorySetsLoadingState() async {
        MockURLProtocol.mockHandler = mockMailResponse(messages: [])

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

    func testLoadMoreHistorySetsHasMoreHistoryFalseWhenNoMoreMessages() async {
        // First load some messages
        let messages = [createTestMessage(id: "test-1", from: "mayor/", to: "user")]
        MockURLProtocol.mockHandler = mockMailResponse(messages: messages)
        await viewModel.refresh()

        // Now load all - should return same count
        MockURLProtocol.mockHandler = mockMailResponse(messages: messages, all: true)
        await viewModel.loadMoreHistory()

        XCTAssertFalse(viewModel.hasMoreHistory)
    }

    // MARK: - Voice Transcription Tests

    func testSendVoiceTranscriptionSetsInputAndSends() async {
        MockURLProtocol.mockHandler = mockSendMailSuccess()

        await viewModel.sendVoiceTranscription("Voice message text")

        // Input should be cleared after sending
        XCTAssertEqual(viewModel.inputText, "")
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

    // MARK: - Helpers

    private func createMockAPIClient() -> APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: config)

        let apiConfig = APIClientConfiguration(baseURL: URL(string: "http://test.local")!)
        return APIClient(configuration: apiConfig, session: session)
    }

    private func createTestMessage(
        id: String,
        from: String,
        to: String,
        body: String = "Test message",
        date: Date = Date()
    ) -> Message {
        Message(
            id: id,
            from: from,
            to: to,
            subject: "",
            body: body,
            timestamp: ISO8601DateFormatter().string(from: date),
            read: true,
            priority: .normal,
            type: .notification,
            threadId: "thread-\(id)",
            replyTo: nil,
            pinned: false,
            cc: nil,
            isInfrastructure: false
        )
    }

    private func mockMailResponse(messages: [Message], all: Bool = false) -> MockURLProtocol.MockHandler {
        { request in
            let paginatedResponse = PaginatedResponse(
                data: messages,
                total: messages.count,
                page: 1,
                limit: 50
            )
            let envelope: [String: Any] = [
                "success": true,
                "data": [
                    "data": try messages.map { msg in
                        try JSONSerialization.jsonObject(with: JSONEncoder().encode(msg))
                    },
                    "total": messages.count,
                    "page": 1,
                    "limit": 50
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

    private func mockSendMailSuccess() -> MockURLProtocol.MockHandler {
        { request in
            let envelope: [String: Any] = [
                "success": true,
                "data": [
                    "success": true,
                    "message": "Message sent"
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

        // Give async authorization time to complete
        try? await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertTrue(mockSpeechService.requestAuthorizationCalled)
        XCTAssertTrue(mockSpeechService.startRecordingCalled)
    }

    func testToggleVoiceRecordingSetsErrorWhenAuthorizationDenied() async {
        mockSpeechService.authorizationStatus = .notDetermined
        mockSpeechService.authorizationToReturn = .denied

        viewModel.toggleVoiceRecording()

        // Give async authorization time to complete
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

        // Start recording
        viewModel.toggleVoiceRecording()

        // Simulate transcription
        mockSpeechService.simulateTranscription("Hello world")

        // Give binding time to propagate
        try? await Task.sleep(nanoseconds: 100_000_000)

        // Note: The input text binding only updates while recording
        // Since mockSpeechService.state is set to .recording in startRecording(),
        // and we're using the mock, the state is .recording
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

        // This would have set an error if the service threw, but since we set the flag after toggle,
        // let's manually set the error state
        mockSpeechService.simulateError("Test error")

        // Now clear it
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
        let session = URLSession(configuration: config)

        let apiConfig = APIClientConfiguration(baseURL: URL(string: "http://test.local")!)
        return APIClient(configuration: apiConfig, session: session)
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

// MARK: - Subject Generation Tests

@MainActor
final class SubjectGenerationTests: XCTestCase {
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
        XCTAssertLessThanOrEqual(subject.count, 53) // 50 + "..."
    }

    func testLongMessageNoSpacesTruncatesAtCharLimit() {
        let text = String(repeating: "x", count: 60)
        let subject = ChatViewModel.generateSubject(from: text)
        XCTAssertTrue(subject.hasSuffix("..."))
        XCTAssertEqual(subject.count, 53) // 50 chars + "..."
    }
}
