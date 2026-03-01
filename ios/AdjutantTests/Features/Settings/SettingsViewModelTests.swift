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
        defaults.removeObject(forKey: "communicationPriority")
    }

    // MARK: - Initial State Tests

    func testInitialState() {
        XCTAssertFalse(viewModel.isLoading)
    }

    func testDefaultVoiceVolume() {
        // When no persisted volume, should default to 0.8
        XCTAssertEqual(viewModel.voiceVolume, 0.8, accuracy: 0.01)
    }

    func testDefaultVoiceOption() {
        // Should default to system voice
        XCTAssertEqual(viewModel.selectedVoice, .system)
    }

    // MARK: - Theme Tests

    func testSetThemeUpdatesSelectedTheme() {
        viewModel.setTheme(.document)
        XCTAssertEqual(viewModel.selectedTheme, .document)

        viewModel.setTheme(.starcraft)
        XCTAssertEqual(viewModel.selectedTheme, .starcraft)

        viewModel.setTheme(.friendly)
        XCTAssertEqual(viewModel.selectedTheme, .friendly)
    }

    func testSetThemeUpdatesAppState() {
        viewModel.setTheme(.starcraft)
        XCTAssertEqual(AppState.shared.currentTheme, .starcraft)
    }

    func testAllThemesAvailable() {
        // Verify all 4 themes are available
        let allThemes = ThemeIdentifier.allCases
        XCTAssertEqual(allThemes.count, 4)
        XCTAssertTrue(allThemes.contains(.pipboy))
        XCTAssertTrue(allThemes.contains(.document))
        XCTAssertTrue(allThemes.contains(.starcraft))
        XCTAssertTrue(allThemes.contains(.friendly))
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

    // MARK: - App Version Tests

    func testAppVersionFormat() {
        let version = viewModel.appVersion
        // Version should contain parentheses for build number
        XCTAssertTrue(version.contains("("))
        XCTAssertTrue(version.contains(")"))
    }

    // MARK: - ThemeIdentifier Tests

    func testThemeIdentifierDisplayNames() {
        XCTAssertEqual(ThemeIdentifier.pipboy.displayName, "PIP-BOY")
        XCTAssertEqual(ThemeIdentifier.document.displayName, "DOCUMENT")
        XCTAssertEqual(ThemeIdentifier.starcraft.displayName, "STARCRAFT")
        XCTAssertEqual(ThemeIdentifier.friendly.displayName, "FRIENDLY")
    }

    func testThemeIdentifierRawValues() {
        XCTAssertEqual(ThemeIdentifier.pipboy.rawValue, "pipboy")
        XCTAssertEqual(ThemeIdentifier.document.rawValue, "document")
        XCTAssertEqual(ThemeIdentifier.starcraft.rawValue, "starcraft")
        XCTAssertEqual(ThemeIdentifier.friendly.rawValue, "friendly")
    }

    func testThemeIdentifierColorThemeConversion() {
        XCTAssertEqual(ThemeIdentifier.pipboy.colorTheme, .pipboy)
        XCTAssertEqual(ThemeIdentifier.document.colorTheme, .document)
        XCTAssertEqual(ThemeIdentifier.starcraft.colorTheme, .starcraft)
        XCTAssertEqual(ThemeIdentifier.friendly.colorTheme, .friendly)
    }

    func testFriendlyThemeProperties() {
        let theme = CRTTheme.ColorTheme.friendly
        XCTAssertEqual(theme.displayName, "FRIENDLY")
        XCTAssertFalse(theme.crtEffectsEnabled, "Friendly should have CRT effects disabled")
        XCTAssertFalse(theme.useMonospaceFont, "Friendly should use system font")
        XCTAssertEqual(theme.preferredColorScheme, .light, "Friendly should use light mode")
    }

    func testFriendlyThemeSetViaAppState() {
        viewModel.setTheme(.friendly)
        XCTAssertEqual(AppState.shared.currentTheme, .friendly)
        XCTAssertEqual(AppState.shared.currentTheme.colorTheme.displayName, "FRIENDLY")
    }

    func testLegacyThemeMigration() {
        // Old theme values should gracefully fall back to .pipboy
        XCTAssertNil(ThemeIdentifier(rawValue: "green"))
        XCTAssertNil(ThemeIdentifier(rawValue: "red"))
        XCTAssertNil(ThemeIdentifier(rawValue: "blue"))
        XCTAssertNil(ThemeIdentifier(rawValue: "tan"))
        XCTAssertNil(ThemeIdentifier(rawValue: "pink"))
        XCTAssertNil(ThemeIdentifier(rawValue: "purple"))
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
}
