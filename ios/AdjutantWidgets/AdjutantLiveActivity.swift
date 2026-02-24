//
//  AdjutantLiveActivity.swift
//  AdjutantWidgets
//
//  Live Activity widget for displaying Adjutant status on Lock Screen
//  and Dynamic Island.
//

import SwiftUI
import WidgetKit
import ActivityKit
import AdjutantKit

// MARK: - Live Activity Widget

/// Live Activity configuration for Adjutant status display.
struct AdjutantLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AdjutantActivityAttributes.self) { context in
            // Lock Screen / Banner view
            LockScreenView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded Dynamic Island regions
                DynamicIslandExpandedRegion(.leading) {
                    ExpandedLeadingView(context: context)
                }

                DynamicIslandExpandedRegion(.trailing) {
                    ExpandedTrailingView(context: context)
                }

                DynamicIslandExpandedRegion(.bottom) {
                    ExpandedBottomView(context: context)
                }

                DynamicIslandExpandedRegion(.center) {
                    ExpandedCenterView(context: context)
                }
            } compactLeading: {
                CompactLeadingView(context: context)
            } compactTrailing: {
                CompactTrailingView(context: context)
            } minimal: {
                MinimalView(context: context)
            }
        }
    }
}

// MARK: - Aggregate Status Helper

/// Derives an aggregate status color from agent summaries.
private func aggregateStatusColor(for agents: [AgentSummary]) -> Color {
    if agents.isEmpty { return .yellow }
    if agents.contains(where: { $0.status == "blocked" }) { return .red }
    if agents.contains(where: { $0.status == "working" }) { return .green }
    return .yellow
}

// MARK: - Lock Screen View

/// Main Lock Screen presentation for the Live Activity.
/// Shows top 2-3 active agent names with status dots, in-progress bead count,
/// and last completed bead title.
private struct LockScreenView: View {
    let context: ActivityViewContext<AdjutantActivityAttributes>

    private var agents: [AgentSummary] { context.state.activeAgents }
    private var beads: [BeadSummary] { context.state.beadsInProgress }
    private var lastCompleted: BeadSummary? { context.state.recentlyCompleted.first }

    var body: some View {
        HStack(spacing: 12) {
            // Left: Aggregate status + agent list
            VStack(alignment: .leading, spacing: 4) {
                Text(context.attributes.townName)
                    .font(.headline)
                    .fontWeight(.semibold)

                // Top 2-3 agents with status dots
                ForEach(Array(agents.prefix(3).enumerated()), id: \.offset) { _, agent in
                    HStack(spacing: 4) {
                        Circle()
                            .fill(agentStatusColor(agent.status))
                            .frame(width: 6, height: 6)
                        Text(agent.name)
                            .font(.caption)
                            .lineLimit(1)
                    }
                }
            }

            Spacer()

            // Right: Bead count + last completed
            VStack(alignment: .trailing, spacing: 4) {
                // In-progress bead count
                HStack(spacing: 4) {
                    Image(systemName: "circle.fill")
                        .foregroundStyle(.blue)
                        .font(.caption2)
                    Text("\(beads.count)")
                        .fontWeight(.semibold)
                    Text("in progress")
                        .foregroundStyle(.secondary)
                }
                .font(.caption)

                // Last completed bead
                if let completed = lastCompleted {
                    HStack(spacing: 4) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                            .font(.caption2)
                        Text(completed.title)
                            .font(.caption2)
                            .lineLimit(1)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()

                Text(context.state.lastUpdated, style: .time)
                    .font(.caption2)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
        }
        .padding()
        .activityBackgroundTint(backgroundTint(for: context.state.powerState))
    }

    private func backgroundTint(for powerState: PowerState) -> Color {
        switch powerState {
        case .running:
            return .green.opacity(0.3)
        case .starting, .stopping:
            return .yellow.opacity(0.3)
        case .stopped:
            return .gray.opacity(0.3)
        }
    }
}

// MARK: - Dynamic Island Expanded Views

/// Leading region: aggregate status dot.
private struct ExpandedLeadingView: View {
    let context: ActivityViewContext<AdjutantActivityAttributes>

    var body: some View {
        Circle()
            .fill(aggregateStatusColor(for: context.state.activeAgents))
            .frame(width: 14, height: 14)
    }
}

/// Trailing region: updated time.
private struct ExpandedTrailingView: View {
    let context: ActivityViewContext<AdjutantActivityAttributes>

    var body: some View {
        VStack(alignment: .trailing, spacing: 2) {
            Text(context.state.lastUpdated, style: .time)
                .font(.caption2)
                .monospacedDigit()
        }
    }
}

/// Center region: agent names with status.
private struct ExpandedCenterView: View {
    let context: ActivityViewContext<AdjutantActivityAttributes>

    var body: some View {
        HStack(spacing: 8) {
            ForEach(Array(context.state.activeAgents.prefix(3).enumerated()), id: \.offset) { _, agent in
                HStack(spacing: 3) {
                    Circle()
                        .fill(agentStatusColor(agent.status))
                        .frame(width: 5, height: 5)
                    Text(agent.name)
                        .font(.caption2)
                        .lineLimit(1)
                }
            }
        }
    }
}

/// Bottom region: active bead titles.
private struct ExpandedBottomView: View {
    let context: ActivityViewContext<AdjutantActivityAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(Array(context.state.beadsInProgress.prefix(3).enumerated()), id: \.offset) { _, bead in
                HStack(spacing: 4) {
                    Circle()
                        .fill(.blue)
                        .frame(width: 4, height: 4)
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

            if context.state.beadsInProgress.isEmpty {
                Text("No active beads")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

// MARK: - Dynamic Island Compact Views

/// Compact leading: active agent count + in-progress bead count.
private struct CompactLeadingView: View {
    let context: ActivityViewContext<AdjutantActivityAttributes>

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "person.2.fill")
                .font(.caption2)
            Text("\(context.state.activeAgents.count)")
                .font(.caption)
                .monospacedDigit()
        }
    }
}

/// Compact trailing: in-progress bead count.
private struct CompactTrailingView: View {
    let context: ActivityViewContext<AdjutantActivityAttributes>

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "circle.fill")
                .font(.caption2)
                .foregroundStyle(.blue)
            Text("\(context.state.beadsInProgress.count)")
                .font(.caption)
                .monospacedDigit()
        }
    }
}

