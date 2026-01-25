import Foundation
import Combine
import AdjutantKit

/// ViewModel for the Settings view.
/// Manages theme selection, tunnel control, notifications, voice settings, and app preferences.
@MainActor
final class SettingsViewModel: BaseViewModel {
    // MARK: - Published Properties

    /// Currently selected theme
    @Published var selectedTheme: ThemeIdentifier

    /// Tunnel/system power state
    @Published private(set) var powerState: PowerState = .stopped

    /// Whether notifications are enabled
    @Published var notificationsEnabled: Bool {
        didSet {
            UserDefaults.standard.set(notificationsEnabled, forKey: "notificationsEnabled")
        }
    }

    /// Selected voice for text-to-speech
    @Published var selectedVoice: VoiceOption {
        didSet {
            UserDefaults.standard.set(selectedVoice.rawValue, forKey: "selectedVoice")
        }
    }

    /// Voice volume (0.0 to 1.0)
    @Published var voiceVolume: Double {
        didSet {
            UserDefaults.standard.set(voiceVolume, forKey: "voiceVolume")
        }
    }

    /// Whether voice features are available
    @Published private(set) var isVoiceAvailable: Bool = false

    /// Default rig filter (nil means all rigs)
    @Published var defaultRigFilter: String? {
        didSet {
            UserDefaults.standard.set(defaultRigFilter, forKey: "defaultRigFilter")
            AppState.shared.selectedRig = defaultRigFilter
        }
    }

    /// Available rigs for filtering
    @Published private(set) var availableRigs: [String] = []

    /// Whether tunnel operation is in progress
    @Published private(set) var isTunnelOperating: Bool = false

    /// Current server URL (from AppState)
    @Published var serverURL: String = ""

    /// Whether server URL is being validated
    @Published private(set) var isValidatingServer: Bool = false

    /// Server validation error message
    @Published var serverErrorMessage: String?

    // MARK: - App Info

    /// App version string
    var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(version) (\(build))"
    }

    // MARK: - Voice Options

    enum VoiceOption: String, CaseIterable, Identifiable {
        case system = "system"
        case male = "male"
        case female = "female"
        case robotic = "robotic"

        var id: String { rawValue }

        var displayName: String {
            switch self {
            case .system: return "SYSTEM DEFAULT"
            case .male: return "MALE"
            case .female: return "FEMALE"
            case .robotic: return "ROBOTIC"
            }
        }
    }

    // MARK: - Dependencies

    private let apiClient: APIClient

    // MARK: - Initialization

    init(apiClient: APIClient = APIClient()) {
        self.apiClient = apiClient

        // Load persisted values
        self.selectedTheme = AppState.shared.currentTheme
        self.notificationsEnabled = UserDefaults.standard.bool(forKey: "notificationsEnabled")

        let savedVolume = UserDefaults.standard.double(forKey: "voiceVolume")
        self.voiceVolume = savedVolume == 0 ? 0.8 : savedVolume // Default volume

        if let voiceRaw = UserDefaults.standard.string(forKey: "selectedVoice"),
           let voice = VoiceOption(rawValue: voiceRaw) {
            self.selectedVoice = voice
        } else {
            self.selectedVoice = .system
        }

        self.defaultRigFilter = UserDefaults.standard.string(forKey: "defaultRigFilter")

        super.init()

        setupBindings()
    }

    // MARK: - Lifecycle

    override func onAppear() {
        super.onAppear()
        syncWithAppState()
    }

    override func refresh() async {
        await fetchAvailableRigs()
    }

    // MARK: - Theme

    /// Updates the selected theme
    func setTheme(_ theme: ThemeIdentifier) {
        selectedTheme = theme
        AppState.shared.currentTheme = theme
    }

    // MARK: - Tunnel Control

    /// Starts the tunnel/system
    func startTunnel() async {
        guard powerState == .stopped else { return }

        isTunnelOperating = true
        powerState = .starting

        await performAsyncAction(showLoading: false) {
            // Simulate tunnel start - replace with actual API call
            try await Task.sleep(nanoseconds: 1_500_000_000)
            self.powerState = .running
            AppState.shared.updatePowerState(.running)
        }

        isTunnelOperating = false
    }

    /// Stops the tunnel/system
    func stopTunnel() async {
        guard powerState == .running else { return }

        isTunnelOperating = true
        powerState = .stopping

        await performAsyncAction(showLoading: false) {
            // Simulate tunnel stop - replace with actual API call
            try await Task.sleep(nanoseconds: 1_000_000_000)
            self.powerState = .stopped
            AppState.shared.updatePowerState(.stopped)
        }

        isTunnelOperating = false
    }

    // MARK: - Server URL

    /// Updates the server URL
    func updateServerURL() async {
        serverErrorMessage = nil

        // Clean up the URL
        var cleanURL = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)

        // Add https:// if no scheme provided
        if !cleanURL.hasPrefix("http://") && !cleanURL.hasPrefix("https://") {
            cleanURL = "https://" + cleanURL
        }

        // Remove trailing slash
        if cleanURL.hasSuffix("/") {
            cleanURL = String(cleanURL.dropLast())
        }

        // Append /api if not present
        if !cleanURL.hasSuffix("/api") {
            cleanURL = cleanURL + "/api"
        }

        // Validate URL format
        guard let url = URL(string: cleanURL),
              let host = url.host,
              !host.isEmpty else {
            serverErrorMessage = "Invalid URL format"
            return
        }

        // Block localhost URLs
        if host.contains("localhost") || host.contains("127.0.0.1") {
            serverErrorMessage = "Please enter a remote server URL"
            return
        }

        isValidatingServer = true

        // Save the URL
        AppState.shared.apiBaseURL = url
        serverURL = cleanURL

        // Brief delay to show validation state
        try? await Task.sleep(nanoseconds: 500_000_000)

        isValidatingServer = false
    }

    /// Resets the server URL to show onboarding again
    func resetServerURL() {
        AppState.shared.apiBaseURL = URL(string: "http://localhost:3001/api")!
        serverURL = ""
    }

    // MARK: - Private Methods

    private func setupBindings() {
        // Observe AppState power changes
        AppState.shared.$powerState
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                self?.powerState = state
            }
            .store(in: &cancellables)

        // Observe voice availability
        AppState.shared.$isVoiceAvailable
            .receive(on: DispatchQueue.main)
            .sink { [weak self] available in
                self?.isVoiceAvailable = available
            }
            .store(in: &cancellables)
    }

    private func syncWithAppState() {
        selectedTheme = AppState.shared.currentTheme
        powerState = AppState.shared.powerState
        isVoiceAvailable = AppState.shared.isVoiceAvailable
        serverURL = AppState.shared.apiBaseURL.absoluteString
    }

    private func fetchAvailableRigs() async {
        // Fetch rigs from AppState which calls the API
        await AppState.shared.fetchAvailableRigs()
        availableRigs = AppState.shared.availableRigs
    }
}
