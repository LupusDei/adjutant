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

    /// Cached convoys
    private(set) var convoys: [Convoy] = []

    /// Cached beads
    private(set) var beads: [BeadInfo] = []

    /// Cached chat messages (same type as mail messages)
    private(set) var chatMessages: [Message] = []

    /// Cached dashboard data
    private(set) var dashboardMail: [Message] = []
    private(set) var dashboardCrew: [CrewMember] = []
    private(set) var dashboardConvoys: [Convoy] = []

    // MARK: - Timestamps

    /// Last update time for each cache type
    private var lastUpdated: [CacheType: Date] = [:]

    enum CacheType {
        case messages
        case crew
        case convoys
        case beads
        case chat
        case dashboard
    }

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

    /// Clears all cached data
    func clearAll() {
        messages = []
        crewMembers = []
        convoys = []
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
