import Foundation
import Combine
import AVFoundation
import Speech
import AdjutantKit

/// ViewModel for composing and sending mail messages.
/// Handles recipient autocomplete, voice dictation, and message sending.
@MainActor
final class ComposeMailViewModel: BaseViewModel {
    // MARK: - Published Properties

    /// The message being composed
    @Published var recipient = ""

    /// Subject line
    @Published var subject = ""

    /// Message body
    @Published var body = ""

    /// Selected priority level
    @Published var priority: MessagePriority = .normal

    /// Filtered recipients for autocomplete
    @Published private(set) var filteredRecipients: [CrewMember] = []

    /// All available recipients (crew members)
    @Published private(set) var allRecipients: [CrewMember] = []

    /// Whether the autocomplete list should be visible
    @Published var showRecipientAutocomplete = false

    /// Whether the message was sent successfully
    @Published private(set) var sendSuccess = false

    /// Voice dictation state
    @Published private(set) var isRecording = false

    /// Which field is being dictated to
    @Published private(set) var dictationTarget: DictationTarget?

    /// Voice availability
    @Published private(set) var voiceAvailable = false

    // MARK: - Types

    enum DictationTarget {
        case subject
        case body
    }

    // MARK: - Private Properties

    private let apiClient: APIClient
    private let replyToId: String?
    private var replyToMessage: Message?

    private var speechRecognizer: SFSpeechRecognizer?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var audioEngine: AVAudioEngine?

    // MARK: - Initialization

    init(replyToId: String? = nil, apiClient: APIClient? = nil) {
        self.replyToId = replyToId
        self.apiClient = apiClient ?? AppState.shared.apiClient
        super.init()

        setupRecipientFiltering()
    }

    // MARK: - Lifecycle

    override func refresh() async {
        await loadRecipients()
        await loadReplyMessage()
        await checkVoiceAvailability()
    }

    // MARK: - Public Methods

    /// Loads available recipients from the API
    func loadRecipients() async {
        await performAsyncAction(showLoading: false) {
            let agents = try await self.apiClient.getAgents()
            self.allRecipients = agents
            self.updateFilteredRecipients()
        }
    }

    /// Loads the message being replied to (if any)
    func loadReplyMessage() async {
        guard let replyToId = replyToId else { return }

        await performAsyncAction(showLoading: false) {
            let message = try await self.apiClient.getMessage(id: replyToId)
            self.replyToMessage = message

            // Pre-fill fields for reply
            self.recipient = message.from
            self.subject = message.subject.hasPrefix("Re: ")
                ? message.subject
                : "Re: \(message.subject)"
        }
    }

    /// Checks if voice services are available
    func checkVoiceAvailability() async {
        do {
            let status = try await apiClient.getVoiceStatus()
            voiceAvailable = status.available
        } catch {
            voiceAvailable = false
        }

        // Also check speech recognition authorization
        let speechStatus = SFSpeechRecognizer.authorizationStatus()
        if speechStatus == .notDetermined {
            SFSpeechRecognizer.requestAuthorization { _ in }
        }
    }

    /// Selects a recipient from the autocomplete list
    func selectRecipient(_ crew: CrewMember) {
        recipient = crew.id
        showRecipientAutocomplete = false
    }

    /// Sends the composed message
    func sendMessage() async {
        guard canSend else { return }

        await performAsyncAction {
            let request = SendMessageRequest(
                to: self.recipient,
                subject: self.subject,
                body: self.body,
                priority: self.priority,
                type: self.replyToId != nil ? .reply : .task,
                replyTo: self.replyToId
            )

            _ = try await self.apiClient.sendMail(request)
            self.sendSuccess = true
        }
    }

    /// Starts voice dictation for the specified field
    func startDictation(for target: DictationTarget) {
        guard !isRecording else { return }

        // Check authorization
        let status = SFSpeechRecognizer.authorizationStatus()
        guard status == .authorized else {
            if status == .notDetermined {
                SFSpeechRecognizer.requestAuthorization { [weak self] newStatus in
                    if newStatus == .authorized {
                        Task { @MainActor in
                            self?.startDictation(for: target)
                        }
                    }
                }
            }
            return
        }

        dictationTarget = target
        isRecording = true

        speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
        audioEngine = AVAudioEngine()

        guard let speechRecognizer = speechRecognizer,
              speechRecognizer.isAvailable,
              let audioEngine = audioEngine else {
            stopDictation()
            return
        }

        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        guard let recognitionRequest = recognitionRequest else {
            stopDictation()
            return
        }

        recognitionRequest.shouldReportPartialResults = true

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
            self.recognitionRequest?.append(buffer)
        }

        audioEngine.prepare()

        do {
            try audioEngine.start()
        } catch {
            stopDictation()
            return
        }

        recognitionTask = speechRecognizer.recognitionTask(with: recognitionRequest) { [weak self] result, error in
            guard let self = self else { return }

            if let result = result {
                let transcription = result.bestTranscription.formattedString

                Task { @MainActor in
                    switch self.dictationTarget {
                    case .subject:
                        self.subject = transcription
                    case .body:
                        self.body = transcription
                    case .none:
                        break
                    }
                }
            }

            if error != nil || result?.isFinal == true {
                Task { @MainActor in
                    self.stopDictation()
                }
            }
        }
    }

    /// Stops voice dictation
    func stopDictation() {
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()

        audioEngine = nil
        recognitionRequest = nil
        recognitionTask = nil
        speechRecognizer = nil

        isRecording = false
        dictationTarget = nil
    }

    // MARK: - Computed Properties

    /// Whether the message can be sent
    var canSend: Bool {
        !recipient.isEmpty && !subject.isEmpty && !body.isEmpty && !isLoading
    }

    /// Whether this is a reply to an existing message
    var isReply: Bool {
        replyToId != nil
    }

    /// The original message being replied to (if any)
    var originalMessage: Message? {
        replyToMessage
    }

    // MARK: - Private Methods

    private func setupRecipientFiltering() {
        $recipient
            .debounce(for: .milliseconds(200), scheduler: RunLoop.main)
            .sink { [weak self] _ in
                self?.updateFilteredRecipients()
            }
            .store(in: &cancellables)
    }

    private func updateFilteredRecipients() {
        let query = recipient.lowercased()

        if query.isEmpty {
            filteredRecipients = allRecipients
        } else {
            filteredRecipients = allRecipients.filter { crew in
                crew.id.lowercased().contains(query) ||
                crew.name.lowercased().contains(query)
            }
        }
    }
}
