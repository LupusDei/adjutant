import XCTest
@testable import AdjutantKit

/// Tests for the image-attachment upload surface on ``APIClient`` (adj-203.5.1 / T013):
/// - `uploadImage(...)` POSTs multipart to `/uploads` and decodes `{ id, filename, mimeType, sizeBytes }`.
/// - `sendChatMessage(...)` forwards `attachmentIds` in the JSON body.
/// - `uploadURL(id:)` builds the authenticated stream URL.
/// - `fetchUploadData(id:)` streams the image bytes through the authenticated client.
final class AttachmentUploadTests: XCTestCase {
    var client: APIClient!

    override func setUp() async throws {
        let sessionConfig = URLSessionConfiguration.ephemeral
        sessionConfig.protocolClasses = [MockURLProtocol.self]
        let clientConfig = APIClientConfiguration(
            baseURL: URL(string: "http://test.local/api")!,
            apiKey: "secret-key",
            retryPolicy: .none
        )
        client = APIClient(configuration: clientConfig, urlSessionConfiguration: sessionConfig)
    }

    override func tearDown() async throws {
        MockURLProtocol.mockHandler = nil
        client = nil
    }

    // MARK: - uploadImage

    func testUploadImagePostsMultipartAndDecodesResult() async throws {
        let capturedRequest = CapturedRequest()
        MockURLProtocol.mockHandler = { request in
            capturedRequest.request = request
            capturedRequest.body = MockURLProtocol.getBodyData(from: request)
            let envelope: [String: Any] = [
                "success": true,
                "data": [
                    "id": "up_abc123",
                    "filename": "screenshot.png",
                    "mimeType": "image/png",
                    "sizeBytes": 2048
                ],
                "timestamp": "2026-07-06T00:00:00.000Z"
            ]
            let data = try JSONSerialization.data(withJSONObject: envelope)
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 201,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, data)
        }

