//
//  DataSyncService.swift
//  Adjutant
//
//  Centralized data sync service. Uses SSE (Server-Sent Events) for real-time
//  updates when connected, with polling as automatic fallback.
//  ViewModels subscribe to data streams instead of polling independently.
//

import Foundation
import Combine
import AdjutantKit
import WidgetKit

/// Centralized service for syncing data from the backend.
/// Prefers SSE for real-time push updates; falls back to polling when SSE is disconnected.
/// ViewModels subscribe to receive data instead of polling independently.
@MainActor
public final class DataSyncService: ObservableObject {
    // MARK: - Singleton

    public static let shared = DataSyncService()

    // MARK: - Publishers

    /// Published mail messages (all messages)
    @Published public private(set) var mail: [Message] = []

    /// Published crew members
    @Published public private(set) var crew: [CrewMember] = []

    /// Published beads (all beads)
    @Published public private(set) var beads: [BeadInfo] = []

    /// Error message from last beads fetch, nil on success
    @Published public private(set) var beadsError: String?

    /// Last update timestamps
    @Published public private(set) var lastMailUpdate: Date?
    @Published public private(set) var lastCrewUpdate: Date?
    @Published public private(set) var lastBeadsUpdate: Date?

    /// Whether SSE is currently providing real-time updates
    @Published public private(set) var isStreamConnected = false

    // MARK: - Configuration

    /// Polling intervals (in seconds)
    public struct PollingIntervals {
        public var mail: TimeInterval = 30.0
        public var crew: TimeInterval = 30.0
        public var beads: TimeInterval = 30.0
    }

    public var pollingIntervals = PollingIntervals()

    /// TTL (time-to-live) for cached data (in seconds).
    /// API calls are skipped if cached data is newer than TTL.
    public struct CacheTTL {
        public var mail: TimeInterval = 25.0
        public var crew: TimeInterval = 25.0
        public var beads: TimeInterval = 25.0
    }

    public var cacheTTL = CacheTTL()

    // MARK: - Private Properties

    private var apiClient: APIClient { AppState.shared.apiClient }

    private var mailPollingTask: Task<Void, Never>?
    private var crewPollingTask: Task<Void, Never>?
    private var beadsPollingTask: Task<Void, Never>?

    /// Tracks which endpoints are currently being fetched to prevent duplicates
    private var isFetchingMail = false
    private var isFetchingCrew = false
    private var isFetchingBeads = false

    /// Last time WidgetCenter.reloadTimelines was called (throttled to max once per 30s)
    private var lastWidgetReloadTime: Date = .distantPast

    /// Subscriber counts for each endpoint (start polling when > 0)
    private var mailSubscriberCount = 0
    private var crewSubscriberCount = 0
    private var beadsSubscriberCount = 0

    /// SSE integration
    private let eventStream = EventStreamService.shared
    private var sseSubscriptions = Set<AnyCancellable>()

    // MARK: - Initialization

    private var priorityCancellable: AnyCancellable?

    /// Whether `start()` has been called. Guards against double-initialization.
    private var hasStarted = false

    /// Lightweight init: no cache loading, no SSE, no Combine subscriptions.
    /// Call start() after the first SwiftUI render to defer heavy work.
    private init() {}

    /// Performs deferred initialization: loads cache, sets up SSE integration,
    /// and observes communication priority changes. Idempotent -- safe to call multiple times.
    /// Call this after the first SwiftUI render (e.g., from a `.task {}` modifier or scene phase handler)
    /// to avoid blocking the main thread during app startup (~75-150ms savings).
    public func start() {
        guard !hasStarted else { return }
        hasStarted = true
        loadFromCache()
        setupSSEIntegration()
        observeCommunicationPriority()
    }

