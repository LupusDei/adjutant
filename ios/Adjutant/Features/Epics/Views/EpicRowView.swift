import SwiftUI
import AdjutantKit

/// Row view for displaying an epic with progress bar
struct EpicRowView: View {
    @Environment(\.crtTheme) private var theme

    let epic: EpicWithProgress
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
                // Title row
                HStack {
                    CRTText(epic.epic.title, style: .body, glowIntensity: .medium)
                        .lineLimit(2)

                    Spacer()

                    // Progress count
                    CRTText(epic.progressText, style: .mono, glowIntensity: .subtle, color: theme.dim)
                }

                // Progress bar
                GeometryReader { geometry in
                    ZStack(alignment: .leading) {
                        // Background
                        RoundedRectangle(cornerRadius: 2)
                            .fill(theme.dim.opacity(0.2))
                            .frame(height: 6)

                        // Progress fill
                        RoundedRectangle(cornerRadius: 2)
                            .fill(progressColor)
                            .frame(width: geometry.size.width * epic.progress, height: 6)
                            .crtGlow(color: progressColor, radius: 4, intensity: 0.5)
                    }
                }
                .frame(height: 6)

                // Epic metadata row
                HStack(spacing: CRTTheme.Spacing.sm) {
                    // Epic ID
                    CRTText(epic.epic.id.uppercased(), style: .caption, glowIntensity: .none, color: theme.dim)

                    // Rig badge if present
                    if let rig = epic.epic.rig {
                        BadgeView(rig.uppercased(), style: .label)
                    }

                    Spacer()

                    // Status indicator
                    HStack(spacing: CRTTheme.Spacing.xxs) {
                        Circle()
                            .fill(statusColor)
                            .frame(width: 6, height: 6)
                        CRTText(statusText, style: .caption, glowIntensity: .none, color: theme.dim)
                    }
                }
            }
            .padding(CRTTheme.Spacing.sm)
            .background(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                    .fill(theme.background.elevated)
            )
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                    .stroke(theme.dim.opacity(0.3), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Computed Properties

    private var progressColor: Color {
        if epic.isComplete {
            return CRTTheme.State.success
        } else if epic.progress > 0.5 {
            return theme.primary
        } else if epic.progress > 0 {
            return CRTTheme.State.warning
        } else {
            return theme.dim
        }
    }

    private var statusColor: Color {
        if epic.isComplete {
            return CRTTheme.State.success
        } else {
            return theme.primary
        }
    }

    private var statusText: String {
        if epic.isComplete {
            return "COMPLETE"
        } else if epic.totalCount == 0 {
            return "NO TASKS"
        } else {
            return "IN PROGRESS"
        }
    }
}

// MARK: - Preview

#Preview("Epic Row - In Progress") {
    let epic = EpicWithProgress(
        epic: BeadInfo(
            id: "adj-abc123",
            title: "Implement Epics view in iOS app",
            status: "open",
            priority: 1,
            type: "epic",
            assignee: nil,
            rig: "adjutant",
            source: "adjutant",
            labels: [],
            createdAt: "2026-02-01T12:00:00Z",
            updatedAt: "2026-02-01T12:30:00Z"
        ),
        completedCount: 2,
        totalCount: 5
    )

    return EpicRowView(epic: epic) {}
        .padding()
        .background(CRTTheme.ColorTheme.pipboy.background.screen)
}

#Preview("Epic Row - Complete") {
    let epic = EpicWithProgress(
        epic: BeadInfo(
            id: "adj-xyz789",
            title: "Implement Dashboard View",
            status: "closed",
            priority: 2,
            type: "epic",
            assignee: nil,
            rig: "adjutant",
            source: "adjutant",
            labels: [],
            createdAt: "2026-01-15T10:00:00Z",
            updatedAt: "2026-01-20T15:00:00Z"
        ),
        completedCount: 8,
        totalCount: 8
    )

    return EpicRowView(epic: epic) {}
        .padding()
        .background(CRTTheme.ColorTheme.pipboy.background.screen)
}
