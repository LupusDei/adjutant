import XCTest
@testable import AdjutantUI
import AdjutantKit

/// Tests for mode transitions: switching between all 3 modes,
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

    // MARK: - All 6 Directional Transitions

    func testGastownToStandalone() {
        appState.updateDeploymentMode(.gastown)
        appState.updateDeploymentMode(.standalone)
        XCTAssertEqual(appState.deploymentMode, .standalone)
    }

    func testGastownToSwarm() {
        appState.updateDeploymentMode(.gastown)
        appState.updateDeploymentMode(.swarm)
        XCTAssertEqual(appState.deploymentMode, .swarm)
    }

    func testStandaloneToGastown() {
        appState.updateDeploymentMode(.standalone)
        appState.updateDeploymentMode(.gastown)
        XCTAssertEqual(appState.deploymentMode, .gastown)
    }

    func testStandaloneToSwarm() {
        appState.updateDeploymentMode(.standalone)
        appState.updateDeploymentMode(.swarm)
        XCTAssertEqual(appState.deploymentMode, .swarm)
    }

    func testSwarmToGastown() {
        appState.updateDeploymentMode(.swarm)
        appState.updateDeploymentMode(.gastown)
        XCTAssertEqual(appState.deploymentMode, .gastown)
    }

    func testSwarmToStandalone() {
        appState.updateDeploymentMode(.swarm)
        appState.updateDeploymentMode(.standalone)
        XCTAssertEqual(appState.deploymentMode, .standalone)
    }

    // MARK: - Full Round-Trip Cycles

    func testFullCycleGastownStandaloneSwarmGastown() {
        appState.updateDeploymentMode(.gastown)
        XCTAssertEqual(appState.deploymentMode, .gastown)

        appState.updateDeploymentMode(.standalone)
        XCTAssertEqual(appState.deploymentMode, .standalone)

        appState.updateDeploymentMode(.swarm)
        XCTAssertEqual(appState.deploymentMode, .swarm)

        appState.updateDeploymentMode(.gastown)
        XCTAssertEqual(appState.deploymentMode, .gastown)
    }

    func testFullCycleStandaloneSwarmGastownStandalone() {
        appState.updateDeploymentMode(.standalone)
        appState.updateDeploymentMode(.swarm)
        appState.updateDeploymentMode(.gastown)
        appState.updateDeploymentMode(.standalone)
        XCTAssertEqual(appState.deploymentMode, .standalone)
    }

    // MARK: - Tab Visibility per Mode

    func testGastownShowsAllTabs() {
        appState.updateDeploymentMode(.gastown)
        let tabs = appState.visibleTabs

        XCTAssertEqual(tabs.count, AppTab.allCases.count)
        for tab in AppTab.allCases {
            XCTAssertTrue(tabs.contains(tab), "Gastown should show \(tab)")
        }
    }

    func testStandaloneShowsOnlyChatBeadsSettings() {
        appState.updateDeploymentMode(.standalone)
        let tabs = appState.visibleTabs

        XCTAssertEqual(tabs.count, 3)
        XCTAssertTrue(tabs.contains(.chat))
        XCTAssertTrue(tabs.contains(.beads))
        XCTAssertTrue(tabs.contains(.settings))
        XCTAssertFalse(tabs.contains(.dashboard))
        XCTAssertFalse(tabs.contains(.mail))
        XCTAssertFalse(tabs.contains(.epics))
        XCTAssertFalse(tabs.contains(.crew))
    }

    func testSwarmShowsChatCrewBeadsSettings() {
        appState.updateDeploymentMode(.swarm)
        let tabs = appState.visibleTabs

        XCTAssertEqual(tabs.count, 4)
        XCTAssertTrue(tabs.contains(.chat))
        XCTAssertTrue(tabs.contains(.crew))
        XCTAssertTrue(tabs.contains(.beads))
        XCTAssertTrue(tabs.contains(.settings))
        XCTAssertFalse(tabs.contains(.dashboard))
        XCTAssertFalse(tabs.contains(.mail))
        XCTAssertFalse(tabs.contains(.epics))
    }

    // MARK: - Tab Visibility Adapts on Transition

    func testTabsReduceWhenSwitchingGastownToStandalone() {
        appState.updateDeploymentMode(.gastown)
        XCTAssertEqual(appState.visibleTabs.count, 7)

        appState.updateDeploymentMode(.standalone)
        XCTAssertEqual(appState.visibleTabs.count, 3)
        XCTAssertFalse(appState.visibleTabs.contains(.dashboard))
    }

    func testTabsExpandWhenSwitchingStandaloneToGastown() {
        appState.updateDeploymentMode(.standalone)
        XCTAssertEqual(appState.visibleTabs.count, 3)

        appState.updateDeploymentMode(.gastown)
        XCTAssertEqual(appState.visibleTabs.count, 7)
        XCTAssertTrue(appState.visibleTabs.contains(.dashboard))
    }

    func testCrewTabAppearsWhenSwitchingStandaloneToSwarm() {
        appState.updateDeploymentMode(.standalone)
        XCTAssertFalse(appState.visibleTabs.contains(.crew))

        appState.updateDeploymentMode(.swarm)
        XCTAssertTrue(appState.visibleTabs.contains(.crew))
    }

    func testCrewTabDisappearsWhenSwitchingSwarmToStandalone() {
        appState.updateDeploymentMode(.swarm)
        XCTAssertTrue(appState.visibleTabs.contains(.crew))

        appState.updateDeploymentMode(.standalone)
        XCTAssertFalse(appState.visibleTabs.contains(.crew))
    }

    func testTabsRestoreAfterRoundTrip() {
        appState.updateDeploymentMode(.gastown)
        let originalTabs = appState.visibleTabs

        // Go to standalone (fewer tabs)
        appState.updateDeploymentMode(.standalone)
        XCTAssertNotEqual(appState.visibleTabs, originalTabs)

        // Come back to gastown
        appState.updateDeploymentMode(.gastown)
        XCTAssertEqual(appState.visibleTabs, originalTabs)
    }

    // MARK: - No Data Loss: State Preservation Across Mode Transitions

    func testPowerStatePreservedAcrossModeTransition() {
        appState.updatePowerState(.running)
        appState.updateDeploymentMode(.standalone)

        XCTAssertEqual(appState.powerState, .running)
        XCTAssertTrue(appState.isPowerOn)
    }

    func testUnreadMailCountPreservedAcrossModeTransition() {
        appState.updateUnreadMailCount(5)
        appState.updateDeploymentMode(.standalone)

        XCTAssertEqual(appState.unreadMailCount, 5)
    }

    func testThemePreservedAcrossModeTransition() {
        appState.currentTheme = .red
        appState.updateDeploymentMode(.swarm)

        XCTAssertEqual(appState.currentTheme, .red)
    }

    func testCommunicationPriorityPreservedAcrossModeTransition() {
        appState.communicationPriority = .realTime
        appState.updateDeploymentMode(.standalone)

        XCTAssertEqual(appState.communicationPriority, .realTime)
    }

    func testOverseerModePreservedAcrossModeTransition() {
        appState.isOverseerMode = false
        appState.updateDeploymentMode(.swarm)

        XCTAssertFalse(appState.isOverseerMode)
    }

    func testSelectedRigPreservedAcrossModeTransition() {
        appState.selectedRig = "greenplace"
        appState.updateDeploymentMode(.standalone)

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
        appState.currentTheme = .blue
        appState.communicationPriority = .pollingOnly
        appState.isOverseerMode = false
        appState.selectedRig = "adjutant"
        appState.addMailIds(["a", "b", "c"])

        // Cycle through all 3 modes
        appState.updateDeploymentMode(.standalone)
        appState.updateDeploymentMode(.swarm)
        appState.updateDeploymentMode(.gastown)

        // Verify all state is preserved
        XCTAssertEqual(appState.powerState, .running)
        XCTAssertTrue(appState.isPowerOn)
        XCTAssertEqual(appState.unreadMailCount, 42)
        XCTAssertEqual(appState.currentTheme, .blue)
        XCTAssertEqual(appState.communicationPriority, .pollingOnly)
        XCTAssertFalse(appState.isOverseerMode)
        XCTAssertEqual(appState.selectedRig, "adjutant")
        XCTAssertEqual(appState.knownMailIds, ["a", "b", "c"])
    }

    // MARK: - Same-Mode No-Op

    func testSameModeTransitionIsNoOp() {
        appState.updateDeploymentMode(.standalone)
        let tabsBefore = appState.visibleTabs

        appState.updateDeploymentMode(.standalone) // no-op
        let tabsAfter = appState.visibleTabs

        XCTAssertEqual(appState.deploymentMode, .standalone)
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
