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

    /// Cached epics
    private(set) var epics: [BeadInfo] = []

    /// Cached beads
    private(set) var beads: [BeadInfo] = []

    /// Cached chat messages (persistent messages from SQLite store)
    private(set) var chatMessages: [PersistentMessage] = []
    private var chatMessagesByAgent: [String: [PersistentMessage]] = [:]

    /// Cached dashboard data
    private(set) var dashboardMail: [Message] = []
    private(set) var dashboardCrew: [CrewMember] = []

    // MARK: - Timestamps

    /// Last update time for each cache type
    private var lastUpdated: [CacheType: Date] = [:]

    enum CacheType {
        case messages
        case crew
        case epics
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

    /// Updates the cached chat messages and persists the most recent to disk
    func updateChatMessages(_ messages: [PersistentMessage]) {
        self.chatMessages = messages
        lastUpdated[.chat] = Date()
        persistChatMessages(messages)
    }

    /// Updates cached chat messages for a specific agent.
    /// Only updates the per-agent cache — does NOT overwrite the global chatMessages.
    func updateChatMessages(_ messages: [PersistentMessage], forAgent agentId: String) {
        chatMessagesByAgent[agentId] = messages
        lastUpdated[.chat] = Date()
        persistAgentChatMessages(messages, forAgent: agentId)
    }

    /// Gets cached chat messages for a specific agent
    func chatMessages(forAgent agentId: String) -> [PersistentMessage] {
        return chatMessagesByAgent[agentId] ?? []
    }

    /// Updates the cached dashboard data
    func updateDashboard(mail: [Message], crew: [CrewMember]) {
        self.dashboardMail = mail
        self.dashboardCrew = crew
        lastUpdated[.dashboard] = Date()
    }

    // MARK: - Query Methods

    /// Returns whether cache has data for a given type
    func hasCache(for type: CacheType) -> Bool {
        switch type {
        case .messages: return !messages.isEmpty
        case .crew: return !crewMembers.isEmpty
        case .epics: return !epics.isEmpty
        case .beads: return !beads.isEmpty
        case .chat: return !chatMessages.isEmpty || !chatMessagesByAgent.isEmpty
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
        epics = []
        beads = []
        chatMessages = []
        chatMessagesByAgent = [:]
        dashboardMail = []
        dashboardCrew = []
        lastUpdated = [:]
        UserDefaults.standard.removeObject(forKey: Self.chatCacheKey)
        UserDefaults.standard.removeObject(forKey: Self.agentChatCacheKey)
    }

    /// Clears cache for a specific type
    func clear(_ type: CacheType) {
        switch type {
        case .messages:
            messages = []
        case .crew:
            crewMembers = []
        case .epics:
            epics = []
        case .beads:
            beads = []
        case .chat:
            chatMessages = []
            chatMessagesByAgent = [:]
            UserDefaults.standard.removeObject(forKey: Self.chatCacheKey)
            UserDefaults.standard.removeObject(forKey: Self.agentChatCacheKey)
        case .dashboard:
            dashboardMail = []
            dashboardCrew = []
        }
        lastUpdated[type] = nil
    }

    // MARK: - Chat Persistence

    private static let chatCacheKey = "cachedChatMessages"
    private static let agentChatCacheKey = "cachedAgentChatMessages"
    private static let maxPersistedMessages = 50
    private static let maxPersistedMessagesPerAgent = 30

    private var persistDebounceTask: Task<Void, Never>?
    private var lastPersistTime: Date = .distantPast
    private static let persistDebounceInterval: TimeInterval = 5.0

    private var agentPersistDebounceTasks: [String: Task<Void, Never>] = [:]
    private var agentLastPersistTime: [String: Date] = [:]

    private func persistChatMessages(_ messages: [PersistentMessage]) {
        let now = Date()
        if now.timeIntervalSince(lastPersistTime) >= Self.persistDebounceInterval {
            performPersist(messages)
            return
        }

        persistDebounceTask?.cancel()
        persistDebounceTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(Self.persistDebounceInterval * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self?.performPersist(messages)
        }
    }

    private func performPersist(_ messages: [PersistentMessage]) {
        lastPersistTime = Date()
        let recent = Array(messages.suffix(Self.maxPersistedMessages))
        if let data = try? JSONEncoder().encode(recent) {
            UserDefaults.standard.set(data, forKey: Self.chatCacheKey)
        }
    }

    /// Persists chat messages for a specific agent separately from the global cache.
    private func persistAgentChatMessages(_ messages: [PersistentMessage], forAgent agentId: String) {
        let now = Date()
        let lastTime = agentLastPersistTime[agentId] ?? .distantPast
        if now.timeIntervalSince(lastTime) >= Self.persistDebounceInterval {
            performAgentPersist(messages, forAgent: agentId)
            return
        }

        agentPersistDebounceTasks[agentId]?.cancel()
        agentPersistDebounceTasks[agentId] = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(Self.persistDebounceInterval * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self?.performAgentPersist(messages, forAgent: agentId)
        }
    }

    private func performAgentPersist(_ messages: [PersistentMessage], forAgent agentId: String) {
        agentLastPersistTime[agentId] = Date()
        let recent = Array(messages.suffix(Self.maxPersistedMessagesPerAgent))

        // Load existing per-agent dict, update this agent's entry, and re-persist
        var agentDict = loadPersistedAgentDict()
        agentDict[agentId] = recent
        if let data = try? JSONEncoder().encode(agentDict) {
            UserDefaults.standard.set(data, forKey: Self.agentChatCacheKey)
        }
    }

    private func loadPersistedAgentDict() -> [String: [PersistentMessage]] {
        guard let data = UserDefaults.standard.data(forKey: Self.agentChatCacheKey) else { return [:] }
        return (try? JSONDecoder().decode([String: [PersistentMessage]].self, from: data)) ?? [:]
    }

    /// Loads persisted chat messages from UserDefaults, decoding JSON on a background thread
    /// to avoid blocking the main thread during app startup (~100-200ms savings).
    func loadPersistedChatMessages() async {
        // Load global chat messages
        if chatMessages.isEmpty {
            if let data = UserDefaults.standard.data(forKey: Self.chatCacheKey) {
                let decoded: [PersistentMessage]? = await Task.detached(priority: .userInitiated) {
                    try? JSONDecoder().decode([PersistentMessage].self, from: data)
                }.value
                if let messages = decoded {
                    chatMessages = messages
                }
            }
        }

        // Load per-agent chat messages
        if chatMessagesByAgent.isEmpty {
            if let data = UserDefaults.standard.data(forKey: Self.agentChatCacheKey) {
                let decoded: [String: [PersistentMessage]]? = await Task.detached(priority: .userInitiated) {
                    try? JSONDecoder().decode([String: [PersistentMessage]].self, from: data)
                }.value
                if let agentDict = decoded {
                    chatMessagesByAgent = agentDict
                }
            }
        }

        lastUpdated[.chat] = Date()
    }

    /// Synchronous variant for backwards compatibility where async is not available.
    /// Prefer the async version when possible.
    func loadPersistedChatMessagesSync() {
        if chatMessages.isEmpty {
            if let data = UserDefaults.standard.data(forKey: Self.chatCacheKey),
               let messages = try? JSONDecoder().decode([PersistentMessage].self, from: data) {
                chatMessages = messages
            }
        }

        if chatMessagesByAgent.isEmpty {
            if let data = UserDefaults.standard.data(forKey: Self.agentChatCacheKey),
               let agentDict = try? JSONDecoder().decode([String: [PersistentMessage]].self, from: data) {
                chatMessagesByAgent = agentDict
            }
        }

        lastUpdated[.chat] = Date()
    }
}
