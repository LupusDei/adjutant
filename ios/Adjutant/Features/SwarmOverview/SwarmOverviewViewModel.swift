import SwiftUI
import Combine
import AdjutantKit

/// Bridge warm-session state shown on the overview status line (adj-202.10.3).
public enum BridgeWarmState {
    case ready    // a pre-warmed avatar session is provisioned + validated — a tap connects fast
    case warming  // a session is provisioning in the background right now
    case idle     // nothing warm — a tap will start a new session (~5s)
    case unknown  // not yet fetched / backend unreachable
}

/// ViewModel for the Swarm Overview page — aggregated global dashboard.
@MainActor
final class SwarmOverviewViewModel: ObservableObject {
    // MARK: - Published State

    @Published var overview: GlobalOverviewResponse?
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var lastSuccessfulRefresh: Date?

    /// Session ID after a successful agent spawn (for navigation)
    @Published var spawnedSessionId: String?

    /// Whether the callsign picker sheet is showing (long-press spawn flow)
    @Published var showingCallsignPicker = false

    /// Whether a broadcast status request is in flight
    @Published var isBroadcasting = false

    /// Brief confirmation text shown after a successful broadcast
    @Published var broadcastResult: String?

    /// Recent timeline events for the overview (replaces epics — adj-156)
    @Published var timelineEvents: [TimelineEvent] = []

    /// Open questions scoped to the current project (adj-181.20).
    /// Empty when there are no open questions or when the fetch failed.
    /// Non-empty causes the Open Questions banner to appear above Agents.
    @Published private(set) var openQuestions: [AgentQuestion] = []

    /// Bridge warm-session state for the overview status line (adj-202.10.3): is a pre-warmed
    /// avatar session READY, currently WARMING, or IDLE (a tap starts a new one)?
    @Published private(set) var bridgeWarmState: BridgeWarmState = .unknown

    // MARK: - Dependencies

    private let apiClient: APIClient
    private var refreshTimer: Timer?
    private var warmStatusTimer: Timer?
    private var isRefreshing = false

    // MARK: - Init

    init(apiClient: APIClient? = nil) {
        self.apiClient = apiClient ?? AppState.shared.apiClient
    }

    // MARK: - Lifecycle

    func onAppear() {
        Task {
            await refresh()
        }
        Task { await refreshBridgeWarmStatus() }
        // Guard against duplicate timers if onAppear fires multiple times
        refreshTimer?.invalidate()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in
                await self.refresh()
            }
        }
        // A faster, lightweight poll JUST for the Bridge warm state so the status line reflects
        // idle → warming → ready promptly (the transition takes only ~5-7s).
        warmStatusTimer?.invalidate()
        warmStatusTimer = Timer.scheduledTimer(withTimeInterval: 4, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in await self.refreshBridgeWarmStatus() }
        }
    }

    func onDisappear() {
        refreshTimer?.invalidate()
        refreshTimer = nil
        warmStatusTimer?.invalidate()
        warmStatusTimer = nil
    }

    // MARK: - Bridge warm status (adj-202.10.3)

    private struct WarmStatusDTO: Decodable { let state: String }

    /// The avatar endpoints live at the ORIGIN root (like BridgePrewarmer), so strip the API path.
    private static func warmStatusURL() -> URL? {
        guard var c = URLComponents(url: AppState.shared.apiBaseURL, resolvingAgainstBaseURL: false) else { return nil }
        c.path = "/avatar/warm-status"
        c.query = nil
        return c.url
    }

    /// Best-effort poll of the backend's warm-session state. NEVER throws into the UI.
    func refreshBridgeWarmStatus() async {
        guard let url = Self.warmStatusURL() else { return }
        do {
            var req = URLRequest(url: url)
            req.timeoutInterval = 6
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard (resp as? HTTPURLResponse)?.statusCode == 200 else { bridgeWarmState = .unknown; return }
            switch try JSONDecoder().decode(WarmStatusDTO.self, from: data).state {
            case "ready": bridgeWarmState = .ready
            case "warming": bridgeWarmState = .warming
            case "idle": bridgeWarmState = .idle
            default: bridgeWarmState = .unknown
            }
        } catch {
            bridgeWarmState = .unknown
        }
    }

    // MARK: - Data Loading

    func refresh() async {
        // Skip if a refresh is already in flight
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        let isFirstLoad = overview == nil
        if isFirstLoad {
            isLoading = true
        }
        defer { isLoading = false }

        do {
            async let overviewTask = apiClient.getGlobalOverview()
            async let timelineTask = apiClient.getTimelineEvents(limit: 20)

            overview = try await overviewTask
            errorMessage = nil
            lastSuccessfulRefresh = Date()

            // Timeline is best-effort — don't fail the whole refresh if it errors
            if let response = try? await timelineTask {
                timelineEvents = response.events
            }
        } catch {
            errorMessage = userFriendlyMessage(for: error)
        }

        // Open questions fetch is best-effort — a failure must NOT break the overview.
        // Scope to the current project UUID when available; fall back to unscoped (all
        // open questions) when no project is selected.
        await fetchOpenQuestions()
    }

    /// Fetch open questions for the current project.
    ///
    /// Always resilient: errors set `openQuestions = []` and do not propagate.
    /// WS live updates (question:new/answered/dismissed) are a nice-to-have for v2;
    /// v1 relies on fetch-on-appear + 30-second timer refresh.
    private func fetchOpenQuestions() async {
        let projectId = AppState.shared.selectedProject?.id
        do {
            openQuestions = try await apiClient.listQuestions(
                status: .open,
                projectId: projectId
            )
        } catch {
            // Best-effort: keep whatever was there (or empty on first load)
            openQuestions = []
        }
    }

    /// Convert network errors to user-friendly messages.
    private func userFriendlyMessage(for error: Error) -> String {
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain {
            switch nsError.code {
            case NSURLErrorTimedOut:
                return "Request timed out. The server may be busy."
            case NSURLErrorCannotConnectToHost, NSURLErrorCannotFindHost:
                return "Cannot reach the server. Check your connection."
            case NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost:
                return "No internet connection."
            default:
                return "Network error. Pull down to retry."
            }
        }
        return error.localizedDescription
    }

    // MARK: - Agent Spawning

    /// Spawn a new agent.
    /// - Parameter callsign: Optional callsign name; nil for random assignment.
    func startAgent(callsign: String? = nil) async {
        // Use the first active project path for spawning, if available
        guard let projectPath = AppState.shared.selectedProject?.path
                ?? overview?.projects.first?.path else {
            errorMessage = "No projects available"
            return
        }

        // Agent spawning removed — API no longer supports this
        _ = projectPath
        errorMessage = "Agent spawning is not available in this deployment mode"
    }

    // MARK: - Broadcast Status Request

    /// Send "Send me an update" to all active agents.
    func triggerUpdate() async {
        isBroadcasting = true
        defer { isBroadcasting = false }

        do {
            let response = try await apiClient.broadcastStatusRequest()
            broadcastResult = "Pinged \(response.count) agent\(response.count == 1 ? "" : "s")"
            // Auto-dismiss after 2 seconds
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            broadcastResult = nil
            await refresh()
        } catch {
            errorMessage = "Broadcast failed: \(error.localizedDescription)"
        }
    }

    func clearError() {
        errorMessage = nil
    }
}