        let pngBytes = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x01, 0x02])
        let result = try await client.uploadImage(
            data: pngBytes,
            filename: "screenshot.png",
            mimeType: "image/png"
        )

        XCTAssertEqual(result.id, "up_abc123")
        XCTAssertEqual(result.filename, "screenshot.png")
        XCTAssertEqual(result.mimeType, "image/png")
        XCTAssertEqual(result.sizeBytes, 2048)

        // Request assertions
        XCTAssertEqual(capturedRequest.request?.httpMethod, "POST")
        XCTAssertEqual(capturedRequest.request?.url?.path, "/api/uploads")
        let contentType = capturedRequest.request?.value(forHTTPHeaderField: "Content-Type")
        XCTAssertNotNil(contentType)
        XCTAssertTrue(contentType!.hasPrefix("multipart/form-data; boundary="),
                      "Expected multipart content type, got \(contentType ?? "nil")")
        XCTAssertEqual(capturedRequest.request?.value(forHTTPHeaderField: "Authorization"), "Bearer secret-key")

        // Body must be multipart with the file field + filename + image bytes
        let bodyString = String(data: capturedRequest.body ?? Data(), encoding: .isoLatin1) ?? ""
        XCTAssertTrue(bodyString.contains("name=\"file\""), "multipart body missing file field")
        XCTAssertTrue(bodyString.contains("filename=\"screenshot.png\""), "multipart body missing filename")
        XCTAssertTrue(bodyString.contains("Content-Type: image/png"), "multipart body missing part content-type")
    }

    func testUploadImageThrowsOnValidationError() async throws {
        MockURLProtocol.mockHandler = { request in
            let envelope: [String: Any] = [
                "success": false,
                "error": ["code": "unsupported-type", "message": "Only images allowed"],
                "timestamp": "2026-07-06T00:00:00.000Z"
            ]
            let data = try JSONSerialization.data(withJSONObject: envelope)
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 400,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, data)
        }

        do {
            _ = try await client.uploadImage(
                data: Data([0x00, 0x01]),
                filename: "evil.txt",
                mimeType: "text/plain"
            )
            XCTFail("Expected uploadImage to throw on a 400 validation error")
        } catch {
            // Expected — any APIClientError is acceptable
        }
    }

    // MARK: - sendChatMessage forwards attachmentIds

    func testSendChatMessageForwardsAttachmentIds() async throws {
        let capturedRequest = CapturedRequest()
        MockURLProtocol.mockHandler = { request in
            capturedRequest.request = request
            capturedRequest.body = MockURLProtocol.getBodyData(from: request)
            let envelope: [String: Any] = [
                "success": true,
                "data": ["messageId": "msg_1", "timestamp": "2026-07-06T00:00:00.000Z"],
                "timestamp": "2026-07-06T00:00:00.000Z"
            ]
            let data = try JSONSerialization.data(withJSONObject: envelope)
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 201,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, data)
        }

        let result = try await client.sendChatMessage(
            agentId: "kerrigan",
            body: "look at this",
            attachmentIds: ["up_1", "up_2"]
        )
        XCTAssertEqual(result.messageId, "msg_1")

        let bodyData = try XCTUnwrap(capturedRequest.body)
        let json = try JSONSerialization.jsonObject(with: bodyData) as? [String: Any]
        XCTAssertEqual(json?["to"] as? String, "kerrigan")
        XCTAssertEqual(json?["body"] as? String, "look at this")
        let ids = json?["attachmentIds"] as? [String]
        XCTAssertEqual(ids, ["up_1", "up_2"])
    }

    func testSendChatMessageOmitsAttachmentIdsWhenNone() async throws {
        let capturedRequest = CapturedRequest()
        MockURLProtocol.mockHandler = { request in
            capturedRequest.body = MockURLProtocol.getBodyData(from: request)
            let envelope: [String: Any] = [
                "success": true,
                "data": ["messageId": "msg_2", "timestamp": "2026-07-06T00:00:00.000Z"],
                "timestamp": "2026-07-06T00:00:00.000Z"
            ]
            let data = try JSONSerialization.data(withJSONObject: envelope)
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 201, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, data)
        }

        _ = try await client.sendChatMessage(agentId: "kerrigan", body: "no image")

        let bodyData = try XCTUnwrap(capturedRequest.body)
        let json = try JSONSerialization.jsonObject(with: bodyData) as? [String: Any]
        XCTAssertNil(json?["attachmentIds"], "attachmentIds should be omitted when nil")
    }

    // MARK: - uploadURL

    func testUploadURLBuildsAuthenticatedStreamURL() async {
        let url = await client.uploadURL(id: "up_abc123")
        XCTAssertEqual(url.absoluteString, "http://test.local/api/uploads/up_abc123")
    }

    // MARK: - fetchUploadData (authenticated render path — raynor guidance)

    func testFetchUploadDataUsesAuthHeaderAndReturnsBytes() async throws {
        let capturedRequest = CapturedRequest()
        let imageBytes = Data([0x89, 0x50, 0x4E, 0x47, 0xAA, 0xBB, 0xCC])
        MockURLProtocol.mockHandler = { request in
            capturedRequest.request = request
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "image/png"]
            )!
            return (response, imageBytes)
        }

        let data = try await client.fetchUploadData(id: "up_abc123")
        XCTAssertEqual(data, imageBytes)
        XCTAssertEqual(capturedRequest.request?.httpMethod, "GET")
        XCTAssertEqual(capturedRequest.request?.url?.path, "/api/uploads/up_abc123")
        XCTAssertEqual(capturedRequest.request?.value(forHTTPHeaderField: "Authorization"), "Bearer secret-key")
    }
}

/// Box for capturing a request across the escaping mock closure boundary.
private final class CapturedRequest: @unchecked Sendable {
    var request: URLRequest?
    var body: Data?
}
