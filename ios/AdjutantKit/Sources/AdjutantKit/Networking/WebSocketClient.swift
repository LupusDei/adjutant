import Foundation
import Combine

// MARK: - WebSocket Message Types

/// Messages sent from client to server
public struct WsClientMessage: Encodable {
    public let type: String
    public var id: String?
    public var to: String?
    public var body: String?
    public var replyTo: String?
    public var metadata: [String: String]?
    public var state: String?
    public var streamId: String?
    public var seq: Int?
    public var apiKey: String?
    public var lastSeqSeen: Int?
    // Session v2 fields
    public var sessionId: String?
    public var text: String?
    public var approved: Bool?
    public var replay: Bool?

    public init(
        type: String,
        id: String? = nil,
        to: String? = nil,
        body: String? = nil,
        replyTo: String? = nil,
        metadata: [String: String]? = nil,
        state: String? = nil,
        streamId: String? = nil,
        seq: Int? = nil,
        apiKey: String? = nil,
        lastSeqSeen: Int? = nil,
        sessionId: String? = nil,
        text: String? = nil,
        approved: Bool? = nil,
        replay: Bool? = nil
    ) {
        self.type = type
        self.id = id
        self.to = to
        self.body = body
        self.replyTo = replyTo
        self.metadata = metadata
        self.state = state
        self.streamId = streamId
        self.seq = seq
        self.apiKey = apiKey
        self.lastSeqSeen = lastSeqSeen
        self.sessionId = sessionId
        self.text = text
        self.approved = approved
        self.replay = replay
    }
}

/// Messages received from server
public struct WsServerMessage: Decodable, Equatable {
    public let type: String
    public let id: String?
    public let clientId: String?
    public let seq: Int?
    public let from: String?
    public let to: String?
    public let body: String?
    public let timestamp: String?
    public let threadId: String?
    public let replyTo: String?
    public let streamId: String?
    public let token: String?
    public let done: Bool?
    public let messageId: String?
    public let state: String?
    public let code: String?
    public let message: String?
    public let relatedId: String?
    public let sessionId: String?
    public let lastSeq: Int?
    public let serverTime: String?
    public let missed: [WsServerMessage]?
    // Session v2 fields
    public let output: String?
    public let buffer: [String]?
    public let status: String?
    public let name: String?
    public let events: [OutputEventDTO]?

    public init(
        type: String,
        id: String? = nil,
        clientId: String? = nil,
        seq: Int? = nil,
        from: String? = nil,
        to: String? = nil,
        body: String? = nil,
        timestamp: String? = nil,
        threadId: String? = nil,
        replyTo: String? = nil,
        streamId: String? = nil,
        token: String? = nil,
        done: Bool? = nil,
        messageId: String? = nil,
        state: String? = nil,
        code: String? = nil,
        message: String? = nil,
        relatedId: String? = nil,
        sessionId: String? = nil,
        lastSeq: Int? = nil,
        serverTime: String? = nil,
        missed: [WsServerMessage]? = nil,
        output: String? = nil,
        buffer: [String]? = nil,
        status: String? = nil,
        name: String? = nil,
        events: [OutputEventDTO]? = nil
    ) {
        self.type = type
        self.id = id
        self.clientId = clientId
        self.seq = seq
        self.from = from
        self.to = to
        self.body = body
        self.timestamp = timestamp
        self.threadId = threadId
        self.replyTo = replyTo
        self.streamId = streamId
        self.token = token
        self.done = done
        self.messageId = messageId
        self.state = state
        self.code = code
        self.message = message
        self.relatedId = relatedId
        self.sessionId = sessionId
        self.lastSeq = lastSeq
        self.serverTime = serverTime
        self.missed = missed
        self.output = output
        self.buffer = buffer
        self.status = status
        self.name = name
        self.events = events
    }
}

// MARK: - Output Event DTO

