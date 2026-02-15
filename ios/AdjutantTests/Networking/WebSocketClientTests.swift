import XCTest
import Combine
@testable import AdjutantKit

final class WebSocketClientTests: XCTestCase {
    private var cancellables: Set<AnyCancellable>!

    override func setUp() {
        cancellables = Set<AnyCancellable>()
    }

    override func tearDown() {
        cancellables = nil
    }

    // MARK: - WsClientMessage Session Fields

    func testClientMessageSessionConnect() throws {
        let msg = WsClientMessage(type: "session_connect", sessionId: "sess-1", replay: true)
        let data = try JSONEncoder().encode(msg)
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        XCTAssertEqual(dict["type"] as? String, "session_connect")
        XCTAssertEqual(dict["sessionId"] as? String, "sess-1")
        XCTAssertEqual(dict["replay"] as? Bool, true)
        XCTAssertNil(dict["text"])
        XCTAssertNil(dict["approved"])
    }

    func testClientMessageSessionDisconnect() throws {
        let msg = WsClientMessage(type: "session_disconnect", sessionId: "sess-2")
        let data = try JSONEncoder().encode(msg)
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        XCTAssertEqual(dict["type"] as? String, "session_disconnect")
        XCTAssertEqual(dict["sessionId"] as? String, "sess-2")
    }

    func testClientMessageSessionInput() throws {
        let msg = WsClientMessage(type: "session_input", sessionId: "sess-3", text: "hello world")
        let data = try JSONEncoder().encode(msg)
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        XCTAssertEqual(dict["type"] as? String, "session_input")
        XCTAssertEqual(dict["sessionId"] as? String, "sess-3")
        XCTAssertEqual(dict["text"] as? String, "hello world")
    }

    func testClientMessageSessionInterrupt() throws {
        let msg = WsClientMessage(type: "session_interrupt", sessionId: "sess-4")
        let data = try JSONEncoder().encode(msg)
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        XCTAssertEqual(dict["type"] as? String, "session_interrupt")
        XCTAssertEqual(dict["sessionId"] as? String, "sess-4")
    }

    func testClientMessageSessionPermissionResponse() throws {
        let msg = WsClientMessage(
            type: "session_permission_response",
            sessionId: "sess-5",
            approved: true
        )
        let data = try JSONEncoder().encode(msg)
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        XCTAssertEqual(dict["type"] as? String, "session_permission_response")
        XCTAssertEqual(dict["sessionId"] as? String, "sess-5")
        XCTAssertEqual(dict["approved"] as? Bool, true)
    }

    func testClientMessageSessionPermissionDenied() throws {
        let msg = WsClientMessage(
            type: "session_permission_response",
            sessionId: "sess-6",
            approved: false
        )
        let data = try JSONEncoder().encode(msg)
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        XCTAssertEqual(dict["approved"] as? Bool, false)
    }

    func testClientMessageOmitsNilSessionFields() throws {
        let msg = WsClientMessage(type: "message", to: "mayor/", body: "hello")
        let data = try JSONEncoder().encode(msg)
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        XCTAssertNil(dict["sessionId"])
        XCTAssertNil(dict["text"])
        XCTAssertNil(dict["approved"])
        XCTAssertNil(dict["replay"])
    }

    // MARK: - WsServerMessage Session Fields

    func testServerMessageSessionConnected() throws {
        let json = """
        {"type":"session_connected","sessionId":"sess-1","buffer":["line1","line2"]}
        """
        let msg = try JSONDecoder().decode(WsServerMessage.self, from: json.data(using: .utf8)!)

        XCTAssertEqual(msg.type, "session_connected")
        XCTAssertEqual(msg.sessionId, "sess-1")
        XCTAssertEqual(msg.buffer, ["line1", "line2"])
    }

    func testServerMessageSessionOutput() throws {
        let json = """
        {"type":"session_output","sessionId":"sess-1","output":"Hello from Claude"}
        """
        let msg = try JSONDecoder().decode(WsServerMessage.self, from: json.data(using: .utf8)!)

        XCTAssertEqual(msg.type, "session_output")
        XCTAssertEqual(msg.sessionId, "sess-1")
        XCTAssertEqual(msg.output, "Hello from Claude")
    }

    func testServerMessageSessionStatus() throws {
        let json = """
        {"type":"session_status","sessionId":"sess-1","status":"working","name":"alpha"}
        """
        let msg = try JSONDecoder().decode(WsServerMessage.self, from: json.data(using: .utf8)!)

        XCTAssertEqual(msg.type, "session_status")
        XCTAssertEqual(msg.sessionId, "sess-1")
        XCTAssertEqual(msg.status, "working")
        XCTAssertEqual(msg.name, "alpha")
    }

