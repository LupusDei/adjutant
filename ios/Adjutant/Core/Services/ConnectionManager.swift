import Foundation
import Combine
import AdjutantKit

/// Manages WebSocket + SSE connections to the Adjutant backend.
///
/// Handles the full lifecycle of real-time connections including:
/// - WebSocket for bidirectional chat communication
/// - SSE for server-pushed system events
/// - Auto-reconnect with exponential backoff (1s → 2s → 4s → ... → 30s cap)
/// - Outbound message queue that survives reconnects
/// - Sequence tracking for gap detection
/// - Connection state published to UI
///
/// ConnectionManager reads `AppState.communicationPriority` to determine
/// which channels to activate:
/// - `.realTime`: WebSocket + SSE
/// - `.efficient`: SSE only (HTTP POST for sending)
/// - `.pollingOnly`: No persistent connections
@MainActor
final class ConnectionManager: ObservableObject {
    // MARK: - Singleton

    static let shared = ConnectionManager()

    // MARK: - Published State

    /// The active communication method
    @Published private(set) var communicationMethod: CommunicationMethod = .http

    /// Current connection state
    @Published private(set) var connectionState: ConnectionState = .disconnected

    /// Whether a stream is currently active (agent response streaming)
    @Published private(set) var isStreamActive: Bool = false

    /// Timestamp of the last successful data exchange
    @Published private(set) var lastActivityTime: Date?

    // MARK: - Event Publishers

    /// Publishes SSE events received from the backend
    let sseEventSubject = PassthroughSubject<SSEEvent, Never>()

    /// Publishes WebSocket messages received from the backend
    let wsMessageSubject = PassthroughSubject<WSMessage, Never>()

    // MARK: - Configuration

    /// Backoff configuration for reconnection attempts
    private let backoffPolicy = RetryPolicy(
        maxAttempts: .max,
        baseDelay: 1.0,
        maxDelay: 30.0,
        multiplier: 2.0,
        jitter: 0.1
    )

    /// WebSocket ping interval (30 seconds per spec)
    private let wsPingInterval: TimeInterval = 30.0

    /// SSE heartbeat timeout: if no data received for this duration, reconnect.
    /// Backend sends heartbeats every 15s, so 45s gives us 3 missed heartbeats.
    private let sseHeartbeatTimeout: TimeInterval = 45.0

    // MARK: - Private State

    /// WebSocket connection (nil when not connected)
    private var webSocketTask: URLSessionWebSocketTask?

    /// SSE URLSession data task (nil when not connected)
    private var sseTask: Task<Void, Never>?

    /// WebSocket receive loop task
    private var wsReceiveTask: Task<Void, Never>?

    /// WebSocket ping task
    private var wsPingTask: Task<Void, Never>?

    /// WebSocket reconnect task
    private var wsReconnectTask: Task<Void, Never>?

    /// SSE reconnect task
    private var sseReconnectTask: Task<Void, Never>?

    /// Outbound message queue (survives reconnects)
    private var outboundQueue: [WSOutboundMessage] = []

    /// Whether we're currently draining the outbound queue
    private var isDrainingQueue = false

    /// Current WebSocket reconnect attempt count (resets on successful connect)
    private var wsReconnectAttempt = 0

    /// Current SSE reconnect attempt count (resets on successful connect)
    private var sseReconnectAttempt = 0

    /// Last received SSE sequence number for gap detection
    private var lastSSESequence: Int = 0

    /// Last received WebSocket sequence number
    private var lastWSSequence: Int = 0

    /// Whether we're intentionally disconnecting (don't auto-reconnect)
    private var isIntentionalDisconnect = false

    /// Combine cancellables
    private var cancellables = Set<AnyCancellable>()

