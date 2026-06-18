import XCTest
@testable import AdjutantUI
@testable import AdjutantKit

/// Tests for the Style Guide editing surface on `SwarmProjectDetailViewModel`
/// (epic adj-201, US4 / adj-201.5.2).
///
/// The editor is brand-color only (v1): a required primary + optional secondary,
/// both hex-validated for PARITY with the backend
/// (`/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/`). Wire shapes match the frozen contract
/// (`GET`/`PUT /api/projects/:id/style-guide`) — see APIClientStyleGuideTests.
@MainActor
final class SwarmProjectDetailViewModelStyleGuideTests: XCTestCase {
    private var apiClient: APIClient!
    private var viewModel: SwarmProjectDetailViewModel!

    private let project = Project(
        id: "proj-001",
        name: "adjutant",
        path: "/tmp/adjutant",
        mode: "swarm",
        createdAt: "2026-06-18 10:00:00"
    )

    override func setUp() async throws {
        try await super.setUp()
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        let apiConfig = APIClientConfiguration(
            baseURL: URL(string: "http://test.local/api")!,
            retryPolicy: .none
        )
        apiClient = APIClient(configuration: apiConfig, urlSessionConfiguration: config)
        viewModel = SwarmProjectDetailViewModel(project: project, apiClient: apiClient)
    }

    override func tearDown() async throws {
        viewModel = nil
        apiClient = nil
        MockURLProtocol.mockHandler = nil
        try await super.tearDown()
    }

    // MARK: - Helpers

    private func mockGuideResponse(primary: Any, secondary: Any) {
        MockURLProtocol.mockHandler = MockURLProtocol.mockResponse(json: [
            "success": true,
            "data": ["brandColorPrimary": primary, "brandColorSecondary": secondary],
            "timestamp": "2026-06-18T10:00:00.000Z"
        ])
    }

    // MARK: - Initial state

    func testInitialStyleGuideFieldsAreEmpty() {
        XCTAssertEqual(viewModel.styleGuidePrimary, "")
        XCTAssertEqual(viewModel.styleGuideSecondary, "")
        XCTAssertFalse(viewModel.isSavingStyleGuide)
        XCTAssertNil(viewModel.styleGuideError)
        XCTAssertFalse(viewModel.styleGuideSaved)
    }

    // MARK: - loadStyleGuide

    func testLoadStyleGuidePopulatesBothColors() async {
        mockGuideResponse(primary: "#00FF00", secondary: "#003300")
        await viewModel.loadStyleGuide()
        XCTAssertEqual(viewModel.styleGuidePrimary, "#00FF00")
        XCTAssertEqual(viewModel.styleGuideSecondary, "#003300")
        XCTAssertNil(viewModel.styleGuideError)
    }

    func testLoadStyleGuideUnsetLeavesFieldsEmpty() async {
        mockGuideResponse(primary: NSNull(), secondary: NSNull())
        await viewModel.loadStyleGuide()
        XCTAssertEqual(viewModel.styleGuidePrimary, "")
        XCTAssertEqual(viewModel.styleGuideSecondary, "")
        XCTAssertNil(viewModel.styleGuideError)
    }

    func testLoadStyleGuidePrimaryOnly() async {
        mockGuideResponse(primary: "#1a2b3c", secondary: NSNull())
        await viewModel.loadStyleGuide()
        XCTAssertEqual(viewModel.styleGuidePrimary, "#1a2b3c")
        XCTAssertEqual(viewModel.styleGuideSecondary, "")
    }

    // MARK: - Hex validation parity

    func testValidHexAcceptsThreeAndSixDigit() {
        XCTAssertTrue(viewModel.isValidStyleGuideHex("#0f0"))
        XCTAssertTrue(viewModel.isValidStyleGuideHex("#00FF00"))
        XCTAssertTrue(viewModel.isValidStyleGuideHex("#1a2b3c"))
    }

    func testValidHexRejectsMalformed() {
        XCTAssertFalse(viewModel.isValidStyleGuideHex("00FF00"))   // no hash
        XCTAssertFalse(viewModel.isValidStyleGuideHex("#GGGGGG"))  // non-hex
        XCTAssertFalse(viewModel.isValidStyleGuideHex("#00FF0"))   // 5 digits
        XCTAssertFalse(viewModel.isValidStyleGuideHex("#00FF000")) // 7 digits
        XCTAssertFalse(viewModel.isValidStyleGuideHex(""))         // empty
    }

    // MARK: - canSaveStyleGuide gating

    func testCanSaveWhenPrimaryEmpty_isClearAllowed() {
        // An empty primary is the "clear the guide" gesture — always saveable.
        viewModel.styleGuidePrimary = ""
        viewModel.styleGuideSecondary = ""
        XCTAssertTrue(viewModel.canSaveStyleGuide)
    }

    func testCannotSaveWhenPrimaryInvalidHex() {
        viewModel.styleGuidePrimary = "notahex"
        XCTAssertFalse(viewModel.canSaveStyleGuide)
    }

    func testCannotSaveWhenSecondaryInvalidHex() {
        viewModel.styleGuidePrimary = "#00FF00"
        viewModel.styleGuideSecondary = "bad"
        XCTAssertFalse(viewModel.canSaveStyleGuide)
    }

    func testCanSaveWhenPrimaryValidAndSecondaryEmpty() {
        viewModel.styleGuidePrimary = "#00FF00"
        viewModel.styleGuideSecondary = ""
        XCTAssertTrue(viewModel.canSaveStyleGuide)
    }

