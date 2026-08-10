import XCTest
@testable import AdjutantKit

/// VM-driven viewer state tests (epic adj-j7az6, Phase 4 / US4 — .4.3).
///
/// The SwiftUI `ArtifactsView`/WKWebView viewer lives in the app target (CI-verified), but
/// the state that drives it — selecting an artifact, fetching its composed self-contained
/// document, and the loading/error lifecycle — lives in `ArtifactsViewModel` so it is
/// unit-testable on-host.
@MainActor
final class ArtifactViewerStateTests: XCTestCase {
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

    private func makeVM() -> ArtifactsViewModel {
        ArtifactsViewModel(apiClient: client, serverBaseURL: { "https://host.example.com/api" })
    }

    private func artifact(id: String = "a-001") -> Artifact {
        Artifact(
            id: id,
            title: "Doc \(id)",
            html: "<main>authored</main>",
            isPublic: false,
            createdAt: "2026-08-10 10:00:00",
            updatedAt: "2026-08-10 10:00:00"
        )
    }

    func testOpenDocumentSelectsAndFetchesComposedHTML() async {
        let composed = "<!DOCTYPE html><html><body><h1>Composed</h1></body></html>"
        MockURLProtocol.mockHandler = { request in
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "text/html; charset=utf-8"]
            )!
            return (response, composed.data(using: .utf8)!)
        }

        let vm = makeVM()
        await vm.openDocument(for: artifact())

        XCTAssertEqual(vm.selectedArtifact?.id, "a-001")
        XCTAssertEqual(vm.documentHTML, composed)
        XCTAssertNil(vm.documentError)
        XCTAssertFalse(vm.isLoadingDocument)
    }

    func testOpenDocumentErrorSetsDocumentError() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 404, code: "NOT_FOUND", message: "gone"
        )

        let vm = makeVM()
        await vm.openDocument(for: artifact())

        XCTAssertNil(vm.documentHTML)
        XCTAssertNotNil(vm.documentError)
        XCTAssertFalse(vm.isLoadingDocument)
    }

    func testCloseDocumentClearsViewerState() async {
        let composed = "<html><body>x</body></html>"
        MockURLProtocol.mockHandler = { request in
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: nil
            )!
            return (response, composed.data(using: .utf8)!)
        }
        let vm = makeVM()
        await vm.openDocument(for: artifact())
        XCTAssertNotNil(vm.documentHTML)

        vm.closeDocument()
        XCTAssertNil(vm.selectedArtifact)
        XCTAssertNil(vm.documentHTML)
        XCTAssertNil(vm.documentError)
    }
}
