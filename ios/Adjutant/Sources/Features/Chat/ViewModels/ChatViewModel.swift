import Foundation
import Combine
import AdjutantKit

/// ViewModel for the Chat feature.
/// Handles loading messages, sending new messages, and managing chat state.
/// Supports chatting with Mayor or any crew agent.
@MainActor
final class ChatViewModel: BaseViewModel {
    // MARK: - Published Properties

    /// Messages in the conversation, sorted newest last
    @Published private(set) var messages: [Message] = []

    /// Current input text
    @Published var inputText: String = ""

    /// Currently selected recipient (default: mayor/)
    @Published private(set) var selectedRecipient: String = "mayor/"

    /// All available recipients (agents)
    @Published private(set) var availableRecipients: [CrewMember] = []

    /// Whether the recipient is currently typing (simulated)
    @Published private(set) var isTyping: Bool = false

    /// Whether voice input is active
    @Published private(set) var isRecordingVoice: Bool = false

    /// Whether there are more messages to load
    @Published private(set) var hasMoreHistory: Bool = true

    /// Whether we're currently loading more history
    @Published private(set) var isLoadingHistory: Bool = false

    /// Speech recognition authorization status
    @Published private(set) var speechAuthorizationStatus: SpeechAuthorizationStatus = .notDetermined

    /// Speech recognition error message
    @Published private(set) var speechError: String?

    // MARK: - Dependencies

    private let apiClient: APIClient
    private let speechService: SpeechRecognitionServiceProtocol?

    // MARK: - Private Properties

    private var pollingTask: Task<Void, Never>?
    /// Polling interval for chat (30 seconds per spec)
    private let pollingInterval: TimeInterval = 30.0
    private var lastMessageId: String?
    private var speechCancellables = Set<AnyCancellable>()
    /// Pending optimistic messages that haven't been confirmed by the server yet
    private var pendingLocalMessages: [Message] = []

    // MARK: - Initialization

    init(apiClient: APIClient? = nil, speechService: SpeechRecognitionServiceProtocol? = nil) {
        self.apiClient = apiClient ?? AppState.shared.apiClient
        self.speechService = speechService
        super.init()
        setupSpeechBindings()
        loadFromCache()
    }

    /// Loads cached chat messages for immediate display
    private func loadFromCache() {
        let cached = ResponseCache.shared.chatMessages
        if !cached.isEmpty {
            messages = cached
            lastMessageId = messages.last?.id
        }
    }

    deinit {
        pollingTask?.cancel()
    }

    // MARK: - Lifecycle

    override func onAppear() {
        super.onAppear()
        Task {
            await loadRecipients()
        }
        startPolling()
    }

    override func onDisappear() {
        super.onDisappear()
        pollingTask?.cancel()
        pollingTask = nil
    }

    // MARK: - Data Loading

    override func refresh() async {
        await performAsyncAction(showLoading: messages.isEmpty) {
            let response = try await self.apiClient.getMail(filter: .user, all: false)
            var serverMessages = self.filterRecipientMessages(response.items).sorted { msg1, msg2 in
                // Sort by timestamp, oldest first (for chat display)
                (msg1.date ?? Date.distantPast) < (msg2.date ?? Date.distantPast)
            }

            // Remove pending local messages that have been confirmed by server
            self.pendingLocalMessages.removeAll { localMsg in
                serverMessages.contains { serverMsg in
                    self.isConfirmedMessage(local: localMsg, server: serverMsg)
                }
            }

            // Merge remaining pending local messages with server messages
            if !self.pendingLocalMessages.isEmpty {
                serverMessages.append(contentsOf: self.pendingLocalMessages)
                serverMessages.sort { msg1, msg2 in
                    (msg1.date ?? Date.distantPast) < (msg2.date ?? Date.distantPast)
                }
            }

            self.messages = serverMessages
            self.lastMessageId = serverMessages.filter { !$0.id.hasPrefix("local-") }.last?.id
            // Update cache for next navigation
            ResponseCache.shared.updateChatMessages(self.messages)
        }
    }

