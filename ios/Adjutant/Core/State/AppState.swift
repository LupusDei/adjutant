import Foundation
import Combine
import AdjutantKit

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

    /// Available rigs in the system (fetched from /api/status)
    @Published private(set) var availableRigs: [String] = []

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

    /// Whether onboarding has been completed (URL is configured)
    var isOnboardingComplete: Bool {
        // Check if URL is not localhost (user has configured a real URL)
        let host = apiBaseURL.host ?? ""
        return !host.contains("localhost") && !host.contains("127.0.0.1")
    }

    // MARK: - Dependencies

    private var apiClient: APIClient?

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

    /// Updates the list of available rigs
    /// - Parameter rigs: Array of rig names
    func updateAvailableRigs(_ rigs: [String]) {
        availableRigs = rigs
    }

    /// Fetches available rigs from the API
    /// Call this on app startup and when refreshing status
    func fetchAvailableRigs() async {
        let client = apiClient ?? APIClient()
        do {
            let status = try await client.getStatus()
            let rigNames = status.rigs.map { $0.name }
            availableRigs = rigNames.sorted()

            // Also update power state from status
            // Convert from AdjutantKit.PowerState to local PowerState
            if let localState = PowerState(rawValue: status.powerState.rawValue) {
                updatePowerState(localState)
            }
        } catch {
            // On error, keep existing rigs list
            // Optionally log the error
        }
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
