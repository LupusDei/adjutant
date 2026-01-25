import Foundation
import Combine

/// Global application state container.
/// Manages app-wide state that needs to be shared across multiple views and ViewModels.
@MainActor
final class AppState: ObservableObject {
    // MARK: - Singleton

    static let shared = AppState()

    // MARK: - Published Properties

    /// Current theme identifier
    @Published var currentTheme: ThemeIdentifier = .green

    /// Whether the Gastown system is running
    @Published private(set) var isPowerOn = false

    /// Current power state of the system
    @Published private(set) var powerState: PowerState = .stopped

    /// Currently selected rig filter (nil means all rigs)
    @Published var selectedRig: String?

    /// Whether overseer mode is enabled (filters infrastructure content)
    @Published var isOverseerMode = true

    /// Count of unread mail messages
    @Published private(set) var unreadMailCount = 0

    /// Whether voice features are available
    @Published private(set) var isVoiceAvailable = false

    /// Whether voice/notifications are muted
    @Published var isVoiceMuted = false

    /// Network connectivity status
    @Published private(set) var isNetworkAvailable = true

    /// Current API base URL
    @Published var apiBaseURL: URL = URL(string: "http://localhost:3001/api")!

    // MARK: - Private Properties

    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization

    private init() {
        loadPersistedState()
    }

    // MARK: - State Updates

    /// Updates the power state
    /// - Parameter state: The new power state
    func updatePowerState(_ state: PowerState) {
        powerState = state
        isPowerOn = state == .running
    }

    /// Updates the unread mail count
    /// - Parameter count: The new unread count
    func updateUnreadMailCount(_ count: Int) {
        unreadMailCount = count
    }

    /// Updates voice availability
    /// - Parameter available: Whether voice is available
    func updateVoiceAvailability(_ available: Bool) {
        isVoiceAvailable = available
    }

    /// Updates network availability
    /// - Parameter available: Whether network is available
    func updateNetworkAvailability(_ available: Bool) {
        isNetworkAvailable = available
    }

    // MARK: - Persistence

    private func loadPersistedState() {
        if let themeRaw = UserDefaults.standard.string(forKey: "selectedTheme"),
           let theme = ThemeIdentifier(rawValue: themeRaw) {
            currentTheme = theme
        }

        isOverseerMode = UserDefaults.standard.bool(forKey: "isOverseerMode")
        isVoiceMuted = UserDefaults.standard.bool(forKey: "isVoiceMuted")
        selectedRig = UserDefaults.standard.string(forKey: "selectedRig")

        if let urlString = UserDefaults.standard.string(forKey: "apiBaseURL"),
           let url = URL(string: urlString) {
            apiBaseURL = url
        }

        // Set up persistence observers
        $currentTheme
            .dropFirst()
            .sink { theme in
                UserDefaults.standard.set(theme.rawValue, forKey: "selectedTheme")
            }
            .store(in: &cancellables)

        $isOverseerMode
            .dropFirst()
            .sink { isOverseer in
                UserDefaults.standard.set(isOverseer, forKey: "isOverseerMode")
            }
            .store(in: &cancellables)

        $isVoiceMuted
            .dropFirst()
            .sink { isMuted in
                UserDefaults.standard.set(isMuted, forKey: "isVoiceMuted")
            }
            .store(in: &cancellables)

        $selectedRig
            .dropFirst()
            .sink { rig in
                UserDefaults.standard.set(rig, forKey: "selectedRig")
            }
            .store(in: &cancellables)

        $apiBaseURL
            .dropFirst()
            .sink { url in
                UserDefaults.standard.set(url.absoluteString, forKey: "apiBaseURL")
            }
            .store(in: &cancellables)
    }
}

// MARK: - Supporting Types

/// Available theme identifiers matching the web app
enum ThemeIdentifier: String, CaseIterable, Identifiable {
    case green = "green"
    case red = "red"
    case blue = "blue"
    case tan = "tan"
    case pink = "pink"
    case purple = "purple"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .green: return "GAS-BOY"
        case .red: return "BLOOD-BAG"
        case .blue: return "VAULT-TEC"
        case .tan: return "WASTELAND"
        case .pink: return "PINK-MIST"
        case .purple: return "RAD-STORM"
        }
    }
}

/// Power states for the Gastown system
enum PowerState: String {
    case stopped
    case starting
    case running
    case stopping

    var isTransitioning: Bool {
        self == .starting || self == .stopping
    }
}
