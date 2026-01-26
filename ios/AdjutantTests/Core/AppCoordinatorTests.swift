import XCTest
import SwiftUI
@testable import AdjutantUI

@MainActor
final class AppCoordinatorTests: XCTestCase {
    var coordinator: AppCoordinator!

    override func setUp() async throws {
        coordinator = AppCoordinator()
    }

    override func tearDown() async throws {
        coordinator = nil
    }

    // MARK: - Initial State Tests

    func testInitialState() {
        XCTAssertEqual(coordinator.selectedTab, .dashboard)
        XCTAssertTrue(coordinator.path.isEmpty)
        XCTAssertNil(coordinator.presentedSheet)
        XCTAssertNil(coordinator.presentedAlert)
    }

    // MARK: - Tab Navigation Tests

    func testSelectTab() {
        coordinator.selectTab(.mail)

        XCTAssertEqual(coordinator.selectedTab, .mail)
    }

    func testNavigateToTabRoute() {
        coordinator.navigate(to: .mail)

        XCTAssertEqual(coordinator.selectedTab, .mail)
    }

    func testTabPathsArePreserved() {
        // Navigate to mail and push a detail
        coordinator.selectTab(.mail)
        coordinator.navigate(to: .mailDetail(id: "test-1"))

        XCTAssertFalse(coordinator.path.isEmpty)

        // Switch to another tab
        coordinator.selectTab(.crew)

        XCTAssertTrue(coordinator.path.isEmpty)

        // Switch back to mail
        coordinator.selectTab(.mail)

        XCTAssertFalse(coordinator.path.isEmpty)
    }

    // MARK: - Detail Navigation Tests

    func testNavigateToMailDetail() {
        let initialCount = coordinator.path.count
        coordinator.navigate(to: .mailDetail(id: "test-123"))

        XCTAssertEqual(coordinator.path.count, initialCount + 1)
    }

    func testNavigateToBeadDetail() {
        let initialCount = coordinator.path.count
        coordinator.navigate(to: .beadDetail(id: "bead-456"))

        XCTAssertEqual(coordinator.path.count, initialCount + 1)
    }

    func testNavigateToPolecatTerminal() {
        let initialCount = coordinator.path.count
        coordinator.navigate(to: .polecatTerminal(rig: "greenplace", polecat: "polecat-1"))

        XCTAssertEqual(coordinator.path.count, initialCount + 1)
    }

    // MARK: - Pop Navigation Tests

    func testPopToRoot() {
        coordinator.navigate(to: .mailDetail(id: "test-1"))
        coordinator.navigate(to: .mailDetail(id: "test-2"))

        XCTAssertFalse(coordinator.path.isEmpty)

        coordinator.popToRoot()

        XCTAssertTrue(coordinator.path.isEmpty)
    }

    func testPop() {
        coordinator.navigate(to: .mailDetail(id: "test-1"))
        coordinator.navigate(to: .mailDetail(id: "test-2"))

        let countBefore = coordinator.path.count
        coordinator.pop()

        XCTAssertEqual(coordinator.path.count, countBefore - 1)
    }

    func testPopOnEmptyPathDoesNothing() {
        XCTAssertTrue(coordinator.path.isEmpty)

        coordinator.pop()

        XCTAssertTrue(coordinator.path.isEmpty)
    }

    // MARK: - Sheet Presentation Tests

    func testPresentSheet() {
        coordinator.presentSheet(.mailCompose(replyTo: nil))

        XCTAssertNotNil(coordinator.presentedSheet)
    }

    func testDismissSheet() {
        coordinator.presentSheet(.mailCompose(replyTo: nil))
        coordinator.dismissSheet()

        XCTAssertNil(coordinator.presentedSheet)
    }

    func testNavigateToMailComposePresentsSheet() {
        coordinator.navigate(to: .mailCompose(replyTo: "test-id"))

        XCTAssertNotNil(coordinator.presentedSheet)
    }

    // MARK: - Alert Presentation Tests

    func testPresentAlert() {
        coordinator.presentAlert(.error(title: "Error", message: "Something went wrong"))

        XCTAssertNotNil(coordinator.presentedAlert)
    }

    func testDismissAlert() {
        coordinator.presentAlert(.error(title: "Error", message: "Something went wrong"))
        coordinator.dismissAlert()

        XCTAssertNil(coordinator.presentedAlert)
    }

    // MARK: - Deep Link Tests

    func testHandleMailDeepLink() {
        let url = URL(string: "adjutant://mail?id=msg-123")!

        let handled = coordinator.handleDeepLink(url)

        XCTAssertTrue(handled)
        XCTAssertEqual(coordinator.selectedTab, .mail)
    }

    func testHandleBeadsDeepLink() {
        let url = URL(string: "adjutant://beads?id=bead-456")!

        let handled = coordinator.handleDeepLink(url)

        XCTAssertTrue(handled)
        XCTAssertEqual(coordinator.selectedTab, .beads)
    }

    func testHandleSettingsDeepLink() {
        let url = URL(string: "adjutant://settings")!

        let handled = coordinator.handleDeepLink(url)

        XCTAssertTrue(handled)
        XCTAssertEqual(coordinator.selectedTab, .settings)
    }

    func testInvalidDeepLinkReturnsfalse() {
        let url = URL(string: "other://invalid")!

        let handled = coordinator.handleDeepLink(url)

        XCTAssertFalse(handled)
    }

    func testUnknownHostReturnsfalse() {
        let url = URL(string: "adjutant://unknown")!

        let handled = coordinator.handleDeepLink(url)

        XCTAssertFalse(handled)
    }
}

// MARK: - AppTab Tests

final class AppTabTests: XCTestCase {
    func testAllTabsHaveTitles() {
        for tab in AppTab.allCases {
            XCTAssertFalse(tab.title.isEmpty, "\(tab) should have a title")
        }
    }

    func testAllTabsHaveSystemImages() {
        for tab in AppTab.allCases {
            XCTAssertFalse(tab.systemImage.isEmpty, "\(tab) should have a system image")
        }
    }

    func testTabIdentifiable() {
        let tabs = AppTab.allCases
        let uniqueIds = Set(tabs.map(\.id))

        XCTAssertEqual(uniqueIds.count, tabs.count, "All tabs should have unique IDs")
    }
}
