//
//  DataSyncService.swift
//  Adjutant
//
//  Centralized polling service to reduce duplicate API requests.
//  ViewModels subscribe to data streams instead of polling independently.
//

import Foundation
import Combine
import AdjutantKit

/// Centralized service for polling API endpoints.
/// Maintains single polling timers per endpoint and publishes updates via Combine.
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

    /// Last update timestamps
    @Published public private(set) var lastMailUpdate: Date?
    @Published public private(set) var lastCrewUpdate: Date?
    @Published public private(set) var lastBeadsUpdate: Date?

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

    /// Subscriber counts for each endpoint (start polling when > 0)
    private var mailSubscriberCount = 0
    private var crewSubscriberCount = 0
    private var beadsSubscriberCount = 0

    // MARK: - Initialization

    private init() {
        loadFromCache()
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

    // MARK: - Subscription Management

    /// Call when a ViewModel starts observing mail data.
    /// Starts polling if this is the first subscriber.
    public func subscribeMail() {
        mailSubscriberCount += 1
        if mailSubscriberCount == 1 {
            startMailPolling()
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
            startCrewPolling()
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
            startBeadsPolling()
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
    public func refreshBeads() async {
        await fetchBeads()
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

    // MARK: - Fetch Methods (Deduplicated)

    private func fetchMail() async {
        // Deduplicate: skip if already fetching
        guard !isFetchingMail else { return }
        isFetchingMail = true
        defer { isFetchingMail = false }

        do {
            let response = try await apiClient.getMail(all: true)
            let sorted = response.items.sorted {
                ($0.date ?? Date.distantPast) > ($1.date ?? Date.distantPast)
            }
            mail = sorted
            lastMailUpdate = Date()

            // Update cache
            ResponseCache.shared.updateMessages(sorted)

            // Process notifications
            await NotificationService.shared.processNewMessages(response.items)

            // Announce overseer-directed mail
            await OverseerMailAnnouncer.shared.processMessages(response.items)

        } catch {
            print("[DataSyncService] Mail fetch failed: \(error.localizedDescription)")
        }
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

        } catch {
            print("[DataSyncService] Crew fetch failed: \(error.localizedDescription)")
        }
    }

    private func fetchBeads() async {
        guard !isFetchingBeads else { return }
        isFetchingBeads = true
        defer { isFetchingBeads = false }

        do {
            // Fetch all beads (rig filtering done client-side)
            let response = try await apiClient.getBeads(rig: "all", status: .all)
            let sorted = response.sorted {
                if $0.priority != $1.priority {
                    return $0.priority < $1.priority
                }
                return ($0.updatedDate ?? $0.createdDate ?? Date.distantPast) >
                       ($1.updatedDate ?? $1.createdDate ?? Date.distantPast)
            }
            beads = sorted
            lastBeadsUpdate = Date()

            // Update cache
            ResponseCache.shared.updateBeads(sorted)

        } catch {
            print("[DataSyncService] Beads fetch failed: \(error.localizedDescription)")
        }
    }

    // MARK: - Filtered Data Accessors

    /// Returns mail filtered by rig prefix
    public func mail(forRig rig: String?) -> [Message] {
        guard let rig = rig else { return mail }
        let rigPrefix = rig.lowercased() + "/"
        return mail.filter { message in
            message.from.lowercased().hasPrefix(rigPrefix) ||
            message.to.lowercased().hasPrefix(rigPrefix)
        }
    }

    /// Returns crew filtered by rig
    public func crew(forRig rig: String?) -> [CrewMember] {
        guard let rig = rig else { return crew }
        return crew.filter { $0.rig == rig }
    }

    /// Returns beads filtered by rig
    public func beads(forRig rig: String?) -> [BeadInfo] {
        guard let rig = rig else { return beads }
        return beads.filter { $0.source == rig }
    }

    /// Returns beads filtered by status
    public func beads(status: String?) -> [BeadInfo] {
        guard let status = status else { return beads }
        return beads.filter { $0.status == status }
    }

    /// Returns beads filtered by rig and status
    public func beads(forRig rig: String?, status: String?) -> [BeadInfo] {
        var result = beads
        if let rig = rig {
            result = result.filter { $0.source == rig }
        }
        if let status = status {
            result = result.filter { $0.status == status }
        }
        return result
    }

    // MARK: - Statistics

    /// Returns the current polling status for debugging
    public var pollingStatus: String {
        let mailStatus = mailPollingTask != nil ? "active (\(mailSubscriberCount) subs)" : "stopped"
        let crewStatus = crewPollingTask != nil ? "active (\(crewSubscriberCount) subs)" : "stopped"
        let beadsStatus = beadsPollingTask != nil ? "active (\(beadsSubscriberCount) subs)" : "stopped"
        return "Mail: \(mailStatus), Crew: \(crewStatus), Beads: \(beadsStatus)"
    }
}
