import Foundation
import Combine
import AdjutantKit

// MARK: - Message Delivery State

enum MessageDeliveryState: Equatable {
    case sending
    case delivered
    case read
    case failed(String)

    static func == (lhs: MessageDeliveryState, rhs: MessageDeliveryState) -> Bool {
        switch (lhs, rhs) {
        case (.sending, .sending), (.delivered, .delivered), (.read, .read):
            return true
        case (.failed(let a), .failed(let b)):
            return a == b
        default:
            return false
        }
    }
}

/// ViewModel for the Chat feature.
/// Handles loading messages, sending new messages, and managing chat state.
/// Supports chatting with Mayor or any crew agent.
/// Uses WebSocket for real-time messaging with REST polling as fallback.
@MainActor
final class ChatViewModel: BaseViewModel {
    // MARK: - Published Properties

    /// Messages in the conversation, sorted newest last
    @Published private(set) var messages: [Message] = []

    /// Current input text
    @Published var inputText: String = ""

    /// Default recipient address, configurable per deployment mode.
    /// Gas Town uses "mayor/", standalone uses "user".
    static var defaultRecipient: String = "mayor/"

    /// Currently selected recipient
    @Published private(set) var selectedRecipient: String = ChatViewModel.defaultRecipient

    /// All available recipients (agents)
    @Published private(set) var availableRecipients: [CrewMember] = []

    /// Whether the recipient is currently typing (real from WS or simulated)
    @Published private(set) var isTyping: Bool = false

    /// Agent typing state from WebSocket
    @Published private(set) var isAgentTyping: Bool = false

    /// Agent activity description (e.g., "Thinking...", "Typing...")
    @Published private(set) var agentActivity: String = ""

    /// Delivery states for outbound messages
    @Published private(set) var deliveryStates: [String: MessageDeliveryState] = [:]

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

    /// Whether audio is currently playing
    @Published private(set) var isPlayingAudio = false

    /// Whether audio is being synthesized
    @Published private(set) var isSynthesizing = false

    /// ID of the message currently being played
    @Published private(set) var playingMessageId: String?

    // MARK: - Dependencies

    private let apiClient: APIClient
    private let connectionManager: ConnectionManager
    private let speechService: (any SpeechRecognitionServiceProtocol)?
    private var ttsService: any TTSPlaybackServiceProtocol

    // MARK: - Private Properties

    private var pollingTask: Task<Void, Never>?
    /// Polling interval for chat (30 seconds per spec)
    private let pollingInterval: TimeInterval = 30.0
    private var lastMessageId: String?
    private var speechCancellables = Set<AnyCancellable>()
    /// Pending optimistic messages that haven't been confirmed by the server yet
    private var pendingLocalMessages: [Message] = []
    /// Task for debouncing typing indicator stop
    private var typingDebounceTask: Task<Void, Never>?
    /// Maps outbound WS message IDs to local optimistic message IDs
    private var pendingMessageMap: [String: String] = [:]
    /// Currently active streaming message content keyed by streamId
    private var activeStreams: [String: (localId: String, body: String)] = [:]

    // MARK: - Initialization

    init(apiClient: APIClient? = nil, connectionManager: ConnectionManager? = nil, speechService: (any SpeechRecognitionServiceProtocol)? = nil, ttsService: (any TTSPlaybackServiceProtocol)? = nil) {
        let client = apiClient ?? AppState.shared.apiClient
        self.apiClient = client
        self.connectionManager = connectionManager ?? AppState.shared.connectionManager
        self.speechService = speechService
        self.ttsService = ttsService ?? (DependencyContainer.shared.resolveOptional((any TTSPlaybackServiceProtocol).self)
            ?? TTSPlaybackService(apiClient: client, baseURL: AppState.shared.apiBaseURL))
        super.init()
        setupSpeechBindings()
        setupPlaybackObservers()
        setupTypingObserver()
        loadFromCache()
    }

    // MARK: - TTS Setup

    private func setupPlaybackObservers() {
        // Observe playback state changes
        ttsService.statePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                self?.isPlayingAudio = state.isPlaying
                // Clear playingMessageId when playback stops
                if !state.isPlaying {
                    self?.playingMessageId = nil
                }
            }
            .store(in: &cancellables)

