import Foundation
import AVFoundation
import AdjutantKit
import Combine

/// Priority levels for voice announcements
public enum AnnouncementPriority: Int, Comparable {
    case low = 0
    case normal = 1
    case high = 2
    case urgent = 3

    public static func < (lhs: AnnouncementPriority, rhs: AnnouncementPriority) -> Bool {
        lhs.rawValue < rhs.rawValue
    }

    /// Converts to TTSPlaybackService priority
    var playbackPriority: PlaybackPriority {
        switch self {
        case .low: return .low
        case .normal: return .normal
        case .high: return .high
        case .urgent: return .urgent
        }
    }
}

/// Service that coordinates all voice announcements in the app.
/// Handles silent mode detection, audio session management, and TTS playback coordination.
@MainActor
public final class VoiceAnnouncementService: ObservableObject {

    // MARK: - Singleton

    public static let shared = VoiceAnnouncementService()

    // MARK: - Published Properties

    /// Whether voice announcements are currently enabled
    @Published public private(set) var isEnabled: Bool = true

    /// Whether the device is in silent mode
    @Published public private(set) var isSilentMode: Bool = false

    /// Number of announcements in queue
    @Published public private(set) var queueCount: Int = 0

    // MARK: - Private Properties

    private var ttsService: (any TTSPlaybackServiceProtocol)?
    private var apiClient: APIClient?
    private var cancellables = Set<AnyCancellable>()

    #if os(iOS)
    private var audioSession: AVAudioSession { AVAudioSession.sharedInstance() }
    #endif

    // MARK: - Initialization

    private init() {
        setupAudioSession()
        observeAppState()
        checkSilentMode()
    }

    // MARK: - Configuration

