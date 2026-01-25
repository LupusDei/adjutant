import XCTest
@testable import Adjutant
@testable import AdjutantKit

@MainActor
final class MailDetailViewModelTests: XCTestCase {

    // MARK: - Properties

    private var sut: MailDetailViewModel!
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

    func testInit_setsMessageId() async {
        // Given
        let messageId = "test-msg-123"

        // When
        sut = MailDetailViewModel(messageId: messageId, apiClient: mockAPIClient)

        // Then
        XCTAssertNil(sut.message)
        XCTAssertTrue(sut.threadMessages.isEmpty)
        XCTAssertFalse(sut.isLoading)
        XCTAssertFalse(sut.isPlayingAudio)
        XCTAssertFalse(sut.isSynthesizing)
    }

    // MARK: - Load Message Tests

    func testLoadMessage_success_setsMessage() async {
        // Given
        let messageId = "test-msg-123"
        let testMessage = createTestMessage(id: messageId)
        mockAPIClient.getMessageResult = .success(testMessage)
        mockAPIClient.markReadResult = .success(SuccessResponse(message: "ok"))
        mockAPIClient.getMailResult = .success(PaginatedResponse(items: [], total: 0, hasMore: false))

        sut = MailDetailViewModel(messageId: messageId, apiClient: mockAPIClient)

        // When
        await sut.loadMessage()

        // Then
        XCTAssertNotNil(sut.message)
        XCTAssertEqual(sut.message?.id, messageId)
        XCTAssertEqual(sut.message?.subject, testMessage.subject)
    }

    func testLoadMessage_failure_setsError() async {
        // Given
        let messageId = "test-msg-123"
        mockAPIClient.getMessageResult = .failure(APIClientError.networkError("Connection failed"))

        sut = MailDetailViewModel(messageId: messageId, apiClient: mockAPIClient)

        // When
        await sut.loadMessage()

        // Then
        XCTAssertNil(sut.message)
        XCTAssertNotNil(sut.errorMessage)
    }

    func testLoadMessage_marksAsRead() async {
        // Given
        let messageId = "test-msg-123"
        let testMessage = createTestMessage(id: messageId)
        mockAPIClient.getMessageResult = .success(testMessage)
        mockAPIClient.markReadResult = .success(SuccessResponse(message: "ok"))
        mockAPIClient.getMailResult = .success(PaginatedResponse(items: [], total: 0, hasMore: false))

        sut = MailDetailViewModel(messageId: messageId, apiClient: mockAPIClient)

        // When
        await sut.loadMessage()

        // Then
        XCTAssertEqual(mockAPIClient.markReadCalledWithId, messageId)
    }

    // MARK: - Thread Tests

    func testLoadMessage_loadsThread() async {
        // Given
        let messageId = "test-msg-123"
        let threadId = "thread-456"
        let testMessage = createTestMessage(id: messageId, threadId: threadId)
        let threadMessage1 = createTestMessage(id: "thread-msg-1", threadId: threadId)
        let threadMessage2 = createTestMessage(id: "thread-msg-2", threadId: threadId)

        mockAPIClient.getMessageResult = .success(testMessage)
        mockAPIClient.markReadResult = .success(SuccessResponse(message: "ok"))
        mockAPIClient.getMailResult = .success(PaginatedResponse(
            items: [threadMessage1, testMessage, threadMessage2],
            total: 3,
            hasMore: false
        ))

        sut = MailDetailViewModel(messageId: messageId, apiClient: mockAPIClient)

        // When
        await sut.loadMessage()

        // Then
        // Thread should contain 2 messages (excluding the current one)
        XCTAssertEqual(sut.threadMessages.count, 2)
        XCTAssertFalse(sut.threadMessages.contains { $0.id == messageId })
    }

    func testHasThread_withThreadMessages_returnsTrue() async {
        // Given
        let messageId = "test-msg-123"
        let threadId = "thread-456"
        let testMessage = createTestMessage(id: messageId, threadId: threadId)
        let threadMessage = createTestMessage(id: "thread-msg-1", threadId: threadId)

        mockAPIClient.getMessageResult = .success(testMessage)
        mockAPIClient.markReadResult = .success(SuccessResponse(message: "ok"))
        mockAPIClient.getMailResult = .success(PaginatedResponse(
            items: [threadMessage, testMessage],
            total: 2,
            hasMore: false
        ))

        sut = MailDetailViewModel(messageId: messageId, apiClient: mockAPIClient)
        await sut.loadMessage()

        // Then
        XCTAssertTrue(sut.hasThread)
    }

