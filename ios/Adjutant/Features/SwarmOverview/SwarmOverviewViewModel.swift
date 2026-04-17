import SwiftUI
import Combine
import AdjutantKit

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

    // MARK: - Dependencies

    private let apiClient: APIClient
    private var refreshTimer: Timer?
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
        // Guard against duplicate timers if onAppear fires multiple times
        refreshTimer?.invalidate()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in
                await self.refresh()
            }
        }
    }

    func onDisappear() {
        refreshTimer?.invalidate()
        refreshTimer = nil
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
