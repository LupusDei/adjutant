import XCTest
@testable import AdjutantKit

/// Tests for `ArtifactsViewModel` (epic adj-j7az6, Phase 4 / US4 — .4.2 + .4.3 selection).
///
/// The VM owns the artifacts list + load/error/publish/unpublish/delete/create state and
/// the selection state that drives the list → viewer flow. It lives in AdjutantKit so this
/// logic is unit-testable without an app host (the SwiftUI view is CI-verified).
@MainActor
final class ArtifactsViewModelTests: XCTestCase {
    var client: APIClient!

    override func setUp() async throws {
        let sessionConfig = URLSessionConfiguration.ephemeral
        sessionConfig.protocolClasses = [MockURLProtocol.self]
        let clientConfig = APIClientConfiguration(
            baseURL: URL(string: "http://test.local/api")!,
            retryPolicy: .none
        )
        client = APIClient(configuration: clientConfig, urlSessionConfiguration: sessionConfig)
    }

    override func tearDown() async throws {
        MockURLProtocol.mockHandler = nil
        client = nil
    }

    private func makeVM(base: String? = "https://host.example.com/api") -> ArtifactsViewModel {
        ArtifactsViewModel(apiClient: client, serverBaseURL: { base })
    }

    // MARK: - Initial state

    func testInitialStateIsEmptyAndNotLoading() {
        let vm = makeVM()
        XCTAssertTrue(vm.artifacts.isEmpty)
        XCTAssertFalse(vm.isLoading)
        XCTAssertNil(vm.errorMessage)
        XCTAssertNil(vm.selectedArtifact)
        XCTAssertTrue(vm.isEmpty)
    }

    // MARK: - load

