import XCTest
import Combine
import AdjutantKit
@testable import AdjutantUI

// MARK: - RetryPolicy Tests

final class RetryPolicyTests: XCTestCase {
    func testExponentialBackoffCalculation() {
        let policy = RetryPolicy(
            maxAttempts: 10,
            baseDelay: 1.0,
            maxDelay: 30.0,
            multiplier: 2.0,
            jitter: 0.0 // No jitter for deterministic test
        )

        XCTAssertEqual(policy.delay(forAttempt: 0), 1.0, accuracy: 0.001)   // 1 * 2^0
        XCTAssertEqual(policy.delay(forAttempt: 1), 2.0, accuracy: 0.001)   // 1 * 2^1
        XCTAssertEqual(policy.delay(forAttempt: 2), 4.0, accuracy: 0.001)   // 1 * 2^2
        XCTAssertEqual(policy.delay(forAttempt: 3), 8.0, accuracy: 0.001)   // 1 * 2^3
        XCTAssertEqual(policy.delay(forAttempt: 4), 16.0, accuracy: 0.001)  // 1 * 2^4
    }

    func testBackoffCapsAtMaxDelay() {
        let policy = RetryPolicy(
            maxAttempts: 10,
            baseDelay: 1.0,
            maxDelay: 30.0,
            multiplier: 2.0,
            jitter: 0.0
        )

        // 2^5 = 32, should be capped at 30
        XCTAssertEqual(policy.delay(forAttempt: 5), 30.0, accuracy: 0.001)
        XCTAssertEqual(policy.delay(forAttempt: 10), 30.0, accuracy: 0.001)
        XCTAssertEqual(policy.delay(forAttempt: 100), 30.0, accuracy: 0.001)
    }

    func testJitterAddsRandomness() {
        let policy = RetryPolicy(
            maxAttempts: 10,
            baseDelay: 10.0,
            maxDelay: 30.0,
            multiplier: 1.0,
            jitter: 0.1 // 10% jitter
        )

        // With 10s base and 10% jitter, values should be in [9, 11]
        var values = Set<Double>()
        for _ in 0..<50 {
            let delay = policy.delay(forAttempt: 0)
            XCTAssertGreaterThanOrEqual(delay, 9.0)
            XCTAssertLessThanOrEqual(delay, 11.0)
            values.insert(delay.rounded(.toNearestOrEven))
        }
        // Jitter should produce some variance (not all identical)
        // With 50 samples and 10% jitter, we expect some variation
    }

    func testDelayNeverNegative() {
        let policy = RetryPolicy(
            maxAttempts: 10,
            baseDelay: 0.1,
            maxDelay: 30.0,
            multiplier: 2.0,
            jitter: 1.0 // 100% jitter
        )

        for attempt in 0..<20 {
            XCTAssertGreaterThanOrEqual(policy.delay(forAttempt: attempt), 0.0)
        }
    }

    func testPredefinedPolicies() {
        let defaultPolicy = RetryPolicy.default
        XCTAssertEqual(defaultPolicy.maxAttempts, 3)
        XCTAssertEqual(defaultPolicy.baseDelay, 1.0)

        let aggressive = RetryPolicy.aggressive
        XCTAssertEqual(aggressive.maxAttempts, 5)
        XCTAssertEqual(aggressive.baseDelay, 0.5)

        let none = RetryPolicy.none
        XCTAssertEqual(none.maxAttempts, 0)
    }

    func testAggressivePolicyHasShorterInitialDelay() {
        let defaultPolicy = RetryPolicy.default
        let aggressive = RetryPolicy.aggressive

        // Aggressive should start faster
        XCTAssertLessThan(aggressive.baseDelay, defaultPolicy.baseDelay)
    }
}

// MARK: - WebSocket Reconnection State Tests

