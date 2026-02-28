import Foundation

// MARK: - Timeline Endpoints

extension APIClient {
    /// Fetch paginated timeline events with optional filters.
    ///
    /// The timeline endpoint returns events directly (not wrapped in ApiResponse).
    ///
    /// - Parameters:
    ///   - agentId: Filter events by agent ID
    ///   - eventType: Filter by event type (status_change, progress_report, etc.)
    ///   - beadId: Filter events related to a specific bead
    ///   - before: Cursor for pagination — ISO 8601 timestamp to fetch events before
    ///   - limit: Maximum events to return (1-200, default 50)
    /// - Returns: A ``TimelineResponse`` with events and pagination info.
    /// - Throws: ``APIClientError`` if the request fails.
    public func getTimelineEvents(
        agentId: String? = nil,
        eventType: String? = nil,
        beadId: String? = nil,
        before: String? = nil,
        limit: Int = 50
    ) async throws -> TimelineResponse {
        var queryItems: [URLQueryItem] = [
            URLQueryItem(name: "limit", value: String(limit))
        ]
        if let agentId {
            queryItems.append(URLQueryItem(name: "agentId", value: agentId))
        }
        if let eventType {
            queryItems.append(URLQueryItem(name: "eventType", value: eventType))
        }
        if let beadId {
            queryItems.append(URLQueryItem(name: "beadId", value: beadId))
        }
        if let before {
            queryItems.append(URLQueryItem(name: "before", value: before))
        }

        // Timeline endpoint returns { events, hasMore } directly (no ApiResponse envelope)
        return try await request(
            .get,
            path: "/events/timeline",
            queryItems: queryItems
        )
    }
}
