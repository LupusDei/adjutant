import Foundation
import Combine
import AdjutantKit
#if canImport(UIKit)
import UIKit
#endif

/// ViewModel for the agent detail view.
/// Handles terminal content loading, bead fetching, message history,
/// and agent lifecycle actions (terminate, assign bead).
@MainActor
final class AgentDetailViewModel: BaseViewModel {
    // MARK: - Tab Definitions

    /// Available tabs in the agent detail view
    enum Tab: String, CaseIterable, Identifiable {
        case info = "INFO"
        case beads = "BEADS"
        case messages = "MESSAGES"

        var id: String { rawValue }
    }

    // MARK: - Published Properties

    /// The agent being displayed
    @Published private(set) var member: CrewMember

    /// Currently selected tab
    @Published var selectedTab: Tab = .info

    /// Terminal content (for agents with sessions)
    @Published private(set) var terminalContent: String?

    /// Terminal session name
    @Published private(set) var terminalSessionName: String?

    /// Terminal capture timestamp
    @Published private(set) var terminalTimestamp: Date?

    /// Whether terminal is loading
    @Published private(set) var isLoadingTerminal = false

    /// Whether auto-scroll is enabled
    @Published var autoScrollEnabled = true

    /// Copy confirmation state
    @Published private(set) var showCopyConfirmation = false

    // MARK: - Beads Properties

    /// Active beads assigned to this agent (open/in_progress)
    @Published private(set) var activeBeads: [BeadInfo] = []

    /// Completed beads assigned to this agent (closed)
    @Published private(set) var completedBeads: [BeadInfo] = []

    /// Whether beads are loading
    @Published private(set) var isLoadingBeads = false

    // MARK: - Messages Properties

    /// Messages with this agent
    @Published private(set) var messages: [PersistentMessage] = []

    /// Input text for quick reply
    @Published var messageInputText: String = ""

    /// Whether messages are loading
    @Published private(set) var isLoadingMessages = false

    /// Whether a message is being sent
    @Published private(set) var isSendingMessage = false

    // MARK: - Action Properties

    /// Whether terminate confirmation alert is showing
    @Published var showTerminateConfirmation = false

    /// Whether the bead picker sheet is showing
    @Published var showBeadPicker = false

    /// Whether an action is in progress (terminate, assign)
    @Published private(set) var isPerformingAction = false

    /// Whether the agent was terminated (signals pop back)
    @Published private(set) var didTerminate = false

    /// Unassigned open beads for the picker
    @Published private(set) var unassignedBeads: [BeadInfo] = []

    /// Whether unassigned beads are loading
    @Published private(set) var isLoadingUnassignedBeads = false

    // MARK: - Private Properties

    private let apiClient: APIClient
    private var pollingTask: Task<Void, Never>?
    private let pollingInterval: TimeInterval = 5.0

    // MARK: - Initialization

    init(
        member: CrewMember,
        apiClient: APIClient? = nil
    ) {
        self.member = member
        self.apiClient = apiClient ?? AppState.shared.apiClient
        super.init()
    }

    deinit {
        pollingTask?.cancel()
    }

    // MARK: - Lifecycle

    override func onAppear() {
        super.onAppear()
        if member.sessionId != nil {
            startPolling()
        }
    }

    override func onDisappear() {
        super.onDisappear()
        pollingTask?.cancel()
        pollingTask = nil
    }

    // MARK: - Data Loading

    override func refresh() async {
        if member.sessionId != nil {
            await loadTerminal()
        }
    }

    /// Terminal content loading (API removed; terminal is now accessed via session streaming)
    func loadTerminal() async {
        // Terminal API has been removed.
        // Terminal content is now viewed via the session terminal streaming feature.
        isLoadingTerminal = false
    }

    /// Manually refresh terminal content
    func refreshTerminal() async {
        await loadTerminal()
    }

    /// Loads beads assigned to this agent (all statuses, server-side filtered)
    func loadBeads() async {
        isLoadingBeads = true

        do {
            let allBeads = try await apiClient.getBeads(
                status: .all,
                assignee: member.name
            )

            let closedStatuses: Set<String> = ["closed"]
            activeBeads = allBeads.filter { !closedStatuses.contains($0.status) }
            completedBeads = allBeads.filter { closedStatuses.contains($0.status) }
            isLoadingBeads = false
        } catch {
            isLoadingBeads = false
        }
    }

    /// Loads message history with this agent
    func loadMessages() async {
        isLoadingMessages = true

        do {
            let response = try await apiClient.getMessages(agentId: member.id)
            var sorted = response.items.sorted { msg1, msg2 in
                (msg1.date ?? Date.distantPast) < (msg2.date ?? Date.distantPast)
            }
            // Filter to only chat messages (user/agent)
            sorted = sorted.filter { $0.role == .user || $0.role == .agent }
            messages = sorted
            isLoadingMessages = false
        } catch {
            isLoadingMessages = false
        }
    }

