//
//  GastownWidget.swift
//  AdjutantWidgets
//
//  Home screen widget for displaying Gas Town status information.
//  Supports small, medium, and large widget sizes.
//

import SwiftUI
import WidgetKit
import AdjutantKit

// MARK: - Widget Data Model

/// Timeline entry containing Gas Town status data for the widget.
struct GastownWidgetEntry: TimelineEntry {
    let date: Date
    let powerState: PowerState
    let unreadMailCount: Int
    let activeWorkers: Int
    let beadsInProgress: Int
    let beadsHooked: Int
    let recentBeads: [RecentBead]
    let workerSummary: WorkerSummary
    let isPlaceholder: Bool

    /// Summary of workers for the widget
    struct WorkerSummary {
        let totalPolecats: Int
        let workingPolecats: Int
        let totalCrew: Int
    }

    /// Recent bead activity for medium/large widgets
    struct RecentBead: Identifiable {
        let id: String
        let title: String
        let status: String
        let assignee: String?
    }

    static var placeholder: GastownWidgetEntry {
        GastownWidgetEntry(
            date: Date(),
            powerState: .running,
            unreadMailCount: 3,
            activeWorkers: 5,
            beadsInProgress: 4,
            beadsHooked: 2,
            recentBeads: [
                RecentBead(id: "adj-001", title: "Add widget support", status: "in_progress", assignee: "obsidian"),
                RecentBead(id: "adj-002", title: "Fix authentication", status: "hooked", assignee: "onyx")
            ],
            workerSummary: WorkerSummary(totalPolecats: 3, workingPolecats: 2, totalCrew: 2),
            isPlaceholder: true
        )
    }
}

// MARK: - Timeline Provider

/// Provides timeline entries for the Gas Town widget.
struct GastownWidgetProvider: TimelineProvider {
    /// App Group identifier for sharing data with the main app
    private static let appGroupIdentifier = "group.com.jmm.adjutant"

    func placeholder(in context: Context) -> GastownWidgetEntry {
        .placeholder
    }

    func getSnapshot(in context: Context, completion: @escaping (GastownWidgetEntry) -> Void) {
        if context.isPreview {
            completion(.placeholder)
        } else {
            Task {
                let entry = await fetchWidgetData()
                completion(entry)
            }
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<GastownWidgetEntry>) -> Void) {
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

    /// Fetch current Gas Town status data
    private func fetchWidgetData() async -> GastownWidgetEntry {
        do {
            // Create client using the shared API URL from App Groups
            let baseURL = getSharedAPIBaseURL()
            let config = APIClientConfiguration(baseURL: baseURL)
            let client = APIClient(configuration: config)

            // Fetch status and beads in parallel
            async let statusTask = client.getStatus()
            async let inProgressTask = client.getBeads(status: .inProgress, limit: 5)
            async let hookedTask = client.getBeads(status: .hooked, limit: 5)

            let status = try await statusTask
            let inProgressBeads = try await inProgressTask
            let hookedBeads = try await hookedTask

            // Calculate worker summary
            var totalPolecats = 0
            var workingPolecats = 0
            var totalCrew = 0

            for rig in status.rigs {
                totalPolecats += rig.polecats.count
                workingPolecats += rig.polecats.filter { $0.state == .working }.count
                totalCrew += rig.crew.count
            }

            // Filter beads to OVERSEER scope (exclude wisp/internal beads)
            let allBeads = inProgressBeads + hookedBeads
            let filteredBeads = filterToOverseerScope(allBeads)

            // Get recent beads for display
            let recentBeads = filteredBeads.prefix(4).map { bead in
                GastownWidgetEntry.RecentBead(
                    id: bead.id,
                    title: bead.title,
                    status: bead.status,
                    assignee: bead.assignee?.components(separatedBy: "/").last
                )
            }

            return GastownWidgetEntry(
                date: Date(),
                powerState: status.powerState,
                unreadMailCount: status.operator.unreadMail,
                activeWorkers: totalPolecats + totalCrew,
                beadsInProgress: inProgressBeads.count,
                beadsHooked: hookedBeads.count,
                recentBeads: Array(recentBeads),
                workerSummary: GastownWidgetEntry.WorkerSummary(
                    totalPolecats: totalPolecats,
                    workingPolecats: workingPolecats,
                    totalCrew: totalCrew
                ),
                isPlaceholder: false
            )
        } catch {
            // Return placeholder data on error
            return GastownWidgetEntry(
                date: Date(),
                powerState: .stopped,
                unreadMailCount: 0,
                activeWorkers: 0,
                beadsInProgress: 0,
                beadsHooked: 0,
                recentBeads: [],
                workerSummary: GastownWidgetEntry.WorkerSummary(
                    totalPolecats: 0,
                    workingPolecats: 0,
                    totalCrew: 0
                ),
                isPlaceholder: false
            )
        }
    }
}

// MARK: - Widget Configuration

/// Home screen widget for Gas Town status.
struct GastownWidget: Widget {
    let kind: String = "GastownWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: GastownWidgetProvider()) { entry in
            GastownWidgetView(entry: entry)
        }
        .configurationDisplayName("Gas Town Status")
        .description("Monitor Gas Town workers and beads at a glance.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

// MARK: - Widget Views

/// Main widget view that adapts to different sizes.
struct GastownWidgetView: View {
    @Environment(\.widgetFamily) var family
    var entry: GastownWidgetEntry

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

/// Compact view showing power state and key counts.
private struct SmallWidgetView: View {
    let entry: GastownWidgetEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Power state header
            HStack {
                PowerIndicator(powerState: entry.powerState)
                Spacer()
                if entry.unreadMailCount > 0 {
                    MailBadge(count: entry.unreadMailCount)
                }
            }

            Spacer()

            // Key metrics
            VStack(alignment: .leading, spacing: 4) {
                MetricRow(icon: "circle.fill", value: entry.beadsInProgress, label: "in progress", color: .blue)
                MetricRow(icon: "pin.fill", value: entry.beadsHooked, label: "hooked", color: .orange)
                MetricRow(icon: "person.2.fill", value: entry.activeWorkers, label: "workers", color: .green)
            }
            .font(.caption)
        }
        .padding()
        .containerBackground(backgroundGradient(for: entry.powerState), for: .widget)
    }
}

// MARK: - Medium Widget

/// Medium view with recent activity and worker breakdown.
private struct MediumWidgetView: View {
    let entry: GastownWidgetEntry

