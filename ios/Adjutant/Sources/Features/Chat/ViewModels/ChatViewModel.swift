import Foundation
import Combine
import AdjutantKit

/// ViewModel for the Chat feature.
/// Uses WebSocket for real-time messaging with HTTP polling fallback.
/// Supports optimistic UI with delivery confirmation, real typing indicators,
/// and token-by-token streaming responses.
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

    /// Whether the recipient is currently typing
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

    /// Whether audio is currently playing
    @Published private(set) var isPlayingAudio = false

    /// Whether audio is being synthesized
    @Published private(set) var isSynthesizing = false

    /// ID of the message currently being played
    @Published private(set) var playingMessageId: String?

    /// Current communication method (HTTP polling, SSE, or WebSocket)
    @Published private(set) var communicationMethod: CommunicationMethod = .http

    /// Current connection state for UI display
    @Published private(set) var connectionState: ConnectionState = .connecting

    /// Whether a stream is currently active
    @Published private(set) var isStreamActive: Bool = false

    /// Timestamp of the last successful poll/data fetch
    @Published private(set) var lastPollTime: Date?

    /// Text being streamed token-by-token (nil when no active stream)
    @Published private(set) var streamingText: String?

    // MARK: - Dependencies

    private let apiClient: APIClient
    private let speechService: (any SpeechRecognitionServiceProtocol)?
    private var ttsService: any TTSPlaybackServiceProtocol
    private let wsService: ChatWebSocketService

    // MARK: - Private Properties

    private var pollingTask: Task<Void, Never>?
    /// Polling interval for fallback (30 seconds)
    private let pollingInterval: TimeInterval = 30.0
    private var lastMessageId: String?
    private var speechCancellables = Set<AnyCancellable>()
    /// Pending optimistic messages: clientId -> Message
    private var pendingLocalMessages: [String: Message] = [:]
    /// Track which client IDs have been confirmed by server
    private var confirmedClientIds: Set<String> = []
    /// Typing debounce timer
    private var typingDebounceTask: Task<Void, Never>?
    private var lastTypingSentAt: Date = .distantPast

    // MARK: - Initialization

    init(
        apiClient: APIClient? = nil,
        speechService: (any SpeechRecognitionServiceProtocol)? = nil,
        ttsService: (any TTSPlaybackServiceProtocol)? = nil,
        wsService: ChatWebSocketService? = nil
    ) {
        let client = apiClient ?? AppState.shared.apiClient
        self.apiClient = client
        self.speechService = speechService
        self.ttsService = ttsService ?? (DependencyContainer.shared.resolveOptional((any TTSPlaybackServiceProtocol).self)
            ?? TTSPlaybackService(apiClient: client, baseURL: AppState.shared.apiBaseURL))
        self.wsService = wsService ?? ChatWebSocketService()
        super.init()
        setupSpeechBindings()
        setupPlaybackObservers()
        setupWebSocketBindings()
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
    }

    // MARK: - WebSocket Setup

    private func setupWebSocketBindings() {
        // Connection state — map WebSocket states to UI ConnectionState/CommunicationMethod
        wsService.$connectionState
            .receive(on: DispatchQueue.main)
            .sink { [weak self] wsState in
                self?.handleWebSocketStateChange(wsState)
            }
            .store(in: &cancellables)

        // Real typing indicators from remote agents
        wsService.$isRemoteTyping
            .receive(on: DispatchQueue.main)
            .assign(to: &$isTyping)

        // Incoming messages from WebSocket
        wsService.incomingMessage
            .receive(on: DispatchQueue.main)
            .sink { [weak self] message in
                self?.handleIncomingMessage(message)
            }
            .store(in: &cancellables)

        // Delivery confirmations for optimistic messages
        wsService.deliveryConfirmation
            .receive(on: DispatchQueue.main)
            .sink { [weak self] confirmation in
                self?.handleDeliveryConfirmation(confirmation)
            }
            .store(in: &cancellables)

        // Stream tokens for live streaming
        wsService.streamToken
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.streamingText = self?.wsService.activeStream?.assembledText
                self?.isStreamActive = true
                if self?.communicationMethod == .websocket {
                    self?.connectionState = .streaming
                }
            }
            .store(in: &cancellables)

        // Stream completion
        wsService.streamEnd
            .receive(on: DispatchQueue.main)
            .sink { [weak self] result in
                self?.handleStreamEnd(result)
            }
            .store(in: &cancellables)
    }

    // MARK: - Lifecycle

    override func onAppear() {
        super.onAppear()
        connectionState = .connecting
        Task {
            await loadRecipients()
        }
        connectWebSocket()
        observeNetworkChanges()
    }

    override func onDisappear() {
        super.onDisappear()
        wsService.disconnect()
        pollingTask?.cancel()
        pollingTask = nil
    }

    // MARK: - Connection Management

    private func connectWebSocket() {
        let baseURL = AppState.shared.apiBaseURL
        let apiKey = AppState.shared.apiKey
        wsService.connect(baseURL: baseURL, apiKey: apiKey)
    }

    private func handleWebSocketStateChange(_ wsState: WebSocketConnectionState) {
        switch wsState {
        case .connected:
            // WebSocket connected — update UI and stop polling fallback
            communicationMethod = .websocket
            connectionState = .connected
            pollingTask?.cancel()
            pollingTask = nil
            // Do an initial refresh to seed messages from server
            Task { await refresh() }

        case .connecting, .authenticating:
            connectionState = .connecting

        case .reconnecting:
            // Fall back to HTTP while reconnecting
            communicationMethod = .http
            connectionState = .connecting
            if pollingTask == nil {
                startPolling()
            }

        case .disconnected:
            // WebSocket failed — fall back to HTTP polling
            communicationMethod = .http
            connectionState = .disconnected
            startPolling()
        }
    }

    // MARK: - Data Loading

    override func refresh() async {
        await performAsyncAction(showLoading: messages.isEmpty) {
            let response = try await self.apiClient.getMail(filter: .user, all: false)
            self.markConnectionSuccess()

            var serverMessages = self.filterRecipientMessages(response.items).sorted { msg1, msg2 in
                (msg1.date ?? Date.distantPast) < (msg2.date ?? Date.distantPast)
            }

            // Remove pending local messages that have been confirmed by server
            let confirmedIds = self.confirmedClientIds
            let pending = self.pendingLocalMessages
            for (clientId, localMsg) in pending {
                if confirmedIds.contains(clientId) {
                    self.pendingLocalMessages.removeValue(forKey: clientId)
                } else if serverMessages.contains(where: { self.isConfirmedMessage(local: localMsg, server: $0) }) {
                    self.pendingLocalMessages.removeValue(forKey: clientId)
                }
            }

            // Merge remaining pending local messages with server messages
            let remainingPending = Array(self.pendingLocalMessages.values)
            if !remainingPending.isEmpty {
                serverMessages.append(contentsOf: remainingPending)
                serverMessages.sort { msg1, msg2 in
                    (msg1.date ?? Date.distantPast) < (msg2.date ?? Date.distantPast)
                }
            }

            self.messages = serverMessages
            self.lastMessageId = serverMessages.filter { !$0.id.hasPrefix("local-") }.last?.id
            ResponseCache.shared.updateChatMessages(self.messages)
        }
    }

    /// Check if a server message confirms a pending local message
    private func isConfirmedMessage(local: Message, server: Message) -> Bool {
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
        messages = []
        pendingLocalMessages = [:]
        confirmedClientIds = []
        streamingText = nil
        await refresh()
    }

    /// Load more history (older messages)
    func loadMoreHistory() async {
        guard !isLoadingHistory, hasMoreHistory else { return }

        isLoadingHistory = true
        defer { isLoadingHistory = false }

        await performAsyncAction(showLoading: false) {
            let response = try await self.apiClient.getMail(filter: .user, all: true)
            var allRecipientMessages = self.filterRecipientMessages(response.items).sorted { msg1, msg2 in
                (msg1.date ?? Date.distantPast) < (msg2.date ?? Date.distantPast)
            }

            // Remove confirmed pending messages
            let confirmedIds = self.confirmedClientIds
            let pending = self.pendingLocalMessages
            for (clientId, localMsg) in pending {
                if confirmedIds.contains(clientId) {
                    self.pendingLocalMessages.removeValue(forKey: clientId)
                } else if allRecipientMessages.contains(where: { self.isConfirmedMessage(local: localMsg, server: $0) }) {
                    self.pendingLocalMessages.removeValue(forKey: clientId)
                }
            }

            let remainingPending = Array(self.pendingLocalMessages.values)
            if !remainingPending.isEmpty {
                allRecipientMessages.append(contentsOf: remainingPending)
                allRecipientMessages.sort { msg1, msg2 in
                    (msg1.date ?? Date.distantPast) < (msg2.date ?? Date.distantPast)
                }
            }

            let serverOnlyCount = allRecipientMessages.filter { !$0.id.hasPrefix("local-") }.count
            if serverOnlyCount <= self.messages.filter({ !$0.id.hasPrefix("local-") }).count {
                self.hasMoreHistory = false
            } else {
                self.messages = allRecipientMessages
            }
        }
    }

    // MARK: - WebSocket Message Handling

    private func handleIncomingMessage(_ message: Message) {
        // Only show messages for the current recipient conversation
        guard message.from == selectedRecipient || message.to == selectedRecipient else { return }

        // Avoid duplicates
        guard !messages.contains(where: { $0.id == message.id }) else { return }

        messages.append(message)
        messages.sort { ($0.date ?? .distantPast) < ($1.date ?? .distantPast) }
        ResponseCache.shared.updateChatMessages(messages)
    }

    private func handleDeliveryConfirmation(_ confirmation: (clientId: String, serverId: String, timestamp: String)) {
        confirmedClientIds.insert(confirmation.clientId)

        // Replace the local-* message with confirmed server ID
        let localId = "local-\(confirmation.clientId)"
        if let index = messages.firstIndex(where: { $0.id == localId }) {
            let original = messages[index]
            let confirmed = Message(
                id: confirmation.serverId,
                from: original.from,
                to: original.to,
                subject: original.subject,
                body: original.body,
                timestamp: confirmation.timestamp,
                read: original.read,
                priority: original.priority,
                type: original.type,
                threadId: original.threadId,
                pinned: original.pinned,
                isInfrastructure: original.isInfrastructure
            )
            messages[index] = confirmed
            pendingLocalMessages.removeValue(forKey: confirmation.clientId)
            ResponseCache.shared.updateChatMessages(messages)
        }
    }

    private func handleStreamEnd(_ result: (streamId: String, messageId: String?)) {
        streamingText = nil
        isStreamActive = false
        if communicationMethod == .websocket {
            connectionState = .connected
        }
    }

    // MARK: - Sending Messages

    /// Send a message to the selected recipient
    func sendMessage() async {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        // Clear input immediately for responsive feel
        inputText = ""

        let subject = Self.generateSubject(from: text)
        let clientId = UUID().uuidString

        // Create optimistic local message for immediate display
        let optimisticMessage = Message(
            id: "local-\(clientId)",
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
        pendingLocalMessages[clientId] = optimisticMessage

        if wsService.isConnected {
            // Send via WebSocket — delivery confirmation comes back async
            wsService.sendMessage(to: selectedRecipient, body: text, clientId: clientId)
        } else {
            // Fallback: send via HTTP
            await performAsyncAction(showLoading: false) {
                let request = SendMessageRequest(
                    to: self.selectedRecipient,
                    subject: subject,
                    body: text,
                    type: .task
                )
                _ = try await self.apiClient.sendMail(request)
                await self.refresh()
            }
        }
    }

    /// Send a voice transcription as a message
    func sendVoiceTranscription(_ text: String) async {
        inputText = text
        await sendMessage()
    }

    // MARK: - Typing Indicators (Outbound)

    /// Called when the user is typing. Sends typing indicator over WebSocket.
    func userDidType() {
        guard wsService.isConnected else { return }

        // Debounce: don't send more than once every 3 seconds
        let now = Date()
        guard now.timeIntervalSince(lastTypingSentAt) > 3.0 else { return }
        lastTypingSentAt = now

        wsService.sendTypingStarted()

        // Auto-send "stopped" after 4 seconds of no typing
        typingDebounceTask?.cancel()
        typingDebounceTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            guard !Task.isCancelled else { return }
            self?.wsService.sendTypingStopped()
        }
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

        if service.authorizationStatus == .authorized {
            do {
                try service.startRecording()
            } catch {
                speechError = error.localizedDescription
            }
        } else {
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

        service.statePublisher
            .receive(on: DispatchQueue.main)
            .map { $0.isRecording }
            .assign(to: &$isRecordingVoice)

        service.transcriptionPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] text in
                guard let self = self, self.isRecordingVoice else { return }
                self.inputText = text
            }
            .store(in: &speechCancellables)

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

        service.authorizationStatusPublisher
            .receive(on: DispatchQueue.main)
            .assign(to: &$speechAuthorizationStatus)

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
    static func generateSubject(from body: String) -> String {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "Chat" }

        if trimmed.count <= 50 {
            return trimmed
        }

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

    /// Start polling for new messages (HTTP fallback when WebSocket is down)
    private func startPolling() {
        pollingTask?.cancel()
        pollingTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(pollingInterval * 1_000_000_000))
                guard !Task.isCancelled else { break }

                if let response = await performAsync(showLoading: false, {
                    try await self.apiClient.getMail(filter: .user, all: false)
                }) {
                    markConnectionSuccess()
                    let newRecipientMessages = filterRecipientMessages(response.items)
                    if let newest = newRecipientMessages.first, newest.id != lastMessageId {
                        await refresh()
                    }
                } else {
                    markConnectionFailure()
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
        if let crew = availableRecipients.first(where: { $0.id == selectedRecipient }) {
            return crew.name.uppercased()
        }
        return selectedRecipient
            .replacingOccurrences(of: "/", with: "")
            .uppercased()
    }

    /// Short ID for the recipient (for input placeholder)
    var recipientShortName: String {
        recipientDisplayName
    }

    /// Server URL for connection details display
    var serverURL: String {
        AppState.shared.apiBaseURL.host ?? "localhost"
    }

    // MARK: - Connection State

    /// Observe network changes to update connection state
    private func observeNetworkChanges() {
        NetworkMonitor.shared.$isConnected
            .receive(on: DispatchQueue.main)
            .sink { [weak self] isConnected in
                guard let self = self else { return }
                if !isConnected {
                    self.connectionState = .disconnected
                } else if self.connectionState == .disconnected {
                    self.connectionState = .connecting
                }
            }
            .store(in: &cancellables)
    }

    /// Update connection state after a successful API call
    private func markConnectionSuccess() {
        lastPollTime = Date()
        if connectionState == .connecting || connectionState == .disconnected {
            connectionState = .connected
        }
    }

    /// Update connection state after a failed API call
    private func markConnectionFailure() {
        if AppState.shared.isNetworkAvailable {
            connectionState = .connecting
        } else {
            connectionState = .disconnected
        }
    }
}