    /// URLSession for WebSocket connections
    private lazy var wsSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 300
        return URLSession(configuration: config)
    }()

    // MARK: - Initialization

    private init() {
        observeAppState()
    }

    // MARK: - Public API

    /// Connect based on the current communication priority.
    /// Call this on app launch or when the priority changes.
    func connect() {
        isIntentionalDisconnect = false
        let priority = AppState.shared.communicationPriority

        switch priority {
        case .realTime:
            connectWebSocket()
            connectSSE()
        case .efficient:
            disconnectWebSocket()
            connectSSE()
        case .pollingOnly:
            disconnectWebSocket()
            disconnectSSE()
            communicationMethod = .http
            connectionState = .connected
        }
    }

    /// Disconnect all persistent connections.
    func disconnect() {
        isIntentionalDisconnect = true
        disconnectWebSocket()
        disconnectSSE()
        connectionState = .disconnected
    }

    /// Enqueue a message for sending via WebSocket.
    /// If WebSocket is not connected, the message is queued and sent when connection is established.
    /// If communication priority is `.efficient` or `.pollingOnly`, the message is queued
    /// but the caller should also send via HTTP as a fallback.
    func send(_ message: WSOutboundMessage) {
        let priority = AppState.shared.communicationPriority

        if priority == .realTime, webSocketTask != nil {
            outboundQueue.append(message)
            drainOutboundQueue()
        } else {
            outboundQueue.append(message)

            if priority != .realTime {
                print("[ConnectionManager] WS not active (priority: \(priority.rawValue)), message queued")
            }
        }
    }

    /// Returns the number of queued outbound messages
    var queuedMessageCount: Int {
        outboundQueue.count
    }

    /// Update the stream active state (called by ChatViewModel when streaming)
    func setStreamActive(_ active: Bool) {
        isStreamActive = active
        if active {
            connectionState = .streaming
        } else if webSocketTask != nil || sseTask != nil {
            connectionState = .connected
        }
    }

    // MARK: - WebSocket Connection

    private func connectWebSocket() {
        guard webSocketTask == nil else { return }

        let baseURL = AppState.shared.apiBaseURL
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: true) else {
            print("[ConnectionManager] Invalid base URL for WebSocket")
            return
        }

        // Convert HTTP URL to WebSocket URL
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        // Navigate from /api to /ws/chat
        let basePath = components.path.replacingOccurrences(of: "/api", with: "")
        components.path = basePath + "/ws/chat"

        guard let wsURL = components.url else {
            print("[ConnectionManager] Failed to construct WebSocket URL")
            return
        }

        connectionState = .connecting
        communicationMethod = .websocket

        var request = URLRequest(url: wsURL)
        // Auth via message-based handshake (API key not in URL per security spec)
        request.timeoutInterval = 10

        let task = wsSession.webSocketTask(with: request)
        webSocketTask = task
        task.resume()

        startWSReceiveLoop()
        startWSPingLoop()
        sendWSAuth()
    }

    private func disconnectWebSocket() {
        wsReconnectTask?.cancel()
        wsReconnectTask = nil
        wsPingTask?.cancel()
        wsPingTask = nil
        wsReceiveTask?.cancel()
        wsReceiveTask = nil
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil

        if communicationMethod == .websocket {
            if sseTask != nil {
                communicationMethod = .sse
            } else {
                communicationMethod = .http
            }
        }
    }

    private func sendWSAuth() {
        guard let apiKey = AppState.shared.apiKey, !apiKey.isEmpty else {
            // No auth needed - mark as connected
            wsReconnectAttempt = 0
            connectionState = .connected
            lastActivityTime = Date()
            drainOutboundQueue()
            return
        }

        let authMessage: [String: Any] = [
            "type": "auth",
            "apiKey": apiKey
        ]

        guard let data = try? JSONSerialization.data(withJSONObject: authMessage),
              let jsonString = String(data: data, encoding: .utf8) else {
            return
        }

        webSocketTask?.send(.string(jsonString)) { [weak self] error in
            Task { @MainActor in
                if let error {
                    print("[ConnectionManager] WS auth send failed: \(error.localizedDescription)")
                    self?.handleWSDisconnect()
                } else {
                    self?.wsReconnectAttempt = 0
                    self?.connectionState = .connected
                    self?.lastActivityTime = Date()
                    self?.drainOutboundQueue()
                }
            }
        }
    }

    private func startWSReceiveLoop() {
        wsReceiveTask?.cancel()
        wsReceiveTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                guard let task = self.webSocketTask else { break }

                do {
                    let message = try await task.receive()
                    self.handleWSMessage(message)
                } catch {
                    if !Task.isCancelled {
                        self.handleWSDisconnect()
                    }
                    break
                }
            }
        }
    }

    private func startWSPingLoop() {
        wsPingTask?.cancel()
        wsPingTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64((self?.wsPingInterval ?? 30) * 1_000_000_000))
                guard !Task.isCancelled else { break }
                self?.webSocketTask?.sendPing { error in
                    if let error {
                        Task { @MainActor in
                            print("[ConnectionManager] WS ping failed: \(error.localizedDescription)")
                            self?.handleWSDisconnect()
                        }
                    }
                }
            }
        }
    }

    private func handleWSMessage(_ message: URLSessionWebSocketTask.Message) {
        lastActivityTime = Date()

        switch message {
        case .string(let text):
            guard let data = text.data(using: .utf8) else { return }
            do {
                let wsMessage = try JSONDecoder().decode(WSMessage.self, from: data)
                if let seq = wsMessage.seq {
                    if seq > lastWSSequence + 1 && lastWSSequence > 0 {
                        print("[ConnectionManager] WS sequence gap detected: expected \(lastWSSequence + 1), got \(seq)")
                    }
                    lastWSSequence = seq
                }

                if wsMessage.type == "stream_token" {
                    if !isStreamActive { setStreamActive(true) }
                } else if wsMessage.type == "stream_end" {
                    setStreamActive(false)
                }

                wsMessageSubject.send(wsMessage)
            } catch {
                print("[ConnectionManager] Failed to decode WS message: \(error.localizedDescription)")
            }

        case .data(let data):
            print("[ConnectionManager] Received unexpected binary WS message (\(data.count) bytes)")

        @unknown default:
            break
        }
    }

    private func handleWSDisconnect() {
        let wasConnected = connectionState == .connected || connectionState == .streaming
        disconnectWebSocket()

        guard !isIntentionalDisconnect else { return }

        if sseTask != nil {
            communicationMethod = .sse
            connectionState = .connected
        } else {
            connectionState = .connecting
        }

        scheduleWSReconnect()

        if wasConnected {
            print("[ConnectionManager] WS disconnected, will reconnect (attempt \(wsReconnectAttempt + 1))")
        }
    }

    private func scheduleWSReconnect() {
        wsReconnectTask?.cancel()

        let delay = backoffPolicy.delay(forAttempt: wsReconnectAttempt)
        wsReconnectAttempt += 1

        wsReconnectTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self?.connectWebSocket()
        }
    }

    // MARK: - Outbound Queue

    private func drainOutboundQueue() {
        guard !isDrainingQueue, !outboundQueue.isEmpty else { return }
        guard let task = webSocketTask else { return }

        isDrainingQueue = true

        let message = outboundQueue.removeFirst()

        guard let data = try? JSONEncoder().encode(message),
              let jsonString = String(data: data, encoding: .utf8) else {
            isDrainingQueue = false
            return
        }

        let capturedMessage = message
        task.send(.string(jsonString)) { [weak self] error in
            Task { @MainActor in
                guard let self else { return }
                self.isDrainingQueue = false

                if let error {
                    self.outboundQueue.insert(capturedMessage, at: 0)
                    print("[ConnectionManager] WS send failed, requeued: \(error.localizedDescription)")
                } else {
                    self.lastActivityTime = Date()
                    self.drainOutboundQueue()
                }
            }
        }
    }

    // MARK: - SSE Connection

    private func connectSSE() {
        guard sseTask == nil else { return }

        if communicationMethod == .http {
            communicationMethod = .sse
        }
        if connectionState == .disconnected {
            connectionState = .connecting
        }

        sseTask = Task { [weak self] in
            guard let self else { return }
            await self.runSSELoop()
        }
    }

    private func disconnectSSE() {
        sseReconnectTask?.cancel()
        sseReconnectTask = nil
        sseTask?.cancel()
        sseTask = nil
    }

    private func runSSELoop() async {
        let baseURL = AppState.shared.apiBaseURL
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: true) else {
            print("[ConnectionManager] Invalid base URL for SSE")
            return
        }

        let basePath = components.path
        components.path = basePath + "/events"

        guard let sseURL = components.url else {
            print("[ConnectionManager] Failed to construct SSE URL")
            return
        }

        var request = URLRequest(url: sseURL)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        request.timeoutInterval = 300 // Long-lived connection

        if let apiKey = AppState.shared.apiKey, !apiKey.isEmpty {
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        }

        // Last-Event-ID for gap recovery on reconnect
        if lastSSESequence > 0 {
            request.setValue(String(lastSSESequence), forHTTPHeaderField: "Last-Event-ID")
        }

        do {
            let (bytes, response) = try await URLSession.shared.bytes(for: request)

            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode) else {
                throw SSEError.invalidResponse
            }

            // Successfully connected
            sseReconnectAttempt = 0
            if communicationMethod == .sse || communicationMethod == .http {
                communicationMethod = .sse
                if connectionState == .connecting {
                    connectionState = .connected
                }
            }
            lastActivityTime = Date()

            // Parse SSE stream line by line
            var currentEvent = ""
            var currentData = ""
            var currentId = ""

            for try await line in bytes.lines {
                guard !Task.isCancelled else { break }

                lastActivityTime = Date()

                if line.isEmpty {
                    // Empty line = end of event, dispatch it
                    if !currentData.isEmpty {
                        let event = SSEEvent(
                            type: currentEvent.isEmpty ? "message" : currentEvent,
                            data: currentData,
                            id: currentId.isEmpty ? nil : currentId
                        )

                        if let seq = Int(currentId) {
                            if seq > lastSSESequence + 1 && lastSSESequence > 0 {
                                print("[ConnectionManager] SSE sequence gap: expected \(lastSSESequence + 1), got \(seq)")
                            }
                            lastSSESequence = seq
                        }

                        sseEventSubject.send(event)
                    }

                    currentEvent = ""
                    currentData = ""
                    currentId = ""

                } else if line.hasPrefix("event:") {
                    currentEvent = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
                } else if line.hasPrefix("data:") {
                    let data = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
                    if currentData.isEmpty {
                        currentData = data
                    } else {
                        currentData += "\n" + data
                    }
                } else if line.hasPrefix("id:") {
                    currentId = String(line.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                } else if line.hasPrefix(":") {
                    // Comment (heartbeat) - activity time already updated above
                    continue
                }
            }
        } catch {
            if !Task.isCancelled {
                print("[ConnectionManager] SSE error: \(error.localizedDescription)")
            }
        }

        // Connection ended
        sseTask = nil

        guard !Task.isCancelled, !isIntentionalDisconnect else { return }

        scheduleSSEReconnect()
    }

    private func scheduleSSEReconnect() {
        sseReconnectTask?.cancel()

        let delay = backoffPolicy.delay(forAttempt: sseReconnectAttempt)
        sseReconnectAttempt += 1

        if webSocketTask == nil {
            connectionState = .connecting
        }

        sseReconnectTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self?.connectSSE()
        }

        print("[ConnectionManager] SSE reconnecting in \(String(format: "%.1f", delay))s (attempt \(sseReconnectAttempt))")
    }

    // MARK: - App State Observation

    private func observeAppState() {
        // React to communication priority changes
        AppState.shared.$communicationPriority
            .dropFirst()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.disconnect()
                self?.connect()
            }
            .store(in: &cancellables)

        // React to API URL changes (need to reconnect)
        AppState.shared.$apiBaseURL
            .dropFirst()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.disconnect()
                self?.lastSSESequence = 0
                self?.lastWSSequence = 0
                self?.connect()
            }
            .store(in: &cancellables)

        // React to network availability changes
        NetworkMonitor.shared.$isConnected
            .removeDuplicates()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] isConnected in
                guard let self else { return }
                if isConnected && self.connectionState == .disconnected && !self.isIntentionalDisconnect {
                    self.connect()
                } else if !isConnected {
                    self.connectionState = .disconnected
                }
            }
            .store(in: &cancellables)
    }
}