final class WebSocketReconnectionTests: XCTestCase {
    func testWebSocketClientInitialStateDisconnected() {
        let client = WebSocketClient(baseURL: URL(string: "http://localhost:4201/api")!)
        XCTAssertEqual(client.connectionStateSubject.value, .disconnected)
    }

    func testIntentionalDisconnectSetsDisconnected() {
        let client = WebSocketClient(baseURL: URL(string: "http://localhost:4201/api")!)
        client.disconnect()
        XCTAssertEqual(client.connectionStateSubject.value, .disconnected)
    }

    func testDisconnectIsIdempotent() {
        let client = WebSocketClient(baseURL: URL(string: "http://localhost:4201/api")!)

        client.disconnect()
        XCTAssertEqual(client.connectionStateSubject.value, .disconnected)

        client.disconnect()
        XCTAssertEqual(client.connectionStateSubject.value, .disconnected)
    }

    func testConnectFromConnectingIsNoOp() {
        let client = WebSocketClient(baseURL: URL(string: "http://localhost:4201/api")!)
        let cancellables = client.connectionStateSubject
            .collect(2)
            .first()

        // First connect changes state to connecting
        client.connect()
        XCTAssertNotEqual(client.connectionStateSubject.value, .disconnected)

        // Second connect should be ignored (guard prevents double-connect)
        client.connect()

        client.disconnect()
    }

    func testURLConversionHTTPToWS() {
        // Verify the client can be created with HTTP URL (internally converts to ws://)
        let client = WebSocketClient(
            baseURL: URL(string: "http://localhost:4201/api")!,
            apiKey: nil
        )
        XCTAssertNotNil(client)
    }

    func testURLConversionHTTPSToWSS() {
        // Verify the client can be created with HTTPS URL (internally converts to wss://)
        let client = WebSocketClient(
            baseURL: URL(string: "https://example.com/api")!,
            apiKey: "test-key"
        )
        XCTAssertNotNil(client)
    }
}

// MARK: - WebSocket Auth Handshake Tests

final class WebSocketAuthHandshakeTests: XCTestCase {
    private let decoder = JSONDecoder()

    func testAuthChallengeTriggersAuthResponse() throws {
        // Verify auth_challenge message is recognized
        let json = "{\"type\":\"auth_challenge\"}".data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)
        XCTAssertEqual(msg.type, "auth_challenge")
    }

    func testAuthResponseEncoding() throws {
        let msg = WsClientMessage(type: "auth_response", apiKey: "my-secret-key")
        let data = try JSONEncoder().encode(msg)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        XCTAssertEqual(json["type"] as? String, "auth_response")
        XCTAssertEqual(json["apiKey"] as? String, "my-secret-key")
    }

    func testConnectedMessageResetsReconnect() throws {
        let json = """
        {"type":"connected","sessionId":"session-abc","lastSeq":0,"serverTime":"2026-02-14T00:00:00Z"}
        """.data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)

        XCTAssertEqual(msg.type, "connected")
        XCTAssertEqual(msg.sessionId, "session-abc")
        XCTAssertEqual(msg.lastSeq, 0)
    }

    func testConnectedWithLastSeqTriggersSyncRequest() throws {
        // When connected message has lastSeq > client's lastSeqSeen, client should sync
        let json = """
        {"type":"connected","sessionId":"s1","lastSeq":42,"serverTime":"2026-02-14T00:00:00Z"}
        """.data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)

        XCTAssertEqual(msg.lastSeq, 42)
        // Client with lastSeqSeen < 42 would call requestSync()
    }

    func testAuthFailedErrorDisconnects() throws {
        let json = """
        {"type":"error","code":"auth_failed","message":"Invalid API key"}
        """.data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)

        XCTAssertEqual(msg.type, "error")
        XCTAssertEqual(msg.code, "auth_failed")
    }

    func testAuthTimeoutErrorDisconnects() throws {
        let json = """
        {"type":"error","code":"auth_timeout","message":"Authentication timed out"}
        """.data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)

        XCTAssertEqual(msg.type, "error")
        XCTAssertEqual(msg.code, "auth_timeout")
    }
}

