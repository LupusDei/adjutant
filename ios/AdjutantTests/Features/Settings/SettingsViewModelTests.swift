import XCTest
@testable import AdjutantUI
@testable import AdjutantKit

@MainActor
final class SettingsViewModelTests: XCTestCase {
    var viewModel: SettingsViewModel!

    override func setUp() async throws {
        // Clear UserDefaults to ensure clean state
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: "notificationsEnabled")
        defaults.removeObject(forKey: "selectedVoice")
        defaults.removeObject(forKey: "voiceVolume")
        defaults.removeObject(forKey: "defaultRigFilter")
        defaults.removeObject(forKey: "communicationPriority")

        viewModel = SettingsViewModel()
    }

    override func tearDown() async throws {
        viewModel = nil

        // Clean up UserDefaults
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: "notificationsEnabled")
        defaults.removeObject(forKey: "selectedVoice")
        defaults.removeObject(forKey: "voiceVolume")
        defaults.removeObject(forKey: "defaultRigFilter")
        defaults.removeObject(forKey: "communicationPriority")
    }

    // MARK: - Initial State Tests

    func testInitialState() {
        XCTAssertFalse(viewModel.isLoading)
        XCTAssertEqual(viewModel.powerState, .stopped)
        XCTAssertFalse(viewModel.isTunnelOperating)
    }

    func testDefaultVoiceVolume() {
        // When no persisted volume, should default to 0.8
        XCTAssertEqual(viewModel.voiceVolume, 0.8, accuracy: 0.01)
    }

    func testDefaultVoiceOption() {
        // Should default to system voice
        XCTAssertEqual(viewModel.selectedVoice, .system)
    }

    func testDefaultRigFilterIsNil() {
        // Should default to nil (all rigs)
        XCTAssertNil(viewModel.defaultRigFilter)
    }

    // MARK: - Theme Tests

    func testSetThemeUpdatesSelectedTheme() {
        viewModel.setTheme(.blue)
        XCTAssertEqual(viewModel.selectedTheme, .blue)

        viewModel.setTheme(.red)
        XCTAssertEqual(viewModel.selectedTheme, .red)
    }

    func testSetThemeUpdatesAppState() {
        viewModel.setTheme(.purple)
        XCTAssertEqual(AppState.shared.currentTheme, .purple)
    }

    func testAllThemesAvailable() {
        // Verify all 6 themes are available
        let allThemes = ThemeIdentifier.allCases
        XCTAssertEqual(allThemes.count, 6)
        XCTAssertTrue(allThemes.contains(.green))
        XCTAssertTrue(allThemes.contains(.red))
        XCTAssertTrue(allThemes.contains(.blue))
        XCTAssertTrue(allThemes.contains(.tan))
        XCTAssertTrue(allThemes.contains(.pink))
        XCTAssertTrue(allThemes.contains(.purple))
    }

    // MARK: - Notification Tests

    func testNotificationsEnabledPersistence() {
        viewModel.notificationsEnabled = true
        XCTAssertTrue(UserDefaults.standard.bool(forKey: "notificationsEnabled"))

        viewModel.notificationsEnabled = false
        XCTAssertFalse(UserDefaults.standard.bool(forKey: "notificationsEnabled"))
    }

    // MARK: - Voice Settings Tests

    func testVoiceOptionPersistence() {
        viewModel.selectedVoice = .robotic
        XCTAssertEqual(UserDefaults.standard.string(forKey: "selectedVoice"), "robotic")

        viewModel.selectedVoice = .female
        XCTAssertEqual(UserDefaults.standard.string(forKey: "selectedVoice"), "female")
    }

    func testVoiceVolumePersistence() {
        viewModel.voiceVolume = 0.5
        XCTAssertEqual(UserDefaults.standard.double(forKey: "voiceVolume"), 0.5, accuracy: 0.01)

        viewModel.voiceVolume = 1.0
        XCTAssertEqual(UserDefaults.standard.double(forKey: "voiceVolume"), 1.0, accuracy: 0.01)
    }

    func testAllVoiceOptionsAvailable() {
        let allVoices = SettingsViewModel.VoiceOption.allCases
        XCTAssertEqual(allVoices.count, 4)
        XCTAssertTrue(allVoices.contains(.system))
        XCTAssertTrue(allVoices.contains(.male))
        XCTAssertTrue(allVoices.contains(.female))
        XCTAssertTrue(allVoices.contains(.robotic))
    }

    func testVoiceOptionDisplayNames() {
        XCTAssertEqual(SettingsViewModel.VoiceOption.system.displayName, "SYSTEM DEFAULT")
        XCTAssertEqual(SettingsViewModel.VoiceOption.male.displayName, "MALE")
        XCTAssertEqual(SettingsViewModel.VoiceOption.female.displayName, "FEMALE")
        XCTAssertEqual(SettingsViewModel.VoiceOption.robotic.displayName, "ROBOTIC")
    }

    // MARK: - Rig Filter Tests

    func testRigFilterPersistence() {
        viewModel.defaultRigFilter = "adjutant"
        XCTAssertEqual(UserDefaults.standard.string(forKey: "defaultRigFilter"), "adjutant")

        viewModel.defaultRigFilter = nil
        XCTAssertNil(UserDefaults.standard.string(forKey: "defaultRigFilter"))
    }

    func testRigFilterUpdatesAppState() {
        viewModel.defaultRigFilter = "beads"
        XCTAssertEqual(AppState.shared.selectedRig, "beads")

        viewModel.defaultRigFilter = nil
        XCTAssertNil(AppState.shared.selectedRig)
    }

    // MARK: - Tunnel Control Tests

    func testStartTunnelFromStoppedState() async {
        XCTAssertEqual(viewModel.powerState, .stopped)

        await viewModel.startTunnel()

        XCTAssertEqual(viewModel.powerState, .running)
        XCTAssertFalse(viewModel.isTunnelOperating)
    }

    func testStartTunnelIgnoredWhenNotStopped() async {
        // First start the tunnel
        await viewModel.startTunnel()
        XCTAssertEqual(viewModel.powerState, .running)

        // Try to start again - should be ignored
        await viewModel.startTunnel()
        XCTAssertEqual(viewModel.powerState, .running)
    }

    func testStopTunnelFromRunningState() async {
        // First start the tunnel
        await viewModel.startTunnel()
        XCTAssertEqual(viewModel.powerState, .running)

        // Now stop it
        await viewModel.stopTunnel()

        XCTAssertEqual(viewModel.powerState, .stopped)
        XCTAssertFalse(viewModel.isTunnelOperating)
    }

    func testStopTunnelIgnoredWhenNotRunning() async {
        XCTAssertEqual(viewModel.powerState, .stopped)

        // Try to stop when already stopped - should be ignored
        await viewModel.stopTunnel()
        XCTAssertEqual(viewModel.powerState, .stopped)
    }

    // MARK: - App Version Tests

    func testAppVersionFormat() {
        let version = viewModel.appVersion
        // Version should contain parentheses for build number
        XCTAssertTrue(version.contains("("))
        XCTAssertTrue(version.contains(")"))
    }

    // MARK: - ThemeIdentifier Tests

    func testThemeIdentifierDisplayNames() {
        XCTAssertEqual(ThemeIdentifier.green.displayName, "GAS-BOY")
        XCTAssertEqual(ThemeIdentifier.red.displayName, "BLOOD-BAG")
        XCTAssertEqual(ThemeIdentifier.blue.displayName, "VAULT-TEC")
        XCTAssertEqual(ThemeIdentifier.tan.displayName, "WASTELAND")
        XCTAssertEqual(ThemeIdentifier.pink.displayName, "PINK-MIST")
        XCTAssertEqual(ThemeIdentifier.purple.displayName, "RAD-STORM")
    }

    func testThemeIdentifierRawValues() {
        XCTAssertEqual(ThemeIdentifier.green.rawValue, "green")
        XCTAssertEqual(ThemeIdentifier.red.rawValue, "red")
        XCTAssertEqual(ThemeIdentifier.blue.rawValue, "blue")
        XCTAssertEqual(ThemeIdentifier.tan.rawValue, "tan")
        XCTAssertEqual(ThemeIdentifier.pink.rawValue, "pink")
        XCTAssertEqual(ThemeIdentifier.purple.rawValue, "purple")
    }

    // MARK: - Communication Priority Tests

    func testDefaultCommunicationPriority() {
        XCTAssertEqual(viewModel.communicationPriority, .efficient)
    }

    func testCommunicationPriorityUpdatesAppState() {
        viewModel.communicationPriority = .realTime
        XCTAssertEqual(AppState.shared.communicationPriority, .realTime)

        viewModel.communicationPriority = .pollingOnly
        XCTAssertEqual(AppState.shared.communicationPriority, .pollingOnly)

        viewModel.communicationPriority = .efficient
        XCTAssertEqual(AppState.shared.communicationPriority, .efficient)
    }

    func testAllCommunicationPrioritiesAvailable() {
        let allPriorities = CommunicationPriority.allCases
        XCTAssertEqual(allPriorities.count, 3)
        XCTAssertTrue(allPriorities.contains(.realTime))
        XCTAssertTrue(allPriorities.contains(.efficient))
        XCTAssertTrue(allPriorities.contains(.pollingOnly))
    }

    func testCommunicationPriorityDisplayNames() {
        XCTAssertEqual(CommunicationPriority.realTime.displayName, "REAL-TIME")
        XCTAssertEqual(CommunicationPriority.efficient.displayName, "EFFICIENT")
        XCTAssertEqual(CommunicationPriority.pollingOnly.displayName, "POLLING ONLY")
    }

    func testCommunicationPriorityRawValues() {
        XCTAssertEqual(CommunicationPriority.realTime.rawValue, "realTime")
        XCTAssertEqual(CommunicationPriority.efficient.rawValue, "efficient")
        XCTAssertEqual(CommunicationPriority.pollingOnly.rawValue, "pollingOnly")
    }

    // MARK: - PowerState Tests

    func testPowerStateIsTransitioning() {
        XCTAssertFalse(PowerState.stopped.isTransitioning)
        XCTAssertTrue(PowerState.starting.isTransitioning)
        XCTAssertFalse(PowerState.running.isTransitioning)
        XCTAssertTrue(PowerState.stopping.isTransitioning)
    }
}
