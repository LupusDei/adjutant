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

    // MARK: - Timestamps

    /// Last update time for each cache type
    private var lastUpdated: [CacheType: Date] = [:]

    enum CacheType {
        case messages
        case crew
        case convoys
        case epics
        case beads
        case chat
        case dashboard

        /// Default TTL in seconds for each cache type
        var ttl: TimeInterval {
            switch self {
            case .messages: return 60
            case .crew: return 120
            case .convoys: return 60
            case .epics: return 60
            case .beads: return 30
            case .chat: return 30
            case .dashboard: return 60
            }
        }
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

    /// Returns whether cache for a given type is still valid (not expired)
    func isValid(for type: CacheType) -> Bool {
        guard let age = cacheAge(for: type) else { return false }
        return age < type.ttl
    }

    /// Returns cached messages if valid, nil if expired or empty
    func validMessages() -> [Message]? {
        guard isValid(for: .messages), !messages.isEmpty else {
            invalidateIfExpired(.messages)
            return nil
        }
        return messages
    }

    /// Returns cached crew members if valid, nil if expired or empty
    func validCrewMembers() -> [CrewMember]? {
        guard isValid(for: .crew), !crewMembers.isEmpty else {
            invalidateIfExpired(.crew)
            return nil
        }
        return crewMembers
    }

    /// Returns cached convoys if valid, nil if expired or empty
    func validConvoys() -> [Convoy]? {
        guard isValid(for: .convoys), !convoys.isEmpty else {
            invalidateIfExpired(.convoys)
            return nil
        }
        return convoys
    }

    /// Returns cached epics if valid, nil if expired or empty
    func validEpics() -> [BeadInfo]? {
        guard isValid(for: .epics), !epics.isEmpty else {
            invalidateIfExpired(.epics)
            return nil
        }
        return epics
    }

    /// Returns cached beads if valid, nil if expired or empty
    func validBeads() -> [BeadInfo]? {
        guard isValid(for: .beads), !beads.isEmpty else {
            invalidateIfExpired(.beads)
            return nil
        }
        return beads
    }

    /// Returns cached chat messages if valid, nil if expired or empty
    func validChatMessages() -> [Message]? {
        guard isValid(for: .chat), !chatMessages.isEmpty else {
            invalidateIfExpired(.chat)
            return nil
        }
        return chatMessages
    }

    /// Returns cached dashboard data if valid, nil if expired
    func validDashboard() -> (mail: [Message], crew: [CrewMember], convoys: [Convoy])? {
        guard isValid(for: .dashboard) else {
            invalidateIfExpired(.dashboard)
            return nil
        }
        return (dashboardMail, dashboardCrew, dashboardConvoys)
    }

    /// Invalidates cache if it has expired
    private func invalidateIfExpired(_ type: CacheType) {
        guard let age = cacheAge(for: type), age >= type.ttl else { return }
        clear(type)
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

    /// Invalidates cache for a specific type (alias for clear, use for user-triggered refreshes)
    func invalidate(_ type: CacheType) {
        clear(type)
    }

    /// Invalidates all caches (alias for clearAll, use for user-triggered refreshes)
    func invalidateAll() {
        clearAll()
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
