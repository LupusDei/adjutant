import Foundation
import Combine
import AdjutantKit

/// ViewModel for the mail list view, handling message fetching,
/// filtering, and actions like mark read/unread and delete.
@MainActor
final class MailListViewModel: BaseViewModel {
    // MARK: - Published Properties

    /// All messages (before filtering)
    @Published private(set) var messages: [Message] = []

    /// Filtered messages based on current filter
    @Published private(set) var filteredMessages: [Message] = []

    /// Current filter selection
    @Published var currentFilter: MailFilter = .all {
        didSet { applyFilter() }
    }

    /// Search query text
    @Published var searchText: String = "" {
        didSet { applyFilter() }
    }

    /// Whether search is active
    @Published var isSearching: Bool = false

    /// Currently selected rig filter (synced from AppState)
    private var selectedRig: String? {
        AppState.shared.selectedRig
    }

    // MARK: - Filter Types

    /// Available mail filter options
    enum MailFilter: String, CaseIterable, Identifiable {
        case all
        case unread
        case priority

        var id: String { rawValue }

        var displayName: String {
            switch self {
            case .all: return "ALL"
            case .unread: return "UNREAD"
            case .priority: return "PRIORITY"
            }
        }
    }

    // MARK: - Configuration

    /// Polling interval for auto-refresh (30 seconds per spec)
    private let pollingInterval: TimeInterval = 30.0

    // MARK: - Dependencies

    private let apiClient: APIClient?

    // MARK: - Private Properties

    private var pollingTask: Task<Void, Never>?

    // MARK: - Initialization

    init(apiClient: APIClient? = nil) {
        self.apiClient = apiClient ?? AppState.shared.apiClient
        super.init()
        setupRigFilterObserver()
        setupOverseerModeObserver()
        loadFromCache()
    }

    /// Loads cached messages for immediate display
    private func loadFromCache() {
        let cached = ResponseCache.shared.messages
        if !cached.isEmpty {
            messages = cached
            applyFilter()
        }
    }

    /// Sets up observation of rig filter changes from AppState
    private func setupRigFilterObserver() {
        AppState.shared.$selectedRig
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.applyFilter()
            }
            .store(in: &cancellables)
    }

    /// Sets up observation of overseer mode changes from AppState
    private func setupOverseerModeObserver() {
        AppState.shared.$isOverseerMode
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.applyFilter()
            }
            .store(in: &cancellables)
    }

    deinit {
        pollingTask?.cancel()
    }

    // MARK: - Lifecycle

    override func onAppear() {
        super.onAppear()
        startPolling()
    }

    override func onDisappear() {
        super.onDisappear()
        stopPolling()
    }

    // MARK: - Data Loading

    override func refresh() async {
        await loadMessages()
    }

    /// Loads messages from the API
    func loadMessages() async {
        guard let apiClient = apiClient else {
            // Use mock data for preview/testing
            await performAsync {
                self.messages = Self.mockMessages
                self.applyFilter()
            }
            return
        }

        await performAsync { [weak self] in
            guard let self = self else { return }
            let response = try await apiClient.getMail(all: true)
            self.messages = response.items.sorted {
                // Sort by date descending (newest first)
                ($0.date ?? Date.distantPast) > ($1.date ?? Date.distantPast)
            }
            // Update cache for next navigation
            ResponseCache.shared.updateMessages(self.messages)
            self.applyFilter()
            // Update global unread count for badge
            self.updateUnreadBadge()
        }
    }

    // MARK: - Polling

    private func startPolling() {
        stopPolling()
        pollingTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(pollingInterval * 1_000_000_000))
                guard !Task.isCancelled else { break }
                await refreshSilently()
            }
        }
    }

    private func stopPolling() {
        pollingTask?.cancel()
        pollingTask = nil
    }

    /// Silently refresh data in the background (no loading indicator)
    private func refreshSilently() async {
        guard let apiClient = apiClient else { return }

        await performAsync(showLoading: false) { [weak self] in
            guard let self = self else { return }
            let response = try await apiClient.getMail(all: true)
            self.messages = response.items.sorted {
                ($0.date ?? Date.distantPast) > ($1.date ?? Date.distantPast)
            }
            // Update cache for next navigation
            ResponseCache.shared.updateMessages(self.messages)
            self.applyFilter()
            self.updateUnreadBadge()
        }
    }

    /// Updates the global unread mail count for badge display
    private func updateUnreadBadge() {
        AppState.shared.updateUnreadMailCount(unreadCount)
    }

    // MARK: - Actions

    /// Marks a message as read
    func markAsRead(_ message: Message) async {
        guard let apiClient = apiClient else {
            updateMessageReadStatus(message, read: true)
            return
        }

        await performAsyncAction(showLoading: false) { [weak self] in
            guard let self = self else { return }
            _ = try await apiClient.markMessageAsRead(id: message.id)
            self.updateMessageReadStatus(message, read: true)
        }
    }

    /// Marks a message as unread
    func markAsUnread(_ message: Message) async {
        guard let apiClient = apiClient else {
            updateMessageReadStatus(message, read: false)
            return
        }

        await performAsyncAction(showLoading: false) { [weak self] in
            guard let self = self else { return }
            _ = try await apiClient.markMessageAsUnread(id: message.id)
            self.updateMessageReadStatus(message, read: false)
        }
    }

    /// Toggles read status of a message
    func toggleReadStatus(_ message: Message) async {
        if message.read {
            await markAsUnread(message)
        } else {
            await markAsRead(message)
        }
    }

    /// Marks all unread messages as read
    func markAllAsRead() async {
        let unreadMessages = messages.filter { !$0.read }
        guard !unreadMessages.isEmpty else { return }

        for message in unreadMessages {
            await markAsRead(message)
        }
    }

    /// Deletes a message
    func deleteMessage(_ message: Message) async {
        guard let apiClient = apiClient else {
            removeMessage(message)
            return
        }

        await performAsyncAction(showLoading: false) { [weak self] in
            guard let self = self else { return }
            _ = try await apiClient.deleteMail(id: message.id)
            self.removeMessage(message)
        }
    }

    /// Deletes multiple messages at given indices
    func deleteMessages(at offsets: IndexSet) async {
        let messagesToDelete = offsets.map { filteredMessages[$0] }
        for message in messagesToDelete {
            await deleteMessage(message)
        }
    }

    // MARK: - Private Helpers

    /// Applies the current filter and search to messages
    private func applyFilter() {
        var result = messages

        // Apply rig filter
        if let rig = selectedRig {
            result = result.filter { message in
                messageMatchesRig(message, rig: rig)
            }
        }

        // Apply overseer mode filter (hide infrastructure messages)
        if AppState.shared.isOverseerMode {
            result = result.filter { !$0.isInfrastructure }
        }

        // Apply status filter
        switch currentFilter {
        case .all:
            break
        case .unread:
            result = result.filter { !$0.read }
        case .priority:
            result = result.filter { $0.priority.rawValue <= MessagePriority.high.rawValue }
        }

        // Apply search
        if !searchText.isEmpty {
            let query = searchText.lowercased()
            result = result.filter { message in
                message.subject.lowercased().contains(query) ||
                message.from.lowercased().contains(query) ||
                message.body.lowercased().contains(query)
            }
        }

        filteredMessages = result
    }

    /// Checks if a message is related to a specific rig
    /// Messages are considered related if the from or to address starts with the rig name
    private func messageMatchesRig(_ message: Message, rig: String) -> Bool {
        let rigPrefix = rig.lowercased() + "/"
        let fromLower = message.from.lowercased()
        let toLower = message.to.lowercased()

        return fromLower.hasPrefix(rigPrefix) || toLower.hasPrefix(rigPrefix)
    }

    /// Updates the read status of a message locally
    private func updateMessageReadStatus(_ message: Message, read: Bool) {
        if let index = messages.firstIndex(where: { $0.id == message.id }) {
            let updated = Message(
                id: message.id,
                from: message.from,
                to: message.to,
                subject: message.subject,
                body: message.body,
                timestamp: message.timestamp,
                read: read,
                priority: message.priority,
                type: message.type,
                threadId: message.threadId,
                replyTo: message.replyTo,
                pinned: message.pinned,
                cc: message.cc,
                isInfrastructure: message.isInfrastructure
            )
            messages[index] = updated
            applyFilter()
            updateUnreadBadge()
        }
    }

    /// Removes a message from the local list
    private func removeMessage(_ message: Message) {
        messages.removeAll { $0.id == message.id }
        applyFilter()
        updateUnreadBadge()
    }

    // MARK: - Computed Properties

    /// Count of unread messages
    var unreadCount: Int {
        messages.filter { !$0.read }.count
    }

    /// Whether there are any messages
    var isEmpty: Bool {
        filteredMessages.isEmpty
    }

    /// Empty state message based on current filter
    var emptyStateMessage: String {
        if !searchText.isEmpty {
            return "No messages match your search"
        }
        switch currentFilter {
        case .all:
            return "Your inbox is empty"
        case .unread:
            return "No unread messages"
        case .priority:
            return "No priority messages"
        }
    }
}