/// Flat DTO for structured output events from the backend OutputParser.
/// Mirrors the backend OutputEvent union type as an optional-field struct for Decodable.
public struct OutputEventDTO: Decodable, Equatable {
    public let type: String
    public let content: String?
    public let tool: String?
    public let input: [String: String]?
    public let output: String?
    public let truncated: Bool?
    public let state: String?
    public let action: String?
    public let details: String?
    public let message: String?
    public let data: String?
    public let requestId: String?
    public let cost: Double?
}

// MARK: - Session Event Types

/// Event emitted when session output arrives
public struct SessionOutputEvent: Equatable {
    public let sessionId: String
    public let output: String

    public init(sessionId: String, output: String) {
        self.sessionId = sessionId
        self.output = output
    }
}

/// Event emitted when a session connection is confirmed
public struct SessionConnectedEvent: Equatable {
    public let sessionId: String
    public let buffer: [String]

    public init(sessionId: String, buffer: [String]) {
        self.sessionId = sessionId
        self.buffer = buffer
    }
}

/// Event emitted when structured output events arrive for a session
public struct SessionEventsEvent: Equatable {
    public let sessionId: String
    public let events: [OutputEventDTO]

    public init(sessionId: String, events: [OutputEventDTO]) {
        self.sessionId = sessionId
        self.events = events
    }
}

/// Event emitted when a session status changes
public struct SessionStatusEvent: Equatable {
    public let sessionId: String
    public let status: String
    public let name: String?

    public init(sessionId: String, status: String, name: String? = nil) {
        self.sessionId = sessionId
        self.status = status
        self.name = name
    }
}

// MARK: - Connection State

public enum WebSocketConnectionState: Equatable {
    case disconnected
    case connecting
    case authenticating
    case connected
    case reconnecting(attempt: Int)
}

// MARK: - WebSocket Client

/// WebSocket client for real-time communication with the Adjutant backend.
/// Handles auth handshake, reconnection, sequence tracking, and gap recovery.
public final class WebSocketClient: NSObject, @unchecked Sendable {
    // MARK: - Publishers

    public let messageSubject = PassthroughSubject<WsServerMessage, Never>()
    public let connectionStateSubject = CurrentValueSubject<WebSocketConnectionState, Never>(.disconnected)

    // Session v2 publishers
    public let sessionOutputSubject = PassthroughSubject<SessionOutputEvent, Never>()
    public let sessionEventsSubject = PassthroughSubject<SessionEventsEvent, Never>()
    public let sessionConnectedSubject = PassthroughSubject<SessionConnectedEvent, Never>()
    public let sessionDisconnectedSubject = PassthroughSubject<String, Never>()
    public let sessionStatusSubject = PassthroughSubject<SessionStatusEvent, Never>()

    // MARK: - Configuration

    private let baseURL: URL
    private let apiKey: String?
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    // MARK: - Connection State

    private var webSocketTask: URLSessionWebSocketTask?
    private var session: URLSession?
    private var lastSeqSeen: Int = 0
    private var reconnectAttempt = 0
    private let maxReconnectAttempts = 10
    private let baseReconnectDelay: TimeInterval = 1.0
    private var reconnectTask: Task<Void, Never>?
    private var isIntentionalDisconnect = false
    private var isHandlingDisconnect = false

    // MARK: - Init

    /// Creates a WebSocket client.
    /// - Parameters:
    ///   - baseURL: The API base URL (e.g., http://localhost:4201/api). The /api suffix is stripped
    ///     and /ws/chat is appended automatically.
    ///   - apiKey: Optional API key for authentication.
    public init(baseURL: URL, apiKey: String? = nil) {
        self.baseURL = baseURL
        self.apiKey = apiKey
        super.init()
    }

    deinit {
        disconnect()
    }

    // MARK: - Public API

    /// Connect to the WebSocket server.
    public func connect() {
        guard connectionStateSubject.value == .disconnected else { return }
        isIntentionalDisconnect = false
        isHandlingDisconnect = false
        reconnectAttempt = 0
        performConnect()
    }

