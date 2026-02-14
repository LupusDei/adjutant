//
//  ConnectionManager.swift
//  Adjutant
//
//  Central coordinator for real-time WebSocket and SSE connections.
//

import Foundation
import Observation

// MARK: - Supporting Types

struct OutboundMessage: Codable {
    let id: UUID
    let to: String
    let body: String
    let replyTo: String?

    init(to: String, body: String, replyTo: String? = nil) {
        self.id = UUID()
        self.to = to
        self.body = body
        self.replyTo = replyTo
    }
}

struct InboundMessage {
    let id: String
    let from: String
    let to: String
    let body: String
    let timestamp: Date
    let threadId: String?
}

struct TypingIndicator {
    let from: String
    let state: TypingState
}

enum TypingState: String, Codable {
    case started
    case stopped
    case thinking
}

struct StreamToken {
    let streamId: String
    let token: String
    let seq: Int
    let done: Bool
}

struct ServerEvent {
    let type: String
    let data: [String: Any]
}

// MARK: - SSE Typed Events

struct BeadUpdateEvent {
    let beadId: String
    let status: String
    let updatedAt: Date?
}

struct AgentStatusEvent {
    let agentId: String
    let status: String
    let rig: String?
}

struct PowerStateEvent {
    let state: String
    let rig: String?
}

struct MailReceivedEvent {
    let messageId: String
    let from: String
    let to: String
    let subject: String
}

// MARK: - ConnectionManager

@Observable
final class ConnectionManager: @unchecked Sendable {

    // MARK: - Singleton

    static let shared = ConnectionManager()

    enum ConnectionState: String {
        case disconnected
        case connecting
        case connected
        case reconnecting
    }

    // MARK: - Published State

    var wsState: ConnectionState = .disconnected
    var sseState: ConnectionState = .disconnected

    // MARK: - Callbacks

    var onMessage: ((InboundMessage) -> Void)?
    var onTyping: ((TypingIndicator) -> Void)?
    var onStreamToken: ((StreamToken) -> Void)?
    var onDelivered: ((String) -> Void)?
    var onEvent: ((ServerEvent) -> Void)?

    // MARK: - Private Properties

    private var webSocketTask: URLSessionWebSocketTask?
    private var sseTask: URLSessionDataTask?
    private var sseSession: URLSession?
    private var sseDelegate: SSESessionDelegate?

    private var pingTask: Task<Void, Never>?
    private var wsReceiveTask: Task<Void, Never>?
    private var wsReconnectTask: Task<Void, Never>?
    private var sseReconnectTask: Task<Void, Never>?
    private var sseHeartbeatTask: Task<Void, Never>?

    private var outboundQueue: [OutboundMessage] = []
    private var lastSeqSeen: Int = 0
    private var lastEventId: String?

    private var wsReconnectAttempts: Int = 0
    private var sseReconnectAttempts: Int = 0
    private var wsIntentionalDisconnect = false
    private var sseIntentionalDisconnect = false
    private var lastSSEDataTime: Date = Date()

    private static let maxReconnectDelay: TimeInterval = 30.0
    private static let pingInterval: TimeInterval = 30.0
    private static let sseHeartbeatTimeout: TimeInterval = 30.0

    // MARK: - Configuration

    private var baseURL: URL { AppState.shared.apiBaseURL }
    private var apiKey: String? { AppState.shared.apiKey }

