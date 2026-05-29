import XCTest
import AdjutantKit
@testable import AdjutantUI

/// Channel bubble attribution + grouping behavior tests (adj-164.6.3 / T026).
///
/// Channels are multi-party, so attribution differs from 1:1 DMs:
///   - Each distinct agent is its own sender; consecutive same-sender messages
///     collapse into a run (reusing `MessageGrouping`, shared with DMs).
///   - Unlike a DM — where the user's own bubble shows no header — a channel
///     shows a sender label for EVERY first-in-group message, including the
///     user's, so multi-party turns are always attributable.
/// These are behavior assertions (grouping flags + the show-attribution
/// predicate), not pure styling.
final class ChannelViewLayoutTests: XCTestCase {

    // MARK: - Multi-party grouping (reuses MessageGrouping)

    func testDistinctAgentsDoNotGroupInChannel() {
        let msgs = [
            agent("raynor", id: "1"),
            agent("kerrigan", id: "2"),
            agent("tassadar", id: "3"),
        ]
        let flags = MessageGrouping.computeGroups(for: msgs)
        // Three different speakers ⇒ each stands alone.
        XCTAssertTrue(flags["1"]!.isFirstInGroup)
        XCTAssertTrue(flags["1"]!.isLastInGroup)
        XCTAssertTrue(flags["2"]!.isFirstInGroup)
        XCTAssertTrue(flags["3"]!.isFirstInGroup)
    }

    func testSameAgentGroupsInChannel() {
        let msgs = [agent("raynor", id: "1"), agent("raynor", id: "2")]
        let flags = MessageGrouping.computeGroups(for: msgs)
        XCTAssertTrue(flags["1"]!.isFirstInGroup)
        XCTAssertFalse(flags["1"]!.isLastInGroup)
        XCTAssertFalse(flags["2"]!.isFirstInGroup)
        XCTAssertTrue(flags["2"]!.isLastInGroup)
    }

    func testUserAndAgentDoNotGroupInChannel() {
        let msgs = [user(id: "1"), agent("raynor", id: "2")]
        let flags = MessageGrouping.computeGroups(for: msgs)
        XCTAssertTrue(flags["1"]!.isLastInGroup)
        XCTAssertTrue(flags["2"]!.isFirstInGroup)
    }

    // MARK: - Channel attribution predicate

    func testShowsAttributionForAgentFirstInGroup() {
        XCTAssertTrue(
            ChannelBubbleAttribution.showsSenderLabel(isOutgoing: false, isFirstInGroup: true)
        )
    }

    func testShowsAttributionForUserFirstInGroup_ChannelDiffersFromDM() {
        // The channel difference from a DM: even the user's own first-in-group
        // bubble is attributed.
        XCTAssertTrue(
            ChannelBubbleAttribution.showsSenderLabel(isOutgoing: true, isFirstInGroup: true)
        )
    }

    func testHidesAttributionWhenNotFirstInGroup() {
        XCTAssertFalse(
            ChannelBubbleAttribution.showsSenderLabel(isOutgoing: false, isFirstInGroup: false)
        )
        XCTAssertFalse(
            ChannelBubbleAttribution.showsSenderLabel(isOutgoing: true, isFirstInGroup: false)
        )
    }

    // MARK: - Helpers

    private func agent(_ id: String, id messageId: String) -> PersistentMessage {
        msg(agentId: id, role: .agent, id: messageId)
    }
    private func user(id messageId: String) -> PersistentMessage {
        msg(agentId: "user", role: .user, id: messageId)
    }
    private func msg(agentId: String, role: MessageRole, id: String) -> PersistentMessage {
        let now = ISO8601DateFormatter().string(from: Date())
        return PersistentMessage(
            id: id,
            agentId: agentId,
            recipient: "chan-ops",
            role: role,
            body: "b",
            deliveryStatus: .delivered,
            conversationId: "chan-ops",
            createdAt: now,
            updatedAt: now
        )
    }
}
