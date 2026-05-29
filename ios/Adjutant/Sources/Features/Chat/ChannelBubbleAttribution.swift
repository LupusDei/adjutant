import Foundation

/// Per-sender attribution policy for multi-party channel bubbles (adj-164.6.3).
///
/// In a 1:1 DM the user's own bubbles carry no sender header — there is only one
/// "other" party, so attribution is implicit. A channel is multi-party, so every
/// turn must be attributable: the FIRST bubble of every same-sender run shows a
/// sender label, INCLUDING the user's own. Same-sender grouping itself is shared
/// with DMs via `MessageGrouping`; this type only decides label visibility.
///
/// Pure and side-effect free so it is unit-testable in isolation.
enum ChannelBubbleAttribution {
    /// Whether a channel bubble should render its sender label.
    ///
    /// - Parameters:
    ///   - isOutgoing: Whether the message is the operator's own.
    ///   - isFirstInGroup: Whether it is the first message of a same-sender run.
    /// - Returns: `true` for the first bubble of any run (user or agent).
    static func showsSenderLabel(isOutgoing: Bool, isFirstInGroup: Bool) -> Bool {
        // Channels attribute every sender's first-in-run bubble, including the
        // user's — the key difference from the DM bubble (where outgoing has no
        // header). Whether the message is outgoing is intentionally ignored.
        _ = isOutgoing
        return isFirstInGroup
    }
}
