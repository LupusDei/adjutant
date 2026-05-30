import XCTest
import Combine
import AdjutantKit
@testable import AdjutantUI

/// State-transition tests for ChannelViewModel (adj-164.6.2 / T025).
///
/// The ViewModel owns the channel-list surface: the set of channels, which one
/// is selected, per-channel unread counts, and membership. These tests assert
/// the three required transitions per the testing rule — initial state, a state
/// change after an action, and an error state after a failed API call — using
/// the merged channels REST contract (Constitution Rule 1).
@MainActor
final class ChannelViewModelTests: XCTestCase {
    private var viewModel: ChannelViewModel!
    private var mockAPIClient: APIClient!

    override func setUp() async throws {
        mockAPIClient = createMockAPIClient()
        viewModel = ChannelViewModel(apiClient: mockAPIClient)
    }

    override func tearDown() async throws {
        viewModel = nil
        mockAPIClient = nil
        MockURLProtocol.mockHandler = nil
    }

    // MARK: - Initial state

    func testInitialState() {
        XCTAssertTrue(viewModel.channels.isEmpty)
        XCTAssertNil(viewModel.selectedChannelId)
        XCTAssertTrue(viewModel.unreadCounts.isEmpty)
        XCTAssertNil(viewModel.errorMessage)
        XCTAssertFalse(viewModel.isMember("anything"))
    }

    // MARK: - loadChannels

