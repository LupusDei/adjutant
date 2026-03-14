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
    @Published var currentTheme: ThemeIdentifier = .pipboy

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
    @Published var apiBaseURL: URL = URL(string: "http://localhost:4201/api")!

    /// API key for authentication (optional)
    @Published var apiKey: String?

    /// Communication priority level (affects polling intervals)
    @Published var communicationPriority: CommunicationPriority = .efficient

    // MARK: - Notification State

    /// Current notification permission status
    @Published private(set) var notificationPermissionStatus: UNAuthorizationStatus = .notDetermined

    /// Set of known mail IDs (used to detect new mail)
    @Published private(set) var knownMailIds: Set<String> = []

    /// Whether onboarding has been completed (URL is configured)
    var isOnboardingComplete: Bool {
        let host = apiBaseURL.host ?? ""
        return !host.contains("localhost") && !host.contains("127.0.0.1")
    }

    // MARK: - Dependencies

    /// Shared API client configured with the current base URL
    private(set) var apiClient: APIClient

    // MARK: - Private Properties

    private var cancellables = Set<AnyCancellable>()

    /// Whether Phase B (deferred initialization) has completed
    private(set) var isFullyInitialized = false

    /// Whether persisted state (theme, voiceMuted, etc.) has been loaded.
    /// Separate from `isFullyInitialized` because `loadPersistedStateAsync()` runs
    /// on a background thread and completes after `completeInitialization()` returns.
    private var isPersistedStateLoaded = false

    /// Continuations waiting for services + persisted state to be ready.
    /// Resumed once both `isFullyInitialized` and `isPersistedStateLoaded` are true.
    private var servicesReadyContinuations: [CheckedContinuation<Void, Never>] = []

    // MARK: - Initialization

    private static func loadPersistedBaseURL() -> URL {
        if let urlString = UserDefaults.standard.string(forKey: "apiBaseURL"),
           let url = URL(string: urlString) {
            return url
        }
        return URL(string: "http://localhost:4201/api")!
    }

    private static func loadPersistedAPIKey() -> String? {
        UserDefaults.standard.string(forKey: "apiKey")
    }

    /// Phase A: Lightweight bootstrap initialization (sync).
    /// Only loads baseURL and apiKey needed for first API call, creates APIClient,
    /// and sets safe defaults for everything else. All other state loading and
    /// Combine subscription setup is deferred to `completeInitialization()`.
    private init() {
        // Critical reads: apiBaseURL and apiKey must be synchronous because
        // APIClient is needed immediately by other services at startup.
        let persistedURL = Self.loadPersistedBaseURL()
        let persistedAPIKey = Self.loadPersistedAPIKey()
        self.apiBaseURL = persistedURL
        self.apiKey = persistedAPIKey

        let config = APIClientConfiguration(baseURL: persistedURL, apiKey: persistedAPIKey)
        self.apiClient = APIClient(configuration: config)

        if let key = persistedAPIKey {
            Self.sharedDefaults?.set(key, forKey: "apiKey")
        }
    }

    /// Phase B: Deferred initialization (called from `.task{}` after first render).
    /// Loads persisted theme, overseer mode, voice mute, and communication priority.
    /// Sets up Combine persistence observers, network recovery observer, and
    /// registers lazy dependencies. Safe to call multiple times (only runs once).
    func completeInitialization() {
        guard !isFullyInitialized else { return }
        isFullyInitialized = true

        // Set up persistence observers synchronously (lightweight, no I/O).
        // These use dropFirst() so they won't fire until values actually change.
        setupPersistenceObservers()

        // Load remaining UserDefaults values on a background thread to avoid
        // blocking the main thread during startup (~150-300ms savings).
        // The UI will render immediately with safe defaults, then update
        // imperceptibly once the real values arrive.
        loadPersistedStateAsync()

        setupNetworkRecoveryObserver()
        registerDependencies()

        // Check if persisted state already loaded (unlikely but possible if Task ran fast)
        resumeServicesReadyContinuationsIfNeeded()
    }

    private func registerDependencies() {
        let container = DependencyContainer.shared
        container.registerLazySingleton((any TTSPlaybackServiceProtocol).self) { [weak self] in
            guard let self = self else {
                let config = APIClientConfiguration(baseURL: URL(string: "http://localhost:4201/api")!)
                let apiClient = APIClient(configuration: config)
                return TTSPlaybackService(apiClient: apiClient, baseURL: URL(string: "http://localhost:4201/api")!)
            }
            return TTSPlaybackService(apiClient: self.apiClient, baseURL: self.apiBaseURL)
        }
    }

    private func setupNetworkRecoveryObserver() {
        NetworkMonitor.shared.$isConnected
            .removeDuplicates()
            .dropFirst()
            .filter { $0 }
            .sink { [weak self] _ in
                Task { @MainActor in
                    await self?.checkVoiceAvailability()
                }
            }
            .store(in: &cancellables)
    }

    private func recreateAPIClient() {
        let config = APIClientConfiguration(baseURL: apiBaseURL, apiKey: apiKey)
        apiClient = APIClient(configuration: config)
    }

    // MARK: - Services Ready Gate

    /// Whether all initialization is complete: Phase B finished AND persisted state loaded.
    var isServicesReady: Bool {
        isFullyInitialized && isPersistedStateLoaded
    }

    /// Waits until Phase B initialization AND persisted state loading have completed.
    /// Returns immediately if already ready. Push notification handlers should call
    /// this before accessing state like `isVoiceMuted` or `isVoiceAvailable`.
    func waitForServicesReady() async {
        if isServicesReady { return }
        await withCheckedContinuation { continuation in
            servicesReadyContinuations.append(continuation)
        }
    }

    /// Resumes all waiting continuations if both init phases are complete.
    private func resumeServicesReadyContinuationsIfNeeded() {
        guard isServicesReady else { return }
        let continuations = servicesReadyContinuations
        servicesReadyContinuations.removeAll()
        for continuation in continuations {
            continuation.resume()
        }
    }

    // MARK: - State Updates

    func updateUnreadMailCount(_ count: Int) {
        unreadMailCount = count
    }

    func updateVoiceAvailability(_ available: Bool) {
        isVoiceAvailable = available
    }

    func updateNetworkAvailability(_ available: Bool) {
        isNetworkAvailable = available
    }

    // MARK: - Notification State Updates

    func updateNotificationPermissionStatus(_ status: UNAuthorizationStatus) {
        notificationPermissionStatus = status
    }

    func refreshNotificationPermissionStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        notificationPermissionStatus = settings.authorizationStatus
    }

    @discardableResult
    func addMailIds(_ mailIds: Set<String>) -> Set<String> {
        let newIds = mailIds.subtracting(knownMailIds)
        knownMailIds.formUnion(mailIds)
        return newIds
    }

    func isNewMail(_ mailId: String) -> Bool {
        !knownMailIds.contains(mailId)
    }

    func clearKnownMailIds() {
        knownMailIds.removeAll()
    }

    /// Checks if voice service is available from the API
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

    static let appGroupIdentifier = "group.com.jmm.adjutant"

    private static var sharedDefaults: UserDefaults? {
        UserDefaults(suiteName: appGroupIdentifier)
    }

    private static func migrateThemeIdentifier(_ rawValue: String) -> ThemeIdentifier {
        if let theme = ThemeIdentifier(rawValue: rawValue) {
            return theme
        }
        return .pipboy
    }

    /// Holds the result of reading all non-critical UserDefaults keys on a background thread.
    private struct PersistedPreferences: Sendable {
        let themeRaw: String?
        let isOverseerMode: Bool
        let isVoiceMuted: Bool
        let communicationPriorityRaw: String?
    }

    /// Reads non-critical UserDefaults values on a background thread, then
    /// publishes them to @Published properties on MainActor.
    /// The UI starts with safe defaults and updates imperceptibly when ready.
    private func loadPersistedStateAsync() {
        Task<Void, Never> { [weak self] in
            // Read all UserDefaults keys in a single batch on a background thread
            let prefs = await Task.detached(priority: .userInitiated) {
                PersistedPreferences(
                    themeRaw: UserDefaults.standard.string(forKey: "selectedTheme"),
                    isOverseerMode: UserDefaults.standard.bool(forKey: "isOverseerMode"),
                    isVoiceMuted: UserDefaults.standard.bool(forKey: "isVoiceMuted"),
                    communicationPriorityRaw: UserDefaults.standard.string(forKey: "communicationPriority")
                )
            }.value

            // Apply values on MainActor
            guard let self else { return }

            if let themeRaw = prefs.themeRaw {
                self.currentTheme = Self.migrateThemeIdentifier(themeRaw)
            }

            self.isOverseerMode = prefs.isOverseerMode
            self.isVoiceMuted = prefs.isVoiceMuted

            if let priorityRaw = prefs.communicationPriorityRaw,
               let priority = CommunicationPriority(rawValue: priorityRaw) {
                self.communicationPriority = priority
            }

            self.isPersistedStateLoaded = true
            self.resumeServicesReadyContinuationsIfNeeded()
        }
    }

    /// Sets up Combine observers that persist @Published property changes to UserDefaults.
    /// Lightweight (no I/O) -- safe to call synchronously during init.
    /// All sinks use dropFirst() to avoid writing defaults back on initial subscription.
    private func setupPersistenceObservers() {
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

        $apiBaseURL
            .dropFirst()
            .sink { [weak self] url in
                UserDefaults.standard.set(url.absoluteString, forKey: "apiBaseURL")
                Self.sharedDefaults?.set(url.absoluteString, forKey: "apiBaseURL")
                self?.recreateAPIClient()
            }
            .store(in: &cancellables)

        $apiKey
            .dropFirst()
            .sink { [weak self] key in
                if let key = key {
                    UserDefaults.standard.set(key, forKey: "apiKey")
                    Self.sharedDefaults?.set(key, forKey: "apiKey")
                } else {
                    UserDefaults.standard.removeObject(forKey: "apiKey")
                    Self.sharedDefaults?.removeObject(forKey: "apiKey")
                }
                self?.recreateAPIClient()
            }
            .store(in: &cancellables)

        $communicationPriority
            .dropFirst()
            .sink { priority in
                UserDefaults.standard.set(priority.rawValue, forKey: "communicationPriority")
            }
            .store(in: &cancellables)
    }
}