    private var wsURL: URL {
        // Derive ws:// URL from http:// base URL
        // e.g. http://localhost:4201/api -> ws://localhost:4201/ws/chat
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: true)!
        components.scheme = baseURL.scheme == "https" ? "wss" : "ws"
        // Strip /api suffix and append /ws/chat
        let basePath = components.path
        if basePath.hasSuffix("/api") {
            components.path = String(basePath.dropLast(4)) + "/ws/chat"
        } else {
            components.path = basePath + "/ws/chat"
        }
        return components.url!
    }

    private var sseURL: URL {
        // e.g. http://localhost:4201/api/events
        baseURL.appendingPathComponent("events")
    }

    // MARK: - Lifecycle

    func connect() {
        connectWebSocket()
        connectSSE()
    }

    func disconnect() {
        disconnectWebSocket()
        disconnectSSE()
    }

    // MARK: - WebSocket

    func connectWebSocket() {
        guard wsState == .disconnected || wsState == .reconnecting else { return }

        wsIntentionalDisconnect = false
        wsState = wsState == .reconnecting ? .reconnecting : .connecting
        print("[ConnectionManager] WebSocket connecting to \(wsURL)")

        var request = URLRequest(url: wsURL)
        if let key = apiKey, !key.isEmpty {
            request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        }

        let session = URLSession(configuration: .default)
        let task = session.webSocketTask(with: request)
        webSocketTask = task
        task.resume()

        startReceiving()
        startPing()
    }

    func disconnectWebSocket() {
        wsIntentionalDisconnect = true
        wsReconnectTask?.cancel()
        wsReconnectTask = nil
        pingTask?.cancel()
        pingTask = nil
        wsReceiveTask?.cancel()
        wsReceiveTask = nil

        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil
        wsState = .disconnected
        wsReconnectAttempts = 0
        print("[ConnectionManager] WebSocket disconnected")
    }

    func sendMessage(_ message: OutboundMessage) {
        guard wsState == .connected else {
            outboundQueue.append(message)
            print("[ConnectionManager] Queued message (ws not connected), queue size: \(outboundQueue.count)")
            return
        }

        let payload: [String: Any] = [
            "type": "message",
            "id": message.id.uuidString,
            "to": message.to,
            "body": message.body,
            "replyTo": message.replyTo as Any
        ]

        sendJSON(payload)
    }

    func sendTyping(to recipient: String, state: TypingState) {
        guard wsState == .connected else { return }

        let payload: [String: Any] = [
            "type": "typing",
            "to": recipient,
            "state": state.rawValue
        ]

        sendJSON(payload)
    }

    // MARK: - WebSocket Private

    private func sendJSON(_ payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let string = String(data: data, encoding: .utf8) else { return }

        webSocketTask?.send(.string(string)) { [weak self] error in
            if let error {
                print("[ConnectionManager] WS send error: \(error.localizedDescription)")
                self?.handleWSDisconnect()
            }
        }
    }

    private func startReceiving() {
        wsReceiveTask?.cancel()
        wsReceiveTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                do {
                    guard let message = try await self.webSocketTask?.receive() else { break }
                    self.handleWSMessage(message)
                } catch {
                    if !Task.isCancelled {
                        print("[ConnectionManager] WS receive error: \(error.localizedDescription)")
                        self.handleWSDisconnect()
                    }
                    break
                }
            }
        }
    }

    private func handleWSMessage(_ message: URLSessionWebSocketTask.Message) {
        switch message {
        case .string(let text):
            guard let data = text.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let type = json["type"] as? String else { return }

            switch type {
            case "auth_challenge":
                handleAuthChallenge(json)

            case "connected":
                Task { @MainActor in
                    self.wsState = .connected
                    self.wsReconnectAttempts = 0
                    print("[ConnectionManager] WebSocket connected")
                    self.flushOutboundQueue()
                    self.sendSync()
                }

            case "message":
                if let msg = parseInboundMessage(json) {
                    updateSeq(json)
                    Task { @MainActor in self.onMessage?(msg) }
                }

            case "typing":
                if let indicator = parseTypingIndicator(json) {
                    Task { @MainActor in self.onTyping?(indicator) }
                }

            case "delivered":
                updateSeq(json)
                if let id = json["id"] as? String {
                    Task { @MainActor in self.onDelivered?(id) }
                }

            case "stream_token":
                if let token = parseStreamToken(json) {
                    Task { @MainActor in self.onStreamToken?(token) }
                }

            case "stream_end":
                if let streamId = json["streamId"] as? String {
                    let token = StreamToken(streamId: streamId, token: "", seq: 0, done: true)
                    Task { @MainActor in self.onStreamToken?(token) }
                }

            case "error":
                let errorMsg = json["message"] as? String ?? "Unknown error"
                print("[ConnectionManager] WS server error: \(errorMsg)")

            default:
                print("[ConnectionManager] WS unknown message type: \(type)")
            }

        case .data:
            break // Binary messages not expected

        @unknown default:
            break
        }
    }

    private func handleAuthChallenge(_ json: [String: Any]) {
        guard let key = apiKey, !key.isEmpty else {
            print("[ConnectionManager] Auth challenge received but no API key configured")
            return
        }

        let response: [String: Any] = [
            "type": "auth_response",
            "apiKey": key
        ]
        sendJSON(response)
    }

    private func parseInboundMessage(_ json: [String: Any]) -> InboundMessage? {
        guard let id = json["id"] as? String,
              let from = json["from"] as? String,
              let to = json["to"] as? String,
              let body = json["body"] as? String else { return nil }

        let timestamp: Date
        if let ts = json["timestamp"] as? String {
            timestamp = ISO8601DateFormatter().date(from: ts) ?? Date()
        } else {
            timestamp = Date()
        }

        return InboundMessage(
            id: id,
            from: from,
            to: to,
            body: body,
            timestamp: timestamp,
            threadId: json["threadId"] as? String
        )
    }

    private func parseTypingIndicator(_ json: [String: Any]) -> TypingIndicator? {
        guard let from = json["from"] as? String,
              let stateStr = json["state"] as? String,
              let state = TypingState(rawValue: stateStr) else { return nil }
        return TypingIndicator(from: from, state: state)
    }

    private func parseStreamToken(_ json: [String: Any]) -> StreamToken? {
        guard let streamId = json["streamId"] as? String,
              let token = json["token"] as? String else { return nil }
        return StreamToken(
            streamId: streamId,
            token: token,
            seq: json["seq"] as? Int ?? 0,
            done: json["done"] as? Bool ?? false
        )
    }

    private func updateSeq(_ json: [String: Any]) {
        if let seq = json["seq"] as? Int, seq > lastSeqSeen {
            lastSeqSeen = seq
        }
    }

    private func sendSync() {
        guard lastSeqSeen > 0 else { return }
        let payload: [String: Any] = [
            "type": "sync",
            "lastSeqSeen": lastSeqSeen
        ]
        sendJSON(payload)
    }

    private func flushOutboundQueue() {
        let queued = outboundQueue
        outboundQueue.removeAll()
        for message in queued {
            sendMessage(message)
        }
        if !queued.isEmpty {
            print("[ConnectionManager] Flushed \(queued.count) queued message(s)")
        }
    }

    private func startPing() {
        pingTask?.cancel()
        pingTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(Self.pingInterval * 1_000_000_000))
                guard !Task.isCancelled else { break }
                self?.webSocketTask?.sendPing { error in
                    if let error {
                        print("[ConnectionManager] Ping failed: \(error.localizedDescription)")
                    }
                }
            }
        }
    }

    private func handleWSDisconnect() {
        guard !wsIntentionalDisconnect else { return }

        pingTask?.cancel()
        wsReceiveTask?.cancel()
        webSocketTask = nil

        Task { @MainActor in
            self.wsState = .reconnecting
            self.scheduleWSReconnect()
        }
    }

    private func scheduleWSReconnect() {
        wsReconnectTask?.cancel()
        wsReconnectTask = Task { [weak self] in
            guard let self else { return }
            let delay = self.reconnectDelay(attempt: self.wsReconnectAttempts)
            self.wsReconnectAttempts += 1
            print("[ConnectionManager] WS reconnecting in \(String(format: "%.1f", delay))s (attempt \(self.wsReconnectAttempts))")

            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !Task.isCancelled else { return }

            self.connectWebSocket()
        }
    }

    // MARK: - SSE

    func connectSSE() {
        guard sseState == .disconnected || sseState == .reconnecting else { return }

        sseIntentionalDisconnect = false
        sseState = sseState == .reconnecting ? .reconnecting : .connecting
        print("[ConnectionManager] SSE connecting to \(sseURL)")

        var request = URLRequest(url: sseURL)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        if let key = apiKey, !key.isEmpty {
            request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        }
        if let lastId = lastEventId {
            request.setValue(lastId, forHTTPHeaderField: "Last-Event-ID")
        }
        // Long timeout for SSE stream
        request.timeoutInterval = 300

        let delegate = SSESessionDelegate(manager: self)
        sseDelegate = delegate
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 300
        config.timeoutIntervalForResource = 600
        let session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
        sseSession = session

        let task = session.dataTask(with: request)
        sseTask = task
        task.resume()

        startSSEHeartbeatMonitor()
    }

    func disconnectSSE() {
        sseIntentionalDisconnect = true
        sseReconnectTask?.cancel()
        sseReconnectTask = nil
        sseHeartbeatTask?.cancel()
        sseHeartbeatTask = nil

        sseTask?.cancel()
        sseTask = nil
        sseSession?.invalidateAndCancel()
        sseSession = nil
        sseDelegate = nil
        sseState = .disconnected
        sseReconnectAttempts = 0
        print("[ConnectionManager] SSE disconnected")
    }

    // MARK: - SSE Parsing

    fileprivate func handleSSEData(_ data: Data) {
        lastSSEDataTime = Date()

        guard let text = String(data: data, encoding: .utf8) else { return }

        // Parse SSE lines
        var eventType: String?
        var eventData: String = ""
        var eventId: String?

        for line in text.components(separatedBy: "\n") {
            if line.hasPrefix("event:") {
                eventType = line.dropFirst(6).trimmingCharacters(in: .whitespaces)
            } else if line.hasPrefix("data:") {
                let value = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
                if !eventData.isEmpty { eventData += "\n" }
                eventData += value
            } else if line.hasPrefix("id:") {
                eventId = line.dropFirst(3).trimmingCharacters(in: .whitespaces)
            } else if line.isEmpty && !eventData.isEmpty {
                // Empty line = end of event
                processSSEEvent(type: eventType ?? "message", data: eventData, id: eventId)
                eventType = nil
                eventData = ""
                eventId = nil
            }
        }

        // Handle trailing event without final newline
        if !eventData.isEmpty {
            processSSEEvent(type: eventType ?? "message", data: eventData, id: eventId)
        }
    }

    private func processSSEEvent(type: String, data: String, id: String?) {
        if let id { lastEventId = id }

        guard let jsonData = data.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else {
            // Non-JSON event (e.g. heartbeat)
            return
        }

        let event = ServerEvent(type: type, data: json)

        Task { @MainActor in
            self.onEvent?(event)
        }
    }

    fileprivate func handleSSEConnected() {
        Task { @MainActor in
            self.sseState = .connected
            self.sseReconnectAttempts = 0
            print("[ConnectionManager] SSE connected")
        }
    }

    fileprivate func handleSSEDisconnect(error: Error?) {
        guard !sseIntentionalDisconnect else { return }

        if let error {
            print("[ConnectionManager] SSE error: \(error.localizedDescription)")
        }

        sseTask = nil
        sseSession?.invalidateAndCancel()
        sseSession = nil
        sseDelegate = nil
        sseHeartbeatTask?.cancel()

        Task { @MainActor in
            self.sseState = .reconnecting
            self.scheduleSSEReconnect()
        }
    }

    private func startSSEHeartbeatMonitor() {
        sseHeartbeatTask?.cancel()
        lastSSEDataTime = Date()
        sseHeartbeatTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(Self.sseHeartbeatTimeout * 1_000_000_000))
                guard !Task.isCancelled, let self else { break }

                let elapsed = Date().timeIntervalSince(self.lastSSEDataTime)
                if elapsed > Self.sseHeartbeatTimeout {
                    print("[ConnectionManager] SSE heartbeat timeout (\(String(format: "%.0f", elapsed))s)")
                    self.sseTask?.cancel()
                    self.handleSSEDisconnect(error: nil)
                    break
                }
            }
        }
    }

    private func scheduleSSEReconnect() {
        sseReconnectTask?.cancel()
        sseReconnectTask = Task { [weak self] in
            guard let self else { return }
            let delay = self.reconnectDelay(attempt: self.sseReconnectAttempts)
            self.sseReconnectAttempts += 1
            print("[ConnectionManager] SSE reconnecting in \(String(format: "%.1f", delay))s (attempt \(self.sseReconnectAttempts))")

            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !Task.isCancelled else { return }

            self.connectSSE()
        }
    }

    // MARK: - Reconnect Backoff

    private func reconnectDelay(attempt: Int) -> TimeInterval {
        // Exponential backoff: 1s → 2s → 4s → 8s → 16s → 30s cap
        let base = min(pow(2.0, Double(attempt)), Self.maxReconnectDelay)
        // Add jitter: 0-2s
        let jitter = Double.random(in: 0...2.0)
        return base + jitter
    }
}

// MARK: - SSE URLSession Delegate

private final class SSESessionDelegate: NSObject, URLSessionDataDelegate {
    private weak var manager: ConnectionManager?

    init(manager: ConnectionManager) {
        self.manager = manager
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        if let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) {
            manager?.handleSSEConnected()
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        manager?.handleSSEData(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        manager?.handleSSEDisconnect(error: error)
    }
}