    /// Observes AppState communication priority changes and adjusts polling intervals
    private func observeCommunicationPriority() {
        // Apply initial priority
        applyPollingIntervals(for: AppState.shared.communicationPriority)

        // Observe changes
        priorityCancellable = AppState.shared.$communicationPriority
            .dropFirst()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] priority in
                self?.applyPollingIntervals(for: priority)
            }
    }

    /// Adjusts polling intervals based on communication priority
    private func applyPollingIntervals(for priority: CommunicationPriority) {
        switch priority {
        case .realTime:
            pollingIntervals = PollingIntervals(mail: 10.0, crew: 10.0, beads: 10.0)
            cacheTTL = CacheTTL(mail: 8.0, crew: 8.0, beads: 8.0)
        case .efficient:
            pollingIntervals = PollingIntervals(mail: 30.0, crew: 30.0, beads: 30.0)
            cacheTTL = CacheTTL(mail: 25.0, crew: 25.0, beads: 25.0)
        case .pollingOnly:
            pollingIntervals = PollingIntervals(mail: 120.0, crew: 120.0, beads: 120.0)
            cacheTTL = CacheTTL(mail: 100.0, crew: 100.0, beads: 100.0)
        }

        // Restart active polling tasks with new intervals (only if SSE is not active)
        if !isStreamConnected {
            resumePollingForActiveSubscribers()
        }
    }

    /// Loads cached data for immediate display
    private func loadFromCache() {
        let cache = ResponseCache.shared
        if cache.hasCache(for: .messages) {
            mail = cache.messages
        }
        if cache.hasCache(for: .crew) {
            crew = cache.crewMembers
        }
        if cache.hasCache(for: .beads) {
            beads = cache.beads
        }
    }

    // MARK: - SSE Integration

    private func setupSSEIntegration() {
        // Watch SSE connection state to toggle polling
        eventStream.$state
            .receive(on: DispatchQueue.main)
            .removeDuplicates()
            .sink { [weak self] state in
                guard let self else { return }
                let connected = state == .connected
                let wasConnected = self.isStreamConnected
                self.isStreamConnected = connected

                if connected && !wasConnected {
                    self.onSSEConnected()
                } else if !connected && wasConnected {
                    self.onSSEDisconnected()
                }
            }
            .store(in: &sseSubscriptions)

        // Subscribe to SSE events and trigger targeted refreshes
        eventStream.eventSubject
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                guard let self else { return }
                self.handleSSEEvent(event)
            }
            .store(in: &sseSubscriptions)
    }

    /// Called when SSE connects - pause polling timers, do initial fetch
    private func onSSEConnected() {
        print("[DataSyncService] SSE connected, pausing polling")
        stopAllPolling()
        // Fetch all data once to ensure we're in sync
        Task { await refreshAll() }
    }

    /// Called when SSE disconnects - resume polling for active subscribers
    private func onSSEDisconnected() {
        print("[DataSyncService] SSE disconnected, resuming polling fallback")
        resumePollingForActiveSubscribers()
    }

    /// Stop all polling timers (but keep subscriber counts)
    private func stopAllPolling() {
        stopMailPolling()
        stopCrewPolling()
        stopBeadsPolling()
    }

    /// Resume polling only for endpoints with active subscribers
    private func resumePollingForActiveSubscribers() {
        if mailSubscriberCount > 0 { startMailPolling() }
        if crewSubscriberCount > 0 { startCrewPolling() }
        if beadsSubscriberCount > 0 { startBeadsPolling() }
    }

    /// Route an SSE event to the appropriate fetch
    private func handleSSEEvent(_ event: ServerSentEvent) {
        switch event.event {
        case "bead_update":
            Task { await fetchBeads() }
        case "agent_status":
            Task { await fetchCrew() }
        case "connected":
            // Initial connection event from server, no action needed
            break
        default:
            break
        }
    }

    /// Start the SSE stream. Call once at app startup.
    public func startEventStream() {
        eventStream.start()
    }

    /// Stop the SSE stream.
    public func stopEventStream() {
        eventStream.stop()
    }

    // MARK: - Subscription Management

    /// Call when a ViewModel starts observing mail data.
    /// Starts polling if this is the first subscriber and SSE is not connected.
    public func subscribeMail() {
        mailSubscriberCount += 1
        if mailSubscriberCount == 1 {
            if isStreamConnected {
                // SSE is live; just fetch once, no polling timer needed
                Task { await fetchMail() }
            } else {
                // No SSE; start polling (which fetches immediately)
                startMailPolling()
            }
        }
    }

    /// Call when a ViewModel stops observing mail data.
    /// Stops polling when no subscribers remain.
    public func unsubscribeMail() {
        mailSubscriberCount = max(0, mailSubscriberCount - 1)
        if mailSubscriberCount == 0 {
            stopMailPolling()
        }
    }

    /// Call when a ViewModel starts observing crew data.
    public func subscribeCrew() {
        crewSubscriberCount += 1
        if crewSubscriberCount == 1 {
            if isStreamConnected {
                Task { await fetchCrew() }
            } else {
                startCrewPolling()
            }
        }
    }

    /// Call when a ViewModel stops observing crew data.
    public func unsubscribeCrew() {
        crewSubscriberCount = max(0, crewSubscriberCount - 1)
        if crewSubscriberCount == 0 {
            stopCrewPolling()
        }
    }

    /// Call when a ViewModel starts observing beads data.
    public func subscribeBeads() {
        beadsSubscriberCount += 1
        if beadsSubscriberCount == 1 {
            if isStreamConnected {
                Task { await fetchBeads() }
            } else {
                startBeadsPolling()
            }
        }
    }

    /// Call when a ViewModel stops observing beads data.
    public func unsubscribeBeads() {
        beadsSubscriberCount = max(0, beadsSubscriberCount - 1)
        if beadsSubscriberCount == 0 {
            stopBeadsPolling()
        }
    }

    // MARK: - Cache Freshness

    /// Returns true if mail cache is still fresh (within TTL)
    private func isMailCacheFresh() -> Bool {
        guard let lastUpdate = lastMailUpdate else { return false }
        return Date().timeIntervalSince(lastUpdate) < cacheTTL.mail
    }

    /// Returns true if crew cache is still fresh (within TTL)
    private func isCrewCacheFresh() -> Bool {
        guard let lastUpdate = lastCrewUpdate else { return false }
        return Date().timeIntervalSince(lastUpdate) < cacheTTL.crew
    }

    /// Returns true if beads cache is still fresh (within TTL)
    private func isBeadsCacheFresh() -> Bool {
        guard let lastUpdate = lastBeadsUpdate else { return false }
        return Date().timeIntervalSince(lastUpdate) < cacheTTL.beads
    }

    // MARK: - Manual Refresh

    /// Manually triggers a mail refresh. Safe to call multiple times (deduplicates).
    public func refreshMail() async {
        await fetchMail()
    }

    /// Manually triggers a crew refresh. Safe to call multiple times (deduplicates).
    public func refreshCrew() async {
        await fetchCrew()
    }

    /// Manually triggers a beads refresh. Safe to call multiple times (deduplicates).
    /// - Parameters:
    ///   - project: Optional project name to scope beads to. Pass "all" for all, nil defaults to "all".
    ///   - sort: Sort field (e.g., "updated", "priority", "created"). Defaults to "updated".
    ///   - order: Sort order ("asc" or "desc"). Defaults to "desc" for most-recently-active first.
    public func refreshBeads(project: String? = nil, sort: String? = nil, order: String? = nil) async {
        await fetchBeads(project: project, sort: sort, order: order)
    }

    /// Refreshes all endpoints, skipping those with fresh cache data.
    /// This reduces concurrent API calls by only fetching stale data.
    public func refreshAll() async {
        async let mailTask: () = refreshMailIfStale()
        async let crewTask: () = refreshCrewIfStale()
        async let beadsTask: () = refreshBeadsIfStale()
        _ = await (mailTask, crewTask, beadsTask)
    }

    /// Fetches mail only if cache is stale
    private func refreshMailIfStale() async {
        guard !isMailCacheFresh() else { return }
        await fetchMail()
    }

    /// Fetches crew only if cache is stale
    private func refreshCrewIfStale() async {
        guard !isCrewCacheFresh() else { return }
        await fetchCrew()
    }

    /// Fetches beads only if cache is stale
    private func refreshBeadsIfStale() async {
        guard !isBeadsCacheFresh() else { return }
        await fetchBeads()
    }

    // MARK: - Polling Control

    private func startMailPolling() {
        stopMailPolling()

        // Fetch immediately
        Task { await fetchMail() }

        // Start polling
        mailPollingTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(pollingIntervals.mail * 1_000_000_000))
                guard !Task.isCancelled else { break }
                await fetchMail()
            }
        }
    }

    private func stopMailPolling() {
        mailPollingTask?.cancel()
        mailPollingTask = nil
    }

    private func startCrewPolling() {
        stopCrewPolling()

        // Fetch immediately
        Task { await fetchCrew() }

        // Start polling
        crewPollingTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(pollingIntervals.crew * 1_000_000_000))
                guard !Task.isCancelled else { break }
                await fetchCrew()
            }
        }
    }

    private func stopCrewPolling() {
        crewPollingTask?.cancel()
        crewPollingTask = nil
    }

    private func startBeadsPolling() {
        stopBeadsPolling()

        // Fetch immediately
        Task { await fetchBeads() }

        // Start polling
        beadsPollingTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(pollingIntervals.beads * 1_000_000_000))
                guard !Task.isCancelled else { break }
                await fetchBeads()
            }
        }
    }

    private func stopBeadsPolling() {
        beadsPollingTask?.cancel()
        beadsPollingTask = nil
    }

    // MARK: - Widget Reload Throttling

    /// Reloads widget timelines at most once per 30 seconds.
    /// Multiple crew/beads fetches on foreground transition would otherwise
    /// trigger rapid redundant widget reloads on the main thread.
    private func throttledWidgetReload() {
        let now = Date()
        guard now.timeIntervalSince(lastWidgetReloadTime) > 30.0 else { return }
        lastWidgetReloadTime = now
        WidgetCenter.shared.reloadTimelines(ofKind: "AdjutantWidget")
    }

    // MARK: - Fetch Methods (Deduplicated)

    private func fetchMail() async {
        // Mail endpoint removed — mail data now comes from chat/messaging system
        // Keep stub for subscriber compatibility
        lastMailUpdate = Date()
    }

    private func fetchCrew() async {
        guard !isFetchingCrew else { return }
        isFetchingCrew = true
        defer { isFetchingCrew = false }

        do {
            let agents = try await apiClient.getAgents()
            crew = agents
            lastCrewUpdate = Date()

            // Update cache
            ResponseCache.shared.updateCrewMembers(agents)
            throttledWidgetReload()

            // Auto-adjust communication priority based on agent activity
            let hasActiveAgents = agents.contains { $0.status == .working || $0.status == .blocked }
            let currentPriority = AppState.shared.communicationPriority

            if hasActiveAgents && currentPriority == .efficient {
                // Switch to realTime when agents are active
                AppState.shared.communicationPriority = .realTime
            } else if !hasActiveAgents && currentPriority == .realTime {
                // Switch back to efficient when all agents are idle/offline
                AppState.shared.communicationPriority = .efficient
            }

        } catch {
            print("[DataSyncService] Crew fetch failed: \(error.localizedDescription)")
        }
    }

    private func fetchBeads(project: String? = nil, sort: String? = nil, order: String? = nil) async {
        guard !isFetchingBeads else { return }
        isFetchingBeads = true
        defer { isFetchingBeads = false }

        do {
            // Sort by updated date descending by default so recently-active beads appear first
            let effectiveSort = sort ?? "updated"
            let effectiveOrder = order ?? "desc"
            // Two-phase fetch to avoid the 500-bead API limit:
            // 1. All active beads (open + in_progress + blocked) — typically ~100-200
            // 2. Last 300 closed beads for the Kanban CLOSED column
            // This replaces the old status=all approach which silently dropped older
            // open tasks/bugs when total beads exceeded the 500 limit.
            async let activeResponse = apiClient.getBeads(status: .default, sort: effectiveSort, order: effectiveOrder, project: project)
            async let closedResponse = apiClient.getBeads(status: .closed, limit: 300, sort: "updated", order: "desc", project: project)

            let (active, closed) = try await (activeResponse, closedResponse)
            let combined = active + closed

            // Sort off the main actor to avoid blocking UI during large bead lists
            let sorted = await Task.detached(priority: .userInitiated) {
                combined.sorted {
                    if $0.priority != $1.priority {
                        return $0.priority < $1.priority
                    }
                    return ($0.updatedDate ?? $0.createdDate ?? Date.distantPast) >
                           ($1.updatedDate ?? $1.createdDate ?? Date.distantPast)
                }
            }.value

            beads = sorted
            beadsError = nil
            lastBeadsUpdate = Date()

            // Update cache
            ResponseCache.shared.updateBeads(sorted)
            throttledWidgetReload()

        } catch {
            print("[DataSyncService] Beads fetch failed: \(error.localizedDescription)")
            // Clear stale data and surface error so UI doesn't show previous project's beads
            beads = []
            beadsError = error.localizedDescription
        }
    }

    // MARK: - Filtered Data Accessors

    /// Returns mail filtered by project prefix
    public func mail(forProject project: String?) -> [Message] {
        guard let project = project else { return mail }
        let projectPrefix = project.lowercased() + "/"
        return mail.filter { message in
            message.from.lowercased().hasPrefix(projectPrefix) ||
            message.to.lowercased().hasPrefix(projectPrefix)
        }
    }

    /// Returns all crew members
    public func crew(forProject project: String?) -> [CrewMember] {
        return crew
    }

    /// Returns beads filtered by project
    public func beads(forProject project: String?) -> [BeadInfo] {
        guard let project = project else { return beads }
        return beads.filter { $0.source == project }
    }

    /// Returns beads filtered by status
    public func beads(status: String?) -> [BeadInfo] {
        guard let status = status else { return beads }
        return beads.filter { $0.status == status }
    }

    /// Returns beads filtered by project and status
    public func beads(forProject project: String?, status: String?) -> [BeadInfo] {
        var result = beads
        if let project = project {
            result = result.filter { $0.source == project }
        }
        if let status = status {
            result = result.filter { $0.status == status }
        }
        return result
    }

    // MARK: - Statistics

    /// Returns the current sync status for debugging
    public var pollingStatus: String {
        let sseStatus = isStreamConnected ? "SSE connected" : "SSE disconnected"
        let mailStatus = mailPollingTask != nil ? "polling (\(mailSubscriberCount) subs)" : "idle (\(mailSubscriberCount) subs)"
        let crewStatus = crewPollingTask != nil ? "polling (\(crewSubscriberCount) subs)" : "idle (\(crewSubscriberCount) subs)"
        let beadsStatus = beadsPollingTask != nil ? "polling (\(beadsSubscriberCount) subs)" : "idle (\(beadsSubscriberCount) subs)"
        return "\(sseStatus) | Mail: \(mailStatus), Crew: \(crewStatus), Beads: \(beadsStatus)"
    }
}