    var body: some View {
        HStack(spacing: 16) {
            // Left: Status summary
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    PowerIndicator(powerState: entry.powerState)
                    if entry.unreadMailCount > 0 {
                        MailBadge(count: entry.unreadMailCount)
                    }
                }

                Spacer()

                VStack(alignment: .leading, spacing: 4) {
                    MetricRow(icon: "circle.fill", value: entry.beadsInProgress, label: "in progress", color: .blue)
                    MetricRow(icon: "pin.fill", value: entry.beadsHooked, label: "hooked", color: .orange)
                }
                .font(.caption)

                Divider()

                // Worker breakdown
                HStack(spacing: 8) {
                    WorkerCount(
                        icon: "figure.run",
                        count: entry.workerSummary.workingPolecats,
                        total: entry.workerSummary.totalPolecats,
                        label: "polecats"
                    )
                    WorkerCount(
                        icon: "person.3.fill",
                        count: entry.workerSummary.totalCrew,
                        total: entry.workerSummary.totalCrew,
                        label: "crew"
                    )
                }
                .font(.caption2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Divider()

            // Right: Recent beads
            VStack(alignment: .leading, spacing: 4) {
                Text("Active Beads")
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)

                if entry.recentBeads.isEmpty {
                    Text("No active beads")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .frame(maxHeight: .infinity)
                } else {
                    ForEach(entry.recentBeads.prefix(3)) { bead in
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

/// Full dashboard with all stats and active beads list.
private struct LargeWidgetView: View {
    let entry: GastownWidgetEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header
            HStack {
                HStack(spacing: 8) {
                    PowerIndicator(powerState: entry.powerState)
                    Text("Gas Town")
                        .font(.headline)
                        .fontWeight(.semibold)
                }

                Spacer()

                if entry.unreadMailCount > 0 {
                    MailBadge(count: entry.unreadMailCount)
                }

                Text(entry.date, style: .time)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Divider()

            // Stats row
            HStack(spacing: 16) {
                StatCard(title: "In Progress", value: entry.beadsInProgress, icon: "circle.fill", color: .blue)
                StatCard(title: "Hooked", value: entry.beadsHooked, icon: "pin.fill", color: .orange)
                StatCard(title: "Polecats", value: entry.workerSummary.workingPolecats, total: entry.workerSummary.totalPolecats, icon: "figure.run", color: .green)
                StatCard(title: "Crew", value: entry.workerSummary.totalCrew, icon: "person.3.fill", color: .purple)
            }

            Divider()

            // Active beads list
            VStack(alignment: .leading, spacing: 4) {
                Text("Active Beads")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)

                if entry.recentBeads.isEmpty {
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
                    .frame(maxHeight: .infinity)
                } else {
                    ForEach(entry.recentBeads) { bead in
                        BeadRow(bead: bead)
                    }
                }

                Spacer()
            }
        }
        .padding()
        .containerBackground(backgroundGradient(for: entry.powerState), for: .widget)
    }
}

// MARK: - Shared Components

/// Power state indicator with icon and color.
private struct PowerIndicator: View {
    let powerState: PowerState

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .foregroundStyle(color)
            Text(label)
                .font(.caption)
                .fontWeight(.medium)
        }
    }

    private var icon: String {
        switch powerState {
        case .running: return "bolt.fill"
        case .starting: return "arrow.up.circle.fill"
        case .stopping: return "arrow.down.circle.fill"
        case .stopped: return "moon.fill"
        }
    }

    private var color: Color {
        switch powerState {
        case .running: return .green
        case .starting, .stopping: return .yellow
        case .stopped: return .gray
        }
    }

    private var label: String {
        switch powerState {
        case .running: return "Running"
        case .starting: return "Starting"
        case .stopping: return "Stopping"
        case .stopped: return "Stopped"
        }
    }
}

/// Mail count badge.
private struct MailBadge: View {
    let count: Int

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: "envelope.fill")
                .font(.caption2)
            Text("\(count)")
                .font(.caption)
                .fontWeight(.medium)
        }
        .foregroundStyle(.blue)
    }
}