    /// Disconnect from the WebSocket server.
    public func disconnect() {
        isIntentionalDisconnect = true
        reconnectTask?.cancel()
        reconnectTask = nil
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        session?.invalidateAndCancel()
        session = nil
        connectionStateSubject.send(.disconnected)
    }

    /// Send a chat message.
    public func sendMessage(to recipient: String, body: String, clientId: String? = nil) {
        let msg = WsClientMessage(
            type: "message",
            id: clientId ?? UUID().uuidString,
            to: recipient,
            body: body
        )
        send(msg)
    }

    /// Send a typing indicator.
    public func sendTyping(state: String = "started") {
        let msg = WsClientMessage(type: "typing", state: state)
        send(msg)
    }

    /// Send a sequence acknowledgment.
    public func sendAck(seq: Int) {
        let msg = WsClientMessage(type: "ack", seq: seq)
        send(msg)
    }

    /// Request missed messages since last known sequence.
    public func requestSync() {
        let msg = WsClientMessage(type: "sync", lastSeqSeen: lastSeqSeen)
        send(msg)
    }

    // MARK: - Session v2 API

    /// Connect to a session to start receiving output.
    /// - Parameters:
    ///   - sessionId: The session to connect to.
    ///   - replay: Whether to replay buffered output from before connection.
    public func sendSessionConnect(sessionId: String, replay: Bool = false) {
        let msg = WsClientMessage(type: "session_connect", sessionId: sessionId, replay: replay)
        send(msg)
    }

    /// Disconnect from a session.
    public func sendSessionDisconnect(sessionId: String) {
        let msg = WsClientMessage(type: "session_disconnect", sessionId: sessionId)
        send(msg)
    }

    /// Send text input to a session.
    public func sendSessionInput(sessionId: String, text: String) {
        let msg = WsClientMessage(type: "session_input", sessionId: sessionId, text: text)
        send(msg)
    }

    /// Send interrupt (Ctrl-C) to a session.
    public func sendSessionInterrupt(sessionId: String) {
        let msg = WsClientMessage(type: "session_interrupt", sessionId: sessionId)
        send(msg)
    }

    /// Send a permission response to a session.
    public func sendSessionPermissionResponse(sessionId: String, approved: Bool) {
        let msg = WsClientMessage(
            type: "session_permission_response",
            sessionId: sessionId,
            approved: approved
        )
        send(msg)
    }

    // MARK: - Private: Connection

    private func performConnect() {
        connectionStateSubject.send(.connecting)

        let wsURL = buildWebSocketURL()
        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        config.httpAdditionalHeaders = ["ngrok-skip-browser-warning": "1"]
        session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        var request = URLRequest(url: wsURL)
        request.setValue("1", forHTTPHeaderField: "ngrok-skip-browser-warning")
        webSocketTask = session?.webSocketTask(with: request)
        webSocketTask?.resume()
        receiveMessage()
    }

    private func buildWebSocketURL() -> URL {
        var urlString = baseURL.absoluteString
        // Strip /api suffix if present
        if urlString.hasSuffix("/api") {
            urlString = String(urlString.dropLast(4))
        } else if urlString.hasSuffix("/api/") {
            urlString = String(urlString.dropLast(5))
        }
        // Convert http(s) to ws(s)
        urlString = urlString.replacingOccurrences(of: "https://", with: "wss://")
        urlString = urlString.replacingOccurrences(of: "http://", with: "ws://")
        // Append WebSocket path
        if !urlString.hasSuffix("/") {
            urlString += "/"
        }
        urlString += "ws/chat"
        return URL(string: urlString)!
    }

    // MARK: - Private: Message Handling