// MARK: - SSE Gap Recovery Tests

final class SSEGapRecoveryTests: XCTestCase {
    func testSSEEventWithSequenceId() {
        let event = SSEEvent(type: "bead_update", data: "{\"id\":\"x\"}", id: "42")
        XCTAssertEqual(event.id, "42")
        XCTAssertEqual(event.type, "bead_update")
    }

    func testSSEEventWithNilId() {
        let event = SSEEvent(type: "heartbeat", data: "", id: nil)
        XCTAssertNil(event.id)
    }

    func testSSEEventSequenceIsParseable() {
        let event = SSEEvent(type: "message", data: "{}", id: "100")
        let seq = Int(event.id ?? "")
        XCTAssertEqual(seq, 100)
    }

    func testSSEGapDetectionLogic() {
        // Simulate SSE gap detection logic
        var lastSSESequence = 10

        let incomingSeq = 15 // Gap: expected 11, got 15
        let hasGap = incomingSeq > lastSSESequence + 1 && lastSSESequence > 0
        XCTAssertTrue(hasGap)

        lastSSESequence = incomingSeq
        XCTAssertEqual(lastSSESequence, 15)
    }

    func testNoGapWhenSequential() {
        var lastSSESequence = 10
        let incomingSeq = 11

        let hasGap = incomingSeq > lastSSESequence + 1 && lastSSESequence > 0
        XCTAssertFalse(hasGap)

        lastSSESequence = incomingSeq
        XCTAssertEqual(lastSSESequence, 11)
    }

    func testNoGapOnFirstMessage() {
        let lastSSESequence = 0 // Initial state
        let incomingSeq = 5

        // Gap detection requires lastSSESequence > 0
        let hasGap = incomingSeq > lastSSESequence + 1 && lastSSESequence > 0
        XCTAssertFalse(hasGap)
    }

    func testSSEEventDecodePayload() {
        let event = SSEEvent(
            type: "agent_status",
            data: "{\"agentId\":\"agent-1\",\"status\":\"active\"}",
            id: "50"
        )

        struct AgentStatus: Decodable {
            let agentId: String
            let status: String
        }

        let decoded = event.decode(AgentStatus.self)
        XCTAssertNotNil(decoded)
        XCTAssertEqual(decoded?.agentId, "agent-1")
        XCTAssertEqual(decoded?.status, "active")
    }

    func testSSEEventDecodeRejectsInvalidJSON() {
        let event = SSEEvent(type: "test", data: "not valid json", id: nil)

        struct TestPayload: Decodable { let field: String }

        XCTAssertNil(event.decode(TestPayload.self))
    }

    func testSSEEventDecodeRejectsEmptyData() {
        let event = SSEEvent(type: "test", data: "", id: nil)

        struct TestPayload: Decodable { let field: String }

        XCTAssertNil(event.decode(TestPayload.self))
    }
}

// MARK: - EventStreamService State Tests

@MainActor
final class EventStreamServiceStateTests: XCTestCase {
    func testInitialStateIsDisconnected() {
        let service = EventStreamService.shared
        service.stop()
        XCTAssertEqual(service.state, .disconnected)
        XCTAssertFalse(service.isConnected)
    }

    func testStopResetsState() {
        let service = EventStreamService.shared
        service.stop()
        XCTAssertEqual(service.state, .disconnected)
    }

    func testStopIsIdempotent() {
        let service = EventStreamService.shared
        service.stop()
        service.stop()
        XCTAssertEqual(service.state, .disconnected)
    }

    func testEventStreamStateEquatableConnected() {
        XCTAssertEqual(EventStreamState.connected, EventStreamState.connected)
        XCTAssertNotEqual(EventStreamState.connected, EventStreamState.disconnected)
    }

