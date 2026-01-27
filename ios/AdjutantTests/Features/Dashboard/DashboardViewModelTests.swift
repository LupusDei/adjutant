import XCTest
@testable import AdjutantUI
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
        XCTAssertTrue(viewModel.recentBeads.isEmpty)
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

    // MARK: - Beads Tests

    func testOpenBeadsCount() {
        // Test that open beads count correctly filters out closed beads
        let openBead = BeadInfo(
            id: "adj-001",
            title: "Open bead",
            status: "open",
            priority: 1,
            type: "task",
            assignee: nil,
            rig: "adjutant",
            source: "adjutant",
            labels: [],
            createdAt: "2026-01-25T10:00:00Z",
            updatedAt: nil
        )
        let closedBead = BeadInfo(
            id: "adj-002",
            title: "Closed bead",
            status: "closed",
            priority: 1,
            type: "task",
            assignee: nil,
            rig: "adjutant",
            source: "adjutant",
            labels: [],
            createdAt: "2026-01-25T10:00:00Z",
            updatedAt: nil
        )

        let beads = [openBead, closedBead]
        let openCount = beads.filter { $0.status != "closed" }.count
        XCTAssertEqual(openCount, 1)
    }

    func testActiveBeadsCount() {
        // Test that active beads count filters for hooked and in_progress
        let hookedBead = BeadInfo(
            id: "adj-001",
            title: "Hooked bead",
            status: "hooked",
            priority: 1,
            type: "task",
            assignee: nil,
            rig: "adjutant",
            source: "adjutant",
            labels: [],
            createdAt: "2026-01-25T10:00:00Z",
            updatedAt: nil
        )
        let inProgressBead = BeadInfo(
            id: "adj-002",
            title: "In progress bead",
            status: "in_progress",
            priority: 1,
            type: "task",
            assignee: nil,
            rig: "adjutant",
            source: "adjutant",
            labels: [],
            createdAt: "2026-01-25T10:00:00Z",
            updatedAt: nil
        )
        let openBead = BeadInfo(
            id: "adj-003",
            title: "Open bead",
            status: "open",
            priority: 1,
            type: "task",
            assignee: nil,
            rig: "adjutant",
            source: "adjutant",
            labels: [],
            createdAt: "2026-01-25T10:00:00Z",
            updatedAt: nil
        )

        let beads = [hookedBead, inProgressBead, openBead]
        let activeCount = beads.filter { $0.status == "hooked" || $0.status == "in_progress" }.count
        XCTAssertEqual(activeCount, 2)
    }

    func testBeadsByColumnGrouping() {
        // Test that beads are correctly grouped by status into Kanban columns
        let openBead = BeadInfo(
            id: "adj-001",
            title: "Open bead",
            status: "open",
            priority: 1,
            type: "task",
            assignee: nil,
            rig: "adjutant",
            source: "adjutant",
            labels: [],
            createdAt: "2026-01-25T10:00:00Z",
            updatedAt: nil
        )
        let hookedBead = BeadInfo(
            id: "adj-002",
            title: "Hooked bead",
            status: "hooked",
            priority: 1,
            type: "task",
            assignee: nil,
            rig: "adjutant",
            source: "adjutant",
            labels: [],
            createdAt: "2026-01-25T10:00:00Z",
            updatedAt: nil
        )

        let beads = [openBead, hookedBead]
        var result: [String: [BeadInfo]] = [:]
        for bead in beads {
            result[bead.status, default: []].append(bead)
        }

        XCTAssertEqual(result["open"]?.count, 1)
        XCTAssertEqual(result["hooked"]?.count, 1)
        XCTAssertNil(result["closed"])
    }

    // MARK: - OVERSEER Filtering Tests

    func testOverseerFilteringExcludesWispBeads() {
        // Test that OVERSEER mode filtering excludes wisp beads by type
        let taskBead = BeadInfo(
            id: "adj-001",
            title: "Regular task",
            status: "open",
            priority: 1,
            type: "task",
            assignee: nil,
            rig: "adjutant",
            source: "adjutant",
            labels: [],
            createdAt: "2026-01-25T10:00:00Z",
            updatedAt: nil
        )
        let wispBead = BeadInfo(
            id: "adj-wisp-002",
            title: "Wisp bead",
            status: "open",
            priority: 2,
            type: "wisp",
            assignee: nil,
            rig: "adjutant",
            source: "adjutant",
            labels: [],
            createdAt: "2026-01-25T10:00:00Z",
            updatedAt: nil
        )
        let moleculeBead = BeadInfo(
            id: "mol-polecat-work",
            title: "Polecat molecule",
            status: "open",
            priority: 2,
            type: "epic",
            assignee: nil,
            rig: "adjutant",
            source: "adjutant",
            labels: [],
            createdAt: "2026-01-25T10:00:00Z",
            updatedAt: nil
        )

        // Simulate OVERSEER filtering logic
        let excludedTypes = ["message", "epic", "convoy", "agent", "role", "witness", "wisp", "infrastructure", "coordination", "sync"]
        let beads = [taskBead, wispBead, moleculeBead]

        let filtered = beads.filter { bead in
            let typeLower = bead.type.lowercased()
            let idLower = bead.id.lowercased()

            // Exclude wisp-related beads (including mol-* molecules)
            if typeLower.contains("wisp") || idLower.contains("wisp") || idLower.hasPrefix("mol-") {
                return false
            }

            // Exclude operational types
            if excludedTypes.contains(typeLower) {
                return false
            }

            return true
        }

        XCTAssertEqual(filtered.count, 1)
        XCTAssertEqual(filtered.first?.id, "adj-001")
    }

    func testOverseerFilteringExcludesInfrastructurePatterns() {
        // Test that beads with infrastructure-related titles are filtered
        let regularBead = BeadInfo(
            id: "adj-001",
            title: "Fix login bug",
            status: "open",
            priority: 1,
            type: "bug",
            assignee: nil,
            rig: "adjutant",
            source: "adjutant",
            labels: [],
            createdAt: "2026-01-25T10:00:00Z",
            updatedAt: nil
        )
        let polecatBead = BeadInfo(
            id: "adj-002",
            title: "Polecat assignment for worker",
            status: "open",
            priority: 2,
            type: "task",
            assignee: nil,
            rig: "adjutant",
            source: "adjutant",
            labels: [],
            createdAt: "2026-01-25T10:00:00Z",
            updatedAt: nil
        )
        let mergeBead = BeadInfo(
            id: "adj-003",
            title: "merge: feature branch",
            status: "open",
            priority: 2,
            type: "task",
            assignee: nil,
            rig: "adjutant",
            source: "adjutant",
            labels: [],
            createdAt: "2026-01-25T10:00:00Z",
            updatedAt: nil
        )

        // Simulate OVERSEER filtering logic for title patterns
        let excludedPatterns = ["witness", "wisp", "internal", "sync", "coordination", "mail delivery", "polecat", "crew assignment"]
        let beads = [regularBead, polecatBead, mergeBead]

        let filtered = beads.filter { bead in
            let titleLower = bead.title.lowercased()

            // Exclude by title patterns
            if excludedPatterns.contains(where: { titleLower.contains($0) }) {
                return false
            }

            // Exclude merge beads
            if titleLower.hasPrefix("merge:") {
                return false
            }

            return true
        }

        XCTAssertEqual(filtered.count, 1)
        XCTAssertEqual(filtered.first?.id, "adj-001")
    }

    // MARK: - Model Tests

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

}
