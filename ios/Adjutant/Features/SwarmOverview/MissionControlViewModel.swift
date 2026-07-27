import SwiftUI
import Combine
import AdjutantKit

/// The load state of the Mission Control map (adj-208.2.3).
enum MissionControlState: Equatable {
    case loading
    case loaded(OverviewProjectsResponse)
    case error(String)
}

/// ViewModel for the Mission Control map — fetches the portfolio rollup, exposes a
/// loading/loaded/error state, supports pull-to-refresh, and runs a ~30s poll while visible.
///
/// Mirrors `SwarmOverviewViewModel` conventions: `@MainActor` `ObservableObject`, injectable
/// `APIClient`, timer-based poll started in `onAppear` / torn down in `onDisappear`. Resilient
/// like the overview — a poll failure after a good load keeps the last rollup on screen rather
/// than blanking the map (only a first-load failure surfaces `.error`).
@MainActor
final class MissionControlViewModel: ObservableObject {
    // MARK: - Published state

    @Published private(set) var state: MissionControlState = .loading

    /// The persisted project selection (epic adj-209, US2).
    ///
    /// `nil` is the default and means **all projects** — no `projectIds` filter is sent,
    /// so the server returns everything. A non-nil `Set` is an *explicit* selection and may
    /// be empty (deselect-all → show nothing). The distinction between `nil` (all) and `[]`
    /// (none) is intentional and is preserved across launches.
    @Published private(set) var selectedProjectIds: Set<String>?

    /// The FULL, unfiltered project universe (id + name) for the selector (adj-209.3.2.1).
    ///
    /// Sourced from the cheap `GET /api/projects` (≈10ms) — deliberately NOT from the map
    /// rollup: a server-side `projectIds` filter makes the rollup contain only the *selected*
    /// projects, so a user could never re-enable a project they deselected. This keeps the fast
    /// filtered rollup for the MAP while giving the selector every project to toggle.
    @Published private(set) var allProjects: [Project] = []

    /// The last successfully loaded rollup, if any (convenience for the view).
    var rollup: OverviewProjectsResponse? {
        if case let .loaded(response) = state { return response }
        return nil
    }

    /// The rollup projects the map should render, filtered by ``selectedProjectIds``.
    ///
    /// The server-side `projectIds` filter is a performance hint; this client-side filter is
    /// the source of truth for *what is shown*, so a just-toggled selection is honored
    /// immediately (and `deselect-all` correctly shows nothing even though an empty filter
    /// makes the server return all).
    var visibleProjects: [ProjectStreamRollup] {
        guard let projects = rollup?.projects else { return [] }
        guard let selected = selectedProjectIds else { return projects } // nil == all
        return projects.filter { selected.contains($0.projectId) }
    }

    /// `true` when no explicit selection is set (the default "all projects" state).
    var isAllSelected: Bool { selectedProjectIds == nil }

    /// Whether a given project is currently selected. With no explicit selection (all),
    /// every project reads as selected.
    func isSelected(_ projectId: String) -> Bool {
        selectedProjectIds?.contains(projectId) ?? true
    }

    /// The in-progress feature nodes for a project, or `[]` if the project is absent
    /// from the current rollup (epic adj-209, US2 — per-feature intensity).
    func features(for projectId: String) -> [FeatureRollup] {
        rollup?.projects.first { $0.projectId == projectId }?.features ?? []
    }

    /// Whether the ~30s poll timer is currently active (drives lifecycle tests).
    var isPolling: Bool { pollTimer != nil }

    // MARK: - Dependencies

    private let apiClient: APIClient
    private let defaults: UserDefaults
    private var pollTimer: Timer?
    private var isRefreshing = false

    /// Poll cadence — matches `SwarmOverviewViewModel` (spec: ~30s, no WebSocket in v1).
    private static let pollInterval: TimeInterval = 30

    /// UserDefaults key for the persisted selection. Absent key == default (all).
    private static let selectionDefaultsKey = "missionControl.selectedProjectIds.v1"

    // MARK: - Init

