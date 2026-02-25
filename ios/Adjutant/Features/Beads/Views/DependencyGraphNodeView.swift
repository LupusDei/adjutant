import SwiftUI
import AdjutantKit

/// A node view for the dependency graph, wrapping CRTCard with status-aware coloring.
/// Shows bead ID, title, type badge, and status indicator with appropriate CRT styling.
struct DependencyGraphNodeView: View {
    @Environment(\.crtTheme) private var theme

    let node: BeadGraphNode
    let isSelected: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxxs) {
            // Top row: ID + type badge
            HStack(spacing: CRTTheme.Spacing.xxs) {
                Text(node.nodeInfo.id)
                    .font(CRTTheme.Typography.font(size: 9, weight: .bold))
                    .foregroundColor(statusColor.opacity(0.9))
                    .tracking(CRTTheme.Typography.letterSpacing)
                    .lineLimit(1)

                Spacer()

                // Type badge
                Text(node.nodeInfo.type.uppercased())
                    .font(CRTTheme.Typography.font(size: 8, weight: .medium))
                    .foregroundColor(statusColor.opacity(0.7))
                    .tracking(0.3)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 1)
                    .background(statusColor.opacity(0.12))
                    .cornerRadius(CRTTheme.CornerRadius.sm)
            }

            // Title
            Text(node.nodeInfo.title)
                .font(CRTTheme.Typography.font(size: 10, weight: .medium))
                .foregroundColor(statusColor)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, CRTTheme.Spacing.xs)
        .padding(.vertical, CRTTheme.Spacing.xxs + 2)
        .frame(
            width: isEpic ? DependencyGraphViewModel.nodeWidth + 20 : DependencyGraphViewModel.nodeWidth,
            height: DependencyGraphViewModel.nodeHeight
        )
        .background(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                .fill(CRTTheme.Background.panel)
        )
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                .stroke(borderColor, lineWidth: isSelected ? 2 : 1)
        )
        .crtGlow(
            color: isSelected ? statusColor : statusColor.opacity(0.3),
            radius: isSelected ? 12 : 4,
            intensity: isSelected ? 0.7 : 0.2
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
    }

    // MARK: - Computed Properties

    /// Whether this node represents an epic (shown slightly larger)
    private var isEpic: Bool {
        node.nodeInfo.type.lowercased() == "epic"
    }

    /// Status-based color for the node
    private var statusColor: Color {
        switch node.nodeInfo.status.lowercased() {
        case "closed":
            return Color(red: 0, green: 1, blue: 0) // bright green #00ff00
        case "in_progress", "hooked":
            return CRTTheme.State.warning // amber/yellow
        case "blocked":
            return CRTTheme.State.error // red
        case "open":
            return CRTTheme.State.offline // dim gray
        default:
            return theme.dim
        }
    }

    /// Border color - brighter when selected or on critical path
    private var borderColor: Color {
        if isSelected {
            return statusColor
        }
        if node.isCriticalPath {
            return Color(red: 0, green: 1, blue: 0).opacity(0.8) // bright green
        }
        return statusColor.opacity(0.4)
    }

    /// Accessibility description
    private var accessibilityLabel: String {
        var label = "\(node.nodeInfo.title), \(node.nodeInfo.type), status \(node.nodeInfo.status)"
        if let assignee = node.nodeInfo.assignee {
            label += ", assigned to \(assignee)"
        }
        if isSelected {
            label += ", selected"
        }
        if node.isCriticalPath {
            label += ", on critical path"
        }
        return label
    }
}

// MARK: - Preview

#Preview("Graph Nodes") {
    let nodes = [
        BeadGraphNode(
            nodeInfo: GraphNodeInfo(id: "adj-001", title: "Root Epic Task", status: "open", type: "epic", priority: 1, assignee: nil, source: "town"),
            position: .zero,
            layer: 0
        ),
        BeadGraphNode(
            nodeInfo: GraphNodeInfo(id: "adj-002", title: "In Progress Task", status: "in_progress", type: "task", priority: 2, assignee: "crew/alice", source: "town"),
            position: .zero,
            layer: 1
        ),
        BeadGraphNode(
            nodeInfo: GraphNodeInfo(id: "adj-003", title: "Closed Task", status: "closed", type: "task", priority: 3, assignee: nil, source: "town"),
            position: .zero,
            layer: 1
        ),
        BeadGraphNode(
            nodeInfo: GraphNodeInfo(id: "adj-004", title: "Blocked Bug", status: "blocked", type: "bug", priority: 0, assignee: "crew/bob", source: "town"),
            position: .zero,
            layer: 2
        ),
    ]

    VStack(spacing: 12) {
        ForEach(Array(nodes.enumerated()), id: \.offset) { index, node in
            DependencyGraphNodeView(node: node, isSelected: index == 1)
        }
    }
    .padding()
    .background(CRTTheme.Background.screen)
}
