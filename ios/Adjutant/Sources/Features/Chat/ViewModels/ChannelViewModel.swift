import Foundation
import Combine
import AdjutantKit

/// ViewModel for the Slack-style channel surface (adj-164.6.2).
///
/// Owns the list of channels, the currently-open channel, per-channel unread
/// counts, and which channels the operator is a member of. It is the channel
/// analogue of ``ChatViewModel`` but deliberately leaner: channel timelines are
/// flat and text-first (no voice/TTS/streaming), so this VM concerns itself
/// only with list/membership/unread state. The per-room message timeline is
/// driven by ``ChannelView`` via the conversation-scoped message API.
@MainActor
final class ChannelViewModel: BaseViewModel {
    // MARK: - Published State

    /// All channels known to the dashboard (newest-created first).
    @Published private(set) var channels: [Channel] = []

    /// The channel currently open in the room view, or nil for the list.
    @Published private(set) var selectedChannelId: String?

    /// Per-channel unread counts keyed by channel id.
    @Published private(set) var unreadCounts: [String: Int] = [:]

    /// Messages of the currently-open channel, oldest first. Empty when no
    /// channel is open or the room has no messages.
    @Published private(set) var messages: [PersistentMessage] = []

    /// Members of the currently-open channel (adj-4wrro). Drives the roster
    /// sheet and lets the add-agent picker filter out existing members. Empty
    /// when no channel is open or the roster hasn't loaded yet.
    @Published private(set) var members: [ChannelMember] = []

    /// Draft text for the open channel's composer.
    @Published var inputText: String = ""

    // MARK: - Membership

    /// Channels the operator has joined. Channels the user created or explicitly
    /// joined are members; this gates whether the room view lets them post.
    private var joinedChannelIds: Set<String> = []

    // MARK: - Dependencies

    /// The canonical member id for the dashboard operator (matches the backend
    /// `USER_MEMBER_ID`). Channel actions act on the user's behalf.
    static let userMemberId = "user"

    private let apiClient: APIClient

    // MARK: - Init

    init(apiClient: APIClient? = nil) {
        self.apiClient = apiClient ?? AppState.shared.apiClient
        super.init()
    }

    // MARK: - Lifecycle

    override func refresh() async {
        await loadChannels()
    }

    // MARK: - Loading

    /// Fetch the full channel list. Errors surface via `errorMessage` and leave
    /// the previous list intact.
    func loadChannels() async {
        await performAsyncAction(showLoading: channels.isEmpty) {
            let response = try await self.apiClient.listChannels()
            self.channels = response.channels
        }
    }

    // MARK: - Mutations

