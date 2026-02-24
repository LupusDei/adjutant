//
//  AdjutantWidget.swift
//  AdjutantWidgets
//
//  Home screen widget for displaying Adjutant status information.
//  Supports small, medium, and large widget sizes.
//

import SwiftUI
import WidgetKit
import AdjutantKit

// MARK: - Widget Data Model

/// Timeline entry containing Adjutant status data for the widget.
struct AdjutantWidgetEntry: TimelineEntry {
    let date: Date
    let powerState: PowerState
    let unreadMailCount: Int
    let activeAgents: [AgentSummary]
    let beadsInProgress: [BeadSummary]
    let recentlyCompleted: [BeadSummary]
    let isPlaceholder: Bool

    /// Aggregate status: green if any agent working, yellow if all idle, red if any blocked
    var aggregateStatus: AggregateStatus {
        if activeAgents.isEmpty { return .idle }
        if activeAgents.contains(where: { $0.status == "blocked" }) { return .blocked }
        if activeAgents.contains(where: { $0.status == "working" }) { return .working }
        return .idle
    }

    /// Count of agents currently active (working or blocked)
    var activeAgentCount: Int {
        activeAgents.count
    }

    /// Count of beads in progress
    var inProgressBeadCount: Int {
        beadsInProgress.count
    }

    enum AggregateStatus {
        case working  // green - at least one agent working
        case idle     // yellow - all agents idle
        case blocked  // red - at least one agent blocked

        var color: Color {
            switch self {
            case .working: return .green
            case .idle: return .yellow
            case .blocked: return .red
            }
        }
    }

    static var placeholder: AdjutantWidgetEntry {
        AdjutantWidgetEntry(
            date: Date(),
            powerState: .running,
            unreadMailCount: 0,
            activeAgents: [
                AgentSummary(name: "obsidian", status: "working"),
                AgentSummary(name: "onyx", status: "working"),
                AgentSummary(name: "slate", status: "idle")
            ],
            beadsInProgress: [
                BeadSummary(id: "adj-001", title: "Add widget support", assignee: "obsidian"),
                BeadSummary(id: "adj-002", title: "Fix authentication", assignee: "onyx")
            ],
            recentlyCompleted: [
                BeadSummary(id: "adj-003", title: "Update models", assignee: "slate")
            ],
            isPlaceholder: true
        )
    }
}

// MARK: - Timeline Provider

/// Provides timeline entries for the Adjutant widget.
struct AdjutantWidgetProvider: TimelineProvider {
    /// App Group identifier for sharing data with the main app
    private static let appGroupIdentifier = "group.com.jmm.adjutant"

    func placeholder(in context: Context) -> AdjutantWidgetEntry {
        .placeholder
    }

    func getSnapshot(in context: Context, completion: @escaping (AdjutantWidgetEntry) -> Void) {
        if context.isPreview {
            completion(.placeholder)
        } else {
            Task {
                let entry = await fetchWidgetData()
                completion(entry)
            }
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<AdjutantWidgetEntry>) -> Void) {
        Task {
            let entry = await fetchWidgetData()
            // Refresh every 5 minutes
            let nextUpdate = Date().addingTimeInterval(5 * 60)
            let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
            completion(timeline)
        }
    }

    /// Get the API base URL from shared App Groups UserDefaults
    private func getSharedAPIBaseURL() -> URL {
        let sharedDefaults = UserDefaults(suiteName: Self.appGroupIdentifier)
        if let urlString = sharedDefaults?.string(forKey: "apiBaseURL"),
           let url = URL(string: urlString) {
            return url
        }
        // Fall back to localhost if no URL configured
        return URL(string: "http://localhost:4201/api")!
    }

