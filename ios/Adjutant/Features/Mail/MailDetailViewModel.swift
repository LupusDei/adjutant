import Foundation
import Combine
import AdjutantKit

/// ViewModel for the mail detail view.
/// Handles message loading, threading, read status, and TTS playback.
@MainActor
final class MailDetailViewModel: BaseViewModel {
    // MARK: - Published Properties

    /// The main message being displayed
    @Published private(set) var message: Message?

    /// Thread messages (conversation history)
    @Published private(set) var threadMessages: [Message] = []

    /// Whether audio is currently playing
    @Published private(set) var isPlayingAudio = false

    /// Whether audio is being synthesized
    @Published private(set) var isSynthesizing = false

    // MARK: - Private Properties

    private let messageId: String
    private let apiClient: APIClient
    private var ttsService: TTSPlaybackServiceProtocol

    // MARK: - Initialization

    init(messageId: String, apiClient: APIClient? = nil, ttsService: TTSPlaybackServiceProtocol? = nil) {
        self.messageId = messageId
        self.apiClient = apiClient ?? AppState.shared.apiClient
        self.ttsService = ttsService ?? (DependencyContainer.shared.resolveOptional(TTSPlaybackServiceProtocol.self)
            ?? TTSPlaybackService(apiClient: apiClient ?? AppState.shared.apiClient, baseURL: AppState.shared.apiBaseURL))
        super.init()
        setupPlaybackObservers()
    }

    // MARK: - Setup

    private func setupPlaybackObservers() {
        // Observe playback state changes
        ttsService.statePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                self?.isPlayingAudio = state.isPlaying
            }
            .store(in: &cancellables)

        // Sync volume from user preferences
        let savedVolume = UserDefaults.standard.double(forKey: "voiceVolume")
        ttsService.volume = Float(savedVolume == 0 ? 0.8 : savedVolume)
    }

    // MARK: - Lifecycle

    override func refresh() async {
        await loadMessage()
    }

    // MARK: - Public Methods

    /// Loads the message and its thread
    func loadMessage() async {
        await performAsyncAction {
            // Load the main message
            let loadedMessage = try await self.apiClient.getMessage(id: self.messageId)
            self.message = loadedMessage

            // Mark as read
            _ = try? await self.apiClient.markMessageAsRead(id: self.messageId)

            // Load thread messages if there's a thread
            await self.loadThread(threadId: loadedMessage.threadId)
        }
    }

    /// Loads thread messages for conversation history
    private func loadThread(threadId: String) async {
        do {
            let allMail = try await apiClient.getMail(all: true)
            let thread = allMail.items
                .filter { $0.threadId == threadId }
                .sorted { ($0.date ?? Date.distantPast) < ($1.date ?? Date.distantPast) }

            // Exclude current message from thread display
            self.threadMessages = thread.filter { $0.id != self.messageId }
        } catch {
            // Thread loading failure is non-fatal
            self.threadMessages = []
        }
    }

    /// Synthesizes and plays TTS audio for the message body
    func playAudio() async {
        guard let message = message, !isSynthesizing else { return }

        isSynthesizing = true

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
            handleError(error)
        }
    }

    /// Stops audio playback
    func stopAudio() {
        ttsService.stop()
    }

    // MARK: - Computed Properties

    /// Formatted date string for display
    var formattedDate: String {
        guard let date = message?.date else { return "" }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    /// Priority display text
    var priorityText: String {
        guard let priority = message?.priority else { return "" }
        switch priority {
        case .urgent: return "P0 URGENT"
        case .high: return "P1 HIGH"
        case .normal: return "P2"
        case .low: return "P3"
        case .lowest: return "P4"
        }
    }

    /// Whether this message is part of a thread
    var hasThread: Bool {
        !threadMessages.isEmpty
    }
}