// MARK: - Supporting Types

/// Available theme identifiers matching the 5 app-wide color schemes
enum ThemeIdentifier: String, CaseIterable, Identifiable {
    case pipboy = "pipboy"
    case document = "document"
    case starcraft = "starcraft"
    case friendly = "friendly"
    case glass = "glass"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .pipboy: return "PIP-BOY"
        case .document: return "DOCUMENT"
        case .starcraft: return "STARCRAFT"
        case .friendly: return "FRIENDLY"
        case .glass: return "DARK MODE"
        }
    }

    var colorTheme: CRTTheme.ColorTheme {
        switch self {
        case .pipboy: return .pipboy
        case .document: return .document
        case .starcraft: return .starcraft
        case .friendly: return .friendly
        case .glass: return .glass
        }
    }
}

/// Communication priority levels for data sync
enum CommunicationPriority: String, CaseIterable, Identifiable {
    case realTime = "realTime"
    case efficient = "efficient"
    case pollingOnly = "pollingOnly"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .realTime: return "REAL-TIME"
        case .efficient: return "EFFICIENT"
        case .pollingOnly: return "POLLING ONLY"
        }
    }

    var description: String {
        switch self {
        case .realTime: return "Fastest updates, higher battery usage"
        case .efficient: return "Balanced updates and battery life"
        case .pollingOnly: return "Lowest battery usage, manual refresh"
        }
    }
}