    /// Filter beads to OVERSEER scope (exclude wisp/internal operational beads)
    private func filterToOverseerScope(_ beads: [BeadInfo]) -> [BeadInfo] {
        let excludedTypes = ["message", "epic", "convoy", "agent", "role", "witness", "wisp", "infrastructure", "coordination", "sync"]
        let excludedPatterns = ["witness", "wisp", "internal", "sync", "coordination", "mail delivery", "polecat", "crew assignment", "rig status", "heartbeat", "health check"]

        return beads.filter { bead in
            let typeLower = bead.type.lowercased()
            let titleLower = bead.title.lowercased()
            let idLower = bead.id.lowercased()
            let assigneeLower = (bead.assignee ?? "").lowercased()

            // Exclude wisp-related beads
            if typeLower.contains("wisp") || titleLower.contains("wisp") ||
                idLower.contains("wisp") || assigneeLower.contains("wisp") {
                return false
            }

            // Exclude operational types
            if excludedTypes.contains(typeLower) {
                return false
            }

            // Exclude by title patterns
            if excludedPatterns.contains(where: { titleLower.contains($0) }) {
                return false
            }

            // Exclude merge beads
            if titleLower.hasPrefix("merge:") {
                return false
            }

            return true
        }
    }

    /// Fetch current Adjutant status data
    private func fetchWidgetData() async -> AdjutantWidgetEntry {
        do {
            // Create client using the shared API URL from App Groups
            let baseURL = getSharedAPIBaseURL()
            let config = APIClientConfiguration(baseURL: baseURL)
            let client = APIClient(configuration: config)

            // Fetch status, beads, and agents in parallel
            async let statusTask = client.getStatus()
            async let inProgressTask = client.getBeads(rig: "all", status: .inProgress, limit: 10)
            async let agentsTask = client.getAgents()

            let status = try await statusTask
            let inProgressBeads = try await inProgressTask
            let agents = try await agentsTask

            // Build agent summaries (up to 4 active agents)
            let activeAgentSummaries: [AgentSummary] = agents
                .filter { $0.status != .offline }
                .prefix(4)
                .map { agent in
                    let statusStr: String
                    switch agent.status {
                    case .working: statusStr = "working"
                    case .blocked: statusStr = "blocked"
                    case .stuck: statusStr = "blocked"
                    case .idle: statusStr = "idle"
                    case .offline: statusStr = "idle"
                    }
                    return AgentSummary(name: agent.name, status: statusStr)
                }

            // Filter beads to OVERSEER scope
            let filteredBeads = filterToOverseerScope(inProgressBeads)

            // Build bead summaries
            let beadSummaries: [BeadSummary] = filteredBeads.prefix(5).map { bead in
                BeadSummary(
                    id: bead.id,
                    title: bead.title,
                    assignee: bead.assignee?.components(separatedBy: "/").last
                )
            }

            // Fetch recently closed beads (fallback to empty if endpoint unavailable)
            var recentlyClosedSummaries: [BeadSummary] = []
            do {
                let closedBeads = try await client.getRecentlyClosedBeads(hours: 1)
                let filteredClosed = filterToOverseerScope(closedBeads)
                recentlyClosedSummaries = filteredClosed.prefix(3).map { bead in
                    BeadSummary(
                        id: bead.id,
                        title: bead.title,
                        assignee: bead.assignee?.components(separatedBy: "/").last
                    )
                }
            } catch {
                // Endpoint may not be available yet - use empty array
            }

            return AdjutantWidgetEntry(
                date: Date(),
                powerState: status.powerState,
                unreadMailCount: status.operator.unreadMail,
                activeAgents: activeAgentSummaries,
                beadsInProgress: beadSummaries,
                recentlyCompleted: recentlyClosedSummaries,
                isPlaceholder: false
            )
        } catch {
            // Return placeholder data on error
            return AdjutantWidgetEntry(
                date: Date(),
                powerState: .stopped,
                unreadMailCount: 0,
                activeAgents: [],
                beadsInProgress: [],
                recentlyCompleted: [],
                isPlaceholder: false
            )
        }
    }
}

// MARK: - Widget Configuration

