import XCTest
import AdjutantKit
@testable import AdjutantUI

/// Tests for the authenticated attachment render path (adj-203.5.3 / T015).
///
/// Per coordinator guidance: `GET /api/uploads/:id` is behind `apiKeyAuth`, so
/// rendering MUST load image bytes through the authenticated client (Bearer
/// header), not a bare `AsyncImage(url:)`. These tests assert the authenticated
/// fetch and the loader state machine.
@MainActor
final class MessageAttachmentRenderTests: XCTestCase {
    override func setUp() async throws {
        AttachmentImageLoader.clearCacheForTesting()
    }

    override func tearDown() async throws {
        MockURLProtocol.mockHandler = nil
        AttachmentImageLoader.clearCacheForTesting()
    }

    private func makeClient(apiKey: String? = "secret-key") -> APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        let apiConfig = APIClientConfiguration(
            baseURL: URL(string: "http://test.local/api")!,
            apiKey: apiKey,
            retryPolicy: .none
        )
        return APIClient(configuration: apiConfig, urlSessionConfiguration: config)
    }

    func testLoaderFetchesBytesThroughAuthenticatedClient() async throws {
        let captured = CapturedBox()
        let imageBytes = Data([0x89, 0x50, 0x4E, 0x47, 0x11, 0x22, 0x33])
        MockURLProtocol.mockHandler = { request in
            captured.request = request
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "image/png"]
            )!
            return (response, imageBytes)
        }

        let loader = AttachmentImageLoader(apiClient: makeClient())
        XCTAssertEqual(loader.state, .idle)

        await loader.load(attachmentId: "up_abc123")

        XCTAssertEqual(loader.state, .loaded(imageBytes))
        // Authenticated fetch: request carried the Bearer header + hit /uploads/:id
        XCTAssertEqual(captured.request?.url?.path, "/api/uploads/up_abc123")
        XCTAssertEqual(captured.request?.value(forHTTPHeaderField: "Authorization"), "Bearer secret-key")
    }

    func testLoaderEntersFailedStateOnError() async throws {
        MockURLProtocol.mockHandler = { request in
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 404, httpVersion: "HTTP/1.1",
                headerFields: nil
            )!
            return (response, Data())
        }

        let loader = AttachmentImageLoader(apiClient: makeClient())
        await loader.load(attachmentId: "missing")

        if case .failed = loader.state {
            // expected
        } else {
            XCTFail("Expected failed state, got \(loader.state)")
        }
    }

    // MARK: - In-memory cache (adj-203.5.6)

    func testSecondLoadServesFromCacheWithoutRefetch() async throws {
        let fetchCount = CounterBox()
        let imageBytes = Data([0x89, 0x50, 0x4E, 0x47, 0x55])
        MockURLProtocol.mockHandler = { request in
            fetchCount.value += 1
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "image/png"]
            )!
            return (response, imageBytes)
        }

        let client = makeClient()
        // First loader triggers a network fetch and populates the cache.
        let first = AttachmentImageLoader(apiClient: client)
        await first.load(attachmentId: "cached_1")
        XCTAssertEqual(first.state, .loaded(imageBytes))
        XCTAssertEqual(fetchCount.value, 1)

        // A brand-new loader for the same id must serve from cache — no refetch.
        let second = AttachmentImageLoader(apiClient: client)
        await second.load(attachmentId: "cached_1")
        XCTAssertEqual(second.state, .loaded(imageBytes))
        XCTAssertEqual(fetchCount.value, 1, "second load must hit the cache, not the network")
    }

    func testPrimeSeedsCacheForImmediateLoad() async throws {
        // No mock handler set — if this hit the network it would crash/fail.
        let localBytes = Data([0x89, 0x50, 0x4E, 0x47, 0x99])
        AttachmentImageLoader.prime(attachmentId: "local_1", data: localBytes)

        let loader = AttachmentImageLoader(apiClient: makeClient())
        await loader.load(attachmentId: "local_1")
        XCTAssertEqual(loader.state, .loaded(localBytes))
    }

    func testMessageImageAttachmentsFiltersToImages() {
        let now = "2026-07-06T00:00:00.000Z"
        let img = MessageAttachment(
            id: "a1", messageId: "m1", kind: "image",
            filename: "shot.png", mimeType: "image/png", sizeBytes: 10, createdAt: now
        )
        let other = MessageAttachment(
            id: "a2", messageId: "m1", kind: "file",
            filename: "notes.txt", mimeType: "text/plain", sizeBytes: 5, createdAt: now
        )
        let message = PersistentMessage(
            id: "m1", agentId: "user", recipient: "kerrigan", role: .user,
            body: "", createdAt: now, updatedAt: now, attachments: [img, other]
        )

        let images = message.imageAttachments
        XCTAssertEqual(images.map(\.id), ["a1"])
    }

    func testMessageImageAttachmentsEmptyWhenNil() {
        let now = "2026-07-06T00:00:00.000Z"
        let message = PersistentMessage(
            id: "m1", agentId: "user", recipient: "kerrigan", role: .user,
            body: "hi", createdAt: now, updatedAt: now
        )
        XCTAssertTrue(message.imageAttachments.isEmpty)
    }
}

private final class CapturedBox: @unchecked Sendable {
    var request: URLRequest?
}

private final class CounterBox: @unchecked Sendable {
    var value = 0
}
