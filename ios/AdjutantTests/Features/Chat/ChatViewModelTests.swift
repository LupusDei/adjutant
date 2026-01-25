import XCTest
import Combine
import AdjutantKit
@testable import Adjutant

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
        XCTAssertFalse(viewModel.isTyping)
        XCTAssertFalse(viewModel.isRecordingVoice)
        XCTAssertTrue(viewModel.hasMoreHistory)
        XCTAssertFalse(viewModel.isLoadingHistory)
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

    func testRefreshFiltersOnlyMayorMessages() async {
        let testMessages = [
            createTestMessage(id: "test-1", from: "mayor/", to: "user"),
            createTestMessage(id: "test-2", from: "other/", to: "user"), // Should be filtered out
            createTestMessage(id: "test-3", from: "user", to: "mayor/")
        ]

        MockURLProtocol.mockHandler = mockMailResponse(messages: testMessages)

        await viewModel.refresh()

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

    // MARK: - Outgoing Message Detection Tests

    func testIsOutgoingForMessageToMayor() {
        let outgoingMessage = createTestMessage(id: "test", from: "user", to: "mayor/")
        XCTAssertTrue(viewModel.isOutgoing(outgoingMessage))
    }

    func testIsOutgoingFalseForMessageFromMayor() {
        let incomingMessage = createTestMessage(id: "test", from: "mayor/", to: "user")
        XCTAssertFalse(viewModel.isOutgoing(incomingMessage))
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
