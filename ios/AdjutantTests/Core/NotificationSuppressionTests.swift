import XCTest
@testable import AdjutantUI

@MainActor
final class NotificationSuppressionTests: XCTestCase {
    var notificationService: NotificationService!

    override func setUp() async throws {
        notificationService = NotificationService.shared
        // Reset suppression state before each test
        notificationService.isViewingChat = false
        notificationService.activeViewingAgentId = nil
    }

    override func tearDown() async throws {
        // Clean up state
        notificationService.isViewingChat = false
        notificationService.activeViewingAgentId = nil
    }

    // MARK: - shouldSuppressBanner Tests

    func testSuppressBannerWhenViewingSameAgent() {
        notificationService.isViewingChat = true
        notificationService.activeViewingAgentId = "agent-1"

        XCTAssertTrue(notificationService.shouldSuppressBanner(forAgentId: "agent-1"))
    }

    func testDoNotSuppressBannerWhenViewingDifferentAgent() {
        notificationService.isViewingChat = true
        notificationService.activeViewingAgentId = "agent-1"

        XCTAssertFalse(notificationService.shouldSuppressBanner(forAgentId: "agent-2"))
    }

    func testDoNotSuppressBannerWhenNotOnChatTab() {
        notificationService.isViewingChat = false
        notificationService.activeViewingAgentId = "agent-1"

        XCTAssertFalse(notificationService.shouldSuppressBanner(forAgentId: "agent-1"))
    }

    func testDoNotSuppressBannerWhenNoActiveAgent() {
        notificationService.isViewingChat = true
        notificationService.activeViewingAgentId = nil

        XCTAssertFalse(notificationService.shouldSuppressBanner(forAgentId: "agent-1"))
    }

    func testDoNotSuppressBannerWhenBothOff() {
        notificationService.isViewingChat = false
        notificationService.activeViewingAgentId = nil

        XCTAssertFalse(notificationService.shouldSuppressBanner(forAgentId: "agent-1"))
    }
}

// MARK: - AppCoordinator Active Viewing Tests

@MainActor
final class AppCoordinatorActiveViewingTests: XCTestCase {
    var coordinator: AppCoordinator!

    override func setUp() async throws {
        coordinator = AppCoordinator()
    }

    override func tearDown() async throws {
        coordinator = nil
    }

    func testActiveViewingAgentIdInitiallyNil() {
        XCTAssertNil(coordinator.activeViewingAgentId)
    }

    func testSetActiveViewingAgentId() {
        coordinator.activeViewingAgentId = "agent-1"

        XCTAssertEqual(coordinator.activeViewingAgentId, "agent-1")
    }

    func testClearActiveViewingAgentId() {
        coordinator.activeViewingAgentId = "agent-1"
        coordinator.activeViewingAgentId = nil

        XCTAssertNil(coordinator.activeViewingAgentId)
    }

    func testPendingDeepLinkConsumedOnInit() {
        // Set a pending deep link before creating coordinator
        NotificationService.shared.pendingDeepLinkAgentId = "deep-link-agent"

        let newCoordinator = AppCoordinator()

        XCTAssertEqual(newCoordinator.pendingChatAgentId, "deep-link-agent")
        XCTAssertEqual(newCoordinator.selectedTab, .chat)
        XCTAssertNil(NotificationService.shared.pendingDeepLinkAgentId)
    }
}

// MARK: - Notification Category Tests

final class NotificationCategoryTests: XCTestCase {
    func testAgentMessageCategoryExists() {
        let category = NotificationService.Category.agentMessage
        XCTAssertEqual(category.rawValue, "AGENT_MESSAGE")
    }

    func testChatMessageCategoryExists() {
        let category = NotificationService.Category.chatMessage
        XCTAssertEqual(category.rawValue, "CHAT_MESSAGE")
    }
}
