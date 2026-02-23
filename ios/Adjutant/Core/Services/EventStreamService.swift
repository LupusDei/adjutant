//
//  EventStreamService.swift
//  Adjutant
//
//  SSE (Server-Sent Events) client for real-time event streaming.
//  Connects to GET /api/events and parses text/event-stream format.
//  Replaces polling when connected; polling resumes as fallback on disconnect.
//

import Foundation
import Combine

/// Connection state for the SSE stream
enum EventStreamState: Equatable {
    case disconnected
    case connecting
    case connected
    case reconnecting(attempt: Int)
}

/// A parsed SSE event from the server
struct ServerSentEvent {
    let id: String?
    let event: String
    let data: String
}

/// Convenience wrapper used by tests — maps `type` to `ServerSentEvent.event`
/// and adds a typed JSON decode helper.
struct SSEEvent {
    let type: String
    let data: String
    let id: String?

    /// Decode the JSON `data` payload into a Decodable type.
    func decode<T: Decodable>(_ type: T.Type) -> T? {
        guard !data.isEmpty,
              let jsonData = data.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(type, from: jsonData)
    }
}

/// Service that maintains a persistent SSE connection to the backend
/// and publishes parsed events for consumption by DataSyncService.
@MainActor
public final class EventStreamService: ObservableObject {
    // MARK: - Singleton

    static let shared = EventStreamService()

    // MARK: - Published Properties

    @Published private(set) var state: EventStreamState = .disconnected

    /// Whether the SSE stream is actively connected
    var isConnected: Bool { state == .connected }

    // MARK: - Event Publisher

    /// Publishes parsed SSE events for subscribers
    let eventSubject = PassthroughSubject<ServerSentEvent, Never>()

    // MARK: - Configuration

    private static let initialReconnectDelay: TimeInterval = 1.0
    private static let maxReconnectDelay: TimeInterval = 30.0
    private static let reconnectBackoffMultiplier: Double = 2.0

    // MARK: - Private Properties

    private var connectionTask: Task<Void, Never>?
    private var lastEventId: String?
    private var reconnectAttempt = 0
    private var isStarted = false

    private init() {}

    // MARK: - Public API

    /// Start the SSE connection. Idempotent - safe to call multiple times.
    func start() {
        guard !isStarted else { return }
        isStarted = true
        connect()
    }

    /// Stop the SSE connection and cancel reconnection.
    func stop() {
        isStarted = false
        connectionTask?.cancel()
        connectionTask = nil
        state = .disconnected
        reconnectAttempt = 0
    }

    // MARK: - Connection

    private func connect() {
        connectionTask?.cancel()

        connectionTask = Task { [weak self] in
            guard let self else { return }

            if self.reconnectAttempt > 0 {
                self.state = .reconnecting(attempt: self.reconnectAttempt)
            } else {
                self.state = .connecting
            }

            do {
                try await self.runStream()
            } catch is CancellationError {
                // Normal cancellation, don't reconnect
                return
            } catch {
                print("[EventStreamService] Stream error: \(error.localizedDescription)")
            }

            // Reconnect if still started
            guard self.isStarted, !Task.isCancelled else { return }
            await self.scheduleReconnect()
        }
    }

    private func runStream() async throws {
        let appState = AppState.shared
        let baseURL = appState.apiBaseURL

        // Build the events URL: replace /api suffix with /api/events
        guard let eventsURL = URL(string: baseURL.absoluteString + "/events") else {
            print("[EventStreamService] Failed to build events URL from \(baseURL)")
            return
        }

        var request = URLRequest(url: eventsURL)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        request.setValue("1", forHTTPHeaderField: "ngrok-skip-browser-warning")
        request.timeoutInterval = 0 // No timeout for streaming

        // Gap recovery: send last event ID
        if let lastEventId {
            request.setValue(lastEventId, forHTTPHeaderField: "Last-Event-ID")
        }

        // Auth
        if let apiKey = appState.apiKey, !apiKey.isEmpty {
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        }

        let sessionConfig = URLSessionConfiguration.default
        sessionConfig.timeoutIntervalForRequest = 60
        sessionConfig.timeoutIntervalForResource = 0 // No resource timeout for SSE
        let session = URLSession(configuration: sessionConfig)

        let (bytes, response) = try await session.bytes(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? -1
            print("[EventStreamService] Unexpected status: \(status)")
            return
        }

        // Connected successfully
        state = .connected
        reconnectAttempt = 0
        print("[EventStreamService] Connected to \(eventsURL)")

        // Parse the SSE stream line by line
        var currentEvent = ""
        var currentData = ""
        var currentId: String?

        for try await line in bytes.lines {
            try Task.checkCancellation()

            if line.isEmpty {
                // Blank line = event dispatch
                if !currentData.isEmpty {
                    let event = ServerSentEvent(
                        id: currentId,
                        event: currentEvent.isEmpty ? "message" : currentEvent,
                        data: currentData
                    )

                    if let id = currentId {
                        lastEventId = id
                    }

                    eventSubject.send(event)
                }

                // Reset for next event
                currentEvent = ""
                currentData = ""
                currentId = nil
            } else if line.hasPrefix("event:") {
                currentEvent = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
            } else if line.hasPrefix("data:") {
                let data = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
                if currentData.isEmpty {
                    currentData = data
                } else {
                    currentData += "\n" + data
                }
            } else if line.hasPrefix("id:") {
                currentId = String(line.dropFirst(3)).trimmingCharacters(in: .whitespaces)
            } else if line.hasPrefix(":") {
                // Comment (heartbeat), ignore
            }
        }
    }

    // MARK: - Reconnection

    private func scheduleReconnect() async {
        reconnectAttempt += 1
        let delay = min(
            Self.initialReconnectDelay * pow(Self.reconnectBackoffMultiplier, Double(reconnectAttempt - 1)),
            Self.maxReconnectDelay
        )

        print("[EventStreamService] Reconnecting in \(delay)s (attempt \(reconnectAttempt))")
        state = .reconnecting(attempt: reconnectAttempt)

        do {
            try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
        } catch {
            return // Cancelled
        }

        guard isStarted, !Task.isCancelled else { return }
        connect()
    }
}