/// Home screen widget for Adjutant status.
struct AdjutantWidget: Widget {
    let kind: String = "AdjutantWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: AdjutantWidgetProvider()) { entry in
            AdjutantWidgetView(entry: entry)
        }
        .configurationDisplayName("Adjutant Status")
        .description("Monitor agents and beads at a glance.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

// MARK: - Widget Views

/// Main widget view that adapts to different sizes.
struct AdjutantWidgetView: View {
    @Environment(\.widgetFamily) var family
    var entry: AdjutantWidgetEntry

    var body: some View {
        switch family {
        case .systemSmall:
            SmallWidgetView(entry: entry)
        case .systemMedium:
            MediumWidgetView(entry: entry)
        case .systemLarge:
            LargeWidgetView(entry: entry)
        default:
            SmallWidgetView(entry: entry)
        }
    }
}

// MARK: - Small Widget

/// Compact view: aggregate status dot, active agent count, in-progress bead count.
private struct SmallWidgetView: View {
    let entry: AdjutantWidgetEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Aggregate status + title
            HStack {
                Circle()
                    .fill(entry.aggregateStatus.color)
                    .frame(width: 10, height: 10)
                Text("Adjutant")
                    .font(.caption)
                    .fontWeight(.semibold)
                Spacer()
            }

            Spacer()

            // Key metrics
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    Image(systemName: "person.2.fill")
                        .foregroundStyle(.green)
                        .font(.caption2)
                    Text("\(entry.activeAgentCount)")
                        .font(.caption)
                        .fontWeight(.semibold)
                    Text("agents")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                HStack(spacing: 4) {
                    Image(systemName: "circle.fill")
                        .foregroundStyle(.blue)
                        .font(.caption2)
                    Text("\(entry.inProgressBeadCount)")
                        .font(.caption)
                        .fontWeight(.semibold)
                    Text("in progress")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding()
        .containerBackground(backgroundGradient(for: entry.powerState), for: .widget)
    }
}

// MARK: - Medium Widget

/// Left side: agent names with status dots (up to 4 working/blocked).
/// Right side: top active beads with assignee short name.
private struct MediumWidgetView: View {
    let entry: AdjutantWidgetEntry

    /// Agents filtered to working/blocked only for the medium view
    private var workingOrBlockedAgents: [AgentSummary] {
        entry.activeAgents.filter { $0.status == "working" || $0.status == "blocked" }
    }

    var body: some View {
        HStack(spacing: 12) {
            // Left: Agent names with status dots
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    Circle()
                        .fill(entry.aggregateStatus.color)
                        .frame(width: 8, height: 8)
                    Text("Agents")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundStyle(.secondary)
                }

                if workingOrBlockedAgents.isEmpty {
                    Text("No active agents")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .frame(maxHeight: .infinity)
                } else {
                    ForEach(Array(workingOrBlockedAgents.prefix(4).enumerated()), id: \.offset) { _, agent in
                        AgentRow(agent: agent)
                    }
                }

                Spacer()
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Divider()

            // Right: Active beads with assignee
            VStack(alignment: .leading, spacing: 6) {
                Text("Active Beads")
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)

                if entry.beadsInProgress.isEmpty {
                    Text("No active beads")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .frame(maxHeight: .infinity)
                } else {
                    ForEach(Array(entry.beadsInProgress.prefix(3).enumerated()), id: \.offset) { _, bead in
                        CompactBeadRow(bead: bead)
                    }
                }

                Spacer()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding()
        .containerBackground(backgroundGradient(for: entry.powerState), for: .widget)
    }
}

// MARK: - Large Widget

/// Full dashboard: agents section, active beads, recently completed.
private struct LargeWidgetView: View {
    let entry: AdjutantWidgetEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header
            HStack {
                HStack(spacing: 6) {
                    Circle()
                        .fill(entry.aggregateStatus.color)
                        .frame(width: 10, height: 10)
                    Text("Adjutant")
                        .font(.headline)
                        .fontWeight(.semibold)
                }

                Spacer()

                Text(entry.date, style: .time)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Divider()

            // Agents section
            VStack(alignment: .leading, spacing: 4) {
                Text("Agents")
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)

                if entry.activeAgents.isEmpty {
                    Text("No active agents")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                } else {
                    ForEach(Array(entry.activeAgents.enumerated()), id: \.offset) { _, agent in
                        AgentRow(agent: agent)
                    }
                }
            }

            Divider()

            // Active beads section
            VStack(alignment: .leading, spacing: 4) {
                Text("Active Beads")
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)

                if entry.beadsInProgress.isEmpty {
                    HStack {
                        Spacer()
                        VStack(spacing: 4) {
                            Image(systemName: "tray")
                                .font(.title2)
                                .foregroundStyle(.tertiary)
                            Text("No active beads")
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                        }
                        Spacer()
                    }
                } else {
                    ForEach(Array(entry.beadsInProgress.prefix(4).enumerated()), id: \.offset) { _, bead in
                        BeadRow(bead: bead)
                    }
                }
            }

            Divider()

            // Recently completed section
            VStack(alignment: .leading, spacing: 4) {
                Text("Recently Completed")
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)

                if entry.recentlyCompleted.isEmpty {
                    Text("None in the last hour")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                } else {
                    ForEach(Array(entry.recentlyCompleted.prefix(3).enumerated()), id: \.offset) { _, bead in
                        CompletedBeadRow(bead: bead)
                    }
                }
            }

            Spacer()
        }
        .padding()
        .containerBackground(backgroundGradient(for: entry.powerState), for: .widget)
    }
}

