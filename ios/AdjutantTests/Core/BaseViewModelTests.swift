import XCTest
import Combine
@testable import Adjutant

@MainActor
final class BaseViewModelTests: XCTestCase {
    fileprivate var viewModel: TestViewModel!
    private var cancellables: Set<AnyCancellable>!

    override func setUp() async throws {
        viewModel = TestViewModel()
        cancellables = Set<AnyCancellable>()
    }

    override func tearDown() async throws {
        viewModel = nil
        cancellables = nil
    }

    // MARK: - Initial State Tests

    func testInitialState() {
        XCTAssertFalse(viewModel.isLoading)
        XCTAssertNil(viewModel.errorMessage)
    }

    // MARK: - performAsync Tests

    func testPerformAsyncSuccess() async {
        let expectation = XCTestExpectation(description: "Loading state changes")
        var loadingStates: [Bool] = []

        viewModel.$isLoading
            .sink { isLoading in
                loadingStates.append(isLoading)
                if loadingStates.count == 3 {
                    expectation.fulfill()
                }
            }
            .store(in: &cancellables)

        let result = await viewModel.performAsync {
            return "success"
        }

        await fulfillment(of: [expectation], timeout: 1.0)

        XCTAssertEqual(result, "success")
        XCTAssertFalse(viewModel.isLoading)
        XCTAssertNil(viewModel.errorMessage)
        // Initial false, then true during loading, then false after
        XCTAssertEqual(loadingStates, [false, true, false])
    }

    func testPerformAsyncFailure() async {
        let result: String? = await viewModel.performAsync {
            throw ServiceError.networkUnavailable
        }

        XCTAssertNil(result)
        XCTAssertFalse(viewModel.isLoading)
        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertEqual(viewModel.errorMessage, "Network connection unavailable")
    }

    func testPerformAsyncWithoutLoading() async {
        let expectation = XCTestExpectation(description: "No loading state change")
        expectation.isInverted = true

        var loadingChanged = false
        viewModel.$isLoading
            .dropFirst()
            .sink { _ in
                loadingChanged = true
                expectation.fulfill()
            }
            .store(in: &cancellables)

        let result = await viewModel.performAsync(showLoading: false) {
            return "success"
        }

        await fulfillment(of: [expectation], timeout: 0.5)

        XCTAssertEqual(result, "success")
        XCTAssertFalse(loadingChanged)
    }

    // MARK: - Error Handling Tests

    func testClearError() async {
        _ = await viewModel.performAsync {
            throw ServiceError.timeout
        }

        XCTAssertNotNil(viewModel.errorMessage)

        viewModel.clearError()

        XCTAssertNil(viewModel.errorMessage)
    }

    func testHandleServiceError() async {
        let errors: [(ServiceError, String)] = [
            (.networkUnavailable, "Network connection unavailable"),
            (.invalidResponse, "Invalid response from server"),
            (.unauthorized, "Unauthorized access"),
            (.notFound, "Resource not found"),
            (.timeout, "Request timed out"),
            (.serverError(statusCode: 500, message: "Internal error"), "Internal error"),
            (.serverError(statusCode: 503, message: nil), "Server error (status: 503)")
        ]

        for (error, expectedMessage) in errors {
            _ = await viewModel.performAsync {
                throw error
            }

            XCTAssertEqual(viewModel.errorMessage, expectedMessage, "Failed for error: \(error)")
            viewModel.clearError()
        }
    }

    // MARK: - Lifecycle Tests

    func testOnAppearCallsRefresh() async {
        viewModel.onAppear()

        // Give time for the async refresh to be triggered
        try? await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertTrue(viewModel.refreshCalled)
    }
}

// MARK: - Test Helpers

@MainActor
fileprivate class TestViewModel: BaseViewModel {
    var refreshCalled = false

    override func refresh() async {
        refreshCalled = true
    }
}