    /// Check if a server message confirms a pending local message
    private func isConfirmedMessage(local: Message, server: Message) -> Bool {
        // Match by body content and recipient - server message confirms the local one
        return local.body == server.body &&
               local.to == server.to &&
               server.to == selectedRecipient
    }

    /// Loads available recipients from the API
    func loadRecipients() async {
        await performAsyncAction(showLoading: false) {
            let agents = try await self.apiClient.getAgents()
            self.availableRecipients = agents
        }
    }

    /// Sets the current recipient and refreshes messages
    func setRecipient(_ recipient: String) async {
        guard recipient != selectedRecipient else { return }
        selectedRecipient = recipient
        messages = [] // Clear messages while loading
        pendingLocalMessages = [] // Clear pending messages for old recipient
        await refresh()
    }

    /// Load more history (older messages)
    func loadMoreHistory() async {
        guard !isLoadingHistory, hasMoreHistory else { return }

        isLoadingHistory = true
        defer { isLoadingHistory = false }

        await performAsyncAction(showLoading: false) {
            // For now, load all messages - pagination could be added later
            let response = try await self.apiClient.getMail(filter: .user, all: true)
            var allRecipientMessages = self.filterRecipientMessages(response.items).sorted { msg1, msg2 in
                (msg1.date ?? Date.distantPast) < (msg2.date ?? Date.distantPast)
            }

            // Remove pending local messages that have been confirmed by server
            self.pendingLocalMessages.removeAll { localMsg in
                allRecipientMessages.contains { serverMsg in
                    self.isConfirmedMessage(local: localMsg, server: serverMsg)
                }
            }

            // Merge remaining pending local messages
            if !self.pendingLocalMessages.isEmpty {
                allRecipientMessages.append(contentsOf: self.pendingLocalMessages)
                allRecipientMessages.sort { msg1, msg2 in
                    (msg1.date ?? Date.distantPast) < (msg2.date ?? Date.distantPast)
                }
            }

            // If we got the same count (excluding local), there's no more history
            let serverOnlyCount = allRecipientMessages.filter { !$0.id.hasPrefix("local-") }.count
            if serverOnlyCount <= self.messages.filter({ !$0.id.hasPrefix("local-") }).count {
                self.hasMoreHistory = false
            } else {
                self.messages = allRecipientMessages
            }
        }
    }

    // MARK: - Sending Messages

    /// Send a message to the selected recipient
    func sendMessage() async {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        // Clear input immediately for responsive feel
        inputText = ""

        // Generate subject from message body (first ~50 chars, truncated at word boundary)
        let subject = Self.generateSubject(from: text)

        // Create optimistic local message for immediate display
        let optimisticMessage = Message(
            id: "local-\(UUID().uuidString)",
            from: "user",
            to: selectedRecipient,
            subject: subject,
            body: text,
            timestamp: ISO8601DateFormatter().string(from: Date()),
            read: true,
            priority: .normal,
            type: .task,
            threadId: "local-thread",
            pinned: false,
            isInfrastructure: false
        )

        // Add to messages immediately (optimistic update)
        messages.append(optimisticMessage)
        // Track as pending so it survives refresh until server confirms
        pendingLocalMessages.append(optimisticMessage)

        await performAsyncAction(showLoading: false) {
            let request = SendMessageRequest(
                to: self.selectedRecipient,
                subject: subject,
                body: text,
                type: .task
            )
            _ = try await self.apiClient.sendMail(request)

            // Simulate typing indicator briefly
            self.isTyping = true
            try? await Task.sleep(nanoseconds: 1_500_000_000) // 1.5 seconds
            self.isTyping = false

            // Refresh to get the new message and any response
            await self.refresh()
        }
    }

    /// Send a voice transcription as a message
    func sendVoiceTranscription(_ text: String) async {
        inputText = text
        await sendMessage()
    }

    // MARK: - Voice Input

    /// Toggle voice recording on/off
    func toggleVoiceRecording() {
        guard let service = speechService else {
            speechError = "Speech recognition not available"
            return
        }

        if isRecordingVoice {
            service.stopRecording()
        } else {
            startVoiceRecording()
        }
    }

