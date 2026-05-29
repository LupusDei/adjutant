import Foundation
import Combine

/// Which surface the chat tab is showing.
enum ChatMode: String, CaseIterable, Sendable {
    case directMessages
    case channels

    /// Short uppercase label for the segmented switcher.
    var label: String {
        switch self {
        case .directMessages: return "DIRECT"
        case .channels: return "CHANNELS"
        }
    }
}

/// Drives the chat tab's DM ↔ Channels switch (adj-164.6.5).
///
/// The chat tab hosts two independent surfaces. This controller owns the active
/// `mode` and preserves each surface's own selection (the open DM recipient and
/// the open channel) so flipping back and forth never loses the user's place.
@MainActor
final class ChatModeController: ObservableObject {
    /// The active surface. Defaults to direct messages (the pre-channels behavior).
    @Published private(set) var mode: ChatMode = .directMessages

    /// The DM recipient the operator last had open. Preserved across mode flips.
    @Published var selectedDMRecipient: String?

    /// The channel the operator last had open. Preserved across mode flips.
    @Published var selectedChannelId: String?

    init() {}

    /// Switch to a specific surface. Idempotent when already in that mode.
    func switchTo(_ newMode: ChatMode) {
        guard newMode != mode else { return }
        mode = newMode
    }

    /// Flip to the other surface.
    func toggle() {
        switchTo(mode == .directMessages ? .channels : .directMessages)
    }
}
