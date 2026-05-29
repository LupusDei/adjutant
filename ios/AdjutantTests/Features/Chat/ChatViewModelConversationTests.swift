import XCTest
import Combine
import AdjutantKit
@testable import AdjutantUI

/// Conversation-scoping + bleed regression tests for ChatViewModel (adj-164.3.2 / T011).
///
/// The root-cause bug being guarded: messages were reconstructed by matching
/// `agentId == recipient || recipient == recipient`, which leaks across what the
/// user perceives as separate conversations ("wrong-thread bleed"). The fix
/// scopes by the stable, deterministic DM `conversationId` (mirrors the backend
/// `dmConversationId` derivation) while gracefully falling back to agent matching
/// for messages that predate conversation ids.
@MainActor
final class ChatViewModelConversationTests: XCTestCase {
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

    // MARK: - Deterministic DM conversation id

    func testDmConversationIdMatchesBackendDerivation() {
        // Order-independent: (user, raynor) and (raynor, user) collapse to one id.
        let a = ChatViewModel.dmConversationId(memberA: "user", memberB: "raynor")
        let b = ChatViewModel.dmConversationId(memberA: "raynor", memberB: "user")
        XCTAssertEqual(a, b)
        XCTAssertTrue(a.hasPrefix("dm_"))
        // Distinct pairs map to distinct conversations.
        let c = ChatViewModel.dmConversationId(memberA: "user", memberB: "kerrigan")
        XCTAssertNotEqual(a, c)
    }

    func testCurrentConversationIdTracksSelectedRecipient() async {
        MockURLProtocol.mockHandler = mockMessagesResponse(messages: [])
        await viewModel.setRecipient("raynor")
        XCTAssertEqual(
            viewModel.currentConversationId,
            ChatViewModel.dmConversationId(memberA: "user", memberB: "raynor")
        )
    }

    // MARK: - Incoming WS scoping by conversationId

    func testIncomingMessageWithMatchingConversationIdIsAccepted() async {
        let wsService = ChatWebSocketService()
        let vm = ChatViewModel(apiClient: mockAPIClient, wsService: wsService)

        MockURLProtocol.mockHandler = mockMessagesResponse(messages: [])
        await vm.setRecipient("raynor")
        let convId = ChatViewModel.dmConversationId(memberA: "user", memberB: "raynor")

        let now = ISO8601DateFormatter().string(from: Date())
        let msg = PersistentMessage(
            id: "ws-1",
            agentId: "raynor",
            recipient: "user",
            role: .agent,
            body: "scoped hello",
            deliveryStatus: .delivered,
            conversationId: convId,
            createdAt: now,
            updatedAt: now
        )
        wsService.incomingMessage.send(msg)
        try? await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertTrue(vm.messages.contains(where: { $0.id == "ws-1" }))
    }

    func testIncomingMessageWithOtherConversationIdIsRejected_BleedRegression() async {
        let wsService = ChatWebSocketService()
        let vm = ChatViewModel(apiClient: mockAPIClient, wsService: wsService)

        MockURLProtocol.mockHandler = mockMessagesResponse(messages: [])
        await vm.setRecipient("raynor")

        // A message stamped for the *kerrigan* DM must never appear in raynor's DM,
        // even though its agentId/recipient might otherwise loosely match.
        let otherConvId = ChatViewModel.dmConversationId(memberA: "user", memberB: "kerrigan")
        let now = ISO8601DateFormatter().string(from: Date())
        let msg = PersistentMessage(
            id: "ws-bleed",
            agentId: "kerrigan",
            recipient: "user",
            role: .agent,
            body: "should not bleed",
            deliveryStatus: .delivered,
            conversationId: otherConvId,
            createdAt: now,
            updatedAt: now
        )
        wsService.incomingMessage.send(msg)
        try? await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertFalse(vm.messages.contains(where: { $0.id == "ws-bleed" }))
    }

    func testIncomingMessageWithoutConversationIdFallsBackToAgentMatch() async {
        // Legacy messages (no conversationId) must still route by agent so the
        // client keeps working before the backend stamps conversation ids.
        let wsService = ChatWebSocketService()
        let vm = ChatViewModel(apiClient: mockAPIClient, wsService: wsService)

        MockURLProtocol.mockHandler = mockMessagesResponse(messages: [])
        await vm.setRecipient("raynor")

        let now = ISO8601DateFormatter().string(from: Date())
        let msg = PersistentMessage(
            id: "ws-legacy",
            agentId: "raynor",
            recipient: "user",
            role: .agent,
            body: "legacy",
            deliveryStatus: .delivered,
            conversationId: nil,
            createdAt: now,
            updatedAt: now
        )
        wsService.incomingMessage.send(msg)
        try? await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertTrue(vm.messages.contains(where: { $0.id == "ws-legacy" }))
    }

    // MARK: - Refresh dedup/merge scoped by conversation

    func testRefreshDropsForeignConversationMessages_BleedRegression() async {
        await viewModel.setRecipient("raynor")
        let mine = ChatViewModel.dmConversationId(memberA: "user", memberB: "raynor")
        let theirs = ChatViewModel.dmConversationId(memberA: "user", memberB: "kerrigan")

        let now = Date()
        let messages = [
            makeMessage(id: "mine-1", agentId: "raynor", body: "a", conversationId: mine, date: now),
            makeMessage(id: "theirs-1", agentId: "kerrigan", body: "b", conversationId: theirs, date: now),
        ]
        MockURLProtocol.mockHandler = mockMessagesResponse(messages: messages)

        await viewModel.refresh()

        XCTAssertTrue(viewModel.messages.contains(where: { $0.id == "mine-1" }))
        XCTAssertFalse(viewModel.messages.contains(where: { $0.id == "theirs-1" }))
    }

    func testRefreshKeepsNilConversationMessages() async {
        await viewModel.setRecipient("raynor")
        let now = Date()
        let messages = [
            makeMessage(id: "legacy-1", agentId: "raynor", body: "a", conversationId: nil, date: now),
        ]
        MockURLProtocol.mockHandler = mockMessagesResponse(messages: messages)

        await viewModel.refresh()

        XCTAssertTrue(viewModel.messages.contains(where: { $0.id == "legacy-1" }))
    }

    // MARK: - Helpers

    private func makeMessage(
        id: String,
        agentId: String,
        body: String,
        conversationId: String?,
        date: Date
    ) -> PersistentMessage {
        let now = ISO8601DateFormatter().string(from: date)
        return PersistentMessage(
            id: id,
            agentId: agentId,
            recipient: "user",
            role: .agent,
            body: body,
            deliveryStatus: .delivered,
            conversationId: conversationId,
            createdAt: now,
            updatedAt: now
        )
    }

    private func createMockAPIClient() -> APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        let apiConfig = APIClientConfiguration(baseURL: URL(string: "http://test.local/api")!)
        return APIClient(configuration: apiConfig, urlSessionConfiguration: config)
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
                "data": ["items": items, "total": messages.count, "hasMore": hasMore],
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