    /// Start voice recording after checking authorization
    private func startVoiceRecording() {
        guard let service = speechService else { return }

        // Check if already authorized
        if service.authorizationStatus == .authorized {
            do {
                try service.startRecording()
            } catch {
                speechError = error.localizedDescription
            }
        } else {
            // Request authorization first
            Task {
                let status = await service.requestAuthorization()
                if status == .authorized {
                    do {
                        try service.startRecording()
                    } catch {
                        self.speechError = error.localizedDescription
                    }
                } else {
                    self.speechError = status.errorMessage
                }
            }
        }
    }

    /// Set up bindings to speech service publishers
    private func setupSpeechBindings() {
        guard let service = speechService else { return }

        // Bind recording state
        service.statePublisher
            .receive(on: DispatchQueue.main)
            .map { $0.isRecording }
            .assign(to: &$isRecordingVoice)

        // Bind transcription to input text while recording
        service.transcriptionPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] text in
                guard let self = self, self.isRecordingVoice else { return }
                self.inputText = text
            }
            .store(in: &speechCancellables)

        // Handle final transcription - auto-send if non-empty
        service.finalTranscriptionPublisher
            .receive(on: DispatchQueue.main)
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .sink { [weak self] text in
                guard let self = self else { return }
                Task {
                    await self.sendVoiceTranscription(text)
                }
            }
            .store(in: &speechCancellables)

        // Bind authorization status
        service.authorizationStatusPublisher
            .receive(on: DispatchQueue.main)
            .assign(to: &$speechAuthorizationStatus)

        // Handle errors from state
        service.statePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                if case .error(let message) = state {
                    self?.speechError = message
                }
            }
            .store(in: &speechCancellables)
    }

    /// Clear speech error
    func clearSpeechError() {
        speechError = nil
    }

    // MARK: - Private Methods

    /// Generate a subject line from the message body
    /// - Parameter body: The full message body text
    /// - Returns: First ~50 characters truncated at word boundary, or "Chat" if empty
    private static func generateSubject(from body: String) -> String {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "Chat" }

        // If short enough, use as-is
        if trimmed.count <= 50 {
            return trimmed
        }

        // Truncate at word boundary
        let prefix = String(trimmed.prefix(50))
        if let lastSpace = prefix.lastIndex(of: " ") {
            return String(prefix[..<lastSpace]) + "..."
        }
        return prefix + "..."
    }

    /// Filter messages to only include conversations with the selected recipient
    private func filterRecipientMessages(_ messages: [Message]) -> [Message] {
        messages.filter { message in
            message.from == selectedRecipient || message.to == selectedRecipient
        }
    }

    /// Start polling for new messages
    private func startPolling() {
        pollingTask?.cancel()
        pollingTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(pollingInterval * 1_000_000_000))
                guard !Task.isCancelled else { break }

                // Check for new messages
                if let response = await performAsync(showLoading: false, {
                    try await self.apiClient.getMail(filter: .user, all: false)
                }) {
                    let newRecipientMessages = filterRecipientMessages(response.items)
                    if let newest = newRecipientMessages.first, newest.id != lastMessageId {
                        await refresh()
                    }
                }
            }
        }
    }

    // MARK: - Computed Properties

    /// Check if a message is from the user (outgoing)
    func isOutgoing(_ message: Message) -> Bool {
        message.to == selectedRecipient
    }

    /// Check if we can send a message
    var canSend: Bool {
        !inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isLoading
    }

    /// Display name for the selected recipient
    var recipientDisplayName: String {
        // Check if we have this recipient in our list
        if let crew = availableRecipients.first(where: { $0.id == selectedRecipient }) {
            return crew.name.uppercased()
        }
        // Fallback: format the ID (e.g., "mayor/" -> "MAYOR")
        return selectedRecipient
            .replacingOccurrences(of: "/", with: "")
            .uppercased()
    }

    /// Short ID for the recipient (for input placeholder)
    var recipientShortName: String {
        recipientDisplayName
    }
}
