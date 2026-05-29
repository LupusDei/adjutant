import XCTest
import AdjutantKit
@testable import AdjutantUI

/// Bubble grouping + auto-scroll behavior tests (adj-164.3.3 / T012).
///
/// Mirrors the web parity behavior (frontend `messageGrouping.ts` +
/// CommandChat `followOutput`):
///   - Consecutive same-sender messages collapse into a "run": only the first
///     shows the sender callsign, only the last shows the timestamp.
///   - The user is one sender; each distinct agent is its own sender; system /
///     announcement rows never group.
///   - Auto-scroll fires only when the user is already at the bottom.
///
/// These are behavior assertions (grouping flags + scroll predicate), not pure
/// styling — exactly what the task scopes for testing.
final class ChatViewLayoutTests: XCTestCase {

    // MARK: - Grouping

    func testSingleMessageIsBothFirstAndLastInGroup() {
        let msgs = [agent("a", id: "1")]
        let flags = MessageGrouping.computeGroups(for: msgs)
        XCTAssertTrue(flags["1"]?.isFirstInGroup ?? false)
        XCTAssertTrue(flags["1"]?.isLastInGroup ?? false)
    }

    func testConsecutiveSameAgentMessagesGroup() {
        let msgs = [
            agent("raynor", id: "1"),
            agent("raynor", id: "2"),
            agent("raynor", id: "3"),
        ]
        let flags = MessageGrouping.computeGroups(for: msgs)
        // First: header yes, timestamp no.
        XCTAssertTrue(flags["1"]!.isFirstInGroup)
        XCTAssertFalse(flags["1"]!.isLastInGroup)
        // Middle: neither.
        XCTAssertFalse(flags["2"]!.isFirstInGroup)
        XCTAssertFalse(flags["2"]!.isLastInGroup)
        // Last: timestamp yes, header no.
        XCTAssertFalse(flags["3"]!.isFirstInGroup)
        XCTAssertTrue(flags["3"]!.isLastInGroup)
    }

    func testDifferentAgentsDoNotGroup() {
        let msgs = [
            agent("raynor", id: "1"),
            agent("kerrigan", id: "2"),
        ]
        let flags = MessageGrouping.computeGroups(for: msgs)
        XCTAssertTrue(flags["1"]!.isFirstInGroup)
        XCTAssertTrue(flags["1"]!.isLastInGroup)
        XCTAssertTrue(flags["2"]!.isFirstInGroup)
        XCTAssertTrue(flags["2"]!.isLastInGroup)
    }

    func testUserAndAgentDoNotGroup() {
        let msgs = [
            user(id: "1"),
            agent("raynor", id: "2"),
            user(id: "3"),
        ]
        let flags = MessageGrouping.computeGroups(for: msgs)
        XCTAssertTrue(flags["1"]!.isLastInGroup)
        XCTAssertTrue(flags["2"]!.isFirstInGroup)
        XCTAssertTrue(flags["2"]!.isLastInGroup)
        XCTAssertTrue(flags["3"]!.isFirstInGroup)
    }

    func testConsecutiveUserMessagesGroup() {
        let msgs = [user(id: "1"), user(id: "2")]
        let flags = MessageGrouping.computeGroups(for: msgs)
        XCTAssertTrue(flags["1"]!.isFirstInGroup)
        XCTAssertFalse(flags["1"]!.isLastInGroup)
        XCTAssertFalse(flags["2"]!.isFirstInGroup)
        XCTAssertTrue(flags["2"]!.isLastInGroup)
    }

    func testAnnouncementsNeverGroup() {
        let msgs = [
            announcement(id: "1"),
            announcement(id: "2"),
        ]
        let flags = MessageGrouping.computeGroups(for: msgs)
        // Even back-to-back, announcement rows stand alone.
        XCTAssertTrue(flags["1"]!.isFirstInGroup)
        XCTAssertTrue(flags["1"]!.isLastInGroup)
        XCTAssertTrue(flags["2"]!.isFirstInGroup)
        XCTAssertTrue(flags["2"]!.isLastInGroup)
    }

    func testEmptyListProducesEmptyFlags() {
        let flags = MessageGrouping.computeGroups(for: [])
        XCTAssertTrue(flags.isEmpty)
    }

    // MARK: - Auto-scroll predicate

    func testShouldAutoScrollWhenAtBottom() {
        XCTAssertTrue(MessageGrouping.shouldAutoScroll(isAtBottom: true))
    }

    func testShouldNotAutoScrollWhenScrolledUp() {
        XCTAssertFalse(MessageGrouping.shouldAutoScroll(isAtBottom: false))
    }

    // MARK: - Helpers

    private func agent(_ id: String, id messageId: String) -> PersistentMessage {
        msg(agentId: id, role: .agent, id: messageId)
    }
    private func user(id messageId: String) -> PersistentMessage {
        msg(agentId: "user", role: .user, id: messageId)
    }
    private func announcement(id messageId: String) -> PersistentMessage {
        msg(agentId: "system", role: .announcement, id: messageId)
    }
    private func msg(agentId: String, role: MessageRole, id: String) -> PersistentMessage {
        let now = ISO8601DateFormatter().string(from: Date())
        return PersistentMessage(
            id: id,
            agentId: agentId,
            recipient: "user",
            role: role,
            body: "b",
            deliveryStatus: .delivered,
            createdAt: now,
            updatedAt: now
        )
    }
}
