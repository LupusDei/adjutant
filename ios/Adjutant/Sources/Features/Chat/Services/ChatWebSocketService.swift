import Foundation
import Combine
import AdjutantKit

/// A streaming response being assembled token-by-token
struct StreamingResponse: Equatable {
    let streamId: String
    let from: String
    var tokens: [String] = []
    var isComplete: Bool = false
    var messageId: String?

    var assembledText: String {
        tokens.joined()
    }
}

/// Service that bridges the WebSocket client to the chat domain.
/// Translates raw WS messages into typed chat events.
@MainActor
final class ChatWebSocketService: ObservableObject {
    // MARK: - Published State

    /// Current connection state
    @Published private(set) var connectionState: WebSocketConnectionState = .disconnected

    /// Whether a remote agent is typing
    @Published private(set) var isRemoteTyping: Bool = false

    /// Currently active streaming response (token-by-token)
    @Published private(set) var activeStream: StreamingResponse?

    // MARK: - Event Publishers

    /// Emits when a new chat message arrives from the server
    let incomingMessage = PassthroughSubject<PersistentMessage, Never>()

    /// Emits delivery confirmations for optimistic messages (clientId -> serverId)
    let deliveryConfirmation = PassthroughSubject<(clientId: String, serverId: String, timestamp: String), Never>()

    /// Emits when a stream token arrives
    let streamToken = PassthroughSubject<(streamId: String, token: String), Never>()

    /// Emits when a stream completes
    let streamEnd = PassthroughSubject<(streamId: String, messageId: String?), Never>()

    // MARK: - Dependencies

    private var wsClient: WebSocketClient?
    private var cancellables = Set<AnyCancellable>()
    private var typingTimer: Task<Void, Never>?

    // MARK: - Init

    init() {}

    // MARK: - Connection Management

    func connect(baseURL: URL, apiKey: String?) {
        disconnect()

        let client = WebSocketClient(baseURL: baseURL, apiKey: apiKey)
        self.wsClient = client

        client.connectionStateSubject
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                self?.connectionState = state
            }
            .store(in: &cancellables)

        client.messageSubject
            .receive(on: DispatchQueue.main)
            .sink { [weak self] msg in
                self?.handleServerMessage(msg)
            }
            .store(in: &cancellables)

        client.connect()
    }

    func disconnect() {
        wsClient?.disconnect()
        wsClient = nil
        cancellables.removeAll()
        connectionState = .disconnected
        isRemoteTyping = false
        activeStream = nil
    }

    var isConnected: Bool {
        connectionState == .connected
    }

    /// Triggers WebSocket reconnection when network is restored
    func reconnectOnNetworkRestored() {
        wsClient?.reconnectOnNetworkRestored()
    }

    // MARK: - Sending

    func sendMessage(to recipient: String, body: String, clientId: String) {
        wsClient?.sendMessage(to: recipient, body: body, clientId: clientId)
    }

    func sendTypingStarted() {
        wsClient?.sendTyping(state: "started")
    }

    func sendTypingStopped() {
        wsClient?.sendTyping(state: "stopped")
    }

    // MARK: - Private: Message Dispatch

    private func handleServerMessage(_ msg: WsServerMessage) {
        switch msg.type {
        case "chat_message":
            handleChatMessage(msg)
        case "delivered":
            handleDelivered(msg)
        case "typing":
            handleTypingIndicator(msg)
        case "stream_token":
            handleStreamToken(msg)
        case "stream_end":
            handleStreamEnd(msg)
        case "error":
            // Errors are logged but not fatal
            break
        default:
            break
        }
    }

    /// Handle the new chat_message event type from the message store
    private func handleChatMessage(_ msg: WsServerMessage) {
        guard let id = msg.id,
              let body = msg.body else { return }

        let now = ISO8601DateFormatter().string(from: Date())
        let message = PersistentMessage(
            id: id,
            agentId: msg.from ?? "unknown",
            recipient: msg.to,
            role: msg.from == "user" ? .user : .agent,
            body: body,
            deliveryStatus: .delivered,
            threadId: msg.threadId,
            createdAt: msg.timestamp ?? now,
            updatedAt: msg.timestamp ?? now
        )

        incomingMessage.send(message)
    }

    private func handleDelivered(_ msg: WsServerMessage) {
        guard let serverId = msg.messageId,
              let clientId = msg.clientId,
              let timestamp = msg.timestamp else { return }
        deliveryConfirmation.send((clientId: clientId, serverId: serverId, timestamp: timestamp))
    }

    private func handleTypingIndicator(_ msg: WsServerMessage) {
        let state = msg.state ?? "started"

        if state == "started" || state == "thinking" {
            isRemoteTyping = true
            // Auto-clear typing after 5 seconds
            typingTimer?.cancel()
            typingTimer = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                guard !Task.isCancelled else { return }
                self?.isRemoteTyping = false
            }
        } else {
            isRemoteTyping = false
            typingTimer?.cancel()
        }
    }

    private func handleStreamToken(_ msg: WsServerMessage) {
        guard let streamId = msg.streamId,
              let token = msg.token else { return }

        if activeStream == nil || activeStream?.streamId != streamId {
            activeStream = StreamingResponse(
                streamId: streamId,
                from: msg.from ?? "unknown"
            )
        }
        activeStream?.tokens.append(token)
        streamToken.send((streamId: streamId, token: token))
    }

    private func handleStreamEnd(_ msg: WsServerMessage) {
        guard let streamId = msg.streamId else { return }

        activeStream?.isComplete = true
        activeStream?.messageId = msg.messageId
        streamEnd.send((streamId: streamId, messageId: msg.messageId))

        // Clear active stream after a brief delay for final render
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 500_000_000)
            if self?.activeStream?.streamId == streamId {
                self?.activeStream = nil
            }
        }
    }
}