    func testHasThread_withoutThreadMessages_returnsFalse() async {
        // Given
        let messageId = "test-msg-123"
        let testMessage = createTestMessage(id: messageId)

        mockAPIClient.getMessageResult = .success(testMessage)
        mockAPIClient.markReadResult = .success(SuccessResponse(message: "ok"))
        mockAPIClient.getMailResult = .success(PaginatedResponse(items: [testMessage], total: 1, hasMore: false))

        sut = MailDetailViewModel(messageId: messageId, apiClient: mockAPIClient)
        await sut.loadMessage()

        // Then
        XCTAssertFalse(sut.hasThread)
    }

    // MARK: - Formatted Properties Tests

    func testFormattedDate_withMessage_returnsFormattedString() async {
        // Given
        let messageId = "test-msg-123"
        let testMessage = createTestMessage(id: messageId)
        mockAPIClient.getMessageResult = .success(testMessage)
        mockAPIClient.markReadResult = .success(SuccessResponse(message: "ok"))
        mockAPIClient.getMailResult = .success(PaginatedResponse(items: [], total: 0, hasMore: false))

        sut = MailDetailViewModel(messageId: messageId, apiClient: mockAPIClient)
        await sut.loadMessage()

        // Then
        XCTAssertFalse(sut.formattedDate.isEmpty)
    }

    func testFormattedDate_withoutMessage_returnsEmpty() async {
        // Given
        sut = MailDetailViewModel(messageId: "test", apiClient: mockAPIClient)

        // Then
        XCTAssertTrue(sut.formattedDate.isEmpty)
    }

    func testPriorityText_returnsCorrectText() async {
        // Given
        let testCases: [(MessagePriority, String)] = [
            (.urgent, "P0 URGENT"),
            (.high, "P1 HIGH"),
            (.normal, "P2"),
            (.low, "P3"),
            (.lowest, "P4")
        ]

        for (priority, expected) in testCases {
            let messageId = "test-msg-\(priority.rawValue)"
            let testMessage = createTestMessage(id: messageId, priority: priority)
            mockAPIClient.getMessageResult = .success(testMessage)
            mockAPIClient.markReadResult = .success(SuccessResponse(message: "ok"))
            mockAPIClient.getMailResult = .success(PaginatedResponse(items: [], total: 0, hasMore: false))

            sut = MailDetailViewModel(messageId: messageId, apiClient: mockAPIClient)
            await sut.loadMessage()

            // Then
            XCTAssertEqual(sut.priorityText, expected, "Failed for priority \(priority)")
        }
    }

    // MARK: - Audio Tests

    func testStopAudio_resetsPlayingState() async {
        // Given
        sut = MailDetailViewModel(messageId: "test", apiClient: mockAPIClient)

        // When
        sut.stopAudio()

        // Then
        XCTAssertFalse(sut.isPlayingAudio)
    }

    // MARK: - Helper Methods

    private func createTestMessage(
        id: String = "test-id",
        threadId: String = "thread-id",
        priority: MessagePriority = .normal
    ) -> Message {
        Message(
            id: id,
            from: "mayor/",
            to: "user/",
            subject: "Test Subject",
            body: "Test body content",
            timestamp: ISO8601DateFormatter().string(from: Date()),
            read: false,
            priority: priority,
            type: .task,
            threadId: threadId,
            replyTo: nil,
            pinned: false,
            cc: nil,
            isInfrastructure: false
        )
    }
}

// MARK: - Mock API Client

private class MockAPIClient: APIClient {
    var getMessageResult: Result<Message, Error>?
    var markReadResult: Result<SuccessResponse, Error>?
    var getMailResult: Result<PaginatedResponse<Message>, Error>?

    var markReadCalledWithId: String?

    override func getMessage(id: String) async throws -> Message {
        guard let result = getMessageResult else {
            throw APIClientError.networkError("Not configured")
        }
        return try result.get()
    }

    override func markMessageAsRead(id: String) async throws -> SuccessResponse {
        markReadCalledWithId = id
        guard let result = markReadResult else {
            throw APIClientError.networkError("Not configured")
        }
        return try result.get()
    }

    override func getMail(filter: MailFilter? = nil, all: Bool = false) async throws -> PaginatedResponse<Message> {
        guard let result = getMailResult else {
            throw APIClientError.networkError("Not configured")
        }
        return try result.get()
    }
}