// MARK: - Dynamic Island Minimal View

/// Minimal view: aggregate status dot (green=working, yellow=idle, red=blocked).
private struct MinimalView: View {
    let context: ActivityViewContext<AdjutantActivityAttributes>

    var body: some View {
        Circle()
            .fill(aggregateStatusColor(for: context.state.activeAgents))
            .frame(width: 12, height: 12)
    }
}

// MARK: - Helper Functions

/// Returns the appropriate color for an agent status string.
private func agentStatusColor(_ status: String) -> Color {
    switch status {
    case "working": return .green
    case "blocked": return .red
    case "idle": return .yellow
    default: return .gray
    }
}

// MARK: - Previews

private let previewAgents: [AgentSummary] = [
    AgentSummary(name: "obsidian", status: "working"),
    AgentSummary(name: "onyx", status: "working"),
    AgentSummary(name: "slate", status: "idle")
]

private let previewBeads: [BeadSummary] = [
    BeadSummary(id: "adj-001", title: "Add widget support", assignee: "obsidian"),
    BeadSummary(id: "adj-002", title: "Fix authentication", assignee: "onyx")
]

private let previewCompleted: [BeadSummary] = [
    BeadSummary(id: "adj-003", title: "Update models", assignee: "slate")
]

#Preview("Lock Screen", as: .content, using: AdjutantActivityAttributes(townName: "Adjutant")) {
    AdjutantLiveActivity()
} contentStates: {
    AdjutantActivityAttributes.ContentState(
        powerState: .running,
        unreadMailCount: 3,
        activeAgents: previewAgents,
        beadsInProgress: previewBeads,
        recentlyCompleted: previewCompleted,
        lastUpdated: Date()
    )
    AdjutantActivityAttributes.ContentState(
        powerState: .stopped,
        unreadMailCount: 0,
        activeAgents: [],
        beadsInProgress: [],
        recentlyCompleted: [],
        lastUpdated: Date()
    )
}

#Preview("Dynamic Island Expanded", as: .dynamicIsland(.expanded), using: AdjutantActivityAttributes(townName: "Adjutant")) {
    AdjutantLiveActivity()
} contentStates: {
    AdjutantActivityAttributes.ContentState(
        powerState: .running,
        unreadMailCount: 3,
        activeAgents: previewAgents,
        beadsInProgress: previewBeads,
        recentlyCompleted: previewCompleted,
        lastUpdated: Date()
    )
}

#Preview("Dynamic Island Compact", as: .dynamicIsland(.compact), using: AdjutantActivityAttributes(townName: "Adjutant")) {
    AdjutantLiveActivity()
} contentStates: {
    AdjutantActivityAttributes.ContentState(
        powerState: .running,
        unreadMailCount: 3,
        activeAgents: previewAgents,
        beadsInProgress: previewBeads,
        recentlyCompleted: previewCompleted,
        lastUpdated: Date()
    )
}

#Preview("Dynamic Island Minimal", as: .dynamicIsland(.minimal), using: AdjutantActivityAttributes(townName: "Adjutant")) {
    AdjutantLiveActivity()
} contentStates: {
    AdjutantActivityAttributes.ContentState(
        powerState: .running,
        unreadMailCount: 3,
        activeAgents: previewAgents,
        beadsInProgress: previewBeads,
        recentlyCompleted: previewCompleted,
        lastUpdated: Date()
    )
}
