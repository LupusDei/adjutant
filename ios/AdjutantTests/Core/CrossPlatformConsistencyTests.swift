import XCTest
import Combine
@testable import AdjutantUI
@testable import AdjutantKit

/// Cross-platform consistency tests (Phase 5.3).
///
/// Verifies that iOS tab visibility rules and mode event handling match
/// the Frontend and Backend expectations. Both iOS and Frontend must:
/// 1. Show the same tabs per mode
/// 2. React to SSE mode_changed events the same way
/// 3. Use the same mode identifiers ("gastown", "standalone", "swarm")
@MainActor
final class CrossPlatformConsistencyTests: XCTestCase {

    // MARK: - Tab Visibility Rules (must match Frontend useVisibleTabs)

    func testGasTownModeShowsAll7Tabs() {
        let tabs = DeploymentMode.gasTown.visibleTabs
        XCTAssertEqual(tabs.count, 7, "Gas Town mode should show all 7 tabs")
        XCTAssertTrue(tabs.contains(.dashboard))
        XCTAssertTrue(tabs.contains(.mail))
        XCTAssertTrue(tabs.contains(.chat))
        XCTAssertTrue(tabs.contains(.epics))
        XCTAssertTrue(tabs.contains(.crew))
        XCTAssertTrue(tabs.contains(.beads))
        XCTAssertTrue(tabs.contains(.settings))
    }

    func testStandaloneModeShowsOnly3Tabs() {
        let tabs = DeploymentMode.singleAgent.visibleTabs
        XCTAssertEqual(tabs.count, 3, "Standalone mode should show 3 tabs")
        XCTAssertTrue(tabs.contains(.chat))
        XCTAssertTrue(tabs.contains(.beads))
        XCTAssertTrue(tabs.contains(.settings))
        // Hidden tabs
        XCTAssertFalse(tabs.contains(.dashboard))
        XCTAssertFalse(tabs.contains(.mail))
        XCTAssertFalse(tabs.contains(.epics))
        XCTAssertFalse(tabs.contains(.crew))
    }

    func testSwarmModeShows4Tabs() {
        let tabs = DeploymentMode.swarm.visibleTabs
        XCTAssertEqual(tabs.count, 4, "Swarm mode should show 4 tabs")
        XCTAssertTrue(tabs.contains(.chat))
        XCTAssertTrue(tabs.contains(.crew))
        XCTAssertTrue(tabs.contains(.beads))
        XCTAssertTrue(tabs.contains(.settings))
        // Hidden tabs
        XCTAssertFalse(tabs.contains(.dashboard))
        XCTAssertFalse(tabs.contains(.mail))
        XCTAssertFalse(tabs.contains(.epics))
    }

    // MARK: - Mode Identifier Values (must match Backend/Frontend strings)

    func testModeRawValuesMatchBackend() {
        // Backend uses: "gastown", "standalone", "swarm"
        // Frontend uses: type DeploymentMode = 'gastown' | 'standalone' | 'swarm'
        XCTAssertEqual(DeploymentMode.gasTown.rawValue, "gastown")
        XCTAssertEqual(DeploymentMode.singleAgent.rawValue, "standalone")
        XCTAssertEqual(DeploymentMode.swarm.rawValue, "swarm")
    }

    func testModeCanBeCreatedFromBackendStrings() {
        // These are the exact strings the backend GET /api/mode returns
        XCTAssertEqual(DeploymentMode(rawValue: "gastown"), .gasTown)
        XCTAssertEqual(DeploymentMode(rawValue: "standalone"), .singleAgent)
        XCTAssertEqual(DeploymentMode(rawValue: "swarm"), .swarm)
    }

    func testModeRejectsInvalidStrings() {
        XCTAssertNil(DeploymentMode(rawValue: "gas_town"))
        XCTAssertNil(DeploymentMode(rawValue: "GT"))
        XCTAssertNil(DeploymentMode(rawValue: "single_agent"))
        XCTAssertNil(DeploymentMode(rawValue: "single"))
        XCTAssertNil(DeploymentMode(rawValue: ""))
    }

    // MARK: - SSE mode_changed Event Parsing

    func testModeChangedEventDecoding() {
        // Backend emits: { mode: "standalone", features: [...], reason: "..." }
        let json = """
        {
            "mode": "standalone",
            "features": ["chat", "beads", "websocket", "sse"],
            "reason": "Switched from gastown"
        }
        """
        let data = json.data(using: .utf8)!
        let event = try? JSONDecoder().decode(ModeChangedEvent.self, from: data)

        XCTAssertNotNil(event)
        XCTAssertEqual(event?.mode, "standalone")
        XCTAssertEqual(event?.features, ["chat", "beads", "websocket", "sse"])
        XCTAssertEqual(event?.reason, "Switched from gastown")
    }

