import Foundation
import Combine
import AdjutantKit
import ActivityKit

/// ViewModel for the Dashboard view, coordinating Beads, Mail, and Crew data.
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

    /// Active convoys
    @Published private(set) var convoys: [Convoy] = []

    /// Beads in progress count
    @Published private(set) var beadsInProgress: Int = 0

    /// Beads hooked count
    @Published private(set) var beadsHooked: Int = 0


    /// Whether the dashboard is currently refreshing (includes background polling)
    @Published private(set) var isRefreshing = false

    // MARK: - Configuration

    /// Polling interval for auto-refresh (in seconds)
    var pollingInterval: TimeInterval = 30.0

    /// Maximum number of recent beads to display per column
    private let maxBeadsPerColumn = 5

    /// Maximum number of recent mail messages to display
    private let maxRecentMail = 3

    /// Town name for Live Activity (default: "Gastown")
    private let townName = "Gastown"

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

        // Fetch all data concurrently
        async let beadsResult = fetchBeads()
        async let mailResult = fetchMail()
        async let crewResult = fetchCrew()
        async let convoysResult = fetchConvoys()
        async let beadsInProgressResult = fetchBeads(status: .inProgress)
        async let beadsHookedResult = fetchBeads(status: .hooked)
        async let _ : () = AppState.shared.fetchAvailableRigs()

        // Await all results
        let (beads, mail, crew, convoys, inProgressBeads, hookedBeads) = await (
            beadsResult, mailResult, crewResult, convoysResult, beadsInProgressResult, beadsHookedResult
        )

        // Update state
        if let beads = beads {
            self.recentBeads = sortBeadsByRecency(beads)
            // Update cache for next navigation
            ResponseCache.shared.updateBeads(beads)
        }

        if let mail = mail {
            self.recentMail = Array(mail.items.prefix(maxRecentMail))
            self.unreadCount = mail.items.filter { !$0.read }.count
            AppState.shared.updateUnreadMailCount(self.unreadCount)

            // Process new messages for notifications
            await NotificationService.shared.processNewMessages(mail.items)
        }

        if let crew = crew {
            self.crewMembers = crew
        }

        if let convoys = convoys {
            self.convoys = convoys.filter { !$0.isComplete }
        }

        // Update beads counts
        self.beadsInProgress = inProgressBeads?.count ?? 0
        self.beadsHooked = hookedBeads?.count ?? 0

        // Update cache for next navigation
        ResponseCache.shared.updateDashboard(
            mail: self.recentMail,
            crew: self.crewMembers,
            convoys: []
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

    private func fetchBeads() async -> [BeadInfo]? {
        await performAsync(showLoading: false) {
            // Fetch beads scoped to selected rig (or all if none selected)
            let rigParam = AppState.shared.selectedRig ?? "all"
            return try await self.apiClient.getBeads(rig: rigParam, status: .all)
        }
    }

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

    private func fetchBeads(status: APIClient.BeadStatusFilter) async -> [BeadInfo]? {
        await performAsync(showLoading: false) {
            try await self.apiClient.getBeads(status: status)
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

    /// Beads grouped by Kanban column status for display
    var beadsByColumn: [KanbanColumnId: [BeadInfo]] {
        var result: [KanbanColumnId: [BeadInfo]] = [:]
        for column in KanbanColumnId.allCases {
            result[column] = []
        }
        for bead in recentBeads {
            let column = mapStatusToColumn(bead.status)
            result[column, default: []].append(bead)
        }
        // Limit beads per column
        for column in KanbanColumnId.allCases {
            if result[column]?.count ?? 0 > maxBeadsPerColumn {
                result[column] = Array(result[column]!.prefix(maxBeadsPerColumn))
            }
        }
        return result
    }

    /// Count of open beads (not closed)
    var openBeadsCount: Int {
        recentBeads.filter { $0.status != "closed" }.count
    }

    /// Count of beads currently hooked or in progress
    var activeBeadsCount: Int {
        recentBeads.filter { $0.status == "hooked" || $0.status == "in_progress" }.count
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
