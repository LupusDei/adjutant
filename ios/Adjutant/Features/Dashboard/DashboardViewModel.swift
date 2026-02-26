import Foundation
import Combine
import AdjutantKit
import ActivityKit
import WidgetKit

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

    /// Rig statuses from the status API
    @Published private(set) var rigStatuses: [RigStatus] = []

    /// Whether the dashboard is currently refreshing (includes background polling)
    @Published private(set) var isRefreshing = false

    // MARK: - Configuration

    /// Maximum number of recent beads to display per column
    private let maxBeadsPerColumn = 5

    /// Maximum number of recent mail messages to display
    private let maxRecentMail = 3

    /// Town name for Live Activity
    private let townName = "Adjutant"

    // MARK: - Private Properties

    private let apiClient: APIClient
    private let dataSync = DataSyncService.shared

    // MARK: - Initialization

    init(apiClient: APIClient? = nil) {
        self.apiClient = apiClient ?? AppState.shared.apiClient
        super.init()
        setupDataSyncObservers()
        loadFromCache()
    }

    /// Loads cached dashboard data for immediate display
    private func loadFromCache() {
        let cache = ResponseCache.shared
        if cache.hasCache(for: .dashboard) {
            // Filter out Wisp and Deacon sources for OVERSEER view
            let cachedMail = cache.dashboardMail.filter { message in
                let fromLower = message.from.lowercased()
                return !fromLower.hasPrefix("wisp/") && !fromLower.hasPrefix("deacon/")
            }
            recentMail = cachedMail
            crewMembers = cache.dashboardCrew
            unreadCount = recentMail.filter { !$0.read }.count
        }
        // Load cached beads
        let cachedBeads = cache.beads
        if !cachedBeads.isEmpty {
            recentBeads = sortBeadsByRecency(cachedBeads)
        }
    }

    /// Sets up observation of DataSyncService updates
    private func setupDataSyncObservers() {
        // Observe mail updates
        dataSync.$mail
            .receive(on: DispatchQueue.main)
            .sink { [weak self] newMail in
                self?.handleMailUpdate(newMail)
            }
            .store(in: &cancellables)

        // Observe crew updates
        dataSync.$crew
            .receive(on: DispatchQueue.main)
            .sink { [weak self] newCrew in
                guard let self = self, !newCrew.isEmpty else { return }
                self.crewMembers = newCrew
                // Sync Live Activity when agent statuses change
                Task { await self.syncLiveActivity() }
                WidgetCenter.shared.reloadTimelines(ofKind: "AdjutantWidget")
            }
            .store(in: &cancellables)

        // Observe beads updates
        dataSync.$beads
            .receive(on: DispatchQueue.main)
            .sink { [weak self] newBeads in
                self?.handleBeadsUpdate(newBeads)
            }
            .store(in: &cancellables)
    }

    /// Handles mail updates from DataSyncService
    private func handleMailUpdate(_ newMail: [Message]) {
        guard !newMail.isEmpty else { return }

        // Filter out Wisp and Deacon sources for OVERSEER view
        let filteredMail = newMail.filter { message in
            let fromLower = message.from.lowercased()
            return !fromLower.hasPrefix("wisp/") && !fromLower.hasPrefix("deacon/")
        }
        self.recentMail = Array(filteredMail.prefix(maxRecentMail))
        self.unreadCount = filteredMail.filter { !$0.read }.count
        AppState.shared.updateUnreadMailCount(self.unreadCount)

        // Update cache
        ResponseCache.shared.updateDashboard(
            mail: self.recentMail,
            crew: self.crewMembers,
            convoys: []
        )

        // Sync Live Activity when unread mail count changes
        Task { await self.syncLiveActivity() }
        WidgetCenter.shared.reloadTimelines(ofKind: "AdjutantWidget")
    }

    /// Handles beads updates from DataSyncService
    private func handleBeadsUpdate(_ newBeads: [BeadInfo]) {
        guard !newBeads.isEmpty else { return }

        let selectedRig = AppState.shared.selectedRig

        // Filter and sort beads by status
        let filtered = newBeads.filter { isOverseerRelevant($0) }

        let inProgress = filtered.filter { $0.status == "in_progress" }
            .sorted { ($0.updatedDate ?? .distantPast) > ($1.updatedDate ?? .distantPast) }
        self.inProgressBeads = Array(inProgress.prefix(maxBeadsPerColumn))

        // In Swarm mode, hooked beads are not shown separately
        if AppState.shared.deploymentMode == .swarm {
            self.hookedBeads = []
        } else {
            let hooked = filtered.filter { $0.status == "hooked" }
                .sorted { ($0.updatedDate ?? .distantPast) > ($1.updatedDate ?? .distantPast) }
            self.hookedBeads = Array(hooked.prefix(maxBeadsPerColumn))
        }

        let closed = filtered.filter { $0.status == "closed" }
            .sorted { ($0.updatedDate ?? .distantPast) > ($1.updatedDate ?? .distantPast) }
        self.recentClosedBeads = Array(closed.prefix(maxBeadsPerColumn))

        self.recentBeads = sortBeadsByRecency(filtered)

        // Sync Live Activity
        Task { await self.syncLiveActivity() }
        WidgetCenter.shared.reloadTimelines(ofKind: "AdjutantWidget")
    }

    deinit {
        // Cleanup handled by cancellables
    }

    // MARK: - Lifecycle

    override func onAppear() {
        super.onAppear()
        dataSync.subscribeMail()
        dataSync.subscribeCrew()
        dataSync.subscribeBeads()
    }

    override func onDisappear() {
        super.onDisappear()
        dataSync.unsubscribeMail()
        dataSync.unsubscribeCrew()
        dataSync.unsubscribeBeads()
    }

    // MARK: - Data Loading

    override func refresh() async {
        isRefreshing = true

        // Refresh all data via centralized service
        await dataSync.refreshAll()

        // Also fetch available rigs and rig statuses
        await AppState.shared.fetchAvailableRigs()
        await fetchRigStatuses()

        isRefreshing = false
    }

    // MARK: - Rig Statuses

    /// Fetches rig statuses from the status API
    private func fetchRigStatuses() async {
        do {
            let status = try await apiClient.getStatus()
            rigStatuses = status.rigs.sorted { $0.name.lowercased() < $1.name.lowercased() }
        } catch {
            // Keep existing data on error
        }
    }

    // MARK: - Live Activity

    /// Syncs the Live Activity with current dashboard state.
    private func syncLiveActivity() async {
        #if os(iOS)
        guard #available(iOS 16.1, *) else { return }

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

        // Build agent summaries from active crew
        let agentSummaries: [AgentSummary] = activeCrewMembers.prefix(4).map { member in
            let statusStr: String
            switch member.status {
            case .working: statusStr = "working"
            case .blocked: statusStr = "blocked"
            case .stuck: statusStr = "blocked"
            case .idle: statusStr = "idle"
            case .offline: statusStr = "idle"
            }
            return AgentSummary(name: member.name, status: statusStr)
        }

        // Build bead summaries from in-progress beads
        let beadSummaries: [BeadSummary] = inProgressBeads.prefix(5).map { bead in
            BeadSummary(
                id: bead.id,
                title: bead.title,
                assignee: bead.assignee?.components(separatedBy: "/").last
            )
        }

        // Build recently completed bead summaries (only from last hour)
        let oneHourAgo = Date().addingTimeInterval(-3600)
        let recentClosed = recentClosedBeads.filter { bead in
            guard let updatedDate = bead.updatedDate else { return false }
            return updatedDate > oneHourAgo
        }
        let completedSummaries: [BeadSummary] = recentClosed.prefix(3).map { bead in
            BeadSummary(
                id: bead.id,
                title: bead.title,
                assignee: bead.assignee?.components(separatedBy: "/").last
            )
        }

        let state = LiveActivityService.createState(
            powerState: powerState,
            unreadMailCount: unreadCount,
            activeAgents: agentSummaries,
            beadsInProgress: beadSummaries,
            recentlyCompleted: completedSummaries
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

    /// Filters beads to only those relevant for OVERSEER view.
    /// Excludes internal workflow types like wisps, molecules, convoys, etc.
    private func isOverseerRelevant(_ bead: BeadInfo) -> Bool {
        // Types to exclude from OVERSEER view (internal workflow items)
        let excludedTypes = ["message", "epic", "convoy", "agent", "role", "witness", "wisp", "infrastructure", "coordination", "sync"]

        let typeLower = bead.type.lowercased()
        let idLower = bead.id.lowercased()
        let titleLower = bead.title.lowercased()

        // Exclude by type
        if excludedTypes.contains(typeLower) {
            return false
        }

        // Exclude if type/title/id contains "wisp" or ID starts with "mol-"
        if typeLower.contains("wisp") || titleLower.contains("wisp") ||
           idLower.contains("wisp") || idLower.hasPrefix("mol-") {
            return false
        }

        return true
    }
}