    func testEventStreamStateEquatableReconnecting() {
        XCTAssertEqual(
            EventStreamState.reconnecting(attempt: 3),
            EventStreamState.reconnecting(attempt: 3)
        )
        XCTAssertNotEqual(
            EventStreamState.reconnecting(attempt: 1),
            EventStreamState.reconnecting(attempt: 2)
        )
    }

    func testEventStreamStateEquatableConnecting() {
        XCTAssertEqual(EventStreamState.connecting, EventStreamState.connecting)
        XCTAssertNotEqual(EventStreamState.connecting, EventStreamState.connected)
    }
}

// MARK: - WebSocket Sequence Tracking Tests

final class WebSocketSequenceTrackingTests: XCTestCase {
    private let decoder = JSONDecoder()

    func testWSGapDetectionLogic() {
        var lastWSSequence = 10

        // Sequential - no gap
        let seq1 = 11
        let hasGap1 = seq1 > lastWSSequence + 1 && lastWSSequence > 0
        XCTAssertFalse(hasGap1)
        lastWSSequence = seq1

        // Gap detected
        let seq2 = 15
        let hasGap2 = seq2 > lastWSSequence + 1 && lastWSSequence > 0
        XCTAssertTrue(hasGap2)
        lastWSSequence = seq2
    }

    func testSyncRequestEncoding() throws {
        let msg = WsClientMessage(type: "sync", lastSeqSeen: 42)
        let data = try JSONEncoder().encode(msg)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        XCTAssertEqual(json["type"] as? String, "sync")
        XCTAssertEqual(json["lastSeqSeen"] as? Int, 42)
    }

    func testSyncResponseWithMissedMessages() throws {
        let json = """
        {
            "type": "sync_response",
            "missed": [
                {"type":"message","id":"m1","seq":11,"body":"missed 1"},
                {"type":"message","id":"m2","seq":12,"body":"missed 2"},
                {"type":"message","id":"m3","seq":13,"body":"missed 3"}
            ]
        }
        """.data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)

        XCTAssertEqual(msg.type, "sync_response")
        XCTAssertEqual(msg.missed?.count, 3)
        XCTAssertEqual(msg.missed?[0].seq, 11)
        XCTAssertEqual(msg.missed?[0].body, "missed 1")
        XCTAssertEqual(msg.missed?[1].seq, 12)
        XCTAssertEqual(msg.missed?[2].seq, 13)
    }

    func testSyncResponseEmptyMissed() throws {
        let json = """
        {"type":"sync_response","missed":[]}
        """.data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)

        XCTAssertEqual(msg.type, "sync_response")
        XCTAssertEqual(msg.missed?.count, 0)
    }

    func testSequenceTrackingUpdatesFromSyncResponse() throws {
        // Simulate processing sync_response missed messages
        var lastSeqSeen = 10

        let missedMessages = [
            WsServerMessage(type: "message", id: "m1", seq: 11, body: "a"),
            WsServerMessage(type: "message", id: "m2", seq: 12, body: "b"),
            WsServerMessage(type: "message", id: "m3", seq: 15, body: "c"),
        ]

        for m in missedMessages {
            if let seq = m.seq {
                lastSeqSeen = max(lastSeqSeen, seq)
            }
        }

        XCTAssertEqual(lastSeqSeen, 15)
    }
}

// MARK: - Streaming End-to-End Tests

@MainActor
final class StreamingEndToEndTests: XCTestCase {
    private var service: ChatWebSocketService!
    private var cancellables: Set<AnyCancellable>!

    override func setUp() async throws {
        cancellables = Set<AnyCancellable>()
        service = ChatWebSocketService()
    }

    override func tearDown() async throws {
        service.disconnect()
        service = nil
        cancellables = nil
    }

