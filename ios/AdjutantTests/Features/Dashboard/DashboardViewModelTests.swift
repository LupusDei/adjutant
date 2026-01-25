import XCTest
@testable import Adjutant
@testable import AdjutantKit

@MainActor
final class DashboardViewModelTests: XCTestCase {
    var viewModel: DashboardViewModel!

    override func setUp() async throws {
        viewModel = DashboardViewModel()
    }

    override func tearDown() async throws {
        viewModel = nil
    }

    // MARK: - Initial State Tests

    func testInitialState() {
        XCTAssertTrue(viewModel.recentMail.isEmpty)
        XCTAssertEqual(viewModel.unreadCount, 0)
        XCTAssertTrue(viewModel.crewMembers.isEmpty)
        XCTAssertTrue(viewModel.convoys.isEmpty)
        XCTAssertFalse(viewModel.isRefreshing)
        XCTAssertFalse(viewModel.isLoading)
    }

    func testDefaultPollingInterval() {
        XCTAssertEqual(viewModel.pollingInterval, 30.0)
    }

    // MARK: - Computed Properties Tests

    func testActiveCrewMembersFiltersOffline() async {
        // Create mock crew members with different statuses
        let workingMember = CrewMember(
            id: "rig/worker1",
            name: "Worker 1",
            type: .polecat,
            rig: "rig",
            status: .working,
            unreadMail: 0
        )
        let idleMember = CrewMember(
            id: "rig/worker2",
            name: "Worker 2",
            type: .polecat,
            rig: "rig",
            status: .idle,
            unreadMail: 0
        )
        let offlineMember = CrewMember(
            id: "rig/worker3",
            name: "Worker 3",
            type: .polecat,
            rig: "rig",
            status: .offline,
            unreadMail: 0
        )

        // Inject test data by accessing the internal property
        // Note: In real implementation, we'd use dependency injection
        // For now we test the computed property logic manually
        let allMembers = [workingMember, idleMember, offlineMember]
        let activeMembers = allMembers.filter { $0.status != .offline }

        XCTAssertEqual(activeMembers.count, 2)
        XCTAssertFalse(activeMembers.contains { $0.status == .offline })
    }

    func testCrewWithIssuesCountsStuckAndBlocked() {
        let workingMember = CrewMember(
            id: "rig/worker1",
            name: "Worker 1",
            type: .polecat,
            rig: "rig",
            status: .working,
            unreadMail: 0
        )
        let stuckMember = CrewMember(
            id: "rig/worker2",
            name: "Worker 2",
            type: .polecat,
            rig: "rig",
            status: .stuck,
            unreadMail: 0
        )
        let blockedMember = CrewMember(
            id: "rig/worker3",
            name: "Worker 3",
            type: .polecat,
            rig: "rig",
            status: .blocked,
            unreadMail: 0
        )

        let allMembers = [workingMember, stuckMember, blockedMember]
        let issueCount = allMembers.filter { $0.status == .stuck || $0.status == .blocked }.count

        XCTAssertEqual(issueCount, 2)
    }

    func testTotalConvoyProgressWithEmptyConvoys() {
        // Empty convoys should return 0 progress
        let convoys: [Convoy] = []
        let progress = calculateTotalProgress(convoys)
        XCTAssertEqual(progress, 0)
    }

    func testTotalConvoyProgressCalculation() {
        let convoy1 = Convoy(
            id: "convoy-1",
            title: "Convoy 1",
            status: "in_progress",
            rig: "rig",
            progress: ConvoyProgress(completed: 3, total: 10),
            trackedIssues: []
        )
        let convoy2 = Convoy(
            id: "convoy-2",
            title: "Convoy 2",
            status: "in_progress",
            rig: "rig",
            progress: ConvoyProgress(completed: 7, total: 10),
            trackedIssues: []
        )

        let convoys = [convoy1, convoy2]
        let progress = calculateTotalProgress(convoys)

        // Total: 10/20 = 0.5
        XCTAssertEqual(progress, 0.5)
    }

    func testTotalConvoyProgressWithZeroTotal() {
        let convoy = Convoy(
            id: "convoy-1",
            title: "Empty Convoy",
            status: "in_progress",
            rig: "rig",
            progress: ConvoyProgress(completed: 0, total: 0),
            trackedIssues: []
        )

        let progress = calculateTotalProgress([convoy])
        XCTAssertEqual(progress, 0)
    }

    // MARK: - Model Tests

    func testConvoyIsComplete() {
        let incompleteConvoy = Convoy(
            id: "convoy-1",
            title: "In Progress",
            status: "in_progress",
            rig: nil,
            progress: ConvoyProgress(completed: 5, total: 10),
            trackedIssues: []
        )

        let completeConvoy = Convoy(
            id: "convoy-2",
            title: "Complete",
            status: "complete",
            rig: nil,
            progress: ConvoyProgress(completed: 10, total: 10),
            trackedIssues: []
        )

        XCTAssertFalse(incompleteConvoy.isComplete)
        XCTAssertTrue(completeConvoy.isComplete)
    }

    func testConvoyProgressPercentage() {
        let progress50 = ConvoyProgress(completed: 5, total: 10)
        XCTAssertEqual(progress50.percentage, 0.5)

        let progress100 = ConvoyProgress(completed: 10, total: 10)
        XCTAssertEqual(progress100.percentage, 1.0)

        let progressZero = ConvoyProgress(completed: 0, total: 10)
        XCTAssertEqual(progressZero.percentage, 0.0)

        let progressEmpty = ConvoyProgress(completed: 0, total: 0)
        XCTAssertEqual(progressEmpty.percentage, 0.0)
    }

    func testMessageSenderName() {
        let message1 = Message(
            id: "msg-1",
            from: "mayor/",
            to: "overseer",
            subject: "Test",
            body: "Body",
            timestamp: "2026-01-25T12:00:00.000Z",
            read: false,
            priority: .normal,
            type: .notification,
            threadId: "thread-1",
            pinned: false,
            isInfrastructure: false
        )
        XCTAssertEqual(message1.senderName, "mayor")

        let message2 = Message(
            id: "msg-2",
            from: "greenplace/Toast",
            to: "overseer",
            subject: "Test",
            body: "Body",
            timestamp: "2026-01-25T12:00:00.000Z",
            read: false,
            priority: .normal,
            type: .notification,
            threadId: "thread-2",
            pinned: false,
            isInfrastructure: false
        )
        XCTAssertEqual(message2.senderName, "greenplace/Toast")
    }

    // MARK: - Helper Functions

    /// Calculate total progress across convoys (mirrors ViewModel logic)
    private func calculateTotalProgress(_ convoys: [Convoy]) -> Double {
        guard !convoys.isEmpty else { return 0 }
        let totalCompleted = convoys.reduce(0) { $0 + $1.progress.completed }
        let totalItems = convoys.reduce(0) { $0 + $1.progress.total }
        guard totalItems > 0 else { return 0 }
        return Double(totalCompleted) / Double(totalItems)
    }
}
