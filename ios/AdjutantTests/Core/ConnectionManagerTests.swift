import XCTest
import Combine
@testable import AdjutantUI

@MainActor
final class ConnectionManagerTests: XCTestCase {
    private var cancellables: Set<AnyCancellable>!

    override func setUp() async throws {
        cancellables = Set<AnyCancellable>()
    }

    override func tearDown() async throws {
        ConnectionManager.shared.disconnect()
        cancellables = nil
    }

    // MARK: - Initial State Tests

    func testInitialState() {
        let manager = ConnectionManager.shared

        XCTAssertEqual(manager.communicationMethod, .http)
        XCTAssertEqual(manager.connectionState, .disconnected)
        XCTAssertFalse(manager.isStreamActive)
        XCTAssertEqual(manager.queuedMessageCount, 0)
    }

    // MARK: - Communication Priority Tests

    func testPollingOnlyPrioritySetsHTTPMethod() {
        let manager = ConnectionManager.shared
        AppState.shared.communicationPriority = .pollingOnly

        // Give the Combine pipeline time to fire
        let expectation = XCTestExpectation(description: "State updated")
        manager.$communicationMethod
            .dropFirst()
            .first(where: { $0 == .http })
            .sink { _ in expectation.fulfill() }
            .store(in: &cancellables)

        manager.connect()

        wait(for: [expectation], timeout: 1.0)
        XCTAssertEqual(manager.communicationMethod, .http)
        XCTAssertEqual(manager.connectionState, .connected)
    }

    // MARK: - Stream Active Tests

    func testSetStreamActiveUpdatesState() {
        let manager = ConnectionManager.shared
        // Set up a baseline connected state
        AppState.shared.communicationPriority = .pollingOnly
        manager.connect()

        XCTAssertFalse(manager.isStreamActive)

        manager.setStreamActive(true)
        XCTAssertTrue(manager.isStreamActive)
        XCTAssertEqual(manager.connectionState, .streaming)

        manager.setStreamActive(false)
        XCTAssertFalse(manager.isStreamActive)
    }

    // MARK: - Outbound Queue Tests

    func testMessageQueuing() {
        let manager = ConnectionManager.shared

        let msg = WSOutboundMessage.message(to: "mayor/", body: "Hello")
        manager.send(msg)

        XCTAssertEqual(manager.queuedMessageCount, 1)
    }

    func testMultipleMessagesQueue() {
        let manager = ConnectionManager.shared

        manager.send(.message(to: "mayor/", body: "Hello"))
        manager.send(.message(to: "mayor/", body: "World"))
        manager.send(.typing(to: "mayor/", started: true))

        XCTAssertEqual(manager.queuedMessageCount, 3)
    }

    // MARK: - Disconnect Tests

    func testDisconnectSetsDisconnectedState() {
        let manager = ConnectionManager.shared
        AppState.shared.communicationPriority = .pollingOnly
        manager.connect()

        XCTAssertEqual(manager.connectionState, .connected)

        manager.disconnect()

        XCTAssertEqual(manager.connectionState, .disconnected)
    }

    // MARK: - SSE Event Model Tests

    func testSSEEventDecoding() {
        let event = SSEEvent(
            type: "bead_update",
            data: "{\"id\":\"abc-123\",\"status\":\"closed\",\"action\":\"closed\"}",
            id: "42"
        )

        struct BeadUpdate: Decodable {
            let id: String
            let status: String
            let action: String
        }

        let decoded = event.decode(BeadUpdate.self)
        XCTAssertNotNil(decoded)
        XCTAssertEqual(decoded?.id, "abc-123")
        XCTAssertEqual(decoded?.status, "closed")
        XCTAssertEqual(decoded?.action, "closed")
    }

    func testSSEEventDecodingInvalidData() {
        let event = SSEEvent(type: "test", data: "not json", id: nil)

        struct TestModel: Decodable {
            let field: String
        }

        let decoded = event.decode(TestModel.self)
        XCTAssertNil(decoded)
    }

    // MARK: - WS Message Model Tests

    func testWSOutboundMessageFactory() {
        let msg = WSOutboundMessage.message(to: "mayor/", body: "Hello", replyTo: "msg-1")
        XCTAssertEqual(msg.type, "message")
        XCTAssertEqual(msg.to, "mayor/")
        XCTAssertEqual(msg.body, "Hello")
        XCTAssertEqual(msg.replyTo, "msg-1")
    }