    func testServerMessageSessionDisconnected() throws {
        let json = """
        {"type":"session_disconnected","sessionId":"sess-1"}
        """
        let msg = try JSONDecoder().decode(WsServerMessage.self, from: json.data(using: .utf8)!)

        XCTAssertEqual(msg.type, "session_disconnected")
        XCTAssertEqual(msg.sessionId, "sess-1")
    }

    func testServerMessageSessionError() throws {
        let json = """
        {"type":"error","sessionId":"sess-1","code":"session_not_found","message":"No such session"}
        """
        let msg = try JSONDecoder().decode(WsServerMessage.self, from: json.data(using: .utf8)!)

        XCTAssertEqual(msg.type, "error")
        XCTAssertEqual(msg.sessionId, "sess-1")
        XCTAssertEqual(msg.code, "session_not_found")
    }

    func testServerMessageBackwardCompatibility() throws {
        // Existing message types should still decode without session fields
        let json = """
        {"type":"message","id":"msg-1","from":"mayor/","to":"user","body":"hello","seq":5}
        """
        let msg = try JSONDecoder().decode(WsServerMessage.self, from: json.data(using: .utf8)!)

        XCTAssertEqual(msg.type, "message")
        XCTAssertEqual(msg.id, "msg-1")
        XCTAssertEqual(msg.body, "hello")
        XCTAssertNil(msg.output)
        XCTAssertNil(msg.buffer)
        XCTAssertNil(msg.status)
        XCTAssertNil(msg.name)
    }

    // MARK: - Session Event Types

    func testSessionOutputEvent() {
        let event = SessionOutputEvent(sessionId: "sess-1", output: "test output")
        XCTAssertEqual(event.sessionId, "sess-1")
        XCTAssertEqual(event.output, "test output")

        let event2 = SessionOutputEvent(sessionId: "sess-1", output: "test output")
        XCTAssertEqual(event, event2)
    }

    func testSessionConnectedEvent() {
        let event = SessionConnectedEvent(sessionId: "sess-1", buffer: ["a", "b"])
        XCTAssertEqual(event.sessionId, "sess-1")
        XCTAssertEqual(event.buffer, ["a", "b"])
    }

    func testSessionStatusEvent() {
        let event = SessionStatusEvent(sessionId: "sess-1", status: "idle", name: "alpha")
        XCTAssertEqual(event.sessionId, "sess-1")
        XCTAssertEqual(event.status, "idle")
        XCTAssertEqual(event.name, "alpha")

        let event2 = SessionStatusEvent(sessionId: "sess-1", status: "working")
        XCTAssertNil(event2.name)
    }

    // MARK: - WebSocketClient Session Publishers

    func testSessionOutputPublisher() {
        let client = WebSocketClient(baseURL: URL(string: "http://localhost:4201/api")!)
        var received: [SessionOutputEvent] = []

        client.sessionOutputSubject
            .sink { received.append($0) }
            .store(in: &cancellables)

        // Simulate receiving a session_output message
        client.sessionOutputSubject.send(SessionOutputEvent(
            sessionId: "sess-1",
            output: "Hello"
        ))

        XCTAssertEqual(received.count, 1)
        XCTAssertEqual(received[0].sessionId, "sess-1")
        XCTAssertEqual(received[0].output, "Hello")
    }

    func testSessionConnectedPublisher() {
        let client = WebSocketClient(baseURL: URL(string: "http://localhost:4201/api")!)
        var received: [SessionConnectedEvent] = []

        client.sessionConnectedSubject
            .sink { received.append($0) }
            .store(in: &cancellables)

        client.sessionConnectedSubject.send(SessionConnectedEvent(
            sessionId: "sess-1",
            buffer: ["line1", "line2"]
        ))

        XCTAssertEqual(received.count, 1)
        XCTAssertEqual(received[0].buffer, ["line1", "line2"])
    }

    func testSessionDisconnectedPublisher() {
        let client = WebSocketClient(baseURL: URL(string: "http://localhost:4201/api")!)
        var received: [String] = []

        client.sessionDisconnectedSubject
            .sink { received.append($0) }
            .store(in: &cancellables)

        client.sessionDisconnectedSubject.send("sess-1")

        XCTAssertEqual(received, ["sess-1"])
    }

    func testSessionStatusPublisher() {
        let client = WebSocketClient(baseURL: URL(string: "http://localhost:4201/api")!)
        var received: [SessionStatusEvent] = []

        client.sessionStatusSubject
            .sink { received.append($0) }
            .store(in: &cancellables)

        client.sessionStatusSubject.send(SessionStatusEvent(
            sessionId: "sess-1",
            status: "working"
        ))

        XCTAssertEqual(received.count, 1)
        XCTAssertEqual(received[0].status, "working")
    }

    // MARK: - Connection State

    func testInitialConnectionState() {
        let client = WebSocketClient(baseURL: URL(string: "http://localhost:4201/api")!)
        XCTAssertEqual(client.connectionStateSubject.value, .disconnected)
    }
}
