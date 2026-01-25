import Foundation
import AVFoundation
import AdjutantKit
import Combine

// MARK: - PlaybackItem

/// An item in the TTS playback queue
public struct PlaybackItem: Identifiable, Equatable {
    public let id: UUID
    public let text: String
    public let audioURL: URL
    public let duration: TimeInterval
    public let voiceId: String
    public let priority: PlaybackPriority
    public let metadata: [String: String]
    public let createdAt: Date

    public init(
        id: UUID = UUID(),
        text: String,
        audioURL: URL,
        duration: TimeInterval,
        voiceId: String,
        priority: PlaybackPriority = .normal,
        metadata: [String: String] = [:],
        createdAt: Date = Date()
    ) {
        self.id = id
        self.text = text
        self.audioURL = audioURL
        self.duration = duration
        self.voiceId = voiceId
        self.priority = priority
        self.metadata = metadata
        self.createdAt = createdAt
    }
}

/// Priority levels for playback items
public enum PlaybackPriority: Int, Comparable, CaseIterable {
    case low = 0
    case normal = 1
    case high = 2
    case urgent = 3

    public static func < (lhs: PlaybackPriority, rhs: PlaybackPriority) -> Bool {
        lhs.rawValue < rhs.rawValue
    }
}

// MARK: - PlaybackState

/// Current state of the TTS playback service
public enum PlaybackState: Equatable {
    case idle
    case loading
    case playing(item: PlaybackItem)
    case paused(item: PlaybackItem)
    case error(message: String)

    public var isPlaying: Bool {
        if case .playing = self { return true }
        return false
    }

    public var isPaused: Bool {
        if case .paused = self { return true }
        return false
    }

    public var currentItem: PlaybackItem? {
        switch self {
        case .playing(let item), .paused(let item):
            return item
        default:
            return nil
        }
    }
}

// MARK: - TTSPlaybackServiceProtocol

/// Protocol for TTS playback service
@MainActor
public protocol TTSPlaybackServiceProtocol: ServiceProtocol {
    /// Current playback state
    var state: PlaybackState { get }

    /// Publisher for state changes
    var statePublisher: AnyPublisher<PlaybackState, Never> { get }

    /// Current queue of items waiting to be played
    var queue: [PlaybackItem] { get }

    /// Publisher for queue changes
    var queuePublisher: AnyPublisher<[PlaybackItem], Never> { get }

    /// Current volume level (0.0 to 1.0)
    var volume: Float { get set }

    /// Publisher for volume changes
    var volumePublisher: AnyPublisher<Float, Never> { get }

    /// Add an item to the playback queue
    func enqueue(_ item: PlaybackItem)

    /// Add items to the playback queue
    func enqueue(_ items: [PlaybackItem])

    /// Create and enqueue a playback item from synthesis response
    func enqueue(text: String, response: SynthesizeResponse, priority: PlaybackPriority, metadata: [String: String])

    /// Remove an item from the queue
    func dequeue(id: UUID)

    /// Clear all items from the queue
    func clearQueue()

    /// Start or resume playback
    func play()

    /// Pause playback
    func pause()

    /// Stop playback and clear current item
    func stop()

    /// Skip to the next item in the queue
    func skip()

    /// Move to specific position in current item
    func seek(to time: TimeInterval)

    /// Current playback position (if playing or paused)
    var currentTime: TimeInterval { get }

    /// Duration of current item (if playing or paused)
    var duration: TimeInterval { get }
}

// MARK: - TTSPlaybackService

/// Implementation of TTS playback service using AVAudioPlayer
@MainActor
public final class TTSPlaybackService: NSObject, TTSPlaybackServiceProtocol {

    // MARK: - ServiceProtocol

    public typealias ServiceError = TTSPlaybackError

    public var isAvailable: Bool {
        get async {
            return audioSession != nil
        }
    }

    // MARK: - Published State

    @Published private(set) public var state: PlaybackState = .idle
    @Published private(set) public var queue: [PlaybackItem] = []
    @Published public var volume: Float = 1.0 {
        didSet {
            audioPlayer?.volume = volume
        }
    }

    public var statePublisher: AnyPublisher<PlaybackState, Never> {
        $state.eraseToAnyPublisher()
    }

    public var queuePublisher: AnyPublisher<[PlaybackItem], Never> {
        $queue.eraseToAnyPublisher()
    }

    public var volumePublisher: AnyPublisher<Float, Never> {
        $volume.eraseToAnyPublisher()
    }

    // MARK: - Playback Position

    public var currentTime: TimeInterval {
        audioPlayer?.currentTime ?? 0
    }

    public var duration: TimeInterval {
        audioPlayer?.duration ?? state.currentItem?.duration ?? 0
    }

    // MARK: - Private Properties

    private var audioPlayer: AVAudioPlayer?
    private var audioSession: AVAudioSession?
    private let apiClient: APIClient
    private let baseURL: URL
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization

