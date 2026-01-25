import Foundation
import Combine
import AdjutantKit

/// ViewModel for the Dashboard view, coordinating Mail, Crew, and Convoy data.
@MainActor
final class DashboardViewModel: BaseViewModel {
    // MARK: - Published Properties

    /// Recent mail messages (limited to most recent)
    @Published private(set) var recentMail: [Message] = []

    /// Unread mail count
    @Published private(set) var unreadCount: Int = 0

    /// Crew members with their statuses
    @Published private(set) var crewMembers: [CrewMember] = []

    /// Active convoys
    @Published private(set) var convoys: [Convoy] = []

    /// Whether the dashboard is currently refreshing (includes background polling)
    @Published private(set) var isRefreshing = false

    // MARK: - Configuration

    /// Polling interval for auto-refresh (in seconds)
    var pollingInterval: TimeInterval = 30.0

    /// Maximum number of recent mail messages to display
    private let maxRecentMail = 5

    // MARK: - Private Properties

    private let apiClient: APIClient
    private var pollingTask: Task<Void, Never>?

    // MARK: - Initialization

    init(apiClient: APIClient = APIClient()) {
        self.apiClient = apiClient
        super.init()
    }

    deinit {
        pollingTask?.cancel()
    }

    // MARK: - Lifecycle

    override func onAppear() {
        super.onAppear()
        startPolling()
    }

    override func onDisappear() {
        super.onDisappear()
        stopPolling()
    }

    // MARK: - Data Loading

    override func refresh() async {
        isRefreshing = true

        // Fetch all data concurrently
        async let mailResult = fetchMail()
        async let crewResult = fetchCrew()
        async let convoysResult = fetchConvoys()

        // Await all results
        let (mail, crew, convoys) = await (mailResult, crewResult, convoysResult)

        // Update state
        if let mail = mail {
            self.recentMail = Array(mail.items.prefix(maxRecentMail))
            self.unreadCount = mail.items.filter { !$0.read }.count
            AppState.shared.updateUnreadMailCount(self.unreadCount)
        }

        if let crew = crew {
            self.crewMembers = crew
        }

        if let convoys = convoys {
            self.convoys = convoys.filter { !$0.isComplete }
        }

        isRefreshing = false
    }

    /// Silently refresh data in the background (no loading indicator)
    func refreshSilently() async {
        await refresh()
    }

    // MARK: - Polling

    private func startPolling() {
        stopPolling()
        pollingTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(pollingInterval * 1_000_000_000))
                guard !Task.isCancelled else { break }
                await refreshSilently()
            }
        }
    }

    private func stopPolling() {
        pollingTask?.cancel()
        pollingTask = nil
    }

    // MARK: - Private Fetch Methods

    private func fetchMail() async -> PaginatedResponse<Message>? {
        await performAsync(showLoading: false) {
            try await self.apiClient.getMail(filter: .user)
        }
    }

    private func fetchCrew() async -> [CrewMember]? {
        await performAsync(showLoading: false) {
            try await self.apiClient.getAgents()
        }
    }

    private func fetchConvoys() async -> [Convoy]? {
        await performAsync(showLoading: false) {
            try await self.apiClient.getConvoys()
        }
    }

    // MARK: - Computed Properties

    /// Crew members that are currently active (not offline)
    var activeCrewMembers: [CrewMember] {
        crewMembers.filter { $0.status != .offline }
    }

    /// Number of crew members with issues (stuck or blocked)
    var crewWithIssues: Int {
        crewMembers.filter { $0.status == .stuck || $0.status == .blocked }.count
    }

    /// Total convoy progress percentage
    var totalConvoyProgress: Double {
        guard !convoys.isEmpty else { return 0 }
        let totalCompleted = convoys.reduce(0) { $0 + $1.progress.completed }
        let totalItems = convoys.reduce(0) { $0 + $1.progress.total }
        guard totalItems > 0 else { return 0 }
        return Double(totalCompleted) / Double(totalItems)
    }
}
