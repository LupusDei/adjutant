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
        lastSeqSeen: Int? = nil
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
        missed: [WsServerMessage]? = nil
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

    // MARK: - Private: Connection

    private func performConnect() {
        connectionStateSubject.send(.connecting)

        let wsURL = buildWebSocketURL()
        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        webSocketTask = session?.webSocketTask(with: wsURL)
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
        guard !isIntentionalDisconnect else {
            connectionStateSubject.send(.disconnected)
            return
        }
        guard reconnectAttempt < maxReconnectAttempts else {
            connectionStateSubject.send(.disconnected)
            return
        }

        reconnectAttempt += 1
        connectionStateSubject.send(.reconnecting(attempt: reconnectAttempt))

        let delay = min(baseReconnectDelay * pow(2.0, Double(reconnectAttempt - 1)), 30.0)
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self?.webSocketTask = nil
            self?.session?.invalidateAndCancel()
            self?.session = nil
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
        handleDisconnection()
    }

    public func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: (any Error)?
    ) {
        if error != nil {
            handleDisconnection()
        }
    }
}
