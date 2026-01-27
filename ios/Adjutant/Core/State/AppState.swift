import Foundation
import Combine
import UserNotifications
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

    // MARK: - Notification State

    /// Current notification permission status
    @Published private(set) var notificationPermissionStatus: UNAuthorizationStatus = .notDetermined

    /// Set of known mail IDs (used to detect new mail)
    @Published private(set) var knownMailIds: Set<String> = []

    /// Whether onboarding has been completed (URL is configured)
    var isOnboardingComplete: Bool {
        // Check if URL is not localhost (user has configured a real URL)
        let host = apiBaseURL.host ?? ""
        return !host.contains("localhost") && !host.contains("127.0.0.1")
    }

    // MARK: - Dependencies

    /// Shared API client configured with the current base URL
    /// This client is recreated when apiBaseURL changes
    private(set) var apiClient: APIClient

    /// Internal reference for status fetching
    private var _statusApiClient: APIClient?

    // MARK: - Private Properties

    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization

    /// Returns the persisted API base URL from UserDefaults, or localhost as fallback
    private static func loadPersistedBaseURL() -> URL {
        if let urlString = UserDefaults.standard.string(forKey: "apiBaseURL"),
           let url = URL(string: urlString) {
            return url
        }
        return URL(string: "http://localhost:3001/api")!
    }

    private init() {
        // IMPORTANT: Load persisted URL FIRST before creating APIClient
        // This prevents early API calls from going to localhost when a saved URL exists
        let persistedURL = Self.loadPersistedBaseURL()
        self.apiBaseURL = persistedURL

        let config = APIClientConfiguration(baseURL: persistedURL)
        self.apiClient = APIClient(configuration: config)

        loadPersistedState()
        setupNetworkRecoveryObserver()
        registerDependencies()
    }

    /// Registers application services in the dependency container
    private func registerDependencies() {
        let container = DependencyContainer.shared

        // Register TTSPlaybackService as a lazy singleton
        container.registerLazySingleton((any TTSPlaybackServiceProtocol).self) { [weak self] in
            guard let self = self else {
                // Fallback if AppState is somehow deallocated
                let config = APIClientConfiguration(baseURL: URL(string: "http://localhost:3001/api")!)
                let apiClient = APIClient(configuration: config)
                return TTSPlaybackService(apiClient: apiClient, baseURL: URL(string: "http://localhost:3001/api")!)
            }
            return TTSPlaybackService(apiClient: self.apiClient, baseURL: self.apiBaseURL)
        }
    }

    /// Sets up observer to re-check voice availability when network recovers
    private func setupNetworkRecoveryObserver() {
        NetworkMonitor.shared.$isConnected
            .removeDuplicates()
            .dropFirst() // Skip initial value
            .filter { $0 } // Only trigger when network becomes available
            .sink { [weak self] _ in
                Task { @MainActor in
                    await self?.checkVoiceAvailability()
                }
            }
            .store(in: &cancellables)
    }

    /// Recreates the API client with the current base URL
    private func recreateAPIClient() {
        let config = APIClientConfiguration(baseURL: apiBaseURL)
        apiClient = APIClient(configuration: config)
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

    // MARK: - Notification State Updates

    /// Updates the notification permission status
    /// - Parameter status: The current authorization status
    func updateNotificationPermissionStatus(_ status: UNAuthorizationStatus) {
        notificationPermissionStatus = status
    }

    /// Refreshes the notification permission status from the system
    func refreshNotificationPermissionStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        notificationPermissionStatus = settings.authorizationStatus
    }

    /// Adds mail IDs to the known set and returns any new IDs
    /// - Parameter mailIds: The mail IDs to check
    /// - Returns: Set of mail IDs that were not previously known
    @discardableResult
    func addMailIds(_ mailIds: Set<String>) -> Set<String> {
        let newIds = mailIds.subtracting(knownMailIds)
        knownMailIds.formUnion(mailIds)
        return newIds
    }

    /// Checks if a mail ID is new (not in known set)
    /// - Parameter mailId: The mail ID to check
    /// - Returns: true if the mail ID is not in the known set
    func isNewMail(_ mailId: String) -> Bool {
        !knownMailIds.contains(mailId)
    }

    /// Clears all known mail IDs (e.g., on logout or data reset)
    func clearKnownMailIds() {
        knownMailIds.removeAll()
    }

    /// Updates the list of available rigs
    /// - Parameter rigs: Array of rig names
    func updateAvailableRigs(_ rigs: [String]) {
        availableRigs = rigs
    }

    /// Fetches available rigs from the API
    /// Call this on app startup and when refreshing status
    func fetchAvailableRigs() async {
        let client = apiClient
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

    /// Checks if voice service is available from the API
    /// Call this on app startup and when network recovers
    func checkVoiceAvailability() async {
        let client = apiClient
        do {
            let status = try await client.getVoiceStatus()
            updateVoiceAvailability(status.available)
        } catch {
            updateVoiceAvailability(false)
        }
    }

    // MARK: - Persistence

    /// App Group identifier for sharing data with widgets
    static let appGroupIdentifier = "group.com.jmm.adjutant"

    /// Shared UserDefaults for widget access
    private static var sharedDefaults: UserDefaults? {
        UserDefaults(suiteName: appGroupIdentifier)
    }

    private func loadPersistedState() {
        if let themeRaw = UserDefaults.standard.string(forKey: "selectedTheme"),
           let theme = ThemeIdentifier(rawValue: themeRaw) {
            currentTheme = theme
        }

        isOverseerMode = UserDefaults.standard.bool(forKey: "isOverseerMode")
        isVoiceMuted = UserDefaults.standard.bool(forKey: "isVoiceMuted")
        // Default to "town" rig if no value persisted (not "all")
        selectedRig = UserDefaults.standard.string(forKey: "selectedRig") ?? "town"

        if let urlString = UserDefaults.standard.string(forKey: "apiBaseURL"),
           let url = URL(string: urlString) {
            apiBaseURL = url
            recreateAPIClient()
            // Also sync to shared defaults for widgets
            Self.sharedDefaults?.set(url.absoluteString, forKey: "apiBaseURL")
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
            .sink { [weak self] url in
                UserDefaults.standard.set(url.absoluteString, forKey: "apiBaseURL")
                // Also sync to shared defaults for widgets
                Self.sharedDefaults?.set(url.absoluteString, forKey: "apiBaseURL")
                self?.recreateAPIClient()
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
