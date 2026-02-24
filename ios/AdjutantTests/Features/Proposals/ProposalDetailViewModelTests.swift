import XCTest
@testable import AdjutantUI
@testable import AdjutantKit

@MainActor
final class ProposalDetailViewModelTests: XCTestCase {
    private var apiClient: APIClient!
    private var viewModel: ProposalDetailViewModel!

    private let testProposalId = "test-proposal-123"

    override func setUp() async throws {
        try await super.setUp()

        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]

        let apiConfig = APIClientConfiguration(baseURL: URL(string: "http://test.local/api")!)
        apiClient = APIClient(configuration: apiConfig, urlSessionConfiguration: config)
        viewModel = ProposalDetailViewModel(proposalId: testProposalId, apiClient: apiClient)
    }

    override func tearDown() async throws {
        viewModel = nil
        apiClient = nil
        MockURLProtocol.mockHandler = nil
        try await super.tearDown()
    }

    // MARK: - Helpers

    private func makeProposalJSON(
        id: String? = nil,
        status: String = "pending",
        type: String = "product"
    ) -> [String: Any] {
        let now = ISO8601DateFormatter().string(from: Date())
        return [
            "id": id ?? testProposalId,
            "author": "adjutant/polecats/flint",
            "title": "Add voice commands",
            "description": "Users should be able to control the dashboard using voice commands.",
            "type": type,
            "status": status,
            "createdAt": now,
            "updatedAt": now
        ]
    }

    private func mockProposalResponse(status: String = "pending", type: String = "product") {
        MockURLProtocol.mockHandler = { [self] request in
            let envelope: [String: Any] = [
                "success": true,
                "data": self.makeProposalJSON(status: status, type: type),
                "timestamp": ISO8601DateFormatter().string(from: Date())
            ]
            let data = try JSONSerialization.data(withJSONObject: envelope)
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, data)
        }
    }

    // MARK: - testLoadProposal

    func testLoadProposal() async {
        mockProposalResponse()

        await viewModel.loadProposal()

        XCTAssertNotNil(viewModel.proposal)
        XCTAssertEqual(viewModel.proposal?.id, testProposalId)
        XCTAssertEqual(viewModel.proposal?.title, "Add voice commands")
        XCTAssertEqual(viewModel.proposal?.author, "adjutant/polecats/flint")
        XCTAssertEqual(viewModel.proposal?.type, .product)
        XCTAssertEqual(viewModel.proposal?.status, .pending)
    }

    // MARK: - testAccept

    func testAccept() async {
        // First load the proposal
        mockProposalResponse(status: "pending")
        await viewModel.loadProposal()
        XCTAssertEqual(viewModel.proposal?.status, .pending)

        // Mock the accept response
        MockURLProtocol.mockHandler = { [self] request in
            XCTAssertEqual(request.httpMethod, "PATCH")
            let envelope: [String: Any] = [
                "success": true,
                "data": self.makeProposalJSON(status: "accepted"),
                "timestamp": ISO8601DateFormatter().string(from: Date())
            ]
            let data = try JSONSerialization.data(withJSONObject: envelope)
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, data)
        }

        await viewModel.accept()

        XCTAssertEqual(viewModel.proposal?.status, .accepted)
    }

    // MARK: - testDismiss

    func testDismiss() async {
        // First load the proposal
        mockProposalResponse(status: "pending")
        await viewModel.loadProposal()

        // Mock the dismiss response
        MockURLProtocol.mockHandler = { [self] request in
            XCTAssertEqual(request.httpMethod, "PATCH")
            let envelope: [String: Any] = [
                "success": true,
                "data": self.makeProposalJSON(status: "dismissed"),
                "timestamp": ISO8601DateFormatter().string(from: Date())
            ]
            let data = try JSONSerialization.data(withJSONObject: envelope)
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, data)
        }

        await viewModel.dismiss()

        XCTAssertEqual(viewModel.proposal?.status, .dismissed)
    }

    // MARK: - testSendToAgent

    func testSendToAgent() async {
        // Load an accepted proposal first
        mockProposalResponse(status: "accepted")
        await viewModel.loadProposal()
        XCTAssertFalse(viewModel.sendSuccess)

        // Mock the send message response
        var capturedBody: [String: Any]?
        MockURLProtocol.mockHandler = { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertTrue(request.url!.path.hasSuffix("/messages"))

            if let body = request.httpBody {
                capturedBody = try? JSONSerialization.jsonObject(with: body) as? [String: Any]
            }

            let now = ISO8601DateFormatter().string(from: Date())
            let envelope: [String: Any] = [
                "success": true,
                "data": ["messageId": "msg-new", "timestamp": now],
                "timestamp": now
            ]
            let data = try JSONSerialization.data(withJSONObject: envelope)
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 201, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, data)
        }

        await viewModel.sendToAgent()

        XCTAssertTrue(viewModel.sendSuccess)
        XCTAssertEqual(capturedBody?["to"] as? String, "user")
        XCTAssertTrue((capturedBody?["body"] as? String)?.contains("Add voice commands") ?? false)
        XCTAssertEqual(capturedBody?["threadId"] as? String, "proposal-\(testProposalId)")
    }

    // MARK: - testSendToAgentWithoutProposal

    func testSendToAgentWithoutProposal() async {
        // Don't load proposal - should be a no-op
        XCTAssertNil(viewModel.proposal)

        await viewModel.sendToAgent()

        XCTAssertFalse(viewModel.sendSuccess)
    }

    // MARK: - testErrorHandling

    func testErrorHandling() async {
        MockURLProtocol.mockHandler = MockURLProtocol.mockError(
            statusCode: 404,
            code: "NOT_FOUND",
            message: "Proposal not found"
        )

        await viewModel.loadProposal()

        XCTAssertNil(viewModel.proposal)
        XCTAssertNotNil(viewModel.errorMessage)
    }

    // MARK: - Computed Properties

    func testFormattedCreatedDateWithNoProposal() {
        XCTAssertEqual(viewModel.formattedCreatedDate, "Unknown")
    }

    func testFormattedCreatedDateWithProposal() async {
        mockProposalResponse()
        await viewModel.loadProposal()
        XCTAssertNotEqual(viewModel.formattedCreatedDate, "Unknown")
    }

    func testFormattedUpdatedDateWithNoProposal() {
        XCTAssertEqual(viewModel.formattedUpdatedDate, "Unknown")
    }

    func testInitialState() {
        XCTAssertNil(viewModel.proposal)
        XCTAssertFalse(viewModel.sendSuccess)
        XCTAssertFalse(viewModel.isLoading)
        XCTAssertNil(viewModel.errorMessage)
    }
}