    func testWSOutboundTypingFactory() {
        let started = WSOutboundMessage.typing(to: "mayor/", started: true)
        XCTAssertEqual(started.type, "typing")
        XCTAssertEqual(started.state, "started")

        let stopped = WSOutboundMessage.typing(to: "mayor/", started: false)
        XCTAssertEqual(stopped.type, "typing")
        XCTAssertEqual(stopped.state, "stopped")
    }

    func testWSOutboundAckFactory() {
        let ack = WSOutboundMessage.ack(messageId: "msg-42", seq: 100)
        XCTAssertEqual(ack.type, "ack")
        XCTAssertEqual(ack.messageId, "msg-42")
        XCTAssertEqual(ack.seq, 100)
    }

    func testWSOutboundStreamCancelFactory() {
        let cancel = WSOutboundMessage.streamCancel(streamId: "stream-1")
        XCTAssertEqual(cancel.type, "stream_cancel")
        XCTAssertEqual(cancel.streamId, "stream-1")
    }

    func testWSOutboundMessageEncoding() throws {
        let msg = WSOutboundMessage.message(id: "test-id", to: "mayor/", body: "Hello")
        let data = try JSONEncoder().encode(msg)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        XCTAssertNotNil(json)
        XCTAssertEqual(json?["type"] as? String, "message")
        XCTAssertEqual(json?["id"] as? String, "test-id")
        XCTAssertEqual(json?["to"] as? String, "mayor/")
        XCTAssertEqual(json?["body"] as? String, "Hello")
    }

    func testWSMessageDecoding() throws {
        let json = """
        {
            "type": "message",
            "id": "msg-1",
            "seq": 42,
            "from": "mayor/",
            "to": "user",
            "body": "Hello from mayor",
            "timestamp": "2026-02-14T12:00:00Z"
        }
        """

        let data = json.data(using: .utf8)!
        let message = try JSONDecoder().decode(WSMessage.self, from: data)

        XCTAssertEqual(message.type, "message")
        XCTAssertEqual(message.id, "msg-1")
        XCTAssertEqual(message.seq, 42)
        XCTAssertEqual(message.from, "mayor/")
        XCTAssertEqual(message.body, "Hello from mayor")
    }

    func testWSStreamTokenDecoding() throws {
        let json = """
        {
            "type": "stream_token",
            "streamId": "stream-1",
            "seq": 5,
            "token": "Hello",
            "done": false
        }
        """

        let data = json.data(using: .utf8)!
        let message = try JSONDecoder().decode(WSMessage.self, from: data)

        XCTAssertEqual(message.type, "stream_token")
        XCTAssertEqual(message.streamId, "stream-1")
        XCTAssertEqual(message.token, "Hello")
        XCTAssertEqual(message.done, false)
    }

    // MARK: - SSE Event Subject Tests

    func testSSEEventSubjectPublishes() {
        let manager = ConnectionManager.shared
        let expectation = XCTestExpectation(description: "SSE event received")

        var receivedEvent: SSEEvent?
        manager.sseEventSubject
            .first()
            .sink { event in
                receivedEvent = event
                expectation.fulfill()
            }
            .store(in: &cancellables)

        // Simulate an event
        manager.sseEventSubject.send(SSEEvent(type: "test", data: "{}", id: "1"))

        wait(for: [expectation], timeout: 1.0)
        XCTAssertEqual(receivedEvent?.type, "test")
    }

    // MARK: - WS Message Subject Tests

    func testWSMessageSubjectPublishes() {
        let manager = ConnectionManager.shared
        let expectation = XCTestExpectation(description: "WS message received")

        var receivedMessage: WSMessage?
        manager.wsMessageSubject
            .first()
            .sink { message in
                receivedMessage = message
                expectation.fulfill()
            }
            .store(in: &cancellables)

        // Simulate a message by decoding and publishing
        let json = "{\"type\":\"message\",\"body\":\"test\"}"
        if let data = json.data(using: .utf8),
           let msg = try? JSONDecoder().decode(WSMessage.self, from: data) {
            manager.wsMessageSubject.send(msg)
        }

        wait(for: [expectation], timeout: 1.0)
        XCTAssertEqual(receivedMessage?.type, "message")
        XCTAssertEqual(receivedMessage?.body, "test")
    }
}