// MARK: - Mock Data

extension MailListViewModel {
    /// Mock messages for preview and testing
    static let mockMessages: [Message] = [
        Message(
            id: "msg-001",
            from: "mayor/",
            to: "adjutant/quartz",
            subject: "System initialization complete",
            body: "Gas Town has been initialized. All systems operational.",
            timestamp: "2026-01-25T10:00:00Z",
            read: true,
            priority: .normal,
            type: .notification,
            threadId: "thread-001",
            pinned: false,
            isInfrastructure: true
        ),
        Message(
            id: "msg-002",
            from: "witness/",
            to: "adjutant/quartz",
            subject: "URGENT: Review required",
            body: "Your recent commit needs attention. Please review the failing tests.",
            timestamp: "2026-01-25T11:30:00Z",
            read: false,
            priority: .urgent,
            type: .task,
            threadId: "thread-002",
            pinned: false,
            isInfrastructure: false
        ),
        Message(
            id: "msg-003",
            from: "refinery/",
            to: "adjutant/quartz",
            subject: "Merge complete",
            body: "Your branch has been successfully merged to main.",
            timestamp: "2026-01-25T09:15:00Z",
            read: true,
            priority: .low,
            type: .notification,
            threadId: "thread-003",
            pinned: false,
            isInfrastructure: true
        ),
        Message(
            id: "msg-004",
            from: "deacon/",
            to: "adjutant/quartz",
            subject: "New task assignment",
            body: "You have been assigned a new task. Check your beads for details.",
            timestamp: "2026-01-25T08:00:00Z",
            read: false,
            priority: .high,
            type: .task,
            threadId: "thread-004",
            pinned: false,
            isInfrastructure: false
        ),
        Message(
            id: "msg-005",
            from: "crew/onyx",
            to: "adjutant/quartz",
            subject: "Question about implementation",
            body: "Can you clarify the requirements for the mail list feature?",
            timestamp: "2026-01-24T16:45:00Z",
            read: true,
            priority: .normal,
            type: .reply,
            threadId: "thread-005",
            replyTo: "msg-001",
            pinned: false,
            isInfrastructure: false
        )
    ]
}
