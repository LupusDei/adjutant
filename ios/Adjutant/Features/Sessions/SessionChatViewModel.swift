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

    /// Output lines accumulated from the session
    @Published private(set) var outputLines: [OutputLine] = []

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
    }

    // MARK: - Private

    private func connectToSession() {
        guard wsClient.connectionStateSubject.value == .connected else {
            errorMessage = "WebSocket not connected"
            return
        }
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

        // Session output
        wsClient.sessionOutputSubject
            .filter { [weak self] in $0.sessionId == self?.session.id }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                self?.appendOutput(event.output)
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
}