    /// Create a channel, insert it at the top of the list, mark the operator a
    /// member (the backend adds the creator as owner), and open it.
    func createChannel(title: String) async {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            errorMessage = "Channel name cannot be empty."
            return
        }
        await performAsyncAction(showLoading: false) {
            let channel = try await self.apiClient.createChannel(title: trimmed)
            // De-dupe defensively in case a concurrent loadChannels already added it.
            if !self.channels.contains(where: { $0.id == channel.id }) {
                self.channels.insert(channel, at: 0)
            }
            self.joinedChannelIds.insert(channel.id)
            self.selectedChannelId = channel.id
        }
    }

    /// Join a channel as the operator. On success the channel is marked a member.
    func joinChannel(_ channelId: String) async {
        await performAsyncAction(showLoading: false) {
            try await self.apiClient.joinChannel(
                channelId: channelId,
                memberId: Self.userMemberId,
                memberKind: .user
            )
            self.joinedChannelIds.insert(channelId)
        }
    }

    /// Leave a channel as the operator. On success membership is cleared, and if
    /// the channel was open the selection is reset to the list.
    func leaveChannel(_ channelId: String) async {
        await performAsyncAction(showLoading: false) {
            try await self.apiClient.leaveChannel(
                channelId: channelId,
                memberId: Self.userMemberId
            )
            self.joinedChannelIds.remove(channelId)
            if self.selectedChannelId == channelId {
                self.selectedChannelId = nil
            }
        }
    }

    // MARK: - Selection

    /// Open a channel's room view. Opening a channel clears its unread badge and
    /// resets the timeline; the room view triggers `loadMessages()` on appear so
    /// selection stays a pure, synchronous state change (no network side effect).
    func selectChannel(_ channelId: String) {
        selectedChannelId = channelId
        unreadCounts[channelId] = 0
        messages = []
        // Drop the previous room's roster so the members sheet never flashes
        // stale members before `loadMembers()` repopulates it.
        members = []
    }

    /// Close the room view and return to the channel list.
    func clearSelection() {
        selectedChannelId = nil
        messages = []
        members = []
    }

    // MARK: - Channel timeline

    /// Load the open channel's messages, scoped strictly by conversation id.
    func loadMessages() async {
        guard let channelId = selectedChannelId else { return }
        await performAsyncAction(showLoading: messages.isEmpty) {
            let response = try await self.apiClient.getConversationMessages(conversationId: channelId)
            // Guard against a race where the user switched channels mid-flight.
            guard self.selectedChannelId == channelId else { return }
            self.messages = response.items
                .sorted { ($0.date ?? .distantPast) < ($1.date ?? .distantPast) }
        }
    }

    // MARK: - Members (adj-4wrro)

    /// Load the open channel's membership roster, scoped strictly by the open
    /// channel id. A no-op when no channel is open. Guards against the
    /// switch-mid-flight race the same way ``loadMessages()`` does so a late
    /// payload for a closed room never lands.
    func loadMembers() async {
        guard let channelId = selectedChannelId else { return }
        await performAsyncAction(showLoading: false) {
            let fetched = try await self.apiClient.getChannelMembers(channelId: channelId)
            guard self.selectedChannelId == channelId else { return }
            self.members = fetched
            // Hydrate the operator's membership from the SERVER (source of truth),
            // not just the in-memory create/join history. Without this,
            // `joinedChannelIds` is empty after an app restart or for channels
            // created elsewhere (web/agent), so `canSend` — which gates the send
            // button on `isMember` — stayed false forever (dead-send-button bug).
            if fetched.contains(where: { $0.memberId == Self.userMemberId }) {
                self.joinedChannelIds.insert(channelId)
            } else {
                self.joinedChannelIds.remove(channelId)
            }
        }
    }

    /// Add an agent to the open channel, then refresh the roster (adj-4wrro).
    ///
    /// The agent joins with ``MemberKind/agent`` — never as the operator. A
    /// no-op when no channel is open. On join failure the roster is left intact
    /// and the error surfaces via `errorMessage`; the reload only runs after a
    /// successful join.
    func addMember(agentId: String) async {
        guard let channelId = selectedChannelId else { return }
        let trimmed = agentId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            errorMessage = "Agent id cannot be empty."
            return
        }
        await performAsyncAction(showLoading: false) {
            try await self.apiClient.joinChannel(
                channelId: channelId,
                memberId: trimmed,
                memberKind: .agent
            )
            // Reload only the open channel's roster; bail if the user navigated away.
            guard self.selectedChannelId == channelId else { return }
            let fetched = try await self.apiClient.getChannelMembers(channelId: channelId)
            guard self.selectedChannelId == channelId else { return }
            self.members = fetched
        }
    }

    /// Post the composer's text to the open channel as the operator, then clear
    /// the draft. The posted message is appended optimistically; the canonical
    /// row arrives via the room-scoped WS fan-out / next load.
    func sendMessage() async {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let channelId = selectedChannelId else { return }
        inputText = ""
        await performAsyncAction(showLoading: false) {
            let ack = try await self.apiClient.postToChannel(
                channelId: channelId,
                body: text,
                senderId: Self.userMemberId
            )
            guard self.selectedChannelId == channelId else { return }
            let optimistic = PersistentMessage(
                id: ack.messageId,
                agentId: Self.userMemberId,
                recipient: channelId,
                role: .user,
                body: text,
                deliveryStatus: .delivered,
                conversationId: channelId,
                createdAt: ack.timestamp,
                updatedAt: ack.timestamp
            )
            if !self.messages.contains(where: { $0.id == optimistic.id }) {
                self.messages.append(optimistic)
            }
        }
    }

    /// Apply a real-time channel message. Routed only when it belongs to the
    /// open channel (`WebSocketClient.shouldRouteChannel`); for other channels it
    /// bumps the unread badge instead.
    func applyIncoming(_ message: PersistentMessage) {
        guard let convId = message.conversationId, !convId.isEmpty else { return }
        if convId == selectedChannelId {
            guard !messages.contains(where: { $0.id == message.id }) else { return }
            messages.append(message)
            messages.sort { ($0.date ?? .distantPast) < ($1.date ?? .distantPast) }
        } else {
            incrementUnread(for: convId)
        }
    }

    /// Whether the composer can send (non-empty draft + an open channel the
    /// operator is a member of).
    var canSend: Bool {
        guard let id = selectedChannelId else { return false }
        return isMember(id) && !inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// The currently-open channel, if any.
    var selectedChannel: Channel? {
        guard let id = selectedChannelId else { return nil }
        return channels.first(where: { $0.id == id })
    }

    // MARK: - Membership / Unread queries

    /// Whether the operator is a member of the given channel.
    func isMember(_ channelId: String) -> Bool {
        joinedChannelIds.contains(channelId)
    }

    /// Unread count for a channel, defaulting to 0 for unknown channels.
    func unreadCount(for channelId: String) -> Int {
        unreadCounts[channelId] ?? 0
    }

    /// Total unread across all channels — used for the tab badge.
    var totalUnread: Int {
        unreadCounts.values.reduce(0, +)
    }

    // MARK: - Real-time integration

    /// Apply a unread delta for a channel that is not currently open. Channels
    /// being actively viewed do not accrue unread. Called by the real-time
    /// layer when a channel message arrives for a non-open room.
    func incrementUnread(for channelId: String) {
        guard channelId != selectedChannelId else { return }
        unreadCounts[channelId, default: 0] += 1
    }

    // MARK: - Test seams

    /// Seed unread counts directly for unit tests (no network round-trip).
    func applyUnreadCountsForTesting(_ counts: [String: Int]) {
        unreadCounts = counts
    }
}
