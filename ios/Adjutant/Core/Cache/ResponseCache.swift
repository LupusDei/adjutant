//
//  ResponseCache.swift
//  Adjutant
//
//  Simple in-memory cache for API responses to enable instant display on navigation.
//

import Foundation
import AdjutantKit

/// A simple in-memory cache for API responses.
/// Allows views to display cached data immediately while fetching fresh data.
@MainActor
final class ResponseCache {
    // MARK: - Singleton

    static let shared = ResponseCache()

    // MARK: - Cached Data

    /// Cached mail messages
    private(set) var messages: [Message] = []

    /// Cached crew members
    private(set) var crewMembers: [CrewMember] = []

    /// Cached convoys (deprecated, use epics)
    private(set) var convoys: [Convoy] = []

    /// Cached epics
    private(set) var epics: [BeadInfo] = []

    /// Cached beads
    private(set) var beads: [BeadInfo] = []

    /// Cached chat messages (same type as mail messages)
    private(set) var chatMessages: [Message] = []

    /// Cached dashboard data
    private(set) var dashboardMail: [Message] = []
    private(set) var dashboardCrew: [CrewMember] = []
    private(set) var dashboardConvoys: [Convoy] = []

    // MARK: - Timestamps & TTL

    /// Last update time for each cache type
    private var lastUpdated: [CacheType: Date] = [:]

    enum CacheType: CaseIterable {
        case messages
        case crew
        case convoys
        case epics
        case beads
        case chat
        case dashboard
    }

    /// Default TTL (time-to-live) in seconds for each cache type.
    /// Shorter TTLs for frequently-changing data, longer for stable data.
    private let defaultTTL: [CacheType: TimeInterval] = [
        .messages: 60,      // Mail changes frequently
        .crew: 300,         // Crew relatively stable (5 min)
        .convoys: 120,      // Convoys update moderately
        .epics: 120,        // Epics update moderately
        .beads: 60,         // Beads change frequently
        .chat: 30,          // Chat needs freshness
        .dashboard: 60      // Dashboard moderate refresh
    ]

    // MARK: - Initialization

    private init() {}

    // MARK: - Update Methods

    /// Updates the cached mail messages
    func updateMessages(_ messages: [Message]) {
        self.messages = messages
        lastUpdated[.messages] = Date()
    }

    /// Updates the cached crew members
    func updateCrewMembers(_ crew: [CrewMember]) {
        self.crewMembers = crew
        lastUpdated[.crew] = Date()
    }

    /// Updates the cached convoys
    func updateConvoys(_ convoys: [Convoy]) {
        self.convoys = convoys
        lastUpdated[.convoys] = Date()
    }

    /// Updates the cached epics
    func updateEpics(_ epics: [BeadInfo]) {
        self.epics = epics
        lastUpdated[.epics] = Date()
    }

    /// Updates the cached beads
    func updateBeads(_ beads: [BeadInfo]) {
        self.beads = beads
        lastUpdated[.beads] = Date()
    }

    /// Updates the cached chat messages
    func updateChatMessages(_ messages: [Message]) {
        self.chatMessages = messages
        lastUpdated[.chat] = Date()
    }

    /// Updates the cached dashboard data
    func updateDashboard(mail: [Message], crew: [CrewMember], convoys: [Convoy]) {
        self.dashboardMail = mail
        self.dashboardCrew = crew
        self.dashboardConvoys = convoys
        lastUpdated[.dashboard] = Date()
    }

    // MARK: - Query Methods

    /// Returns whether cache has data for a given type
    func hasCache(for type: CacheType) -> Bool {
        switch type {
        case .messages: return !messages.isEmpty
        case .crew: return !crewMembers.isEmpty
        case .convoys: return !convoys.isEmpty
        case .epics: return !epics.isEmpty
        case .beads: return !beads.isEmpty
        case .chat: return !chatMessages.isEmpty
        case .dashboard: return !dashboardMail.isEmpty || !dashboardCrew.isEmpty
        }
    }

    /// Returns the age of cache in seconds, or nil if no cache exists
    func cacheAge(for type: CacheType) -> TimeInterval? {
        guard let updated = lastUpdated[type] else { return nil }
        return Date().timeIntervalSince(updated)
    }

    /// Returns whether cache exists AND is still valid (not expired).
    /// This is the primary method callers should use to check cache validity.
    func isValid(for type: CacheType) -> Bool {
        guard hasCache(for: type) else { return false }
        guard let age = cacheAge(for: type) else { return false }
        let ttl = defaultTTL[type] ?? 60
        return age < ttl
    }

    /// Returns the TTL for a cache type in seconds
    func ttl(for type: CacheType) -> TimeInterval {
        defaultTTL[type] ?? 60
    }

    /// Invalidates expired cache entries.
    /// Call this periodically or before accessing cache to auto-clean stale data.
    func invalidateExpired() {
        for type in CacheType.allCases {
            if let age = cacheAge(for: type), age >= (defaultTTL[type] ?? 60) {
                clear(type)
            }
        }
    }

    /// Clears all cached data
    func clearAll() {
        messages = []
        crewMembers = []
        convoys = []
        epics = []
        beads = []
        chatMessages = []
        dashboardMail = []
        dashboardCrew = []
        dashboardConvoys = []
        lastUpdated = [:]
    }

    /// Clears cache for a specific type
    func clear(_ type: CacheType) {
        switch type {
        case .messages:
            messages = []
        case .crew:
            crewMembers = []
        case .convoys:
            convoys = []
        case .epics:
            epics = []
        case .beads:
            beads = []
        case .chat:
            chatMessages = []
        case .dashboard:
            dashboardMail = []
            dashboardCrew = []
            dashboardConvoys = []
        }
        lastUpdated[type] = nil
    }
}