// MARK: - SSE Event Model

/// A parsed Server-Sent Event
struct SSEEvent {
    /// Event type (e.g., "bead_update", "agent_status", "mode_changed")
    let type: String
    /// JSON data payload
    let data: String
    /// Event ID (sequence number from backend)
    let id: String?

    /// Decode the data payload to a specific type
    func decode<T: Decodable>(_ type: T.Type) -> T? {
        guard let jsonData = data.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(type, from: jsonData)
    }
}

// MARK: - WebSocket Message Models

/// A message received from the WebSocket server
struct WSMessage: Decodable {
    let type: String
    let id: String?
    let clientId: String?
    let seq: Int?
    let from: String?
    let to: String?
    let body: String?
    let timestamp: String?

    // Stream fields
    let streamId: String?
    let token: String?
    let done: Bool?

    // Typing fields
    let state: String?

    // Error fields
    let code: String?
    let message: String?
    let relatedId: String?

    // Delivery confirmation
    let messageId: String?
}

/// An outbound message to send via WebSocket
struct WSOutboundMessage: Encodable, Sendable {
    let type: String
    let id: String?
    let to: String?
    let body: String?
    let replyTo: String?

    // Typing
    let state: String?

    // Stream
    let streamId: String?

    // Ack
    let messageId: String?
    let seq: Int?

