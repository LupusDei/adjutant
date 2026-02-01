import Foundation
import Combine
import AdjutantKit
import ActivityKit

/// ViewModel for the Dashboard view, coordinating Beads, Crew, and Mail data.
@MainActor
final class DashboardViewModel: BaseViewModel {
    // MARK: - Published Properties

    /// Recent beads for Kanban preview (limited to most recently updated)
    @Published private(set) var recentBeads: [BeadInfo] = []

    /// Recent mail messages (limited to most recent)
    @Published private(set) var recentMail: [Message] = []

    /// Unread mail count
    @Published private(set) var unreadCount: Int = 0

    /// Crew members with their statuses
    @Published private(set) var crewMembers: [CrewMember] = []

    /// Beads that are in progress
    @Published private(set) var inProgressBeads: [BeadInfo] = []

    /// Beads that are hooked
    @Published private(set) var hookedBeads: [BeadInfo] = []

    /// Recently closed beads
    @Published private(set) var recentClosedBeads: [BeadInfo] = []

    /// Whether the dashboard is currently refreshing (includes background polling)
    @Published private(set) var isRefreshing = false

    // MARK: - Configuration

    /// Polling interval for auto-refresh (in seconds)
    var pollingInterval: TimeInterval = 30.0

    /// Maximum number of recent beads to display per column
    private let maxBeadsPerColumn = 5

    /// Maximum number of recent mail messages to display
    private let maxRecentMail = 3

    /// Town name for Live Activity
    private let townName = "Adjutant"

    // MARK: - Private Properties

    private let apiClient: APIClient
    private var pollingTask: Task<Void, Never>?

    // MARK: - Initialization

    init(apiClient: APIClient? = nil) {
        self.apiClient = apiClient ?? AppState.shared.apiClient
        super.init()
        loadFromCache()
    }

    /// Loads cached dashboard data for immediate display
    private func loadFromCache() {
        let cache = ResponseCache.shared
        if cache.hasCache(for: .dashboard) {
            recentMail = cache.dashboardMail
            crewMembers = cache.dashboardCrew
            unreadCount = recentMail.filter { !$0.read }.count
        }
        // Load cached beads
        let cachedBeads = cache.beads
        if !cachedBeads.isEmpty {
            recentBeads = sortBeadsByRecency(cachedBeads)
        }
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

        // Get current rig filter from AppState
        let selectedRig = AppState.shared.selectedRig

        // Fetch all data concurrently
        async let mailResult = fetchMail()
        async let crewResult = fetchCrew()
        async let inProgressResult = fetchBeads(status: .inProgress, rig: selectedRig)
        async let hookedResult = fetchBeads(status: .hooked, rig: selectedRig)
        async let closedResult = fetchBeads(status: .closed, rig: selectedRig)
        async let _ : () = AppState.shared.fetchAvailableRigs()

        // Await all results
        let (mail, crew, inProgress, hooked, closed) = await (
            mailResult, crewResult, inProgressResult, hookedResult, closedResult
        )

        if let mail = mail {
            self.recentMail = Array(mail.items.prefix(maxRecentMail))
            self.unreadCount = mail.items.filter { !$0.read }.count
            AppState.shared.updateUnreadMailCount(self.unreadCount)

            // Process new messages for notifications
            await NotificationService.shared.processNewMessages(mail.items)

            // Announce overseer-directed mail via voice
            await OverseerMailAnnouncer.shared.processMessages(mail.items)
        }

        if let crew = crew {
            self.crewMembers = crew
        }

        if let inProgress = inProgress {
            // Filter out wisps (scope to Overseer view), sort by updated date descending
            let filtered = inProgress.filter { $0.type != "wisp" }
            let sorted = filtered.sorted { ($0.updatedDate ?? .distantPast) > ($1.updatedDate ?? .distantPast) }
            self.inProgressBeads = Array(sorted.prefix(maxBeadsPerColumn))
        }

        if let hooked = hooked {
            // Filter out wisps (scope to Overseer view), sort by updated date descending
            let filtered = hooked.filter { $0.type != "wisp" }
            let sorted = filtered.sorted { ($0.updatedDate ?? .distantPast) > ($1.updatedDate ?? .distantPast) }
            self.hookedBeads = Array(sorted.prefix(maxBeadsPerColumn))
        }

        if let closed = closed {
            // Filter out wisps (scope to Overseer view), sort by updated date descending
            let filtered = closed.filter { $0.type != "wisp" }
            let sorted = filtered.sorted { ($0.updatedDate ?? .distantPast) > ($1.updatedDate ?? .distantPast) }
            self.recentClosedBeads = Array(sorted.prefix(maxBeadsPerColumn))
        }

        // Update cache for next navigation
        ResponseCache.shared.updateDashboard(
            mail: self.recentMail,
            crew: self.crewMembers,
            convoys: []  // Convoys removed from dashboard
        )

        // Update Live Activity with current state
        await syncLiveActivity()

        isRefreshing = false
    }

    // MARK: - Live Activity

    /// Syncs the Live Activity with current dashboard state.
    private func syncLiveActivity() async {
        #if os(iOS)
        guard #available(iOS 16.1, *) else { return }

        let activeAgentCount = activeCrewMembers.count

        // Get the power state from AppState (convert local to AdjutantKit type)
        let localPowerState = AppState.shared.powerState
        let powerState: AdjutantKit.PowerState
        switch localPowerState {
        case .stopped:
            powerState = .stopped
        case .starting:
            powerState = .starting
        case .running:
            powerState = .running
        case .stopping:
            powerState = .stopping
        }

        let state = LiveActivityService.createState(
            powerState: powerState,
            unreadMailCount: unreadCount,
            activeAgents: activeAgentCount,
            beadsInProgress: beadsInProgress,
            beadsHooked: beadsHooked
        )

        await LiveActivityService.shared.syncActivity(
            townName: townName,
            state: state
        )
        #endif
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

    private func fetchBeads(status: APIClient.BeadStatusFilter, rig: String?) async -> [BeadInfo]? {
        await performAsync(showLoading: false) {
            try await self.apiClient.getBeads(
                rig: rig,
                status: status,
                limit: self.maxBeadsPerColumn
            )
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

    /// Total count of active beads (in progress + hooked)
    var activeBeadsCount: Int {
        inProgressBeads.count + hookedBeads.count
    }

    /// Count of beads in progress (for Live Activity)
    var beadsInProgress: Int {
        inProgressBeads.count
    }

    /// Count of beads hooked (for Live Activity)
    var beadsHooked: Int {
        hookedBeads.count
    }

    // MARK: - Private Helpers

    /// Sorts beads by most recently updated first
    private func sortBeadsByRecency(_ beads: [BeadInfo]) -> [BeadInfo] {
        beads.sorted { a, b in
            let dateA = a.updatedDate ?? a.createdDate ?? Date.distantPast
            let dateB = b.updatedDate ?? b.createdDate ?? Date.distantPast
            return dateA > dateB
        }
    }
}
