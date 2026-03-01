import Foundation
import Combine
import AdjutantKit
import ActivityKit
import WidgetKit

/// ViewModel for the Dashboard view, coordinating Beads, Crew, and Mail data.
/// Uses a single GET /api/dashboard batch endpoint instead of multiple individual requests.
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

    /// Recently closed beads
    @Published private(set) var recentClosedBeads: [BeadInfo] = []

    /// Unread messages grouped by agent (max 8)
    @Published private(set) var unreadMessages: [UnreadAgentSummary] = []

    /// In-progress tasks (non-epic beads)
    @Published private(set) var inProgressTasks: [BeadInfo] = []

    /// Recently completed tasks (non-epic beads)
    @Published private(set) var recentCompletedTasks: [BeadInfo] = []

    /// In-progress epics
    @Published private(set) var inProgressEpics: [DashboardEpicItem] = []

    /// Recently completed epics
    @Published private(set) var completedEpics: [DashboardEpicItem] = []

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
            let cachedMail = cache.dashboardMail.filter { isOverseerMail($0) }
            recentMail = cachedMail
            crewMembers = cache.dashboardCrew
            unreadCount = recentMail.filter { !$0.read }.count
        }
        let cachedBeads = cache.beads
        if !cachedBeads.isEmpty {
            recentBeads = sortBeadsByRecency(cachedBeads)
        }
    }

    deinit {
        // Cleanup handled by cancellables
    }

    // MARK: - Lifecycle

    override func onAppear() {
        // Don't call super.onAppear() — we manage our own single fetch
        // Use startTrackedTask so the task is cancelled on onDisappear
        startTrackedTask {
            await self.refresh()
        }
    }

    override func onDisappear() {
        super.onDisappear()
    }

    // MARK: - Data Loading

    override func refresh() async {
        isRefreshing = true
        await fetchDashboard()
        isRefreshing = false
    }

    /// Fetches all dashboard data in a single batch request
    private func fetchDashboard() async {
        do {
            let response = try await apiClient.getDashboard()
            errorMessage = nil
            processDashboardResponse(response)
        } catch is CancellationError {
            // Task was cancelled (e.g., view disappeared), don't update state
        } catch {
            // Keep existing data but surface the error
            handleError(error)
        }
    }

    /// Processes the batch dashboard response, updating all published properties
    private func processDashboardResponse(_ response: DashboardResponse) {
        // Beads section
        if let beadsData = response.beads.data {
            processBeadsData(beadsData)
        }

        // Unread messages grouped by agent
        if let summaries = response.unreadMessages?.data {
            unreadMessages = summaries
        }

        // Epics section
        if let epicsData = response.epics.data {
            inProgressEpics = epicsData.inProgress.items
            completedEpics = epicsData.completed.items
        }

        // Mail section
        if let mailData = response.mail.data {
            processMailData(mailData)
        }

        // Crew section
        if let crew = response.crew.data {
            crewMembers = crew
        }

        // Update cache for other views
        ResponseCache.shared.updateDashboard(
            mail: recentMail,
            crew: crewMembers
        )

        // Sync Live Activity + Widgets
        Task<Void, Never> { await syncLiveActivity() }
        WidgetCenter.shared.reloadTimelines(ofKind: "AdjutantWidget")
    }

    /// Processes beads data from the dashboard response
    private func processBeadsData(_ data: DashboardBeadsData) {
        // Combine all beads for filtering
        let allBeads = data.inProgress.items + data.open.items + data.closed.items
        let filtered = allBeads.filter { isOverseerRelevant($0) }

        let inProgress = filtered.filter { $0.status == "in_progress" }
            .sorted { ($0.updatedDate ?? .distantPast) > ($1.updatedDate ?? .distantPast) }
        self.inProgressBeads = Array(inProgress.prefix(maxBeadsPerColumn))

        let closed = filtered.filter { $0.status == "closed" }
            .sorted { ($0.updatedDate ?? .distantPast) > ($1.updatedDate ?? .distantPast) }
        self.recentClosedBeads = Array(closed.prefix(maxBeadsPerColumn))

        self.recentBeads = sortBeadsByRecency(filtered)

        // Tasks (non-epic beads) for the overview widget
        let tasks = allBeads.filter { $0.type != "epic" }
        self.inProgressTasks = tasks.filter { $0.status == "in_progress" }
            .sorted { ($0.updatedDate ?? .distantPast) > ($1.updatedDate ?? .distantPast) }
        self.recentCompletedTasks = Array(tasks.filter { $0.status == "closed" }
            .sorted { ($0.updatedDate ?? .distantPast) > ($1.updatedDate ?? .distantPast) }
            .prefix(maxBeadsPerColumn))

        // Update beads cache
        ResponseCache.shared.updateBeads(allBeads)
    }

    /// Processes mail data from the dashboard response
    private func processMailData(_ data: DashboardMailSummary) {
        let filteredMail = data.recentMessages.filter { isOverseerMail($0) }
        self.recentMail = Array(filteredMail.prefix(maxRecentMail))
        self.unreadCount = data.unreadCount
        AppState.shared.updateUnreadMailCount(self.unreadCount)
    }

    // MARK: - Live Activity

    /// Syncs the Live Activity with current dashboard state.
    private func syncLiveActivity() async {
        #if os(iOS)
        guard #available(iOS 16.1, *) else { return }

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
            unreadMessageCount: unreadCount,
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

    /// Total count of active beads (in progress)
    var activeBeadsCount: Int {
        inProgressBeads.count
    }

    /// Count of beads in progress (for Live Activity)
    var beadsInProgress: Int {
        inProgressBeads.count
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

    /// Filters mail messages for OVERSEER view (excludes internal wisp/deacon sources)
    private func isOverseerMail(_ message: Message) -> Bool {
        let fromLower = message.from.lowercased()
        return !fromLower.hasPrefix("wisp/") && !fromLower.hasPrefix("deacon/")
    }

    /// Filters beads to only those relevant for OVERSEER view.
    /// Excludes internal workflow types like wisps, molecules, etc.
    private func isOverseerRelevant(_ bead: BeadInfo) -> Bool {
        // Types to exclude from OVERSEER view (internal workflow items)
        let excludedTypes = ["message", "epic", "agent", "role", "witness", "wisp", "infrastructure", "coordination", "sync"]

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
