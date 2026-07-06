import XCTest
import AdjutantKit
@testable import AdjutantUI

/// Tests for the iOS chat composer attachment surface (adj-203.5.2 / T014):
/// - `ComposerAttachments` add/remove/clear + per-message cap (≤4).
/// - `ChatViewModel` upload-then-send: with ≥1 attachment the send uploads each
///   image then posts the message with `attachmentIds` — allowed even when the
///   text is empty (screenshot-with-no-caption; raynor guidance).
@MainActor
final class ChatComposerAttachmentTests: XCTestCase {
    override func tearDown() async throws {
        MockURLProtocol.mockHandler = nil
    }

    private func makeClient() -> APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        let apiConfig = APIClientConfiguration(
            baseURL: URL(string: "http://test.local/api")!,
            apiKey: "secret-key",
            retryPolicy: .none
        )
        return APIClient(configuration: apiConfig, urlSessionConfiguration: config)
    }

    private func png(_ marker: UInt8) -> PendingAttachment {
        PendingAttachment(
            data: Data([0x89, 0x50, 0x4E, 0x47, marker]),
            filename: "shot\(marker).png",
            mimeType: "image/png"
        )
    }

    // MARK: - ComposerAttachments model

    func testAddAndRemoveAttachments() {
        let store = ComposerAttachments()
        XCTAssertTrue(store.isEmpty)

        let a = png(1)
        XCTAssertTrue(store.add(a))
        XCTAssertEqual(store.items.count, 1)
        XCTAssertFalse(store.isEmpty)

        store.remove(id: a.id)
        XCTAssertTrue(store.isEmpty)
    }

    func testEnforcesMaxOfFour() {
        let store = ComposerAttachments()
        XCTAssertTrue(store.add(png(1)))
        XCTAssertTrue(store.add(png(2)))
        XCTAssertTrue(store.add(png(3)))
        XCTAssertTrue(store.add(png(4)))
        XCTAssertFalse(store.canAddMore)
        // The 5th is rejected
        XCTAssertFalse(store.add(png(5)))
        XCTAssertEqual(store.items.count, 4)
    }

    func testClearRemovesAll() {
        let store = ComposerAttachments()
        _ = store.add(png(1))
        _ = store.add(png(2))
        store.clear()
        XCTAssertTrue(store.isEmpty)
    }

    // MARK: - ChatViewModel upload-then-send

    func testCanSendWithAttachmentAndEmptyText() {
        let vm = ChatViewModel(apiClient: makeClient())
        vm.setSelectedRecipientForTesting("kerrigan")
        vm.inputText = ""
        XCTAssertFalse(vm.canSend, "empty text + no attachments cannot send")

        _ = vm.attachments.add(png(1))
        XCTAssertTrue(vm.canSend, "attachment present should allow send even with empty text")
    }

    func testSendUploadsThenPostsWithAttachmentIds() async throws {
        let captured = SendCapture()
        MockURLProtocol.mockHandler = { request in
            let path = request.url?.path ?? ""
            if path == "/api/uploads" {
                let envelope: [String: Any] = [
                    "success": true,
                    "data": [
                        "id": "up_777", "filename": "shot1.png",
                        "mimeType": "image/png", "sizeBytes": 5
                    ],
                    "timestamp": "2026-07-06T00:00:00.000Z"
                ]
                let data = try JSONSerialization.data(withJSONObject: envelope)
                let response = HTTPURLResponse(
                    url: request.url!, statusCode: 201, httpVersion: "HTTP/1.1",
                    headerFields: ["Content-Type": "application/json"]
                )!
                return (response, data)
            }
            // POST /api/messages
            captured.messageBody = MockURLProtocol.getBodyData(from: request)
            let envelope: [String: Any] = [
                "success": true,
                "data": ["messageId": "msg_1", "timestamp": "2026-07-06T00:00:00.000Z"],
                "timestamp": "2026-07-06T00:00:00.000Z"
            ]
            let data = try JSONSerialization.data(withJSONObject: envelope)
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 201, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, data)
        }

        let vm = ChatViewModel(apiClient: makeClient())
        vm.setSelectedRecipientForTesting("kerrigan")
        vm.inputText = ""
        _ = vm.attachments.add(png(1))

        await vm.sendMessage()

        // Message posted with the uploaded attachment id
        let bodyData = try XCTUnwrap(captured.messageBody)
        let json = try JSONSerialization.jsonObject(with: bodyData) as? [String: Any]
        XCTAssertEqual(json?["to"] as? String, "kerrigan")
        XCTAssertEqual(json?["attachmentIds"] as? [String], ["up_777"])

        // Composer cleared after a successful send
        XCTAssertTrue(vm.attachments.isEmpty)
    }

    // MARK: - Optimistic thumbnail (adj-203.5.7)

    func testOptimisticMessageCarriesLocalThumbnail() async throws {
        AttachmentImageLoader.clearCacheForTesting()
        let staged = png(1)

        MockURLProtocol.mockHandler = { request in
            let path = request.url?.path ?? ""
            if path == "/api/uploads" {
                let envelope: [String: Any] = [
                    "success": true,
                    "data": ["id": "up_1", "filename": "shot1.png", "mimeType": "image/png", "sizeBytes": 5],
                    "timestamp": "2026-07-06T00:00:00.000Z"
                ]
                return try Self.json(envelope, status: 201, url: request.url!)
            }
            if request.httpMethod == "GET" {
                // refresh() — return an empty, well-formed list so the pending
                // optimistic message survives the merge.
                let envelope: [String: Any] = [
                    "success": true,
                    "data": ["items": [], "total": 0, "hasMore": false],
                    "timestamp": "2026-07-06T00:00:00.000Z"
                ]
                return try Self.json(envelope, status: 200, url: request.url!)
            }
            // POST /api/messages
            let envelope: [String: Any] = [
                "success": true,
                "data": ["messageId": "msg_1", "timestamp": "2026-07-06T00:00:00.000Z"],
                "timestamp": "2026-07-06T00:00:00.000Z"
            ]
            return try Self.json(envelope, status: 201, url: request.url!)
        }

        let vm = ChatViewModel(apiClient: makeClient())
        vm.setSelectedRecipientForTesting("kerrigan")
        _ = vm.attachments.add(staged)

        await vm.sendMessage()

        // The just-sent (local) bubble carries an image attachment...
        let local = try XCTUnwrap(vm.messages.first { $0.id.hasPrefix("local-") })
        XCTAssertFalse(local.imageAttachments.isEmpty, "optimistic bubble should carry a local thumbnail")
        // ...whose bytes are already in the render cache (no server round-trip needed).
        let attId = local.imageAttachments[0].id
        XCTAssertEqual(AttachmentImageLoader.cachedData(for: attId), staged.data)
    }
}

extension ChatComposerAttachmentTests {
    /// Build a JSON mock response.
    static func json(_ object: [String: Any], status: Int, url: URL) throws -> (HTTPURLResponse, Data) {
        let data = try JSONSerialization.data(withJSONObject: object)
        let response = HTTPURLResponse(
            url: url, statusCode: status, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        return (response, data)
    }
}

private final class SendCapture: @unchecked Sendable {
    var messageBody: Data?
}