    public init(apiClient: APIClient, baseURL: URL) {
        self.apiClient = apiClient
        self.baseURL = baseURL
        super.init()
        configureAudioSession()
    }

    // MARK: - Audio Session Configuration

    private func configureAudioSession() {
        do {
            audioSession = AVAudioSession.sharedInstance()
            try audioSession?.setCategory(
                .playback,
                mode: .spokenAudio,
                options: [.allowBluetooth, .allowAirPlay, .mixWithOthers]
            )
            try audioSession?.setActive(true)
        } catch {
            state = .error(message: "Failed to configure audio session: \(error.localizedDescription)")
        }
    }

    // MARK: - Queue Management

    public func enqueue(_ item: PlaybackItem) {
        // Insert based on priority - higher priority items come first
        let insertIndex = queue.firstIndex { $0.priority < item.priority } ?? queue.endIndex
        queue.insert(item, at: insertIndex)

        // Auto-start if idle
        if case .idle = state {
            playNext()
        }
    }

    public func enqueue(_ items: [PlaybackItem]) {
        for item in items {
            enqueue(item)
        }
    }

    public func enqueue(
        text: String,
        response: SynthesizeResponse,
        priority: PlaybackPriority = .normal,
        metadata: [String: String] = [:]
    ) {
        guard let audioURL = URL(string: response.audioUrl, relativeTo: baseURL) else {
            return
        }

        let item = PlaybackItem(
            text: text,
            audioURL: audioURL,
            duration: response.duration,
            voiceId: response.voiceId,
            priority: priority,
            metadata: metadata
        )
        enqueue(item)
    }

    public func dequeue(id: UUID) {
        queue.removeAll { $0.id == id }
    }

    public func clearQueue() {
        queue.removeAll()
    }

    // MARK: - Playback Control

    public func play() {
        switch state {
        case .idle:
            playNext()
        case .paused(let item):
            audioPlayer?.play()
            state = .playing(item: item)
        case .playing:
            break // Already playing
        case .loading:
            break // Wait for load to complete
        case .error:
            // Try to recover by playing next
            playNext()
        }
    }

    public func pause() {
        guard case .playing(let item) = state else { return }
        audioPlayer?.pause()
        state = .paused(item: item)
    }

    public func stop() {
        audioPlayer?.stop()
        audioPlayer = nil
        state = .idle
    }

    public func skip() {
        audioPlayer?.stop()
        audioPlayer = nil
        playNext()
    }

    public func seek(to time: TimeInterval) {
        guard audioPlayer != nil else { return }
        audioPlayer?.currentTime = max(0, min(time, duration))
    }

    // MARK: - Private Methods

    private func playNext() {
        guard !queue.isEmpty else {
            state = .idle
            return
        }

        let item = queue.removeFirst()
        loadAndPlay(item)
    }

    private func loadAndPlay(_ item: PlaybackItem) {
        state = .loading

        Task {
            do {
                let data = try await fetchAudioData(for: item)
                try await playAudioData(data, for: item)
            } catch {
                await MainActor.run {
                    self.state = .error(message: error.localizedDescription)
                    // Try next item after a short delay
                    Task {
                        try? await Task.sleep(nanoseconds: 500_000_000)
                        await MainActor.run {
                            self.playNext()
                        }
                    }
                }
            }
        }
    }

    private func fetchAudioData(for item: PlaybackItem) async throws -> Data {
        // Extract filename from URL path
        let filename = item.audioURL.lastPathComponent
        return try await apiClient.getAudioFile(filename: filename)
    }

    @MainActor
    private func playAudioData(_ data: Data, for item: PlaybackItem) throws {
        audioPlayer = try AVAudioPlayer(data: data)
        audioPlayer?.delegate = self
        audioPlayer?.volume = volume
        audioPlayer?.prepareToPlay()

        if audioPlayer?.play() == true {
            state = .playing(item: item)
        } else {
            throw TTSPlaybackError.playbackFailed
        }
    }
}

// MARK: - AVAudioPlayerDelegate

extension TTSPlaybackService: AVAudioPlayerDelegate {
    nonisolated public func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            self.audioPlayer = nil
            self.playNext()
        }
    }

    nonisolated public func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        Task { @MainActor in
            self.state = .error(message: error?.localizedDescription ?? "Decode error occurred")
            self.audioPlayer = nil
            self.playNext()
        }
    }
}

// MARK: - Errors

public enum TTSPlaybackError: LocalizedError {
    case audioSessionConfigurationFailed
    case playbackFailed
    case invalidAudioData
    case networkError(Error)

    public var errorDescription: String? {
        switch self {
        case .audioSessionConfigurationFailed:
            return "Failed to configure audio session"
        case .playbackFailed:
            return "Failed to start audio playback"
        case .invalidAudioData:
            return "Invalid audio data received"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        }
    }
}