/// Single metric row with icon, value, and label.
private struct MetricRow: View {
    let icon: String
    let value: Int
    let label: String
    let color: Color

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .foregroundStyle(color)
                .font(.caption2)
            Text("\(value)")
                .fontWeight(.semibold)
            Text(label)
                .foregroundStyle(.secondary)
        }
    }
}

/// Worker count display with active/total.
private struct WorkerCount: View {
    let icon: String
    let count: Int
    let total: Int
    let label: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 2) {
                Image(systemName: icon)
                Text("\(count)/\(total)")
                    .fontWeight(.medium)
            }
            Text(label)
                .foregroundStyle(.secondary)
        }
    }
}

/// Stat card for large widget.
private struct StatCard: View {
    let title: String
    let value: Int
    var total: Int? = nil
    let icon: String
    let color: Color

    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(color)

            if let total = total {
                Text("\(value)/\(total)")
                    .font(.headline)
                    .fontWeight(.bold)
            } else {
                Text("\(value)")
                    .font(.headline)
                    .fontWeight(.bold)
            }

            Text(title)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

/// Compact bead row for medium widget.
private struct CompactBeadRow: View {
    let bead: GastownWidgetEntry.RecentBead

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(statusColor)
                .frame(width: 6, height: 6)
            Text(bead.title)
                .font(.caption2)
                .lineLimit(1)
        }
    }

    private var statusColor: Color {
        switch bead.status {
        case "in_progress": return .blue
        case "hooked": return .orange
        default: return .gray
        }
    }
}

/// Full bead row for large widget.
private struct BeadRow: View {
    let bead: GastownWidgetEntry.RecentBead

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(statusColor)
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

            StatusBadge(status: bead.status)
        }
        .padding(.vertical, 2)
    }

    private var statusColor: Color {
        switch bead.status {
        case "in_progress": return .blue
        case "hooked": return .orange
        default: return .gray
        }
    }
}

/// Status badge pill.
private struct StatusBadge: View {
    let status: String

    var body: some View {
        Text(displayStatus)
            .font(.caption2)
            .fontWeight(.medium)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.2))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }

    private var displayStatus: String {
        switch status {
        case "in_progress": return "active"
        case "hooked": return "hooked"
        default: return status
        }
    }

    private var color: Color {
        switch status {
        case "in_progress": return .blue
        case "hooked": return .orange
        default: return .gray
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
    GastownWidget()
} timeline: {
    GastownWidgetEntry.placeholder
}

#Preview("Medium", as: .systemMedium) {
    GastownWidget()
} timeline: {
    GastownWidgetEntry.placeholder
}

#Preview("Large", as: .systemLarge) {
    GastownWidget()
} timeline: {
    GastownWidgetEntry.placeholder
}
