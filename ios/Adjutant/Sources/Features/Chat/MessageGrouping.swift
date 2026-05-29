import Foundation
import AdjutantKit

/// Same-sender run grouping + auto-scroll policy for the DM timeline
/// (adj-164.3.3). Parity with the web `messageGrouping.ts` + CommandChat
/// `followOutput` so iOS and web render bubbles identically.
///
/// Consecutive messages from the same sender collapse into a visual "run":
/// only the FIRST message in a run shows the sender callsign header, only the
/// LAST shows the timestamp / delivery status. This reads as one continuous
/// transmission instead of a stack of identically-chromed boxes.
///
/// Pure and O(n): a single pass comparing each message's sender key to its
/// neighbours. Kept out of the view so it is unit-testable in isolation.
enum MessageGrouping {

    /// Per-message grouping flags.
    struct GroupFlags: Equatable {
        /// First message in a same-sender run → render the sender callsign.
        let isFirstInGroup: Bool
        /// Last message in a same-sender run → render the timestamp / status.
        let isLastInGroup: Bool
    }

    /// The identity a run is keyed on. The user is always one sender; each
    /// distinct agent is its own sender (two agents never share a run). System
    /// and announcement rows get a unique key so they never group.
    private static func senderKey(_ msg: PersistentMessage) -> String {
        switch msg.role {
        case .user:
            return "user"
        case .system, .announcement:
            // Never group system/announcement rows — make every key unique.
            return "__system__\(msg.id)"
        case .agent:
            return "agent:\(msg.agentId)"
        }
    }

    /// Compute per-message grouping flags for a chronologically-ordered list
    /// (oldest → newest).
    ///
    /// - Parameter messages: messages in display order.
    /// - Returns: a dictionary keyed by message id with each message's flags.
    static func computeGroups(for messages: [PersistentMessage]) -> [String: GroupFlags] {
        var flags: [String: GroupFlags] = [:]
        flags.reserveCapacity(messages.count)

        for i in messages.indices {
            let current = messages[i]
            let key = senderKey(current)

            let prevKey = i > 0 ? senderKey(messages[i - 1]) : nil
            let nextKey = i < messages.count - 1 ? senderKey(messages[i + 1]) : nil

            let isFirst = prevKey == nil || prevKey != key
            let isLast = nextKey == nil || nextKey != key

            flags[current.id] = GroupFlags(isFirstInGroup: isFirst, isLastInGroup: isLast)
        }

        return flags
    }

    /// Auto-scroll policy: pin to the newest message only when the user is
    /// already at the bottom. When they've scrolled up to read history, return
    /// false so the timeline does not jump out from under them. Mirrors the web
    /// `followOutput(isAtBottom)` predicate.
    static func shouldAutoScroll(isAtBottom: Bool) -> Bool {
        isAtBottom
    }
}
