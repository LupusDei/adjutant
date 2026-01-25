import Foundation
import Combine
import AVFoundation
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
    private var audioPlayer: AVAudioPlayer?
    private lazy var audioDelegate = AudioPlayerDelegate { [weak self] in
        Task { @MainActor in
            self?.isPlayingAudio = false
        }
    }

    // MARK: - Initialization

    init(messageId: String, apiClient: APIClient? = nil) {
        self.messageId = messageId
        self.apiClient = apiClient ?? APIClient()
        super.init()
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

            // Extract filename from audioUrl path (e.g., "/voice/audio/file.mp3" -> "file.mp3")
            let filename = URL(string: response.audioUrl)?.lastPathComponent ?? response.audioUrl

            // Get the audio data
            let audioData = try await apiClient.getAudioFile(filename: filename)

            // Play the audio
            audioPlayer = try AVAudioPlayer(data: audioData)
            audioPlayer?.delegate = audioDelegate
            audioPlayer?.play()
            isPlayingAudio = true
            isSynthesizing = false
        } catch {
            isSynthesizing = false
            handleError(error)
        }
    }

    /// Stops audio playback
    func stopAudio() {
        audioPlayer?.stop()
        audioPlayer = nil
        isPlayingAudio = false
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

// MARK: - Audio Player Delegate

/// Simple delegate to handle audio playback completion
private class AudioPlayerDelegate: NSObject, AVAudioPlayerDelegate {
    private let onFinish: () -> Void

    init(onFinish: @escaping () -> Void) {
        self.onFinish = onFinish
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        onFinish()
    }
}
