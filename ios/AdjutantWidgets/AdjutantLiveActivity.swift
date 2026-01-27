//
//  AdjutantLiveActivity.swift
//  AdjutantWidgets
//
//  Live Activity widget for displaying Gas Town status on Lock Screen
//  and Dynamic Island.
//

import SwiftUI
import WidgetKit
import ActivityKit
import AdjutantKit

// MARK: - Live Activity Widget

/// Live Activity configuration for Gas Town status display.
struct AdjutantLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: GastownActivityAttributes.self) { context in
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

// MARK: - Lock Screen View

/// Main Lock Screen presentation for the Live Activity.
/// Shows comprehensive Gas Town status information.
private struct LockScreenView: View {
    let context: ActivityViewContext<GastownActivityAttributes>

    var body: some View {
        HStack(spacing: 16) {
            // Power state indicator
            PowerStateView(powerState: context.state.powerState)

            VStack(alignment: .leading, spacing: 4) {
                // Town name
                Text(context.attributes.townName)
                    .font(.headline)
                    .fontWeight(.semibold)

                // Status summary
                HStack(spacing: 12) {
                    StatusBadge(
                        icon: "circle.fill",
                        value: context.state.beadsInProgress,
                        label: "active"
                    )

                    StatusBadge(
                        icon: "pin.fill",
                        value: context.state.beadsHooked,
                        label: "hooked"
                    )

                    StatusBadge(
                        icon: "person.2.fill",
                        value: context.state.activeAgents,
                        label: "agents"
                    )
                }
                .font(.caption)
            }

            Spacer()

            // Last updated timestamp
            VStack(alignment: .trailing, spacing: 2) {
                Text("Updated")
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                Text(context.state.lastUpdated, style: .time)
                    .font(.caption)
                    .monospacedDigit()
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

/// Leading region of expanded Dynamic Island.
private struct ExpandedLeadingView: View {
    let context: ActivityViewContext<GastownActivityAttributes>

    var body: some View {
        PowerStateView(powerState: context.state.powerState)
            .frame(width: 44, height: 44)
    }
}

/// Trailing region of expanded Dynamic Island.
private struct ExpandedTrailingView: View {
    let context: ActivityViewContext<GastownActivityAttributes>

    var body: some View {
        VStack(alignment: .trailing, spacing: 2) {
            Text(context.state.lastUpdated, style: .time)
                .font(.caption2)
                .monospacedDigit()
        }
    }
}

/// Center region of expanded Dynamic Island.
private struct ExpandedCenterView: View {
    let context: ActivityViewContext<GastownActivityAttributes>

    var body: some View {
        Text(context.attributes.townName)
            .font(.headline)
            .fontWeight(.semibold)
    }
}

/// Bottom region of expanded Dynamic Island.
private struct ExpandedBottomView: View {
    let context: ActivityViewContext<GastownActivityAttributes>

    var body: some View {
        HStack(spacing: 16) {
            HStack(spacing: 4) {
                Image(systemName: "circle.fill")
                    .foregroundStyle(.blue)
                Text("\(context.state.beadsInProgress)")
                    .fontWeight(.medium)
                Text("active")
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 4) {
                Image(systemName: "pin.fill")
                    .foregroundStyle(.orange)
                Text("\(context.state.beadsHooked)")
                    .fontWeight(.medium)
                Text("hooked")
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 4) {
                Image(systemName: "person.2.fill")
                    .foregroundStyle(.green)
                Text("\(context.state.activeAgents)")
                    .fontWeight(.medium)
                Text("agents")
                    .foregroundStyle(.secondary)
            }
        }
        .font(.caption)
    }
}

// MARK: - Dynamic Island Compact Views

/// Compact leading view for collapsed Dynamic Island.
private struct CompactLeadingView: View {
    let context: ActivityViewContext<GastownActivityAttributes>

    var body: some View {
        Image(systemName: powerStateIcon(for: context.state.powerState))
            .foregroundStyle(powerStateColor(for: context.state.powerState))
    }
}

/// Compact trailing view for collapsed Dynamic Island.
private struct CompactTrailingView: View {
    let context: ActivityViewContext<GastownActivityAttributes>

    var body: some View {
        HStack(spacing: 4) {
            // Show beads in progress count (most important metric)
            Image(systemName: "circle.fill")
                .font(.caption2)
                .foregroundStyle(.blue)
            Text("\(context.state.beadsInProgress)")
                .font(.caption)
                .monospacedDigit()
        }
    }
}

// MARK: - Dynamic Island Minimal View

/// Minimal view for Dynamic Island when multiple activities are present.
private struct MinimalView: View {
    let context: ActivityViewContext<GastownActivityAttributes>

    var body: some View {
        Image(systemName: powerStateIcon(for: context.state.powerState))
            .foregroundStyle(powerStateColor(for: context.state.powerState))
    }
}

// MARK: - Shared Components

/// Visual indicator for power state.
private struct PowerStateView: View {
    let powerState: PowerState

    var body: some View {
        ZStack {
            Circle()
                .fill(powerStateColor(for: powerState).opacity(0.2))

            Image(systemName: powerStateIcon(for: powerState))
                .font(.title2)
                .foregroundStyle(powerStateColor(for: powerState))
        }
        .frame(width: 44, height: 44)
    }
}

/// Badge showing an icon with a numeric value.
private struct StatusBadge: View {
    let icon: String
    let value: Int
    let label: String

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
            Text("\(value)")
                .fontWeight(.medium)
            Text(label)
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - Helper Functions

/// Returns the appropriate SF Symbol for a power state.
private func powerStateIcon(for powerState: PowerState) -> String {
    switch powerState {
    case .running:
        return "bolt.fill"
    case .starting:
        return "arrow.up.circle.fill"
    case .stopping:
        return "arrow.down.circle.fill"
    case .stopped:
        return "moon.fill"
    }
}

/// Returns the appropriate color for a power state.
private func powerStateColor(for powerState: PowerState) -> Color {
    switch powerState {
    case .running:
        return .green
    case .starting, .stopping:
        return .yellow
    case .stopped:
        return .gray
    }
}

// MARK: - Previews

#Preview("Lock Screen", as: .content, using: GastownActivityAttributes(townName: "Adjutant")) {
    AdjutantLiveActivity()
} contentStates: {
    GastownActivityAttributes.ContentState(
        powerState: .running,
        unreadMailCount: 3,
        activeAgents: 5,
        beadsInProgress: 4,
        beadsHooked: 2,
        lastUpdated: Date()
    )
    GastownActivityAttributes.ContentState(
        powerState: .stopped,
        unreadMailCount: 0,
        activeAgents: 0,
        beadsInProgress: 0,
        beadsHooked: 0,
        lastUpdated: Date()
    )
}

#Preview("Dynamic Island Expanded", as: .dynamicIsland(.expanded), using: GastownActivityAttributes(townName: "Adjutant")) {
    AdjutantLiveActivity()
} contentStates: {
    GastownActivityAttributes.ContentState(
        powerState: .running,
        unreadMailCount: 3,
        activeAgents: 5,
        beadsInProgress: 4,
        beadsHooked: 2,
        lastUpdated: Date()
    )
}

#Preview("Dynamic Island Compact", as: .dynamicIsland(.compact), using: GastownActivityAttributes(townName: "Adjutant")) {
    AdjutantLiveActivity()
} contentStates: {
    GastownActivityAttributes.ContentState(
        powerState: .running,
        unreadMailCount: 3,
        activeAgents: 5,
        beadsInProgress: 4,
        beadsHooked: 2,
        lastUpdated: Date()
    )
}

#Preview("Dynamic Island Minimal", as: .dynamicIsland(.minimal), using: GastownActivityAttributes(townName: "Adjutant")) {
    AdjutantLiveActivity()
} contentStates: {
    GastownActivityAttributes.ContentState(
        powerState: .running,
        unreadMailCount: 3,
        activeAgents: 5,
        beadsInProgress: 4,
        beadsHooked: 2,
        lastUpdated: Date()
    )
}