    func testModeChangedEventWithoutReason() {
        let json = """
        {
            "mode": "swarm",
            "features": ["chat", "crew_flat", "beads", "mail", "websocket", "sse"]
        }
        """
        let data = json.data(using: .utf8)!
        let event = try? JSONDecoder().decode(ModeChangedEvent.self, from: data)

        XCTAssertNotNil(event)
        XCTAssertEqual(event?.mode, "swarm")
        XCTAssertNil(event?.reason)
    }

    func testUpdateDeploymentModeFromSSEEvent() {
        let appState = AppState.shared

        // Set initial mode
        appState.deploymentMode = .gasTown
        XCTAssertEqual(appState.deploymentMode, .gasTown)

        // Simulate SSE event
        let event = ModeChangedEvent(
            mode: "standalone",
            features: ["chat", "beads"],
            reason: "Switched from gastown"
        )
        appState.updateDeploymentMode(from: event)

        XCTAssertEqual(appState.deploymentMode, .singleAgent)
    }

    func testUpdateDeploymentModeIgnoresInvalidMode() {
        let appState = AppState.shared
        appState.deploymentMode = .gasTown

        let event = ModeChangedEvent(
            mode: "invalid_mode",
            features: [],
            reason: nil
        )
        appState.updateDeploymentMode(from: event)

        // Should remain unchanged
        XCTAssertEqual(appState.deploymentMode, .gasTown)
    }

    // MARK: - ModeInfo Response Model

    func testModeInfoDecoding() {
        // This is the exact structure GET /api/mode returns
        let json = """
        {
            "mode": "gastown",
            "features": ["power_control", "rigs", "epics", "crew_hierarchy", "mail", "dashboard", "refinery", "witness", "websocket", "sse"],
            "availableModes": [
                {"mode": "gastown", "available": true},
                {"mode": "standalone", "available": true},
                {"mode": "swarm", "available": true}
            ]
        }
        """
        let data = json.data(using: .utf8)!
        let modeInfo = try? JSONDecoder().decode(ModeInfo.self, from: data)

        XCTAssertNotNil(modeInfo)
        XCTAssertEqual(modeInfo?.mode, "gastown")
        XCTAssertEqual(modeInfo?.features.count, 10)
        XCTAssertEqual(modeInfo?.availableModes.count, 3)
    }

    func testModeInfoWithUnavailableMode() {
        let json = """
        {
            "mode": "standalone",
            "features": ["chat", "beads", "websocket", "sse"],
            "availableModes": [
                {"mode": "gastown", "available": false, "reason": "Gas Town infrastructure not detected (no mayor/town.json)"},
                {"mode": "standalone", "available": true},
                {"mode": "swarm", "available": true}
            ]
        }
        """
        let data = json.data(using: .utf8)!
        let modeInfo = try? JSONDecoder().decode(ModeInfo.self, from: data)

        XCTAssertNotNil(modeInfo)
        let gtMode = modeInfo?.availableModes.first(where: { $0.mode == "gastown" })
        XCTAssertEqual(gtMode?.available, false)
        XCTAssertNotNil(gtMode?.reason)
        XCTAssertTrue(gtMode?.reason?.contains("Gas Town infrastructure") ?? false)
    }

    // MARK: - SSE Event Decoding

    func testSSEEventDecodesAsModeChangedEvent() {
        // The SSE event type is "mode_changed" and data is a JSON payload
        let sseEvent = SSEEvent(
            type: "mode_changed",
            data: "{\"mode\":\"swarm\",\"features\":[\"chat\",\"crew_flat\"],\"reason\":\"switched\"}",
            id: "42"
        )

        let modeEvent = sseEvent.decode(ModeChangedEvent.self)
        XCTAssertNotNil(modeEvent)
        XCTAssertEqual(modeEvent?.mode, "swarm")
        XCTAssertEqual(modeEvent?.features, ["chat", "crew_flat"])
    }

    // MARK: - Default Tab per Mode

    func testDefaultTabMatchesVisibleTabs() {
        // Each mode's default tab must be in its visible tabs
        for mode in DeploymentMode.allCases {
            let visibleTabs = mode.visibleTabs
            let defaultTab = mode.defaultTab
            XCTAssertTrue(
                visibleTabs.contains(defaultTab),
                "\(mode.displayName) default tab '\(defaultTab.title)' is not in visible tabs"
            )
        }
    }

    func testGasTownDefaultTabIsDashboard() {
        XCTAssertEqual(DeploymentMode.gasTown.defaultTab, .dashboard)
    }

    func testStandaloneDefaultTabIsChat() {
        XCTAssertEqual(DeploymentMode.singleAgent.defaultTab, .chat)
    }

    func testSwarmDefaultTabIsChat() {
        XCTAssertEqual(DeploymentMode.swarm.defaultTab, .chat)
    }
}
