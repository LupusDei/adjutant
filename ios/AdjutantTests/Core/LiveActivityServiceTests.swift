#if os(iOS)
import XCTest
import Combine
import AdjutantKit
@testable import AdjutantUI

@MainActor
final class LiveActivityServiceTests: XCTestCase {

    var sut: LiveActivityService!
    var cancellables: Set<AnyCancellable>!

    override func setUp() async throws {
        try await super.setUp()
        sut = LiveActivityService.shared
        cancellables = []
    }

    override func tearDown() async throws {
        // End any activities that might have been started during tests
        await sut.endAllActivities()
        cancellables = nil
        try await super.tearDown()
    }

    // MARK: - Singleton Tests

    func testSharedInstanceExists() {
        XCTAssertNotNil(LiveActivityService.shared)
    }

    func testSharedInstanceIsSameReference() {
        let instance1 = LiveActivityService.shared
        let instance2 = LiveActivityService.shared
        XCTAssertTrue(instance1 === instance2)
    }

    // MARK: - Initial State Tests

    func testInitialHasActiveActivityIsFalse() {
        // On a fresh launch, there should be no active activity
        // Note: This might be true if a previous test left an activity running
        // so we end all activities first
        Task {
            await sut.endAllActivities()
        }
        // After ending, hasActiveActivity should be false
        XCTAssertFalse(sut.hasActiveActivity)
    }

    func testInitialCurrentActivityIdIsNil() {
        XCTAssertNil(sut.currentActivityId)
    }

    // MARK: - Support Detection Tests

    func testIsSupportedPropertyExists() {
        // Just verify the property is accessible
        _ = sut.isSupported
    }

    // MARK: - Content State Tests

    func testContentStateInitialization() {
        let agents = [
            AgentSummary(name: "obsidian", status: "working"),
            AgentSummary(name: "onyx", status: "idle"),
            AgentSummary(name: "slate", status: "blocked")
        ]
        let state = AdjutantActivityAttributes.ContentState(
            unreadMessageCount: 5,
            activeAgents: agents,
            lastUpdated: Date()
        )

        XCTAssertEqual(state.unreadMessageCount, 5)
        XCTAssertEqual(state.activeAgents.count, 3)
        XCTAssertEqual(state.activeAgents[0].name, "obsidian")
        XCTAssertNotNil(state.lastUpdated)
    }

    func testContentStateWithExplicitDate() {
        let testDate = Date(timeIntervalSince1970: 0)
        let state = AdjutantActivityAttributes.ContentState(
            unreadMessageCount: 0,
            activeAgents: [],
            lastUpdated: testDate
        )

        XCTAssertEqual(state.lastUpdated, testDate)
    }

    func testContentStateEquality() {
        let date = Date()
        let agents = [AgentSummary(name: "obsidian", status: "working")]
        let beads = [BeadSummary(id: "adj-001", title: "Test", assignee: "obsidian")]
        let state1 = AdjutantActivityAttributes.ContentState(
            unreadMessageCount: 5,
            activeAgents: agents,
            beadsInProgress: beads,
            lastUpdated: date
        )
        let state2 = AdjutantActivityAttributes.ContentState(
            unreadMessageCount: 5,
            activeAgents: agents,
            beadsInProgress: beads,
            lastUpdated: date
        )

        XCTAssertEqual(state1, state2)
    }

    func testContentStateInequality() {
        let state1 = AdjutantActivityAttributes.ContentState(
            unreadMessageCount: 5,
            activeAgents: [AgentSummary(name: "obsidian", status: "working")],
            lastUpdated: Date()
        )
        let state2 = AdjutantActivityAttributes.ContentState(
            unreadMessageCount: 10,
            activeAgents: [AgentSummary(name: "obsidian", status: "working")],
            lastUpdated: Date()
        )

        XCTAssertNotEqual(state1, state2)
    }

    // MARK: - Attributes Tests

    func testAttributesInitialization() {
        let attributes = AdjutantActivityAttributes(townName: "test-town")
        XCTAssertEqual(attributes.townName, "test-town")
    }

    // MARK: - Error Tests

    func testLiveActivityErrorNotSupported() {
        let error = LiveActivityError.notSupported
        XCTAssertNotNil(error.errorDescription)
        XCTAssertTrue(error.errorDescription!.contains("not supported"))
    }

    func testLiveActivityErrorAlreadyActive() {
        let error = LiveActivityError.alreadyActive
        XCTAssertNotNil(error.errorDescription)
        XCTAssertTrue(error.errorDescription!.contains("already running"))
    }

    func testLiveActivityErrorNoActiveActivity() {
        let error = LiveActivityError.noActiveActivity
        XCTAssertNotNil(error.errorDescription)
        XCTAssertTrue(error.errorDescription!.contains("No active"))
    }

    func testLiveActivityErrorStartFailed() {
        let underlyingError = NSError(domain: "test", code: 1, userInfo: nil)
        let error = LiveActivityError.startFailed(underlyingError)
        XCTAssertNotNil(error.errorDescription)
        XCTAssertTrue(error.errorDescription!.contains("start"))
    }

    func testLiveActivityErrorUpdateFailed() {
        let underlyingError = NSError(domain: "test", code: 1, userInfo: nil)
        let error = LiveActivityError.updateFailed(underlyingError)
        XCTAssertNotNil(error.errorDescription)
        XCTAssertTrue(error.errorDescription!.contains("update"))
    }

    // MARK: - Create State Helper Tests

    func testCreateStateWithParameters() {
        let agents = [
            AgentSummary(name: "obsidian", status: "working"),
            AgentSummary(name: "onyx", status: "idle")
        ]
        let state = LiveActivityService.createState(
            unreadMessageCount: 10,
            activeAgents: agents
        )

        XCTAssertEqual(state.unreadMessageCount, 10)
        XCTAssertEqual(state.activeAgents.count, 2)
    }

    func testCreateStateWithEmptyState() {
        let state = LiveActivityService.createState(
            unreadMessageCount: 0,
            activeAgents: []
        )

        XCTAssertEqual(state.unreadMessageCount, 0)
        XCTAssertEqual(state.activeAgents.count, 0)
    }

    // MARK: - Published Property Tests

    func testHasActiveActivityPublishes() {
        let expectation = expectation(description: "hasActiveActivity publishes")
        expectation.assertForOverFulfill = false

        sut.$hasActiveActivity
            .dropFirst() // Skip initial value
            .sink { _ in
                expectation.fulfill()
            }
            .store(in: &cancellables)

        // Trigger a state change by ending all activities
        Task {
            await sut.endAllActivities()
        }

        wait(for: [expectation], timeout: 2.0)
    }

    // MARK: - Activity Lifecycle Tests (Simulator-Safe)

    func testEndAllActivitiesWithNoActiveActivities() async {
        // Should not throw or crash when no activities exist
        await sut.endAllActivities()
        XCTAssertFalse(sut.hasActiveActivity)
        XCTAssertNil(sut.currentActivityId)
    }

    func testUpdateActivityWithNoActiveActivity() async {
        // Should handle gracefully when trying to update non-existent activity
        let state = AdjutantActivityAttributes.ContentState(
            unreadMessageCount: 1,
            activeAgents: [AgentSummary(name: "obsidian", status: "working")],
            lastUpdated: Date()
        )

        // Should not throw - just prints a message
        await sut.updateActivity(with: state)
    }
}
#endif