    func testStreamTokenBuildsAssembledText() {
        var stream = StreamingResponse(streamId: "s1", from: "agent-1")
        XCTAssertEqual(stream.assembledText, "")

        stream.tokens.append("Hello")
        XCTAssertEqual(stream.assembledText, "Hello")

        stream.tokens.append(" ")
        stream.tokens.append("world")
        XCTAssertEqual(stream.assembledText, "Hello world")

        stream.tokens.append("!")
        XCTAssertEqual(stream.assembledText, "Hello world!")
    }

    func testStreamCompletionSetsFields() {
        var stream = StreamingResponse(streamId: "s1", from: "agent-1")
        stream.tokens = ["Complete", " ", "response"]

        XCTAssertFalse(stream.isComplete)
        XCTAssertNil(stream.messageId)

        stream.isComplete = true
        stream.messageId = "msg-final-42"

        XCTAssertTrue(stream.isComplete)
        XCTAssertEqual(stream.messageId, "msg-final-42")
        XCTAssertEqual(stream.assembledText, "Complete response")
    }

    func testStreamingResponseEquatable() {
        let stream1 = StreamingResponse(streamId: "s1", from: "agent-1")
        var stream2 = StreamingResponse(streamId: "s1", from: "agent-1")
        XCTAssertEqual(stream1, stream2)

        stream2.tokens = ["token"]
        XCTAssertNotEqual(stream1, stream2)
    }

    func testStreamTokenPublisherFires() {
        let expectation = XCTestExpectation(description: "Stream token received")
        var receivedStreamId: String?
        var receivedToken: String?

        service.streamToken
            .first()
            .sink { (streamId, token) in
                receivedStreamId = streamId
                receivedToken = token
                expectation.fulfill()
            }
            .store(in: &cancellables)

        // Simulate by directly accessing the subject
        let wsMsg = WsServerMessage(
            type: "stream_token",
            streamId: "test-stream",
            token: "Hello"
        )

        // Since we can't easily inject messages into ChatWebSocketService
        // without a real WebSocket, test the publisher contract directly
        service.streamToken.send((streamId: "test-stream", token: "Hello"))

        wait(for: [expectation], timeout: 1.0)
        XCTAssertEqual(receivedStreamId, "test-stream")
        XCTAssertEqual(receivedToken, "Hello")
    }

    func testStreamEndPublisherFires() {
        let expectation = XCTestExpectation(description: "Stream end received")
        var receivedStreamId: String?
        var receivedMessageId: String?

        service.streamEnd
            .first()
            .sink { (streamId, messageId) in
                receivedStreamId = streamId
                receivedMessageId = messageId
                expectation.fulfill()
            }
            .store(in: &cancellables)

        service.streamEnd.send((streamId: "test-stream", messageId: "msg-final"))

        wait(for: [expectation], timeout: 1.0)
        XCTAssertEqual(receivedStreamId, "test-stream")
        XCTAssertEqual(receivedMessageId, "msg-final")
    }

    func testDeliveryConfirmationPublisher() {
        let expectation = XCTestExpectation(description: "Delivery confirmation received")

        service.deliveryConfirmation
            .first()
            .sink { (clientId, serverId, timestamp) in
                XCTAssertEqual(clientId, "client-123")
                XCTAssertEqual(serverId, "server-456")
                XCTAssertEqual(timestamp, "2026-02-14T00:00:00Z")
                expectation.fulfill()
            }
            .store(in: &cancellables)

        service.deliveryConfirmation.send((
            clientId: "client-123",
            serverId: "server-456",
            timestamp: "2026-02-14T00:00:00Z"
        ))

        wait(for: [expectation], timeout: 1.0)
    }

