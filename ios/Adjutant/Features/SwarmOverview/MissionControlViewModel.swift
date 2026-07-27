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

    /// The last successfully loaded rollup, if any (convenience for the view).
    var rollup: OverviewProjectsResponse? {
        if case let .loaded(response) = state { return response }
        return nil
    }

    /// Whether the ~30s poll timer is currently active (drives lifecycle tests).
    var isPolling: Bool { pollTimer != nil }

    // MARK: - Dependencies

    private let apiClient: APIClient
    private var pollTimer: Timer?
    private var isRefreshing = false

    /// Poll cadence — matches `SwarmOverviewViewModel` (spec: ~30s, no WebSocket in v1).
    private static let pollInterval: TimeInterval = 30

    // MARK: - Init

    init(apiClient: APIClient? = nil) {
        self.apiClient = apiClient ?? AppState.shared.apiClient
    }

    // MARK: - Lifecycle

    func onAppear() {
        Task { await refresh() }
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

    // MARK: - Data loading

    /// Fetch the portfolio rollup. Coalesces overlapping calls (pull-to-refresh + poll).
    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        // Show the loading state only on a true first load — a refresh over existing data
        // keeps the map on screen while it revalidates.
        if rollup == nil { state = .loading }

        do {
            let response = try await apiClient.getOverviewProjects()
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