// MARK: - Shared Components

/// A row showing an agent name with a status dot.
private struct AgentRow: View {
    let agent: AgentSummary

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(statusColor)
                .frame(width: 6, height: 6)
            Text(agent.name)
                .font(.caption)
                .lineLimit(1)
        }
    }

    private var statusColor: Color {
        switch agent.status {
        case "working": return .green
        case "blocked": return .red
        case "idle": return .yellow
        default: return .gray
        }
    }
}

/// Compact bead row for medium widget: title + assignee short name.
private struct CompactBeadRow: View {
    let bead: BeadSummary

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(.blue)
                .frame(width: 6, height: 6)
            Text(bead.title)
                .font(.caption2)
                .lineLimit(1)
            if let assignee = bead.assignee {
                Text("@\(assignee)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }
}

/// Full bead row for large widget.
private struct BeadRow: View {
    let bead: BeadSummary

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(.blue)
                .frame(width: 8, height: 8)

            VStack(alignment: .leading, spacing: 1) {
                Text(bead.title)
                    .font(.caption)
                    .lineLimit(1)

                HStack(spacing: 4) {
                    Text(bead.id)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)

                    if let assignee = bead.assignee {
                        Text("@\(assignee)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Spacer()
        }
        .padding(.vertical, 2)
    }
}

/// Completed bead row showing checkmark.
private struct CompletedBeadRow: View {
    let bead: BeadSummary

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
                .font(.caption2)
            Text(bead.title)
                .font(.caption2)
                .lineLimit(1)
            if let assignee = bead.assignee {
                Text("@\(assignee)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

// MARK: - Helper Functions

/// Background gradient based on power state.
private func backgroundGradient(for powerState: PowerState) -> some ShapeStyle {
    switch powerState {
    case .running:
        return Color(.systemBackground)
    case .starting, .stopping:
        return Color(.systemBackground)
    case .stopped:
        return Color(.secondarySystemBackground)
    }
}

// MARK: - Previews

#Preview("Small", as: .systemSmall) {
    AdjutantWidget()
} timeline: {
    AdjutantWidgetEntry.placeholder
}

#Preview("Medium", as: .systemMedium) {
    AdjutantWidget()
} timeline: {
    AdjutantWidgetEntry.placeholder
}

#Preview("Large", as: .systemLarge) {
    AdjutantWidget()
} timeline: {
    AdjutantWidgetEntry.placeholder
}