    init(
        type: String,
        id: String? = nil,
        to: String? = nil,
        body: String? = nil,
        replyTo: String? = nil,
        state: String? = nil,
        streamId: String? = nil,
        messageId: String? = nil,
        seq: Int? = nil
    ) {
        self.type = type
        self.id = id
        self.to = to
        self.body = body
        self.replyTo = replyTo
        self.state = state
        self.streamId = streamId
        self.messageId = messageId
        self.seq = seq
    }

    /// Create a chat message
    static func message(id: String = UUID().uuidString, to: String, body: String, replyTo: String? = nil) -> WSOutboundMessage {
        WSOutboundMessage(type: "message", id: id, to: to, body: body, replyTo: replyTo)
    }

    /// Create a typing indicator
    static func typing(to: String, started: Bool) -> WSOutboundMessage {
        WSOutboundMessage(type: "typing", to: to, state: started ? "started" : "stopped")
    }

    /// Create an acknowledgment
    static func ack(messageId: String, seq: Int) -> WSOutboundMessage {
        WSOutboundMessage(type: "ack", messageId: messageId, seq: seq)
    }

    /// Create a stream cancel request
    static func streamCancel(streamId: String) -> WSOutboundMessage {
        WSOutboundMessage(type: "stream_cancel", streamId: streamId)
    }
}

// MARK: - SSE Error

private enum SSEError: LocalizedError {
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Invalid SSE response from server"
        }
    }
}