    func testLoadChannelsPopulatesList() async {
        MockURLProtocol.mockHandler = mockChannelsList([
            channelJSON(id: "chan-ops", title: "ops", memberCount: 3),
            channelJSON(id: "chan-dev", title: "dev", memberCount: 1),
        ])

        await viewModel.loadChannels()

        XCTAssertEqual(viewModel.channels.count, 2)
        XCTAssertEqual(viewModel.channels.first?.title, "ops")
        XCTAssertEqual(viewModel.channels.first?.memberCount, 3)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testLoadChannelsEmpty() async {
        MockURLProtocol.mockHandler = mockChannelsList([])
        await viewModel.loadChannels()
        XCTAssertTrue(viewModel.channels.isEmpty)
    }

    func testLoadChannelsSetsErrorOnFailure() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 500, code: "SERVER_ERROR", message: "boom"
        )
        await viewModel.loadChannels()
        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertTrue(viewModel.channels.isEmpty)
    }

    // MARK: - createChannel

    func testCreateChannelPrependsAndSelects() async {
        MockURLProtocol.mockHandler = { request in
            // The create POST returns a bare Conversation; subsequent list reads
            // are not exercised here — createChannel inserts the returned channel.
            try MockURLProtocol.mockResponse(
                statusCode: 201,
                json: [
                    "success": true,
                    "data": self.channelJSON(id: "chan-new", title: "new-room", memberCount: nil),
                    "timestamp": "2026-05-29T12:00:00.000Z"
                ]
            )(request)
        }

        await viewModel.createChannel(title: "new-room")

        XCTAssertTrue(viewModel.channels.contains(where: { $0.id == "chan-new" }))
        // Creator is a member; selecting the new channel is the natural next step.
        XCTAssertTrue(viewModel.isMember("chan-new"))
        XCTAssertEqual(viewModel.selectedChannelId, "chan-new")
    }

    func testCreateChannelSetsErrorOnFailure() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 400, code: "BAD_REQUEST", message: "title required"
        )
        await viewModel.createChannel(title: "")
        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertTrue(viewModel.channels.isEmpty)
    }

    // MARK: - join / leave membership

    func testJoinChannelMarksMembership() async {
        MockURLProtocol.mockHandler = mockActionAck()
        await viewModel.joinChannel("chan-ops")
        XCTAssertTrue(viewModel.isMember("chan-ops"))
    }

    func testLeaveChannelClearsMembership() async {
        MockURLProtocol.mockHandler = mockActionAck()
        await viewModel.joinChannel("chan-ops")
        XCTAssertTrue(viewModel.isMember("chan-ops"))

        await viewModel.leaveChannel("chan-ops")
        XCTAssertFalse(viewModel.isMember("chan-ops"))
    }

    func testLeaveSelectedChannelClearsSelection() async {
        MockURLProtocol.mockHandler = mockActionAck()
        await viewModel.joinChannel("chan-ops")
        viewModel.selectChannel("chan-ops")
        XCTAssertEqual(viewModel.selectedChannelId, "chan-ops")

        await viewModel.leaveChannel("chan-ops")
        XCTAssertNil(viewModel.selectedChannelId)
    }

    func testJoinChannelSetsErrorOnFailure() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 404, code: "NOT_FOUND", message: "no channel"
        )
        await viewModel.joinChannel("nope")
        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertFalse(viewModel.isMember("nope"))
    }

    // MARK: - selection + unread

    func testSelectChannelUpdatesSelectionAndClearsItsUnread() {
        viewModel.applyUnreadCountsForTesting(["chan-ops": 5, "chan-dev": 2])
        viewModel.selectChannel("chan-ops")
        XCTAssertEqual(viewModel.selectedChannelId, "chan-ops")
        // Opening a channel clears its unread badge.
        XCTAssertEqual(viewModel.unreadCount(for: "chan-ops"), 0)
        // Other channels keep their unread.
        XCTAssertEqual(viewModel.unreadCount(for: "chan-dev"), 2)
    }

    func testUnreadCountDefaultsToZeroForUnknownChannel() {
        XCTAssertEqual(viewModel.unreadCount(for: "ghost"), 0)
    }

    // MARK: - Real-time applyIncoming

    func testApplyIncomingForOpenChannelAppendsMessage() {
        viewModel.selectChannel("chan-ops")
        viewModel.applyIncoming(channelMessage(id: "m1", channelId: "chan-ops"))
        XCTAssertTrue(viewModel.messages.contains(where: { $0.id == "m1" }))
    }

    func testApplyIncomingForOtherChannelBumpsUnreadNotTimeline_BleedRegression() {
        viewModel.selectChannel("chan-ops")
        // A post for a different room must not enter the open timeline.
        viewModel.applyIncoming(channelMessage(id: "m2", channelId: "chan-dev"))
        XCTAssertFalse(viewModel.messages.contains(where: { $0.id == "m2" }))
        XCTAssertEqual(viewModel.unreadCount(for: "chan-dev"), 1)
    }

    func testApplyIncomingIgnoresMessageWithoutConversationId() {
        viewModel.selectChannel("chan-ops")
        let now = ISO8601DateFormatter().string(from: Date())
        let noConv = PersistentMessage(
            id: "m3", agentId: "raynor", recipient: "chan-ops", role: .agent,
            body: "x", deliveryStatus: .delivered, conversationId: nil,
            createdAt: now, updatedAt: now
        )
        viewModel.applyIncoming(noConv)
        XCTAssertFalse(viewModel.messages.contains(where: { $0.id == "m3" }))
    }

    func testApplyIncomingDeduplicatesById() {
        viewModel.selectChannel("chan-ops")
        let msg = channelMessage(id: "dup", channelId: "chan-ops")
        viewModel.applyIncoming(msg)
        viewModel.applyIncoming(msg)
        XCTAssertEqual(viewModel.messages.filter { $0.id == "dup" }.count, 1)
    }

    // MARK: - Members roster (adj-4wrro)

    func testInitialMembersEmpty() {
        XCTAssertTrue(viewModel.members.isEmpty)
    }

    func testLoadMembersPopulatesRoster() async {
        viewModel.selectChannel("chan-ops")
        MockURLProtocol.mockHandler = mockMembersList([
            memberJSON(memberId: "user", kind: "user", role: "owner"),
            memberJSON(memberId: "raynor", kind: "agent", role: "member"),
        ], channelId: "chan-ops")

        await viewModel.loadMembers()

        XCTAssertEqual(viewModel.members.count, 2)
        XCTAssertEqual(viewModel.members.first?.memberId, "user")
        XCTAssertEqual(viewModel.members.first?.memberKind, .user)
        XCTAssertEqual(viewModel.members.last?.memberId, "raynor")
        XCTAssertNil(viewModel.errorMessage)
    }

    func testLoadMembersNoOpWhenNoChannelSelected() async {
        // No open channel → nothing to load, no network call, roster stays empty.
        await viewModel.loadMembers()
        XCTAssertTrue(viewModel.members.isEmpty)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testLoadMembersSetsErrorOnFailure() async {
        viewModel.selectChannel("chan-ops")
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 404, code: "NOT_FOUND", message: "no channel"
        )
        await viewModel.loadMembers()
        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertTrue(viewModel.members.isEmpty)
    }

    func testLoadMembersIgnoresStaleResponseAfterChannelSwitch() async {
        // Guard the same race loadMessages guards: if the user switches channels
        // mid-flight, a late members payload for the old room must not land.
        viewModel.selectChannel("chan-ops")
        MockURLProtocol.mockHandler = { [weak viewModel] request in
            // Simulate the user navigating away before the response returns.
            Task { @MainActor in viewModel?.selectChannel("chan-dev") }
            return try self.mockMembersList([
                self.memberJSON(memberId: "raynor", kind: "agent", role: "member")
            ], channelId: "chan-ops")(request)
        }
        await viewModel.loadMembers()
        // The roster must not show chan-ops members now that chan-dev is open.
        XCTAssertTrue(viewModel.members.isEmpty)
    }

    // MARK: - addMember (adj-4wrro)

    func testAddMemberJoinsAgentAndReloadsRoster() async {
        viewModel.selectChannel("chan-ops")
        // Route both calls addMember makes: the join POST, then the members GET.
        MockURLProtocol.mockHandler = { request in
            let path = request.url?.path ?? ""
            if request.httpMethod == "POST", path.hasSuffix("/join") {
                return try self.mockActionAck()(request)
            }
            return try self.mockMembersList([
                self.memberJSON(memberId: "user", kind: "user", role: "owner"),
                self.memberJSON(memberId: "raynor", kind: "agent", role: "member"),
            ], channelId: "chan-ops")(request)
        }

        await viewModel.addMember(agentId: "raynor")

        XCTAssertTrue(viewModel.members.contains(where: { $0.memberId == "raynor" }))
        XCTAssertNil(viewModel.errorMessage)
    }

    func testAddMemberSendsAgentMemberKindInJoinBody() async {
        viewModel.selectChannel("chan-ops")
        var capturedJoinBody: Data?
        MockURLProtocol.mockHandler = { request in
            let path = request.url?.path ?? ""
            if request.httpMethod == "POST", path.hasSuffix("/join") {
                capturedJoinBody = MockURLProtocol.getBodyData(from: request)
                return try self.mockActionAck()(request)
            }
            return try self.mockMembersList([], channelId: "chan-ops")(request)
        }

        await viewModel.addMember(agentId: "kerrigan")

        let body = try? XCTUnwrap(capturedJoinBody)
        let obj = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? nil
        XCTAssertEqual(obj?["memberId"] as? String, "kerrigan")
        // An added agent MUST join as an agent, never as the user.
        XCTAssertEqual(obj?["memberKind"] as? String, "agent")
    }

    func testAddMemberNoOpWhenNoChannelSelected() async {
        await viewModel.addMember(agentId: "raynor")
        XCTAssertTrue(viewModel.members.isEmpty)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testAddMemberSetsErrorOnJoinFailure() async {
        viewModel.selectChannel("chan-ops")
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 404, code: "NOT_FOUND", message: "no channel"
        )
        await viewModel.addMember(agentId: "raynor")
        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertFalse(viewModel.members.contains(where: { $0.memberId == "raynor" }))
    }

    // MARK: - Helpers

    private func memberJSON(memberId: String, kind: String, role: String) -> [String: Any] {
        [
            "conversationId": "chan-ops",
            "memberId": memberId,
            "memberKind": kind,
            "role": role,
            "joinedAt": "2026-05-29 12:00:00",
            "lastReadAt": NSNull(),
        ]
    }

    private func mockMembersList(_ members: [[String: Any]], channelId: String) -> MockURLProtocol.MockHandler {
        MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": ["members": members, "total": members.count],
            "timestamp": "2026-05-29T12:00:00.000Z"
        ])
    }

    private func channelMessage(id: String, channelId: String) -> PersistentMessage {
        let now = ISO8601DateFormatter().string(from: Date())
        return PersistentMessage(
            id: id, agentId: "raynor", recipient: channelId, role: .agent,
            body: "hi", deliveryStatus: .delivered, conversationId: channelId,
            createdAt: now, updatedAt: now
        )
    }

    private func channelJSON(id: String, title: String, memberCount: Int?) -> [String: Any] {
        var obj: [String: Any] = [
            "id": id,
            "kind": "channel",
            "title": title,
            "archived": false,
            "createdAt": "2026-05-29 12:00:00",
            "updatedAt": "2026-05-29 12:00:00",
        ]
        if let memberCount { obj["memberCount"] = memberCount }
        return obj
    }

    private func mockChannelsList(_ channels: [[String: Any]]) -> MockURLProtocol.MockHandler {
        MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": ["channels": channels, "total": channels.count],
            "timestamp": "2026-05-29T12:00:00.000Z"
        ])
    }

    private func mockActionAck() -> MockURLProtocol.MockHandler {
        MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": ["success": true],
            "timestamp": "2026-05-29T12:00:00.000Z"
        ])
    }

    private func createMockAPIClient() -> APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        let apiConfig = APIClientConfiguration(baseURL: URL(string: "http://test.local/api")!)
        return APIClient(configuration: apiConfig, urlSessionConfiguration: config)
    }
}