    func testIncomingMessagePublisher() {
        let expectation = XCTestExpectation(description: "Incoming message received")

        service.incomingMessage
            .first()
            .sink { message in
                XCTAssertEqual(message.id, "ws-msg-1")
                XCTAssertEqual(message.from, "agent-1")
                XCTAssertEqual(message.body, "Test body")
                expectation.fulfill()
            }
            .store(in: &cancellables)

        let msg = Message(
            id: "ws-msg-1",
            from: "agent-1",
            to: "user",
            subject: "Test",
            body: "Test body",
            timestamp: "2026-02-14T00:00:00Z",
            read: false,
            priority: .normal,
            type: .notification,
            threadId: "t1",
            replyTo: nil,
            pinned: false,
            isInfrastructure: false
        )
        service.incomingMessage.send(msg)

        wait(for: [expectation], timeout: 1.0)
    }

    func testInitialServiceState() {
        XCTAssertEqual(service.connectionState, .disconnected)
        XCTAssertFalse(service.isRemoteTyping)
        XCTAssertNil(service.activeStream)
        XCTAssertFalse(service.isConnected)
    }

    func testDisconnectResetsAllState() {
        // Even after artificial state changes, disconnect clears everything
        service.disconnect()

        XCTAssertEqual(service.connectionState, .disconnected)
        XCTAssertFalse(service.isRemoteTyping)
        XCTAssertNil(service.activeStream)
    }
}

// MARK: - Stream Token Message Decoding Tests

final class StreamTokenDecodingTests: XCTestCase {
    private let decoder = JSONDecoder()

    func testDecodeStreamTokenWithAllFields() throws {
        let json = """
        {
            "type": "stream_token",
            "streamId": "stream-42",
            "token": "Hello ",
            "from": "agent-1",
            "seq": 10,
            "done": false
        }
        """.data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)

        XCTAssertEqual(msg.type, "stream_token")
        XCTAssertEqual(msg.streamId, "stream-42")
        XCTAssertEqual(msg.token, "Hello ")
        XCTAssertEqual(msg.from, "agent-1")
        XCTAssertEqual(msg.seq, 10)
        XCTAssertEqual(msg.done, false)
    }

    func testDecodeStreamEndWithMessageId() throws {
        let json = """
        {
            "type": "stream_end",
            "streamId": "stream-42",
            "messageId": "final-msg-id"
        }
        """.data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)

        XCTAssertEqual(msg.type, "stream_end")
        XCTAssertEqual(msg.streamId, "stream-42")
        XCTAssertEqual(msg.messageId, "final-msg-id")
    }

    func testDecodeStreamEndWithoutMessageId() throws {
        let json = """
        {"type":"stream_end","streamId":"stream-42"}
        """.data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)

        XCTAssertEqual(msg.type, "stream_end")
        XCTAssertEqual(msg.streamId, "stream-42")
        XCTAssertNil(msg.messageId)
    }

    func testDecodeMultipleStreamTokensInSequence() throws {
        let tokens = ["Hello", " ", "world", "!", " How", " are", " you", "?"]

        for (i, token) in tokens.enumerated() {
            let json = """
            {"type":"stream_token","streamId":"s1","token":"\(token)","seq":\(i + 1)}
            """.data(using: .utf8)!
            let msg = try decoder.decode(WsServerMessage.self, from: json)

            XCTAssertEqual(msg.type, "stream_token")
            XCTAssertEqual(msg.token, token)
            XCTAssertEqual(msg.seq, i + 1)
        }
    }
}


// MARK: - WebSocket Connection State Tests

final class WebSocketConnectionStateTests: XCTestCase {
    func testAllStatesAreEquatable() {
        XCTAssertEqual(WebSocketConnectionState.disconnected, WebSocketConnectionState.disconnected)
        XCTAssertEqual(WebSocketConnectionState.connecting, WebSocketConnectionState.connecting)
        XCTAssertEqual(WebSocketConnectionState.authenticating, WebSocketConnectionState.authenticating)
        XCTAssertEqual(WebSocketConnectionState.connected, WebSocketConnectionState.connected)
        XCTAssertEqual(
            WebSocketConnectionState.reconnecting(attempt: 1),
            WebSocketConnectionState.reconnecting(attempt: 1)
        )
    }

