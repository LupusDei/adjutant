import Foundation
import Speech
import AVFoundation
import Combine

// MARK: - Authorization Status

/// Combined authorization status for speech recognition
public enum SpeechAuthorizationStatus: Equatable {
    case notDetermined
    case denied
    case restricted
    case authorized
    case microphoneDenied

    var canRecord: Bool {
        self == .authorized
    }

    var errorMessage: String? {
        switch self {
        case .notDetermined:
            return nil
        case .denied:
            return "Speech recognition permission denied. Please enable in Settings."
        case .restricted:
            return "Speech recognition is restricted on this device."
        case .microphoneDenied:
            return "Microphone permission denied. Please enable in Settings."
        case .authorized:
            return nil
        }
    }
}

// MARK: - Recognition State

/// Current state of speech recognition
public enum RecognitionState: Equatable {
    case idle
    case starting
    case recording
    case processing
    case error(message: String)

    public var isRecording: Bool {
        self == .recording
    }

    public var isActive: Bool {
        switch self {
        case .starting, .recording, .processing:
            return true
        default:
            return false
        }
    }
}

// MARK: - SpeechRecognitionServiceProtocol

/// Protocol for speech recognition service
@MainActor
public protocol SpeechRecognitionServiceProtocol: ServiceProtocol {
    /// Current recognition state
    var state: RecognitionState { get }

    /// Publisher for state changes
    var statePublisher: AnyPublisher<RecognitionState, Never> { get }

    /// Current transcription text (updated in real-time)
    var transcription: String { get }

    /// Publisher for transcription changes
    var transcriptionPublisher: AnyPublisher<String, Never> { get }

    /// Final transcription when recording stops
    var finalTranscription: String? { get }

    /// Publisher for final transcription
    var finalTranscriptionPublisher: AnyPublisher<String?, Never> { get }

    /// Current authorization status
    var authorizationStatus: SpeechAuthorizationStatus { get }

    /// Publisher for authorization status changes
    var authorizationStatusPublisher: AnyPublisher<SpeechAuthorizationStatus, Never> { get }

    /// Request authorization for speech recognition and microphone
    func requestAuthorization() async -> SpeechAuthorizationStatus

    /// Start recording and transcribing speech
    func startRecording() throws

    /// Stop recording and finalize transcription
    func stopRecording()

    /// Cancel recording without finalizing
    func cancelRecording()
}

// MARK: - SpeechRecognitionService

/// Implementation of speech recognition service using SFSpeechRecognizer
@MainActor
public final class SpeechRecognitionService: NSObject, SpeechRecognitionServiceProtocol {

    // MARK: - ServiceProtocol

    public typealias ServiceError = SpeechRecognitionError

    public var isAvailable: Bool {
        get async {
            guard let recognizer = speechRecognizer else { return false }
            return recognizer.isAvailable && authorizationStatus == .authorized
        }
    }

    // MARK: - Published State

    @Published private(set) public var state: RecognitionState = .idle
    @Published private(set) public var transcription: String = ""
    @Published private(set) public var finalTranscription: String?
    @Published private(set) public var authorizationStatus: SpeechAuthorizationStatus = .notDetermined

    public var statePublisher: AnyPublisher<RecognitionState, Never> {
        $state.eraseToAnyPublisher()
    }

    public var transcriptionPublisher: AnyPublisher<String, Never> {
        $transcription.eraseToAnyPublisher()
    }

    public var finalTranscriptionPublisher: AnyPublisher<String?, Never> {
        $finalTranscription.eraseToAnyPublisher()
    }

    public var authorizationStatusPublisher: AnyPublisher<SpeechAuthorizationStatus, Never> {
        $authorizationStatus.eraseToAnyPublisher()
    }

    // MARK: - Private Properties

    private let speechRecognizer: SFSpeechRecognizer?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private let audioEngine = AVAudioEngine()
    #if os(iOS)
    private var audioSession: AVAudioSession?
    #endif

    // MARK: - Initialization

    public override init() {
        self.speechRecognizer = SFSpeechRecognizer(locale: Locale.current)
        super.init()
        speechRecognizer?.delegate = self
        updateAuthorizationStatus()
    }

    /// Initialize with a specific locale
    public init(locale: Locale) {
        self.speechRecognizer = SFSpeechRecognizer(locale: locale)
        super.init()
        speechRecognizer?.delegate = self
        updateAuthorizationStatus()
    }

    // MARK: - Authorization

