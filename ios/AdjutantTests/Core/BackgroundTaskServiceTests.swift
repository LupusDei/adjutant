import XCTest
import Combine
@testable import Adjutant

@MainActor
final class BackgroundTaskServiceTests: XCTestCase {

    var sut: BackgroundTaskService!
    var cancellables: Set<AnyCancellable>!

    override func setUp() async throws {
        try await super.setUp()
        sut = BackgroundTaskService.shared
        cancellables = []
        // Clear any stored last refresh date for clean tests
        UserDefaults.standard.removeObject(forKey: "lastBackgroundRefreshDate")
    }

    override func tearDown() async throws {
        cancellables = nil
        try await super.tearDown()
    }

    // MARK: - Task Identifier Tests

    func testAppRefreshTaskIdentifier() {
        XCTAssertEqual(
            BackgroundTaskService.appRefreshTaskIdentifier,
            "com.adjutant.refresh"
        )
    }

    func testProcessingTaskIdentifier() {
        XCTAssertEqual(
            BackgroundTaskService.processingTaskIdentifier,
            "com.adjutant.processing"
        )
    }

    // MARK: - Initial State Tests

    func testInitialRefreshingState() {
        XCTAssertFalse(sut.isRefreshing)
    }

    func testInitialLastErrorIsNil() {
        XCTAssertNil(sut.lastError)
    }

    func testInitialSuccessfulRefreshCountIsZero() {
        XCTAssertEqual(sut.successfulRefreshCount, 0)
    }

    // MARK: - Published Property Tests

    func testIsRefreshingPublisherEmitsChanges() {
        let expectation = XCTestExpectation(description: "isRefreshing change published")
        var receivedValues: [Bool] = []

        sut.$isRefreshing
            .sink { value in
                receivedValues.append(value)
                if receivedValues.count >= 1 {
                    expectation.fulfill()
                }
            }
            .store(in: &cancellables)

        wait(for: [expectation], timeout: 1.0)
        XCTAssertFalse(receivedValues.isEmpty)
        XCTAssertFalse(receivedValues.first ?? true)
    }

    func testLastRefreshDatePublisherEmitsChanges() {
        let expectation = XCTestExpectation(description: "lastRefreshDate change published")
        var receivedValue: Date??

        sut.$lastRefreshDate
            .sink { value in
                receivedValue = value
                expectation.fulfill()
            }
            .store(in: &cancellables)

        wait(for: [expectation], timeout: 1.0)
        // Initial value should be nil (cleared in setUp)
        XCTAssertNil(receivedValue as? Date)
    }

    func testLastErrorPublisherEmitsChanges() {
        let expectation = XCTestExpectation(description: "lastError change published")
        var receivedValue: Error??

        sut.$lastError
            .sink { value in
                receivedValue = value
                expectation.fulfill()
            }
            .store(in: &cancellables)

        wait(for: [expectation], timeout: 1.0)
        XCTAssertNil(receivedValue as? Error)
    }

    // MARK: - Singleton Tests

    func testSharedInstanceIsSingleton() {
        let instance1 = BackgroundTaskService.shared
        let instance2 = BackgroundTaskService.shared
        XCTAssertTrue(instance1 === instance2)
    }

    // MARK: - Cancel All Tasks Test

    func testCancelAllTasksDoesNotThrow() {
        // This just verifies the method can be called without throwing
        sut.cancelAllTasks()
        // No assertion needed - if it throws, the test fails
    }

    // MARK: - Scene Phase Handling Tests

    func testHandleScenePhaseChangeToBackground() {
        // This verifies the method can be called without errors
        // Actual scheduling requires BGTaskScheduler entitlements
        sut.handleScenePhaseChange(to: .background)
        // No assertion needed - if it throws, the test fails
    }

    func testHandleScenePhaseChangeToActive() {
        sut.handleScenePhaseChange(to: .active)
        // No assertion needed - if it throws, the test fails
    }

    func testHandleScenePhaseChangeToInactive() {
        sut.handleScenePhaseChange(to: .inactive)
        // No assertion needed - if it throws, the test fails
    }
}