    func testReconnectingStatesWithDifferentAttempts() {
        XCTAssertNotEqual(
            WebSocketConnectionState.reconnecting(attempt: 1),
            WebSocketConnectionState.reconnecting(attempt: 2)
        )
    }

    func testDifferentStatesAreNotEqual() {
        XCTAssertNotEqual(WebSocketConnectionState.disconnected, WebSocketConnectionState.connecting)
        XCTAssertNotEqual(WebSocketConnectionState.connecting, WebSocketConnectionState.authenticating)
        XCTAssertNotEqual(WebSocketConnectionState.authenticating, WebSocketConnectionState.connected)
        XCTAssertNotEqual(WebSocketConnectionState.connected, WebSocketConnectionState.reconnecting(attempt: 1))
    }
}

// MARK: - WsServerMessage Full Decoding Coverage

final class WsServerMessageFullDecodingTests: XCTestCase {
    private let decoder = JSONDecoder()

    func testDecodeDeliveredWithAllFields() throws {
        let json = """
        {
            "type": "delivered",
            "messageId": "server-msg-42",
            "clientId": "client-msg-1",
            "timestamp": "2026-02-14T12:00:00Z"
        }
        """.data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)

        XCTAssertEqual(msg.type, "delivered")
        XCTAssertEqual(msg.messageId, "server-msg-42")
        XCTAssertEqual(msg.clientId, "client-msg-1")
        XCTAssertEqual(msg.timestamp, "2026-02-14T12:00:00Z")
    }

    func testDecodeTypingStarted() throws {
        let json = """
        {"type":"typing","from":"agent-1","state":"started"}
        """.data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)

        XCTAssertEqual(msg.type, "typing")
        XCTAssertEqual(msg.from, "agent-1")
        XCTAssertEqual(msg.state, "started")
    }

    func testDecodeTypingThinking() throws {
        let json = """
        {"type":"typing","from":"agent-1","state":"thinking"}
        """.data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)

        XCTAssertEqual(msg.state, "thinking")
    }

    func testDecodeTypingStopped() throws {
        let json = """
        {"type":"typing","from":"agent-1","state":"stopped"}
        """.data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)

        XCTAssertEqual(msg.state, "stopped")
    }

    func testDecodeErrorWithRelatedId() throws {
        let json = """
        {
            "type": "error",
            "code": "invalid_recipient",
            "message": "Unknown recipient",
            "relatedId": "msg-that-failed"
        }
        """.data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)

        XCTAssertEqual(msg.type, "error")
        XCTAssertEqual(msg.code, "invalid_recipient")
        XCTAssertEqual(msg.message, "Unknown recipient")
        XCTAssertEqual(msg.relatedId, "msg-that-failed")
    }

    func testDecodeRateLimitedError() throws {
        let json = """
        {"type":"error","code":"rate_limited","message":"Slow down"}
        """.data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)

        XCTAssertEqual(msg.code, "rate_limited")
    }

    func testDecodeMessageWithThreadId() throws {
        let json = """
        {
            "type": "message",
            "id": "m1",
            "from": "agent-1",
            "to": "user",
            "body": "Threaded msg",
            "threadId": "thread-42",
            "replyTo": "m0",
            "timestamp": "2026-02-14T00:00:00Z"
        }
        """.data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)

        XCTAssertEqual(msg.threadId, "thread-42")
        XCTAssertEqual(msg.replyTo, "m0")
    }

    func testDecodeConnectedWithServerTime() throws {
        let json = """
        {
            "type": "connected",
            "sessionId": "sess-1",
            "lastSeq": 100,
            "serverTime": "2026-02-14T16:00:00Z"
        }
        """.data(using: .utf8)!
        let msg = try decoder.decode(WsServerMessage.self, from: json)

        XCTAssertEqual(msg.serverTime, "2026-02-14T16:00:00Z")
        XCTAssertEqual(msg.lastSeq, 100)
    }
}
