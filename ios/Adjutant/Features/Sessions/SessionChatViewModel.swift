import Foundation
import Combine
import AdjutantKit

/// ViewModel for SessionChatView - manages WebSocket v2 session connection,
/// streaming output, and input sending for live agent sessions.
@MainActor
final class SessionChatViewModel: ObservableObject {
    // MARK: - Published State

    /// Session we're connected to
    @Published private(set) var session: ManagedSession

    /// Output lines accumulated from the session (raw terminal view)
    @Published private(set) var outputLines: [OutputLine] = []

    /// Structured output events from the parser (chat view)
    @Published private(set) var outputEvents: [OutputEvent] = []

    /// Whether we're connected to the session's output stream
    @Published private(set) var isConnected = false

    /// Current session status (idle, working, waiting_permission)
    @Published private(set) var sessionStatus: String = "idle"

    /// Text input from the user
    @Published var inputText = ""

    /// Error message to display
    @Published private(set) var errorMessage: String?

    /// Whether a permission prompt is active
    @Published private(set) var isWaitingPermission = false

    // MARK: - Types

    struct OutputLine: Identifiable, Equatable {
        let id = UUID()
        let text: String
        let timestamp: Date

        static func == (lhs: OutputLine, rhs: OutputLine) -> Bool {
            lhs.id == rhs.id
        }
    }

    // MARK: - Dependencies

    private let wsClient: WebSocketClient
    private var cancellables = Set<AnyCancellable>()
    private let maxOutputLines = 5000

    /// Tracks locally-sent user inputs to deduplicate against server echoes
    private var pendingLocalInputs: [String] = []

    // MARK: - Init

    init(session: ManagedSession, wsClient: WebSocketClient) {
        self.session = session
        self.wsClient = wsClient
        self.sessionStatus = session.status.rawValue
        setupSubscriptions()
    }

    // MARK: - Lifecycle

    func onAppear() {
        connectToSession()
    }

    func onDisappear() {
        disconnectFromSession()
    }

    // MARK: - Actions

    func sendInput() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        // Add local user input event so it appears in the chat view immediately
        outputEvents.append(.userInput(content: text))
        // Track it so we can deduplicate the server echo
        pendingLocalInputs.append(text)

        wsClient.sendSessionInput(sessionId: session.id, text: text + "\n")
        inputText = ""
    }

    func sendInterrupt() {
        wsClient.sendSessionInterrupt(sessionId: session.id)
    }

    func respondToPermission(approved: Bool) {
        wsClient.sendSessionPermissionResponse(sessionId: session.id, approved: approved)
        isWaitingPermission = false
    }

    func clearError() {
        errorMessage = nil
    }

    func clearOutput() {
        outputLines.removeAll()
        outputEvents.removeAll()
        pendingLocalInputs.removeAll()
    }

    // MARK: - Private

    private func connectToSession() {
        let state = wsClient.connectionStateSubject.value
        if state == .disconnected {
            // WebSocket not started yet — kick off connection.
            // The connectionState subscription will call us again once connected.
            wsClient.connect()
            return
        }
        guard state == .connected else {
            // Currently connecting/authenticating — wait for the subscription callback.
            return
        }
        errorMessage = nil
        wsClient.sendSessionConnect(sessionId: session.id, replay: true)
    }

    private func disconnectFromSession() {
        if isConnected {
            wsClient.sendSessionDisconnect(sessionId: session.id)
            isConnected = false
        }
    }

    private func setupSubscriptions() {
        // Session connected confirmation
        wsClient.sessionConnectedSubject
            .filter { [weak self] in $0.sessionId == self?.session.id }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                guard let self else { return }
                self.isConnected = true
                // Append replay buffer
                for line in event.buffer {
                    self.appendOutput(line)
                }
            }
            .store(in: &cancellables)

        // Session disconnected
        wsClient.sessionDisconnectedSubject
            .filter { [weak self] in $0 == self?.session.id }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.isConnected = false
            }
            .store(in: &cancellables)

        // Session raw output (terminal view)
        wsClient.sessionOutputSubject
            .filter { [weak self] in $0.sessionId == self?.session.id }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                self?.appendOutput(event.output)
            }
            .store(in: &cancellables)

        // Session structured events (chat view)
        wsClient.sessionEventsSubject
            .filter { [weak self] in $0.sessionId == self?.session.id }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                self?.appendEvents(event.events)
            }
            .store(in: &cancellables)

        // Session status changes
        wsClient.sessionStatusSubject
            .filter { [weak self] in $0.sessionId == self?.session.id }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                self?.sessionStatus = event.status
                self?.isWaitingPermission = event.status == "waiting_permission"
            }
            .store(in: &cancellables)

        // WebSocket connection state
        wsClient.connectionStateSubject
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                guard let self else { return }
                if state == .connected && !self.isConnected {
                    // Reconnected — re-subscribe to session
                    self.connectToSession()
                } else if state == .disconnected {
                    self.isConnected = false
                }
            }
            .store(in: &cancellables)

        // Error messages related to this session
        wsClient.messageSubject
            .filter { [weak self] in
                $0.type == "error" && $0.sessionId == self?.session.id
            }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] msg in
                self?.errorMessage = msg.message ?? "Unknown session error"
            }
            .store(in: &cancellables)
    }

    private func appendOutput(_ text: String) {
        let line = OutputLine(text: text, timestamp: Date())
        outputLines.append(line)

        // Trim if too many lines
        if outputLines.count > maxOutputLines {
            outputLines.removeFirst(outputLines.count - maxOutputLines)
        }
    }

    private func appendEvents(_ dtos: [OutputEventDTO]) {
        for dto in dtos {
            if let event = mapDTOToEvent(dto) {
                outputEvents.append(event)
            }
        }
        // Trim to same limit as raw lines
        if outputEvents.count > maxOutputLines {
            outputEvents.removeFirst(outputEvents.count - maxOutputLines)
        }
    }

    private func mapDTOToEvent(_ dto: OutputEventDTO) -> OutputEvent? {
        switch dto.type {
        case "message":
            return .message(content: dto.content ?? "")
        case "user_input":
            let content = dto.content ?? ""
            // Deduplicate: if we already displayed this locally from sendInput(), skip the server echo
            if let index = pendingLocalInputs.firstIndex(of: content) {
                pendingLocalInputs.remove(at: index)
                return nil
            }
            return .userInput(content: content)
        case "tool_use":
            return .toolUse(
                tool: dto.tool ?? "unknown",
                input: dto.input?.map { "\($0.key): \($0.value)" }.joined(separator: ", ") ?? ""
            )
        case "tool_result":
            return .toolResult(
                tool: dto.tool ?? "unknown",
                output: dto.output ?? "",
                truncated: dto.truncated ?? false
            )
        case "status":
            return .status(state: dto.state ?? "idle")
        case "permission_request":
            return .permissionRequest(
                action: dto.action ?? "",
                details: dto.details ?? ""
            )
        case "error":
            return .error(message: dto.message ?? "Unknown error")
        case "raw":
            return .raw(data: dto.data ?? "")
        default:
            return .raw(data: dto.content ?? dto.data ?? "")
        }
    }
}
