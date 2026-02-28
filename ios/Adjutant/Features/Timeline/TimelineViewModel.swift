import Foundation
import Combine
import AdjutantKit

/// ViewModel for the timeline view, handling event fetching,
/// filtering, and pagination.
@MainActor
final class TimelineViewModel: BaseViewModel {
    // MARK: - Published Properties

    /// Timeline events (reverse chronological)
    @Published private(set) var events: [TimelineEvent] = []

    /// Whether more events are available for pagination
    @Published private(set) var hasMore = false

    /// Selected agent filter (nil = all agents)
    @Published var selectedAgent: String? {
        didSet {
            Task<Void, Never> { await refresh() }
        }
    }

    /// Selected event type filter (nil = all types)
    @Published var selectedEventType: String? {
        didSet {
            Task<Void, Never> { await refresh() }
        }
    }

    // MARK: - Event Type Options

    /// Available event types for filtering
    static let eventTypes: [(value: String, label: String)] = [
        ("status_change", "STATUS"),
        ("progress_report", "PROGRESS"),
        ("announcement", "ANNOUNCE"),
        ("message_sent", "MESSAGE"),
        ("bead_updated", "BEAD"),
        ("bead_closed", "CLOSED"),
    ]

    // MARK: - Dependencies

    private let apiClient: APIClient?

    // MARK: - Initialization

    init(apiClient: APIClient? = nil) {
        self.apiClient = apiClient ?? AppState.shared.apiClient
        super.init()
    }

    // MARK: - Data Loading

    override func refresh() async {
        await loadEvents()
    }

    /// Loads the first page of timeline events
    func loadEvents() async {
        guard let apiClient else {
            events = Self.mockEvents
            hasMore = false
            return
        }

        await performAsync(showLoading: events.isEmpty) {
            let response = try await apiClient.getTimelineEvents(
                agentId: self.selectedAgent,
                eventType: self.selectedEventType,
                limit: 50
            )
            self.events = response.events
            self.hasMore = response.hasMore
        }
    }

    /// Loads the next page of events (pagination)
    func loadMore() async {
        guard let apiClient, hasMore, !isLoading else { return }
        guard let lastEvent = events.last else { return }

        await performAsync(showLoading: false) {
            let response = try await apiClient.getTimelineEvents(
                agentId: self.selectedAgent,
                eventType: self.selectedEventType,
                before: lastEvent.createdAt,
                limit: 50
            )
            self.events.append(contentsOf: response.events)
            self.hasMore = response.hasMore
        }
    }

    /// Sets the agent filter
    func setAgentFilter(_ agent: String?) {
        selectedAgent = agent
    }

    /// Sets the event type filter
    func setEventTypeFilter(_ type: String?) {
        selectedEventType = type
    }

    /// Unique agent IDs from the current events, for the filter picker
    var agentOptions: [String] {
        Array(Set(events.map(\.agentId))).sorted()
    }
}

// MARK: - Mock Data

extension TimelineViewModel {
    static let mockEvents: [TimelineEvent] = [
        TimelineEvent(
            id: "evt-001",
            eventType: "status_change",
            agentId: "ios-timeline",
            action: "Status changed to working",
            detail: ["status": .string("working")],
            createdAt: "2026-02-28T10:00:00Z"
        ),
        TimelineEvent(
            id: "evt-002",
            eventType: "announcement",
            agentId: "web-timeline",
            action: "Completed adj-028.2.1: Timeline component",
            createdAt: "2026-02-28T09:45:00Z"
        ),
        TimelineEvent(
            id: "evt-003",
            eventType: "bead_updated",
            agentId: "backend-timeline",
            action: "Updated bead adj-028.1.6 status to in_progress",
            beadId: "adj-028.1.6",
            createdAt: "2026-02-28T09:30:00Z"
        ),
        TimelineEvent(
            id: "evt-004",
            eventType: "message_sent",
            agentId: "ios-timeline",
            action: "Sent message to team-lead",
            messageId: "msg-456",
            createdAt: "2026-02-28T09:15:00Z"
        ),
    ]
}