    func testLoadPopulatesArtifacts() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [
                ArtifactAPITests.artifactDict(id: "a-001", published: true),
                ArtifactAPITests.artifactDict(id: "a-002", published: false)
            ],
            "timestamp": "2026-08-10T10:00:00.000Z"
        ])

        let vm = makeVM()
        await vm.load()

        XCTAssertEqual(vm.artifacts.count, 2)
        XCTAssertEqual(vm.artifacts[0].id, "a-001")
        XCTAssertFalse(vm.isLoading)
        XCTAssertNil(vm.errorMessage)
        XCTAssertFalse(vm.isEmpty)
    }

    func testLoadErrorSetsErrorMessage() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 500, code: "INTERNAL_ERROR", message: "boom"
        )

        let vm = makeVM()
        await vm.load()

        XCTAssertTrue(vm.artifacts.isEmpty)
        XCTAssertNotNil(vm.errorMessage)
        XCTAssertFalse(vm.isLoading)
    }

    // MARK: - publish / unpublish update in-place

    func testPublishUpdatesArtifactInPlace() async {
        // First load two unpublished artifacts.
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [
                ArtifactAPITests.artifactDict(id: "a-001", published: false),
                ArtifactAPITests.artifactDict(id: "a-002", published: false)
            ],
            "timestamp": "2026-08-10T10:00:00.000Z"
        ])
        let vm = makeVM()
        await vm.load()
        XCTAssertFalse(vm.artifacts[0].isPublished)

        // Now publish a-001.
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [
                "artifact": ArtifactAPITests.artifactDict(id: "a-001", published: true),
                "publicUrl": "https://host.example.com/a/abc123def456ghi7"
            ],
            "timestamp": "2026-08-10T10:00:00.000Z"
        ])
        await vm.publish(vm.artifacts[0])

        XCTAssertTrue(vm.artifacts[0].isPublished, "published artifact should be updated in place")
        XCTAssertEqual(vm.artifacts[0].shareToken, "abc123def456ghi7")
        XCTAssertFalse(vm.artifacts[1].isPublished, "other artifacts untouched")
        XCTAssertFalse(vm.isWorking)
    }

    func testUnpublishUpdatesArtifactInPlace() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [ArtifactAPITests.artifactDict(id: "a-001", published: true)],
            "timestamp": "2026-08-10T10:00:00.000Z"
        ])
        let vm = makeVM()
        await vm.load()
        XCTAssertTrue(vm.artifacts[0].isPublished)

        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": ["artifact": ArtifactAPITests.artifactDict(id: "a-001", published: false)],
            "timestamp": "2026-08-10T10:00:00.000Z"
        ])
        await vm.unpublish(vm.artifacts[0])

        XCTAssertFalse(vm.artifacts[0].isPublished)
    }

    func testPublishErrorSetsMessageAndKeepsState() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [ArtifactAPITests.artifactDict(id: "a-001", published: false)],
            "timestamp": "2026-08-10T10:00:00.000Z"
        ])
        let vm = makeVM()
        await vm.load()

        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 404, code: "NOT_FOUND", message: "gone"
        )
        await vm.publish(vm.artifacts[0])

        XCTAssertFalse(vm.artifacts[0].isPublished, "failed publish must not flip state")
        XCTAssertNotNil(vm.errorMessage)
        XCTAssertFalse(vm.isWorking)
    }

    // MARK: - create

    func testCreatePrependsNewArtifact() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [ArtifactAPITests.artifactDict(id: "a-001", published: false)],
            "timestamp": "2026-08-10T10:00:00.000Z"
        ])
        let vm = makeVM()
        await vm.load()
        XCTAssertEqual(vm.artifacts.count, 1)

        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(statusCode: 201, json: [
            "success": true,
            "data": ArtifactAPITests.artifactDict(id: "a-new", published: false),
            "timestamp": "2026-08-10T10:00:00.000Z"
        ])
        let created = await vm.create(title: "New", html: "<main>x</main>", description: nil)

        XCTAssertEqual(created?.id, "a-new")
        XCTAssertEqual(vm.artifacts.count, 2)
        XCTAssertEqual(vm.artifacts.first?.id, "a-new", "new artifact should be prepended (newest-first)")
    }

    // MARK: - delete

    func testDeleteRemovesArtifact() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [
                ArtifactAPITests.artifactDict(id: "a-001", published: false),
                ArtifactAPITests.artifactDict(id: "a-002", published: false)
            ],
            "timestamp": "2026-08-10T10:00:00.000Z"
        ])
        let vm = makeVM()
        await vm.load()
        XCTAssertEqual(vm.artifacts.count, 2)

        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": ["id": "a-001", "deleted": true],
            "timestamp": "2026-08-10T10:00:00.000Z"
        ])
        await vm.delete(vm.artifacts[0])

        XCTAssertEqual(vm.artifacts.count, 1)
        XCTAssertEqual(vm.artifacts[0].id, "a-002")
    }

    func testDeleteClearsSelectionWhenDeletingSelected() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [ArtifactAPITests.artifactDict(id: "a-001", published: false)],
            "timestamp": "2026-08-10T10:00:00.000Z"
        ])
        let vm = makeVM()
        await vm.load()
        vm.select(vm.artifacts[0])
        XCTAssertEqual(vm.selectedArtifact?.id, "a-001")

        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": ["id": "a-001", "deleted": true],
            "timestamp": "2026-08-10T10:00:00.000Z"
        ])
        await vm.delete(vm.artifacts[0])

        XCTAssertNil(vm.selectedArtifact, "deleting the selected artifact clears selection")
    }

    // MARK: - selection state (drives list → viewer, .4.3)

    func testSelectAndClearSelection() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [ArtifactAPITests.artifactDict(id: "a-001", published: true)],
            "timestamp": "2026-08-10T10:00:00.000Z"
        ])
        let vm = makeVM()
        await vm.load()

        vm.select(vm.artifacts[0])
        XCTAssertEqual(vm.selectedArtifact?.id, "a-001")

        vm.clearSelection()
        XCTAssertNil(vm.selectedArtifact)
    }

    // MARK: - shareURL

    func testShareURLForPublishedArtifact() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [ArtifactAPITests.artifactDict(id: "a-001", published: true)],
            "timestamp": "2026-08-10T10:00:00.000Z"
        ])
        let vm = makeVM(base: "https://host.example.com/api")
        await vm.load()

        let url = vm.shareURL(for: vm.artifacts[0])
        XCTAssertEqual(url?.absoluteString, "https://host.example.com/a/abc123def456ghi7")
    }

    func testShareURLNilForUnpublishedArtifact() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [ArtifactAPITests.artifactDict(id: "a-001", published: false)],
            "timestamp": "2026-08-10T10:00:00.000Z"
        ])
        let vm = makeVM()
        await vm.load()

        XCTAssertNil(vm.shareURL(for: vm.artifacts[0]), "unpublished artifact has no share URL")
    }

    func testShareURLNilWhenNoActiveServer() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": [ArtifactAPITests.artifactDict(id: "a-001", published: true)],
            "timestamp": "2026-08-10T10:00:00.000Z"
        ])
        let vm = makeVM(base: nil)
        await vm.load()

        XCTAssertNil(vm.shareURL(for: vm.artifacts[0]), "no active server → no share URL")
    }
}