    init(apiClient: APIClient? = nil, defaults: UserDefaults = .standard) {
        self.apiClient = apiClient ?? AppState.shared.apiClient
        self.defaults = defaults
        // Load a persisted selection, if any. A missing key stays nil (all projects);
        // a stored (possibly empty) array is an explicit selection.
        if let stored = defaults.array(forKey: Self.selectionDefaultsKey) as? [String] {
            selectedProjectIds = Set(stored)
        } else {
            selectedProjectIds = nil
        }
    }

    // MARK: - Lifecycle

    func onAppear() {
        Task { await refresh() }
        Task { await loadAllProjects() }   // full universe for the selector (adj-209.3.2.1)
        // Guard against duplicate timers if onAppear fires more than once.
        pollTimer?.invalidate()
        pollTimer = Timer.scheduledTimer(withTimeInterval: Self.pollInterval, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in await self.refresh() }
        }
    }

    func onDisappear() {
        pollTimer?.invalidate()
        pollTimer = nil
    }

    // MARK: - Selection (persisted)
    //
    // These mutate + persist the selection SYNCHRONOUSLY but do NOT auto-refresh — the
    // caller (selector UI / poll / pull-to-refresh) drives `refresh()` so the fetch cadence
    // stays in one place and tests remain deterministic. `refresh()` always reads the
    // current selection, so the next poll picks up a change even without an explicit call.

    /// Set the explicit selection. `nil` restores the default (all projects); a `Set`
    /// (possibly empty) is an explicit selection. Persists immediately.
    func setSelectedProjectIds(_ ids: Set<String>?) {
        selectedProjectIds = ids
        persistSelection()
    }

    /// Reset to the default — all projects (clears the persisted value).
    func selectAll() {
        setSelectedProjectIds(nil)
    }

    /// Explicitly select nothing (deselect-all). Distinct from ``selectAll()``.
    func deselectAll() {
        setSelectedProjectIds([])
    }

    /// Toggle a single project's membership.
    ///
    /// The "universe" of togglable projects is the current rollup's projects, so toggling a
    /// project OFF from the default "all" state materializes the full set minus that id.
    /// Re-selecting every project collapses back to the canonical all == `nil`.
    func toggleProject(_ projectId: String) {
        let universe = Set(rollup?.projects.map(\.projectId) ?? [])
        var next = selectedProjectIds ?? universe
        if next.contains(projectId) {
            next.remove(projectId)
        } else {
            next.insert(projectId)
        }
        // Collapse a full selection back to the canonical "all" (nil) for tidy persistence.
        if !universe.isEmpty && next == universe {
            setSelectedProjectIds(nil)
        } else {
            setSelectedProjectIds(next)
        }
    }

    private func persistSelection() {
        if let ids = selectedProjectIds {
            // Sorted for a stable on-disk representation.
            defaults.set(ids.sorted(), forKey: Self.selectionDefaultsKey)
        } else {
            defaults.removeObject(forKey: Self.selectionDefaultsKey)
        }
    }

    /// The `projectIds` filter to send for the current selection: `nil` (all) sends no
    /// filter; an explicit selection sends its sorted ids.
    private var selectionFilter: [String]? {
        selectedProjectIds.map { $0.sorted() }
    }

    // MARK: - Data loading

    /// Load the full unfiltered project universe for the selector (adj-209.3.2.1). Cheap and
    /// idempotent; resilient — a failure keeps the last good list rather than clearing it.
    /// Call on appear and when opening the selector (the project set changes rarely).
    func loadAllProjects() async {
        do {
            allProjects = try await apiClient.getProjects()
        } catch {
            // Keep the last good list; the selector simply shows what it last knew.
        }
    }

    /// Fetch the portfolio rollup. Coalesces overlapping calls (pull-to-refresh + poll).
    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        // Show the loading state only on a true first load — a refresh over existing data
        // keeps the map on screen while it revalidates.
        if rollup == nil { state = .loading }

        do {
            let response = try await apiClient.getOverviewProjects(projectIds: selectionFilter)
            state = .loaded(response)
        } catch {
            // Resilient: keep the last good rollup if we have one; only a cold failure errors.
            if rollup == nil {
                state = .error(Self.userFriendlyMessage(for: error))
            }
        }
    }

    // MARK: - Error mapping

    private static func userFriendlyMessage(for error: Error) -> String {
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
}
