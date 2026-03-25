import SwiftUI
import AdjutantKit

/// Displays the auto-develop loop state within a project detail view.
///
/// Shows the current phase in the development pipeline, proposal counts,
/// cycle statistics, and the number of epics currently in execution.
struct AutoDevelopStatusView: View {
    @Environment(\.crtTheme) private var theme

    let status: AutoDevelopStatus

    /// The ordered phases of the auto-develop pipeline.
    private static let phases = [
        "analyze",
        "propose",
        "review",
        "plan",
        "execute",
        "verify",
        "report"
    ]

    var body: some View {
        VStack(spacing: CRTTheme.Spacing.sm) {
            phasePipeline
            proposalCountsGrid
            statsRow
        }
    }

    // MARK: - Phase Pipeline

    private var phasePipeline: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
            CRTText("PIPELINE", style: .caption, glowIntensity: .subtle, color: theme.dim)

            HStack(spacing: CRTTheme.Spacing.xs) {
                ForEach(Self.phases, id: \.self) { phase in
                    let isActive = phase == status.currentPhase
                    VStack(spacing: 2) {
                        Circle()
                            .fill(isActive ? theme.primary : theme.dim.opacity(0.3))
                            .frame(width: 8, height: 8)
                            .shadow(
                                color: isActive ? theme.primary.opacity(0.6) : .clear,
                                radius: isActive ? 4 : 0
                            )

                        CRTText(
                            phase.uppercased(),
                            style: .caption,
                            glowIntensity: isActive ? .medium : .none,
                            color: isActive ? theme.primary : theme.dim.opacity(0.5)
                        )
                        .font(.system(size: 8, design: .monospaced))
                    }
                    .frame(maxWidth: .infinity)
                }
            }
        }
    }

    // MARK: - Proposal Counts

    private var proposalCountsGrid: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
            CRTText("PROPOSALS", style: .caption, glowIntensity: .subtle, color: theme.dim)

            HStack(spacing: CRTTheme.Spacing.sm) {
                proposalStat(label: "REVIEW", count: status.proposals.inReview, color: CRTTheme.State.info)
                proposalStat(label: "ACCEPTED", count: status.proposals.accepted, color: CRTTheme.State.success)
                proposalStat(label: "ESCALATED", count: status.proposals.escalated, color: CRTTheme.State.warning)
                proposalStat(label: "DISMISSED", count: status.proposals.dismissed, color: theme.dim)
            }
        }
    }

    private func proposalStat(label: String, count: Int, color: Color) -> some View {
        VStack(spacing: 2) {
            CRTText("\(count)", style: .body, glowIntensity: count > 0 ? .subtle : .none, color: color)
            CRTText(label, style: .caption, glowIntensity: .none, color: theme.dim.opacity(0.7))
                .font(.system(size: 8, design: .monospaced))
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Stats Row

    private var statsRow: some View {
        HStack(spacing: CRTTheme.Spacing.lg) {
            VStack(spacing: 2) {
                CRTText(
                    "\(status.cycleStats.completedCycles)/\(status.cycleStats.totalCycles)",
                    style: .body,
                    glowIntensity: .subtle,
                    color: theme.primary
                )
                CRTText("CYCLES", style: .caption, glowIntensity: .subtle, color: theme.dim)
            }

            VStack(spacing: 2) {
                CRTText(
                    "\(status.epicsInExecution)",
                    style: .body,
                    glowIntensity: status.epicsInExecution > 0 ? .medium : .subtle,
                    color: status.epicsInExecution > 0 ? CRTTheme.State.success : theme.dim
                )
                CRTText("EPICS ACTIVE", style: .caption, glowIntensity: .subtle, color: theme.dim)
            }

            if let cycleId = status.activeCycleId {
                VStack(spacing: 2) {
                    CRTText(
                        String(cycleId.prefix(8)).uppercased(),
                        style: .body,
                        glowIntensity: .subtle,
                        color: theme.primary
                    )
                    CRTText("CYCLE ID", style: .caption, glowIntensity: .subtle, color: theme.dim)
                }
            }
        }
    }
}