    private func receiveMessage() {
        webSocketTask?.receive { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self.handleRawMessage(text)
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        self.handleRawMessage(text)
                    }
                @unknown default:
                    break
                }
                self.receiveMessage()
            case .failure:
                self.handleDisconnection()
            }
        }
    }

    private func handleRawMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let msg = try? decoder.decode(WsServerMessage.self, from: data) else {
            return
        }

        switch msg.type {
        case "auth_challenge":
            connectionStateSubject.send(.authenticating)
            let authMsg = WsClientMessage(type: "auth_response", apiKey: apiKey ?? "")
            send(authMsg)

        case "connected":
            connectionStateSubject.send(.connected)
            reconnectAttempt = 0
            isHandlingDisconnect = false
            if let lastSeq = msg.lastSeq, lastSeqSeen > 0 && lastSeqSeen < lastSeq {
                requestSync()
            }

        case "sync_response":
            if let missed = msg.missed {
                for m in missed {
                    if let seq = m.seq {
                        lastSeqSeen = max(lastSeqSeen, seq)
                    }
                    messageSubject.send(m)
                }
            }

        case "error":
            if msg.code == "auth_failed" || msg.code == "auth_timeout" {
                connectionStateSubject.send(.disconnected)
            }
            messageSubject.send(msg)

        // Session v2 message types
        case "session_connected":
            if let sessionId = msg.sessionId {
                sessionConnectedSubject.send(SessionConnectedEvent(
                    sessionId: sessionId,
                    buffer: msg.buffer ?? []
                ))
            }

        case "session_disconnected":
            if let sessionId = msg.sessionId {
                sessionDisconnectedSubject.send(sessionId)
            }

        case "session_output":
            if let sessionId = msg.sessionId, let events = msg.events, !events.isEmpty {
                sessionEventsSubject.send(SessionEventsEvent(
                    sessionId: sessionId,
                    events: events
                ))
            }

        case "session_raw":
            if let sessionId = msg.sessionId, let output = msg.output {
                sessionOutputSubject.send(SessionOutputEvent(
                    sessionId: sessionId,
                    output: output
                ))
            }

        case "session_status":
            if let sessionId = msg.sessionId, let status = msg.status {
                sessionStatusSubject.send(SessionStatusEvent(
                    sessionId: sessionId,
                    status: status,
                    name: msg.name
                ))
            }

        default:
            if let seq = msg.seq {
                lastSeqSeen = max(lastSeqSeen, seq)
            }
            messageSubject.send(msg)
        }
    }

    // MARK: - Private: Sending

    private func send(_ msg: WsClientMessage) {
        guard let data = try? encoder.encode(msg),
              let text = String(data: data, encoding: .utf8) else { return }
        webSocketTask?.send(.string(text)) { _ in }
    }

    // MARK: - Private: Reconnection

    private func handleDisconnection() {
        // Guard against multiple simultaneous calls (receive failure + delegate callbacks)
        guard !isHandlingDisconnect else { return }
        isHandlingDisconnect = true

        // Cancel any pending reconnect before proceeding
        reconnectTask?.cancel()
        reconnectTask = nil

        guard !isIntentionalDisconnect else {
            connectionStateSubject.send(.disconnected)
            isHandlingDisconnect = false
            return
        }
        guard reconnectAttempt < maxReconnectAttempts else {
            connectionStateSubject.send(.disconnected)
            isHandlingDisconnect = false
            return
        }

        reconnectAttempt += 1
        connectionStateSubject.send(.reconnecting(attempt: reconnectAttempt))

        // Clean up old session BEFORE scheduling delayed reconnect.
        // Mark session as stale so delegate callbacks from invalidation are ignored.
        let oldSession = session
        webSocketTask = nil
        session = nil
        oldSession?.invalidateAndCancel()

        let delay = min(baseReconnectDelay * pow(2.0, Double(reconnectAttempt - 1)), 30.0)
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self?.isHandlingDisconnect = false
            self?.performConnect()
        }
    }
}

// MARK: - URLSessionWebSocketDelegate

extension WebSocketClient: URLSessionWebSocketDelegate {
    public func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        // Connection opened, waiting for auth_challenge
    }

    public func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        // Ignore callbacks from stale sessions being invalidated
        guard session === self.session else { return }
        handleDisconnection()
    }

    public func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: (any Error)?
    ) {
        // Ignore callbacks from stale sessions being invalidated
        guard error != nil, session === self.session else { return }
        handleDisconnection()
    }
}