        // Sync volume from user preferences
        let savedVolume = UserDefaults.standard.double(forKey: "voiceVolume")
        ttsService.volume = Float(savedVolume == 0 ? 0.8 : savedVolume)
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
        typingDebounceTask?.cancel()
    }

    // MARK: - Lifecycle

    override func onAppear() {
        super.onAppear()
        Task {
            await loadRecipients()
        }
        subscribeToMessages()
        startPolling()
    }

    override func onDisappear() {
        super.onDisappear()
        pollingTask?.cancel()
        pollingTask = nil
        typingDebounceTask?.cancel()
        typingDebounceTask = nil
        unsubscribeFromMessages()
    }

    // MARK: - WebSocket Subscription

    /// Subscribe to WebSocket message events via ConnectionManager
    private func subscribeToMessages() {
        connectionManager.onMessage = { [weak self] inbound in
            Task { @MainActor in
                self?.handleInboundMessage(inbound)
            }
        }

        connectionManager.onTyping = { [weak self] indicator in
            Task { @MainActor in
                self?.handleTypingIndicator(indicator)
            }
        }

        connectionManager.onStreamToken = { [weak self] token in
            Task { @MainActor in
                self?.handleStreamToken(token)
            }
        }

        connectionManager.onDelivered = { [weak self] messageId in
            Task { @MainActor in
                self?.handleDeliveryConfirmation(messageId)
            }
        }
    }

    /// Remove WebSocket subscriptions
    private func unsubscribeFromMessages() {
        connectionManager.onMessage = nil
        connectionManager.onTyping = nil
        connectionManager.onStreamToken = nil
        connectionManager.onDelivered = nil
    }

    /// Handle an inbound message from WebSocket
    private func handleInboundMessage(_ inbound: InboundMessage) {
        // Only show messages for the selected conversation
        guard inbound.from == selectedRecipient || inbound.to == selectedRecipient else { return }

        // Check for duplicate (already received via polling)
        guard !messages.contains(where: { $0.id == inbound.id }) else { return }

        let message = Message(
            id: inbound.id,
            from: inbound.from,
            to: inbound.to,
            subject: "",
            body: inbound.body,
            timestamp: ISO8601DateFormatter().string(from: inbound.timestamp),
            read: true,
            priority: .normal,
            type: .task,
            threadId: inbound.threadId ?? "",
            pinned: false,
            isInfrastructure: false
        )

        messages.append(message)
        lastMessageId = inbound.id
        ResponseCache.shared.updateChatMessages(messages)

        // Clear agent typing when a message arrives
        isAgentTyping = false
        isTyping = false
        agentActivity = ""
    }

    /// Handle typing indicator from WebSocket
    private func handleTypingIndicator(_ indicator: TypingIndicator) {
        guard indicator.from == selectedRecipient else { return }

        switch indicator.state {
        case .started:
            isAgentTyping = true
            isTyping = true
            agentActivity = "Typing..."
        case .thinking:
            isAgentTyping = true
            isTyping = true
            agentActivity = "Thinking..."
        case .stopped:
            isAgentTyping = false
            isTyping = false
            agentActivity = ""
        }
    }

    /// Handle stream token from WebSocket
    private func handleStreamToken(_ token: StreamToken) {
        if token.done {
            // Stream complete — finalize the message
            if let stream = activeStreams.removeValue(forKey: token.streamId),
               let index = messages.firstIndex(where: { $0.id == stream.localId }) {
                let finalized = Message(
                    id: stream.localId,
                    from: selectedRecipient,
                    to: "user",
                    subject: "",
                    body: stream.body,
                    timestamp: messages[index].timestamp,
                    read: true,
                    priority: .normal,
                    type: .task,
                    threadId: "",
                    pinned: false,
                    isInfrastructure: false
                )
                messages[index] = finalized
                ResponseCache.shared.updateChatMessages(messages)
            }
            isAgentTyping = false
            isTyping = false
            agentActivity = ""
            return
        }

        if var stream = activeStreams[token.streamId] {
            // Append token to existing stream
            stream.body += token.token
            activeStreams[token.streamId] = stream

            // Update the message in-place
            if let index = messages.firstIndex(where: { $0.id == stream.localId }) {
                let updated = Message(
                    id: stream.localId,
                    from: selectedRecipient,
                    to: "user",
                    subject: "",
                    body: stream.body,
                    timestamp: messages[index].timestamp,
                    read: true,
                    priority: .normal,
                    type: .task,
                    threadId: "",
                    pinned: false,
                    isInfrastructure: false
                )
                messages[index] = updated
            }
        } else {
            // New stream — create a streaming message
            let localId = "stream-\(token.streamId)"
            let body = token.token
            activeStreams[token.streamId] = (localId: localId, body: body)

            let message = Message(
                id: localId,
                from: selectedRecipient,
                to: "user",
                subject: "",
                body: body,
                timestamp: ISO8601DateFormatter().string(from: Date()),
                read: true,
                priority: .normal,
                type: .task,
                threadId: "",
                pinned: false,
                isInfrastructure: false
            )
            messages.append(message)
            isAgentTyping = true
            isTyping = true
            agentActivity = "Typing..."
        }
    }

    /// Handle delivery confirmation from WebSocket
    private func handleDeliveryConfirmation(_ messageId: String) {
        // Map the server message ID back to our local optimistic message ID
        if let localId = pendingMessageMap.removeValue(forKey: messageId) {
            deliveryStates[localId] = .delivered
        } else {
            deliveryStates[messageId] = .delivered
        }
    }

    // MARK: - Typing Indicator Sending

    /// Set up observer to send typing indicators when user types
    private func setupTypingObserver() {
        $inputText
            .dropFirst()
            .removeDuplicates()
            .sink { [weak self] text in
                guard let self else { return }
                if !text.isEmpty {
                    self.sendTypingStarted()
                }
            }
            .store(in: &cancellables)
    }

    /// Send typing started indicator and schedule debounced stop
    private func sendTypingStarted() {
        connectionManager.sendTyping(to: selectedRecipient, state: .started)

        // Cancel existing debounce and schedule a new stop after 3 seconds
        typingDebounceTask?.cancel()
        typingDebounceTask = Task {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled else { return }
            self.sendTypingStopped()
        }
    }

    /// Send typing stopped indicator
    private func sendTypingStopped() {
        typingDebounceTask?.cancel()
        typingDebounceTask = nil
        connectionManager.sendTyping(to: selectedRecipient, state: .stopped)
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
        activeStreams = [:]
        pendingMessageMap = [:]
        deliveryStates = [:]
        isAgentTyping = false
        isTyping = false
        agentActivity = ""
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

        // Stop typing indicator on send
        sendTypingStopped()

        if connectionManager.wsState == .connected {
            // Send via WebSocket
            let outbound = OutboundMessage(to: selectedRecipient, body: text)
            deliveryStates[optimisticMessage.id] = .sending
            pendingMessageMap[outbound.id.uuidString] = optimisticMessage.id
            connectionManager.sendMessage(outbound)
        } else {
            // Fall back to REST
            await performAsyncAction(showLoading: false) {
                let request = SendMessageRequest(
                    to: self.selectedRecipient,
                    subject: subject,
                    body: text,
                    type: .task
                )
                _ = try await self.apiClient.sendMail(request)

                // Refresh to get the new message and any response
                await self.refresh()
            }
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

    // MARK: - TTS Playback

    /// Synthesizes and plays TTS audio for a message
    func playAudio(for message: Message) async {
        guard !isSynthesizing else { return }

        isSynthesizing = true
        playingMessageId = message.id

        do {
            let request = SynthesizeRequest(text: message.body, messageId: message.id)
            let response = try await apiClient.synthesizeSpeech(request)

            // Enqueue to TTS service with message metadata
            ttsService.enqueue(
                text: message.body,
                response: response,
                priority: .normal,
                metadata: ["messageId": message.id]
            )

            isSynthesizing = false
        } catch {
            isSynthesizing = false
            playingMessageId = nil
            handleError(error)
        }
    }

    /// Stops audio playback
    func stopAudio() {
        ttsService.stop()
        playingMessageId = nil
    }

    /// Check if a specific message is currently playing
    func isPlaying(message: Message) -> Bool {
        playingMessageId == message.id && isPlayingAudio
    }

    /// Check if a specific message is currently synthesizing
    func isSynthesizing(message: Message) -> Bool {
        playingMessageId == message.id && isSynthesizing
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

    /// Start polling for new messages (skips polls when WebSocket is connected)
    private func startPolling() {
        pollingTask?.cancel()
        pollingTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(pollingInterval * 1_000_000_000))
                guard !Task.isCancelled else { break }

                // Skip polling when WebSocket is connected
                if connectionManager.wsState == .connected { continue }

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
