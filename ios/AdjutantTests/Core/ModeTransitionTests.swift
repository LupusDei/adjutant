import XCTest
@testable import AdjutantUI
import AdjutantKit

/// Tests for mode transitions: switching between gastown and swarm modes,
/// verifying no data loss, and UI tab adaptation.
@MainActor
final class ModeTransitionTests: XCTestCase {
    var appState: AppState!

    override func setUp() async throws {
        appState = AppState.shared
        // Reset to known state
        appState.updateDeploymentMode(.gastown)
    }

    override func tearDown() async throws {
        // Reset to default
        appState.updateDeploymentMode(.gastown)
        appState = nil
    }

    // MARK: - Initial State

    func testDefaultModeIsGastown() {
        appState.updateDeploymentMode(.gastown)
        XCTAssertEqual(appState.deploymentMode, .gastown)
    }

    // MARK: - All Directional Transitions

    func testGastownToSwarm() {
        appState.updateDeploymentMode(.gastown)
        appState.updateDeploymentMode(.swarm)
        XCTAssertEqual(appState.deploymentMode, .swarm)
    }

    func testSwarmToGastown() {
        appState.updateDeploymentMode(.swarm)
        appState.updateDeploymentMode(.gastown)
        XCTAssertEqual(appState.deploymentMode, .gastown)
    }

    // MARK: - Full Round-Trip Cycles

    func testFullCycleGastownSwarmGastown() {
        appState.updateDeploymentMode(.gastown)
        XCTAssertEqual(appState.deploymentMode, .gastown)

        appState.updateDeploymentMode(.swarm)
        XCTAssertEqual(appState.deploymentMode, .swarm)

        appState.updateDeploymentMode(.gastown)
        XCTAssertEqual(appState.deploymentMode, .gastown)
    }

    func testFullCycleSwarmGastownSwarm() {
        appState.updateDeploymentMode(.swarm)
        appState.updateDeploymentMode(.gastown)
        appState.updateDeploymentMode(.swarm)
        XCTAssertEqual(appState.deploymentMode, .swarm)
    }

    // MARK: - Tab Visibility per Mode

    func testGastownShowsAllTabsExceptProjectsAndOverview() {
        appState.updateDeploymentMode(.gastown)
        let tabs = appState.visibleTabs

        let excluded: Set<AppTab> = [.projects, .overview]
        XCTAssertEqual(tabs.count, AppTab.allCases.count - excluded.count, "Gastown shows all tabs except Projects and Overview")
        XCTAssertFalse(tabs.contains(.projects))
        XCTAssertFalse(tabs.contains(.overview))
        for tab in AppTab.allCases where !excluded.contains(tab) {
            XCTAssertTrue(tabs.contains(tab), "Gastown should show \(tab)")
        }
    }

    func testSwarmShowsOverviewChatCrewEpicsProjectsBeadsProposalsSettings() {
        appState.updateDeploymentMode(.swarm)
        let tabs = appState.visibleTabs

        XCTAssertEqual(tabs.count, 8)
        XCTAssertTrue(tabs.contains(.overview))
        XCTAssertTrue(tabs.contains(.chat))
        XCTAssertTrue(tabs.contains(.crew))
        XCTAssertTrue(tabs.contains(.epics))
        XCTAssertTrue(tabs.contains(.projects))
        XCTAssertTrue(tabs.contains(.beads))
        XCTAssertTrue(tabs.contains(.proposals))
        XCTAssertTrue(tabs.contains(.settings))
        XCTAssertFalse(tabs.contains(.dashboard))
        XCTAssertFalse(tabs.contains(.mail))
    }

    // MARK: - Tab Visibility Adapts on Transition

    func testTabsChangeWhenSwitchingGastownToSwarm() {
        appState.updateDeploymentMode(.gastown)
        XCTAssertEqual(appState.visibleTabs.count, 8)

        appState.updateDeploymentMode(.swarm)
        XCTAssertEqual(appState.visibleTabs.count, 8)
        XCTAssertFalse(appState.visibleTabs.contains(.dashboard))
        XCTAssertTrue(appState.visibleTabs.contains(.overview))
    }

    func testTabsChangeWhenSwitchingSwarmToGastown() {
        appState.updateDeploymentMode(.swarm)
        XCTAssertEqual(appState.visibleTabs.count, 8)

        appState.updateDeploymentMode(.gastown)
        XCTAssertEqual(appState.visibleTabs.count, 8)
        XCTAssertTrue(appState.visibleTabs.contains(.dashboard))
        XCTAssertFalse(appState.visibleTabs.contains(.overview))
    }