    func testCanSaveWhenBothValid() {
        viewModel.styleGuidePrimary = "#00FF00"
        viewModel.styleGuideSecondary = "#003300"
        XCTAssertTrue(viewModel.canSaveStyleGuide)
    }

    // MARK: - saveStyleGuide — success

    func testSaveStyleGuideSendsPutAndUpdatesFromResponse() async {
        var capturedMethod: String?
        var capturedBody: [String: Any]?
        MockURLProtocol.mockHandler = { request in
            capturedMethod = request.httpMethod
            if let data = MockURLProtocol.getBodyData(from: request) {
                capturedBody = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            }
            return try MockURLProtocol.mockResponse(json: [
                "success": true,
                "data": ["brandColorPrimary": "#00FF00", "brandColorSecondary": "#003300"],
                "timestamp": "2026-06-18T10:00:00.000Z"
            ])(request)
        }

        viewModel.styleGuidePrimary = "#00FF00"
        viewModel.styleGuideSecondary = "#003300"
        await viewModel.saveStyleGuide()

        XCTAssertEqual(capturedMethod, "PUT")
        XCTAssertEqual(capturedBody?["primary"] as? String, "#00FF00")
        XCTAssertEqual(capturedBody?["secondary"] as? String, "#003300")
        XCTAssertTrue(viewModel.styleGuideSaved)
        XCTAssertNil(viewModel.styleGuideError)
        XCTAssertFalse(viewModel.isSavingStyleGuide)
        XCTAssertEqual(viewModel.styleGuidePrimary, "#00FF00")
        XCTAssertEqual(viewModel.styleGuideSecondary, "#003300")
    }

    /// An empty secondary must be sent as JSON null (clears secondary server-side).
    func testSaveStyleGuideSendsNullSecondaryWhenEmpty() async {
        var capturedBody: [String: Any]?
        MockURLProtocol.mockHandler = { request in
            if let data = MockURLProtocol.getBodyData(from: request) {
                capturedBody = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            }
            return try MockURLProtocol.mockResponse(json: [
                "success": true,
                "data": ["brandColorPrimary": "#00FF00", "brandColorSecondary": NSNull()],
                "timestamp": "2026-06-18T10:00:00.000Z"
            ])(request)
        }

        viewModel.styleGuidePrimary = "#00FF00"
        viewModel.styleGuideSecondary = ""
        await viewModel.saveStyleGuide()

        XCTAssertEqual(capturedBody?["primary"] as? String, "#00FF00")
        XCTAssertTrue(capturedBody?["secondary"] is NSNull,
                      "Empty secondary must serialize as JSON null")
        XCTAssertTrue(viewModel.styleGuideSaved)
        XCTAssertEqual(viewModel.styleGuideSecondary, "")
    }

    /// Saving an empty primary clears the guide; response (both null) empties the fields.
    func testSaveStyleGuideClearEmptiesFields() async {
        mockGuideResponse(primary: NSNull(), secondary: NSNull())
        viewModel.styleGuidePrimary = ""
        viewModel.styleGuideSecondary = ""
        await viewModel.saveStyleGuide()
        XCTAssertTrue(viewModel.styleGuideSaved)
        XCTAssertEqual(viewModel.styleGuidePrimary, "")
        XCTAssertEqual(viewModel.styleGuideSecondary, "")
    }

    // MARK: - saveStyleGuide — validation / failure

    /// Client-side validation blocks the request entirely (no network) on bad hex.
    func testSaveStyleGuideInvalidHexSetsErrorWithoutRequest() async {
        var requestMade = false
        MockURLProtocol.mockHandler = { request in
            requestMade = true
            return try MockURLProtocol.mockResponse(json: [
                "success": true,
                "data": ["brandColorPrimary": "#00FF00", "brandColorSecondary": NSNull()],
                "timestamp": "2026-06-18T10:00:00.000Z"
            ])(request)
        }

        viewModel.styleGuidePrimary = "notahex"
        await viewModel.saveStyleGuide()

        XCTAssertFalse(requestMade, "Invalid hex must not hit the network")
        XCTAssertNotNil(viewModel.styleGuideError)
        XCTAssertFalse(viewModel.styleGuideSaved)
        XCTAssertFalse(viewModel.isSavingStyleGuide)
    }

    /// A server failure sets the error and does NOT flag saved.
    func testSaveStyleGuideServerErrorSetsError() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 400, code: "BAD_REQUEST", message: "Invalid hex color"
        )

        viewModel.styleGuidePrimary = "#00FF00"
        await viewModel.saveStyleGuide()

        XCTAssertNotNil(viewModel.styleGuideError)
        XCTAssertFalse(viewModel.styleGuideSaved)
        XCTAssertFalse(viewModel.isSavingStyleGuide)
    }

    /// Editing fields after a successful save resets the saved flag (so the
    /// "saved" confirmation does not stick to stale input).
    func testEditingAfterSaveIsReflectedByLoadResettingSavedFlag() async {
        mockGuideResponse(primary: "#00FF00", secondary: NSNull())
        viewModel.styleGuidePrimary = "#00FF00"
        await viewModel.saveStyleGuide()
        XCTAssertTrue(viewModel.styleGuideSaved)

        // A fresh load resets the transient saved confirmation.
        mockGuideResponse(primary: "#00FF00", secondary: NSNull())
        await viewModel.loadStyleGuide()
        XCTAssertFalse(viewModel.styleGuideSaved)
    }
}
