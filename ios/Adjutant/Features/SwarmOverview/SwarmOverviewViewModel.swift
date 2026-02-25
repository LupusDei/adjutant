import SwiftUI
import Combine
import AdjutantKit

/// ViewModel for the Swarm Overview page — aggregated project dashboard.
@MainActor
final class SwarmOverviewViewModel: ObservableObject {
    // MARK: - Published State

    @Published var overview: ProjectOverviewResponse?
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var lastSuccessfulRefresh: Date?

    /// Session ID after a successful agent spawn (for navigation)
    @Published var spawnedSessionId: String?

    /// Whether the callsign picker sheet is showing (long-press spawn flow)
    @Published var showingCallsignPicker = false

    // MARK: - Dependencies

    private let apiClient: APIClient
    private var refreshTimer: Timer?

    // MARK: - Init

    init(apiClient: APIClient? = nil) {
        self.apiClient = apiClient ?? AppState.shared.apiClient
    }

    // MARK: - Lifecycle

    func onAppear() {
        Task {
            await loadActiveProject()
            await refresh()
        }
        // Guard against duplicate timers if onAppear fires multiple times
        refreshTimer?.invalidate()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
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
        guard let projectId = activeProjectId else {
            errorMessage = "No active project"
            return
        }

        let isFirstLoad = overview == nil
        if isFirstLoad {
            isLoading = true
        }
        defer { isLoading = false }

        do {
            overview = try await apiClient.getProjectOverview(projectId: projectId)
            errorMessage = nil
            lastSuccessfulRefresh = Date()
        } catch {
            // On first load, show the error immediately
            // On subsequent loads, keep stale data visible with a banner
            if isFirstLoad {
                errorMessage = userFriendlyMessage(for: error)
            } else {
                errorMessage = userFriendlyMessage(for: error)
            }
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

    /// Spawn a new agent for the active project.
    /// - Parameter callsign: Optional callsign name; nil for random assignment.
    func startAgent(callsign: String? = nil) async {
        guard let projectPath = activeProjectPath else {
            errorMessage = "No active project"
            return
        }

        do {
            let response = try await apiClient.spawnPolecat(projectPath: projectPath, callsign: callsign)
            spawnedSessionId = response.sessionId
            await refresh()
        } catch {
            errorMessage = "Spawn failed: \(error.localizedDescription)"
        }
    }

    // MARK: - Helpers

    /// The active project ID from the overview data or fetched from API.
    private var activeProjectId: String? {
        if let id = overview?.project.id {
            return id
        }
        // Fall back to fetching projects — the overview itself needs an ID
        // We'll use a cached approach: try to get from the last known overview,
        // or fall back to fetching projects list synchronously isn't possible,
        // so we store it after first successful fetch.
        return _cachedProjectId
    }

    /// The active project path for spawning agents.
    private var activeProjectPath: String? {
        overview?.project.path
    }

    /// Cached project ID set during initial load.
    private var _cachedProjectId: String?

    /// Bootstrap: fetch the active project ID if we don't have one yet.
    func loadActiveProject() async {
        guard _cachedProjectId == nil else { return }
        do {
            let projects = try await apiClient.getProjects()
            if let active = projects.first(where: { $0.active }) {
                _cachedProjectId = active.id
            } else if let first = projects.first {
                _cachedProjectId = first.id
            }
        } catch {
            // Will surface as "No active project" on refresh
        }
    }

    func clearError() {
        errorMessage = nil
    }
}