    /// Sends a quick reply message to this agent
    func sendMessage() async {
        let text = messageInputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        isSendingMessage = true
        let savedText = messageInputText
        messageInputText = ""

        do {
            _ = try await apiClient.sendChatMessage(agentId: member.id, body: text)
            isSendingMessage = false
            await loadMessages()
        } catch {
            isSendingMessage = false
            messageInputText = savedText
            handleError(error)
        }
    }

    // MARK: - Agent Actions

    /// Terminates the agent session
    func terminateAgent() async {
        let sessionId = member.sessionId ?? member.id

        isPerformingAction = true

        do {
            _ = try await apiClient.killSession(id: sessionId)
            isPerformingAction = false
            didTerminate = true

            #if canImport(UIKit)
            let feedback = UINotificationFeedbackGenerator()
            feedback.notificationOccurred(.success)
            #endif
        } catch {
            isPerformingAction = false
            handleError(error)
        }
    }

    /// Loads unassigned open beads for the bead picker
    func loadUnassignedBeads() async {
        isLoadingUnassignedBeads = true

        do {
            let openBeads = try await apiClient.getBeads(status: .open)
            unassignedBeads = openBeads.filter { $0.assignee == nil || $0.assignee?.isEmpty == true }
            isLoadingUnassignedBeads = false
        } catch {
            isLoadingUnassignedBeads = false
        }
    }

    /// Assigns a bead to this agent
    func assignBead(_ beadId: String) async {
        isPerformingAction = true

        do {
            _ = try await apiClient.assignBead(id: beadId, assignee: member.name)
            isPerformingAction = false

            #if canImport(UIKit)
            let feedback = UIImpactFeedbackGenerator(style: .medium)
            feedback.impactOccurred()
            #endif

            await loadBeads()
        } catch {
            isPerformingAction = false
            handleError(error)
        }
    }

    // MARK: - Actions

    /// Copies terminal content to clipboard
    func copyTerminalContent() {
        guard let content = terminalContent else { return }

        #if canImport(UIKit)
        UIPasteboard.general.string = stripAnsiCodes(content)

        showCopyConfirmation = true

        Task {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            showCopyConfirmation = false
        }
        #endif
    }

    // MARK: - Polling

    private func startPolling() {
        pollingTask?.cancel()
        pollingTask = Task {
            await loadTerminal()

            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(pollingInterval * 1_000_000_000))
                guard !Task.isCancelled else { break }
                await loadTerminal()
            }
        }
    }

    // MARK: - Computed Properties

    /// Whether this agent has a terminal view
    var hasTerm: Bool {
        member.sessionId != nil
    }

    /// Whether the agent can be terminated
    var canTerminate: Bool {
        member.status != .offline
    }

    /// Whether the user can send a message
    var canSendMessage: Bool {
        !messageInputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSendingMessage
    }

    /// Status display text
    var statusDisplayText: String {
        switch member.status {
        case .idle: return "IDLE"
        case .working: return "WORKING"
        case .blocked: return "BLOCKED"
        case .stuck: return "STUCK"
        case .offline: return "OFFLINE"
        }
    }

    /// Formatted timestamp string
    var formattedTimestamp: String {
        guard let timestamp = terminalTimestamp else { return "" }
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: timestamp)
    }

    /// Total bead count for badge
    var totalBeadCount: Int {
        activeBeads.count + completedBeads.count
    }

    /// Message count for badge
    var messageCount: Int {
        messages.count
    }

    // MARK: - Helpers

    /// Strips ANSI escape codes from terminal output for clipboard
    private func stripAnsiCodes(_ text: String) -> String {
        let pattern = "\\x1B(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])"
        guard let regex = try? NSRegularExpression(pattern: pattern, options: []) else {
            return text
        }
        let range = NSRange(text.startIndex..., in: text)
        return regex.stringByReplacingMatches(in: text, options: [], range: range, withTemplate: "")
    }

    /// Checks if a bead's assignee matches this agent
    private func assigneeMatches(_ assignee: String?) -> Bool {
        guard let assignee, !assignee.isEmpty else { return false }
        if assignee == member.id { return true }
        if assignee == member.name { return true }
        // Match last path component: "adjutant/agents/toast" matches agent "toast"
        if let lastComponent = assignee.split(separator: "/").last {
            if String(lastComponent) == member.name || String(lastComponent) == member.id { return true }
        }
        // Match agent ID as path prefix
        if let lastComponent = member.id.split(separator: "/").last {
            if String(lastComponent) == assignee { return true }
        }
        return false
    }
}