    public func requestAuthorization() async -> SpeechAuthorizationStatus {
        // Request speech recognition authorization
        let speechStatus = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status)
            }
        }

        // If speech denied, return early
        guard speechStatus == .authorized else {
            let status = mapSpeechAuthorizationStatus(speechStatus)
            await MainActor.run {
                self.authorizationStatus = status
            }
            return status
        }

        // Request microphone authorization
        #if os(iOS)
        let micStatus: Bool
        if #available(iOS 17.0, *) {
            micStatus = await AVAudioApplication.requestRecordPermission()
        } else {
            micStatus = await withCheckedContinuation { continuation in
                AVAudioSession.sharedInstance().requestRecordPermission { granted in
                    continuation.resume(returning: granted)
                }
            }
        }
        let finalStatus: SpeechAuthorizationStatus = micStatus ? .authorized : .microphoneDenied
        #else
        let finalStatus: SpeechAuthorizationStatus = .authorized
        #endif
        await MainActor.run {
            self.authorizationStatus = finalStatus
        }
        return finalStatus
    }

    private func updateAuthorizationStatus() {
        let speechStatus = SFSpeechRecognizer.authorizationStatus()

        switch speechStatus {
        case .notDetermined:
            authorizationStatus = .notDetermined
        case .denied:
            authorizationStatus = .denied
        case .restricted:
            authorizationStatus = .restricted
        case .authorized:
            // Check microphone too
            #if os(iOS)
            let micStatus = AVAudioSession.sharedInstance().recordPermission
            authorizationStatus = micStatus == .granted ? .authorized : .microphoneDenied
            #else
            authorizationStatus = .authorized
            #endif
        @unknown default:
            authorizationStatus = .notDetermined
        }
    }

    private func mapSpeechAuthorizationStatus(_ status: SFSpeechRecognizerAuthorizationStatus) -> SpeechAuthorizationStatus {
        switch status {
        case .notDetermined:
            return .notDetermined
        case .denied:
            return .denied
        case .restricted:
            return .restricted
        case .authorized:
            return .authorized
        @unknown default:
            return .notDetermined
        }
    }

    // MARK: - Recording Control

    public func startRecording() throws {
        guard let recognizer = speechRecognizer, recognizer.isAvailable else {
            throw SpeechRecognitionError.recognizerUnavailable
        }

        guard authorizationStatus == .authorized else {
            throw SpeechRecognitionError.notAuthorized(authorizationStatus)
        }

        // Cancel any existing task
        recognitionTask?.cancel()
        recognitionTask = nil

        // Reset state
        transcription = ""
        finalTranscription = nil
        state = .starting

        // Configure audio session
        #if os(iOS)
        do {
            audioSession = AVAudioSession.sharedInstance()
            try audioSession?.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audioSession?.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            state = .error(message: "Failed to configure audio session: \(error.localizedDescription)")
            throw SpeechRecognitionError.audioSessionFailed(error)
        }
        #endif

        // Create recognition request
        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        guard let request = recognitionRequest else {
            state = .error(message: "Failed to create recognition request")
            throw SpeechRecognitionError.requestCreationFailed
        }

        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = false

        // Configure audio input
        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak self] buffer, _ in
            self?.recognitionRequest?.append(buffer)
        }

        // Start recognition task
        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor in
                self?.handleRecognitionResult(result: result, error: error)
            }
        }

        // Start audio engine
        audioEngine.prepare()
        do {
            try audioEngine.start()
            state = .recording
        } catch {
            cleanup()
            state = .error(message: "Failed to start audio engine: \(error.localizedDescription)")
            throw SpeechRecognitionError.audioEngineFailed(error)
        }
    }

    public func stopRecording() {
        guard state.isActive else { return }

        state = .processing

        // Stop audio
        audioEngine.stop()
        recognitionRequest?.endAudio()

        // The recognition task completion handler will handle finalization
    }

    public func cancelRecording() {
        guard state.isActive else { return }

        cleanup()
        transcription = ""
        finalTranscription = nil
        state = .idle
    }

    // MARK: - Private Methods

    private func handleRecognitionResult(result: SFSpeechRecognitionResult?, error: Error?) {
        if let error = error {
            // Check if this is just the normal end of recording
            let nsError = error as NSError
            if nsError.domain == "kAFAssistantErrorDomain" && nsError.code == 1110 {
                // "No speech detected" - not really an error
                finalizeRecording()
                return
            }

            state = .error(message: error.localizedDescription)
            cleanup()
            return
        }

        guard let result = result else { return }

        // Update transcription with best result
        transcription = result.bestTranscription.formattedString

        // Check if this is the final result
        if result.isFinal {
            finalizeRecording()
        }
    }

    private func finalizeRecording() {
        let text = transcription.trimmingCharacters(in: .whitespacesAndNewlines)
        finalTranscription = text.isEmpty ? nil : text
        cleanup()
        state = .idle
    }

    private func cleanup() {
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        recognitionRequest = nil
        recognitionTask?.cancel()
        recognitionTask = nil

        // Deactivate audio session
        #if os(iOS)
        try? audioSession?.setActive(false, options: .notifyOthersOnDeactivation)
        #endif
    }
}

// MARK: - SFSpeechRecognizerDelegate

extension SpeechRecognitionService: SFSpeechRecognizerDelegate {
    nonisolated public func speechRecognizer(_ speechRecognizer: SFSpeechRecognizer, availabilityDidChange available: Bool) {
        Task { @MainActor in
            if !available && self.state.isActive {
                self.cancelRecording()
                self.state = .error(message: "Speech recognition became unavailable")
            }
        }
    }
}

// MARK: - Errors

public enum SpeechRecognitionError: LocalizedError {
    case recognizerUnavailable
    case notAuthorized(SpeechAuthorizationStatus)
    case audioSessionFailed(Error)
    case audioEngineFailed(Error)
    case requestCreationFailed
    case recognitionFailed(Error)

    public var errorDescription: String? {
        switch self {
        case .recognizerUnavailable:
            return "Speech recognition is not available on this device"
        case .notAuthorized(let status):
            return status.errorMessage ?? "Speech recognition not authorized"
        case .audioSessionFailed(let error):
            return "Failed to configure audio session: \(error.localizedDescription)"
        case .audioEngineFailed(let error):
            return "Failed to start audio engine: \(error.localizedDescription)"
        case .requestCreationFailed:
            return "Failed to create speech recognition request"
        case .recognitionFailed(let error):
            return "Speech recognition failed: \(error.localizedDescription)"
        }
    }
}
