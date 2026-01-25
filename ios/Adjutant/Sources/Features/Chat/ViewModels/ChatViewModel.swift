import Foundation
import Combine
import AdjutantKit

/// ViewModel for the Mayor Chat feature.
/// Handles loading messages, sending new messages, and managing chat state.
@MainActor
final class ChatViewModel: BaseViewModel {
    // MARK: - Published Properties

    /// Messages in the conversation, sorted newest last
    @Published private(set) var messages: [Message] = []

    /// Current input text
    @Published var inputText: String = ""

    /// Whether the Mayor is currently typing (simulated)
    @Published private(set) var isTyping: Bool = false

    /// Whether voice input is active
    @Published var isRecordingVoice: Bool = false

    /// Whether there are more messages to load
    @Published private(set) var hasMoreHistory: Bool = true

    /// Whether we're currently loading more history
    @Published private(set) var isLoadingHistory: Bool = false

    // MARK: - Dependencies

    private let apiClient: APIClient

    // MARK: - Private Properties

    private var pollingTask: Task<Void, Never>?
    private let pollingInterval: TimeInterval = 5.0
    private var lastMessageId: String?

    // MARK: - Initialization

    init(apiClient: APIClient) {
        self.apiClient = apiClient
        super.init()
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
        pollingTask?.cancel()
        pollingTask = nil
    }

    // MARK: - Data Loading

    override func refresh() async {
        await performAsyncAction(showLoading: messages.isEmpty) {
            let response = try await self.apiClient.getMail(filter: .user, all: false)
            self.messages = self.filterMayorMessages(response.data).sorted { msg1, msg2 in
                // Sort by timestamp, oldest first (for chat display)
                (msg1.date ?? Date.distantPast) < (msg2.date ?? Date.distantPast)
            }
            self.lastMessageId = self.messages.last?.id
        }
    }

    /// Load more history (older messages)
    func loadMoreHistory() async {
        guard !isLoadingHistory, hasMoreHistory else { return }

        isLoadingHistory = true
        defer { isLoadingHistory = false }

        await performAsyncAction(showLoading: false) {
            // For now, load all messages - pagination could be added later
            let response = try await self.apiClient.getMail(filter: .user, all: true)
            let allMayorMessages = self.filterMayorMessages(response.data).sorted { msg1, msg2 in
                (msg1.date ?? Date.distantPast) < (msg2.date ?? Date.distantPast)
            }

            // If we got the same count, there's no more history
            if allMayorMessages.count <= self.messages.count {
                self.hasMoreHistory = false
            } else {
                self.messages = allMayorMessages
            }
        }
    }

    // MARK: - Sending Messages

    /// Send a message to the Mayor
    func sendMessage() async {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        // Clear input immediately for responsive feel
        inputText = ""

        await performAsyncAction(showLoading: false) {
            let request = SendMessageRequest(
                to: "mayor/",
                subject: "",
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

    // MARK: - Private Methods

    /// Filter messages to only include Mayor conversations
    private func filterMayorMessages(_ messages: [Message]) -> [Message] {
        messages.filter { message in
            message.from == "mayor/" || message.to == "mayor/"
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
                    let newMayorMessages = filterMayorMessages(response.data)
                    if let newest = newMayorMessages.first, newest.id != lastMessageId {
                        await refresh()
                    }
                }
            }
        }
    }

    // MARK: - Computed Properties

    /// Check if a message is from the user (outgoing)
    func isOutgoing(_ message: Message) -> Bool {
        message.to == "mayor/"
    }

    /// Check if we can send a message
    var canSend: Bool {
        !inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isLoading
    }
}