    func testCrewTabVisibleInSwarm() {
        appState.updateDeploymentMode(.swarm)
        XCTAssertTrue(appState.visibleTabs.contains(.crew))
    }

    func testEpicsTabVisibleInSwarm() {
        appState.updateDeploymentMode(.swarm)
        XCTAssertTrue(appState.visibleTabs.contains(.epics))
    }

    func testTabsRestoreAfterRoundTrip() {
        appState.updateDeploymentMode(.gastown)
        let originalTabs = appState.visibleTabs

        // Go to swarm (fewer tabs)
        appState.updateDeploymentMode(.swarm)
        XCTAssertNotEqual(appState.visibleTabs, originalTabs)

        // Come back to gastown
        appState.updateDeploymentMode(.gastown)
        XCTAssertEqual(appState.visibleTabs, originalTabs)
    }

    // MARK: - No Data Loss: State Preservation Across Mode Transitions

    func testPowerStatePreservedAcrossModeTransition() {
        appState.updatePowerState(.running)
        appState.updateDeploymentMode(.swarm)

        XCTAssertEqual(appState.powerState, .running)
        XCTAssertTrue(appState.isPowerOn)
    }

    func testUnreadMailCountPreservedAcrossModeTransition() {
        appState.updateUnreadMailCount(5)
        appState.updateDeploymentMode(.swarm)

        XCTAssertEqual(appState.unreadMailCount, 5)
    }

    func testThemePreservedAcrossModeTransition() {
        appState.currentTheme = .document
        appState.updateDeploymentMode(.swarm)

        XCTAssertEqual(appState.currentTheme, .document)
    }

    func testCommunicationPriorityPreservedAcrossModeTransition() {
        appState.communicationPriority = .realTime
        appState.updateDeploymentMode(.swarm)

        XCTAssertEqual(appState.communicationPriority, .realTime)
    }

    func testOverseerModePreservedAcrossModeTransition() {
        appState.isOverseerMode = false
        appState.updateDeploymentMode(.swarm)

        XCTAssertFalse(appState.isOverseerMode)
    }

    func testSelectedRigPreservedAcrossModeTransition() {
        appState.selectedRig = "greenplace"
        appState.updateDeploymentMode(.swarm)

        XCTAssertEqual(appState.selectedRig, "greenplace")
    }

    func testKnownMailIdsPreservedAcrossModeTransition() {
        appState.addMailIds(["mail-1", "mail-2", "mail-3"])
        appState.updateDeploymentMode(.swarm)

        XCTAssertEqual(appState.knownMailIds.count, 3)
        XCTAssertTrue(appState.knownMailIds.contains("mail-1"))
    }

    func testAllStatePreservedThroughFullCycle() {
        // Set up various state
        appState.updatePowerState(.running)
        appState.updateUnreadMailCount(42)
        appState.currentTheme = .starcraft
        appState.communicationPriority = .pollingOnly
        appState.isOverseerMode = false
        appState.selectedRig = "adjutant"
        appState.addMailIds(["a", "b", "c"])

        // Cycle through both modes
        appState.updateDeploymentMode(.swarm)
        appState.updateDeploymentMode(.gastown)

        // Verify all state is preserved
        XCTAssertEqual(appState.powerState, .running)
        XCTAssertTrue(appState.isPowerOn)
        XCTAssertEqual(appState.unreadMailCount, 42)
        XCTAssertEqual(appState.currentTheme, .starcraft)
        XCTAssertEqual(appState.communicationPriority, .pollingOnly)
        XCTAssertFalse(appState.isOverseerMode)
        XCTAssertEqual(appState.selectedRig, "adjutant")
        XCTAssertEqual(appState.knownMailIds, ["a", "b", "c"])
    }

    // MARK: - Same-Mode No-Op

    func testSameModeTransitionIsNoOp() {
        appState.updateDeploymentMode(.swarm)
        let tabsBefore = appState.visibleTabs

        appState.updateDeploymentMode(.swarm) // no-op
        let tabsAfter = appState.visibleTabs

        XCTAssertEqual(appState.deploymentMode, .swarm)
        XCTAssertEqual(tabsBefore, tabsAfter)
    }

    // MARK: - Common Tabs Are Always Visible

    func testChatAndBeadsAndSettingsAlwaysVisible() {
        let alwaysVisibleTabs: [AppTab] = [.chat, .beads, .settings]

        for mode in DeploymentMode.allCases {
            appState.updateDeploymentMode(mode)
            for tab in alwaysVisibleTabs {
                XCTAssertTrue(
                    appState.visibleTabs.contains(tab),
                    "\(tab) should be visible in \(mode) mode"
                )
            }
        }
    }
}