    /// Configures the service with required dependencies.
    /// Call this during app startup after AppState is initialized.
    public func configure(ttsService: any TTSPlaybackServiceProtocol, apiClient: APIClient) {
        self.ttsService = ttsService
        self.apiClient = apiClient

        // Subscribe to TTS queue changes
        ttsService.queuePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] queue in
                self?.queueCount = queue.count
            }
            .store(in: &cancellables)
    }

    // MARK: - Public API

    /// Announces text with the specified priority.
    /// Respects silent mode and app mute settings.
    /// - Parameters:
    ///   - text: The text to announce
    ///   - priority: Announcement priority (default: normal)
    public func announce(_ text: String, priority: AnnouncementPriority = .normal) async {
        guard canAnnounce() else { return }

        await synthesizeAndPlay(text: text, priority: priority)
    }

    /// Announces a bead status change.
    /// - Parameters:
    ///   - title: The bead title
    ///   - oldStatus: Previous status (optional)
    ///   - newStatus: New status
    ///   - priority: Announcement priority
    public func announceBeadStatusChange(
        title: String,
        oldStatus: String?,
        newStatus: String,
        priority: AnnouncementPriority = .normal
    ) async {
        let text = AnnouncementTextFormatter.formatStatusChange(
            title: title,
            oldStatus: oldStatus,
            newStatus: newStatus
        )
        await announce(text, priority: priority)
    }

    /// Announces new mail.
    /// - Parameters:
    ///   - from: Sender identifier
    ///   - subject: Mail subject
    ///   - bodyPreview: Optional body preview
    ///   - priority: Announcement priority
    public func announceNewMail(
        from: String,
        subject: String,
        bodyPreview: String? = nil,
        priority: AnnouncementPriority = .normal
    ) async {
        let text: String
        if let preview = bodyPreview {
            text = AnnouncementTextFormatter.formatMailAnnouncementWithPreview(
                from: from,
                subject: subject,
                bodyPreview: preview
            )
        } else {
            text = AnnouncementTextFormatter.formatMailAnnouncement(from: from, subject: subject)
        }
        await announce(text, priority: priority)
    }

    /// Checks and updates silent mode status.
    public func checkSilentMode() {
        #if os(iOS)
        // Check if audio output route indicates silent mode
        // When in silent mode, the audio route will be speaker but output volume is 0
        let route = audioSession.currentRoute
        let hasOutput = !route.outputs.isEmpty

        // Check if output volume is zero (proxy for silent mode)
        // Note: This isn't 100% reliable but works for most cases
        let outputVolume = audioSession.outputVolume
        isSilentMode = hasOutput && outputVolume == 0
        #else
        isSilentMode = false
        #endif
    }

    /// Clears all pending announcements.
    public func clearQueue() {
        ttsService?.clearQueue()
    }

    // MARK: - Private Methods

    private func setupAudioSession() {
        #if os(iOS)
        do {
            // Configure for speech playback that respects silent mode
            try audioSession.setCategory(
                .playback,
                mode: .spokenAudio,
                options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers]
            )

            // Observe route changes (headphones, bluetooth, etc.)
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(handleRouteChange),
                name: AVAudioSession.routeChangeNotification,
                object: nil
            )

            // Observe interruptions (phone calls, etc.)
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(handleInterruption),
                name: AVAudioSession.interruptionNotification,
                object: nil
            )
        } catch {
            print("[VoiceAnnouncementService] Failed to configure audio session: \(error)")
        }
        #endif
    }

    private func observeAppState() {
        // Observe mute toggle from AppState
        AppState.shared.$isVoiceMuted
            .receive(on: DispatchQueue.main)
            .sink { [weak self] isMuted in
                self?.isEnabled = !isMuted
            }
            .store(in: &cancellables)

        // Observe voice availability
        AppState.shared.$isVoiceAvailable
            .receive(on: DispatchQueue.main)
            .sink { [weak self] available in
                if !available {
                    self?.isEnabled = false
                }
            }
            .store(in: &cancellables)
    }

    private func canAnnounce() -> Bool {
        // Check all conditions that would prevent announcement
        guard isEnabled else {
            print("[VoiceAnnouncementService] Announcements disabled")
            return false
        }

        guard !AppState.shared.isVoiceMuted else {
            print("[VoiceAnnouncementService] Voice is muted")
            return false
        }

        guard AppState.shared.isVoiceAvailable else {
            print("[VoiceAnnouncementService] Voice service not available")
            return false
        }

        // Refresh silent mode check
        checkSilentMode()
        guard !isSilentMode else {
            print("[VoiceAnnouncementService] Device in silent mode")
            return false
        }

        guard ttsService != nil, apiClient != nil else {
            print("[VoiceAnnouncementService] Service not configured")
            return false
        }

        return true
    }

    private func synthesizeAndPlay(text: String, priority: AnnouncementPriority) async {
        guard let apiClient = apiClient, let ttsService = ttsService else { return }

        do {
            // Request synthesis from backend
            let request = SynthesizeRequest(text: text)
            let response = try await apiClient.synthesizeSpeech(request)

            // Enqueue for playback
            ttsService.enqueue(
                text: text,
                response: response,
                priority: priority.playbackPriority,
                metadata: ["type": "announcement"]
            )

            // Start playback if not already playing
            ttsService.play()

        } catch {
            print("[VoiceAnnouncementService] Synthesis failed: \(error)")
        }
    }

    // MARK: - Audio Session Handlers

    #if os(iOS)
    @objc private func handleRouteChange(_ notification: Notification) {
        checkSilentMode()
    }

    @objc private func handleInterruption(_ notification: Notification) {
        guard let userInfo = notification.userInfo,
              let typeValue = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue) else {
            return
        }

        switch type {
        case .began:
            // Pause playback during interruption
            ttsService?.pause()
        case .ended:
            // Resume if interruption ended
            if let optionsValue = userInfo[AVAudioSessionInterruptionOptionKey] as? UInt {
                let options = AVAudioSession.InterruptionOptions(rawValue: optionsValue)
                if options.contains(.shouldResume) {
                    ttsService?.play()
                }
            }
        @unknown default:
            break
        }
    }
    #endif
}
