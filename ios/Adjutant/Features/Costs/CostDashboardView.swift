import SwiftUI
import AdjutantKit

/// Full cost dashboard view matching the web frontend 1:1.
/// Displays total spend, burn rate, budget progress, per-agent breakdown, and token summary.
struct CostDashboardView: View {
    @StateObject private var viewModel = CostDashboardViewModel()
    @Environment(\.crtTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(spacing: CRTTheme.Spacing.md) {
                // Header
                AppHeaderView(
                    title: "COSTS",
                    subtitle: "SPENDING DASHBOARD",
                    isLoading: viewModel.isLoading
                )

                if !viewModel.hasLoadedOnce && viewModel.isLoading {
                    // Loading skeleton
                    loadingSkeleton
                } else {
                    // Total Spend hero
                    totalSpendCard

                    // Burn Rate
                    burnRateCard

                    // Budget bar (if budget exists)
                    if let budget = viewModel.primaryBudget {
                        let spend = budget.spendStatus(totalSpent: viewModel.costSummary?.totalCost ?? 0)
                        budgetCard(budget, spend: spend)
                    }

                    // Per-agent breakdown
                    agentBreakdownCard

                    // Token summary
                    tokenSummaryCard
                }
            }
            .padding(.vertical, CRTTheme.Spacing.md)
        }
        .background(theme.background.screen)
        .refreshable {
            await viewModel.refresh()
        }
        .onAppear {
            viewModel.onAppear()
        }
        .onDisappear {
            viewModel.onDisappear()
        }
    }

    // MARK: - Loading Skeleton

    private var loadingSkeleton: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            // Placeholder cards with pulsing animation
            ForEach(0..<3, id: \.self) { _ in
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                    .fill(theme.dim.opacity(0.1))
                    .frame(height: 80)
                    .overlay(
                        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                            .stroke(theme.dim.opacity(0.2), lineWidth: 1)
                    )
            }
            .padding(.horizontal, CRTTheme.Spacing.md)

            LoadingIndicator(size: .large, text: "LOADING COST DATA")
        }
    }

    // MARK: - Total Spend Card

    private var totalSpendCard: some View {
        CRTCard(style: .elevated) {
            VStack(spacing: CRTTheme.Spacing.sm) {
                // Large dollar amount with confidence indicator
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    CRTText(viewModel.formattedTotalCostWithConfidence, style: .header, glowIntensity: .bright)
                        .crtGlow(color: theme.primary, radius: 12, intensity: 0.6)

                    CRTText(
                        viewModel.confidenceLabel,
                        style: .caption,
                        glowIntensity: .none,
                        color: viewModel.isAllVerified ? CRTTheme.State.success : theme.dim
                    )
                }

                // Subtitle
                CRTText(
                    "ACROSS \(viewModel.sessionCount) SESSIONS",
                    style: .caption,
                    glowIntensity: .subtle,
                    color: theme.dim
                )
            }
            .frame(maxWidth: .infinity)
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
    }

    // MARK: - Burn Rate Card

    private var burnRateCard: some View {
        CRTCard(style: .standard) {
            HStack {
                VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
                    CRTText("BURN RATE", style: .caption, glowIntensity: .subtle, color: theme.dim)

                    HStack(spacing: CRTTheme.Spacing.xs) {
                        CRTText(viewModel.formattedBurnRate, style: .subheader, glowIntensity: .medium)

                        // Trend indicator
                        CRTText(
                            viewModel.trendSymbol,
                            style: .subheader,
                            glowIntensity: .medium,
                            color: trendColor
                        )
                    }
                }

                Spacer()

                // Trend label
                BadgeView(viewModel.trendDescription, style: .status(trendStatusType))
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
    }

    private var trendColor: Color {
        switch viewModel.burnRate?.trend {
        case "increasing": return CRTTheme.State.warning
        case "decreasing": return CRTTheme.State.success
        default: return theme.primary
        }
    }

    private var trendStatusType: BadgeView.Style.StatusType {
        switch viewModel.burnRate?.trend {
        case "increasing": return .warning
        case "decreasing": return .success
        default: return .info
        }
    }

    // MARK: - Budget Card

    private func budgetCard(_ budget: BudgetStatus, spend: BudgetSpendStatus) -> some View {
        CRTCard(style: .standard) {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                HStack {
                    CRTText("BUDGET", style: .caption, glowIntensity: .subtle, color: theme.dim)
                    Spacer()
                    BadgeView(spend.status.uppercased(), style: .status(budgetStatusType(spend)))
                }

                // Progress bar
                GeometryReader { geometry in
                    ZStack(alignment: .leading) {
                        // Background
                        RoundedRectangle(cornerRadius: 4)
                            .fill(theme.dim.opacity(0.2))
                            .frame(height: 12)

                        // Progress fill
                        RoundedRectangle(cornerRadius: 4)
                            .fill(budgetColor(spend))
                            .frame(
                                width: geometry.size.width * min(spend.percentUsed / 100.0, 1.0),
                                height: 12
                            )
                            .crtGlow(color: budgetColor(spend), radius: 4, intensity: 0.5)

                        // Warning threshold line
                        Rectangle()
                            .fill(CRTTheme.State.warning.opacity(0.6))
                            .frame(width: 2, height: 16)
                            .offset(x: geometry.size.width * (budget.warningPercent / 100.0) - 1)

                        // Critical threshold line
                        Rectangle()
                            .fill(CRTTheme.State.error.opacity(0.6))
                            .frame(width: 2, height: 16)
                            .offset(x: geometry.size.width * (budget.criticalPercent / 100.0) - 1)
                    }
                }
                .frame(height: 16)

                // Budget text
                HStack {
                    CRTText(
                        "\(viewModel.formatDollars(spend.spent)) / \(viewModel.formatDollars(spend.budget))",
                        style: .body,
                        glowIntensity: .subtle,
                        color: budgetColor(spend)
                    )

                    Spacer()

                    CRTText(
                        String(format: "%.0f%%", spend.percentUsed),
                        style: .mono,
                        glowIntensity: .medium,
                        color: budgetColor(spend)
                    )
                }
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
    }

    private func budgetColor(_ spend: BudgetSpendStatus) -> Color {
        switch spend.status {
        case "exceeded": return CRTTheme.State.error
        case "critical": return CRTTheme.State.error
        case "warning": return CRTTheme.State.warning
        default: return CRTTheme.State.success
        }
    }

    private func budgetStatusType(_ spend: BudgetSpendStatus) -> BadgeView.Style.StatusType {
        switch spend.status {
        case "exceeded", "critical": return .warning
        case "warning": return .info
        default: return .success
        }
    }

    // MARK: - Agent Breakdown Card

    private var agentBreakdownCard: some View {
        CRTCard(style: .standard) {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                HStack {
                    Image(systemName: "person.3.fill")
                        .foregroundColor(theme.primary)
                    CRTText("PER-SESSION BREAKDOWN", style: .caption, glowIntensity: .subtle, color: theme.dim)
                    Spacer()
                    CRTText("\(viewModel.sortedSessionCosts.count)", style: .caption, color: theme.dim)
                }

                Divider()
                    .background(theme.dim.opacity(0.3))

                if viewModel.sortedSessionCosts.isEmpty {
                    EmptyStateView(
                        title: "NO SESSION DATA",
                        icon: "dollarsign.circle"
                    )
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, CRTTheme.Spacing.sm)
                } else {
                    VStack(spacing: CRTTheme.Spacing.xs) {
                        ForEach(viewModel.sortedSessionCosts.prefix(10)) { session in
                            sessionCostRow(session)
                        }
                        if viewModel.sortedSessionCosts.count > 10 {
                            CRTText(
                                "+\(viewModel.sortedSessionCosts.count - 10) more",
                                style: .caption,
                                color: theme.dim
                            )
                            .frame(maxWidth: .infinity, alignment: .center)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
    }

    private func sessionCostRow(_ session: SessionCost) -> some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            // Session name (truncated project path)
            CRTText(
                sessionDisplayName(session),
                style: .caption,
                color: theme.primary
            )
            .lineLimit(1)

            Spacer()

            // Cost with reconciliation indicator
            HStack(spacing: 4) {
                CRTText(
                    viewModel.formatDollars(session.cost),
                    style: .mono,
                    glowIntensity: .subtle,
                    color: theme.bright
                )
                CRTText(
                    reconciliationIndicator(for: session),
                    style: .caption,
                    glowIntensity: .none,
                    color: reconciliationColor(for: session)
                )
            }
        }
        .padding(CRTTheme.Spacing.xs)
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(theme.dim.opacity(0.05))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 4)
                .stroke(theme.dim.opacity(0.15), lineWidth: 1)
        )
    }

    /// Returns the indicator character for a session's reconciliation status.
    private func reconciliationIndicator(for session: SessionCost) -> String {
        switch session.effectiveReconciliationStatus {
        case "verified": return "\u{2713}"    // checkmark
        case "discrepancy": return "\u{26A0}" // warning
        default: return "~"
        }
    }

    /// Returns the color for a session's reconciliation status indicator.
    private func reconciliationColor(for session: SessionCost) -> Color {
        switch session.effectiveReconciliationStatus {
        case "verified": return CRTTheme.State.success
        case "discrepancy": return CRTTheme.State.warning
        default: return theme.dim
        }
    }

    /// Extracts a display name from a session, preferring agent name over session UUID
    private func sessionDisplayName(_ session: SessionCost) -> String {
        // Prefer agent name when available (adj-2jd0)
        if let agentId = session.agentId, !agentId.isEmpty {
            return agentId.uppercased()
        }
        // Fall back to project path / session ID
        let projectName = session.projectPath.components(separatedBy: "/").last ?? session.projectPath
        if projectName.isEmpty {
            return session.sessionId.prefix(12).uppercased()
        }
        return "\(projectName.uppercased()) / \(session.sessionId.prefix(8).uppercased())"
    }

    // MARK: - Token Summary Card

    private var tokenSummaryCard: some View {
        CRTCard(style: .standard) {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                HStack {
                    Image(systemName: "chart.bar.fill")
                        .foregroundColor(theme.primary)
                    CRTText("TOKEN BREAKDOWN", style: .caption, glowIntensity: .subtle, color: theme.dim)
                }

                Divider()
                    .background(theme.dim.opacity(0.3))

                if let tokens = viewModel.totalTokens {
                    VStack(spacing: CRTTheme.Spacing.xs) {
                        tokenRow("INPUT", count: tokens.input, total: tokens.total)
                        tokenRow("OUTPUT", count: tokens.output, total: tokens.total)
                        tokenRow("CACHE READ", count: tokens.cacheRead, total: tokens.total)
                        tokenRow("CACHE WRITE", count: tokens.cacheWrite, total: tokens.total)

                        Divider()
                            .background(theme.dim.opacity(0.2))

                        HStack {
                            CRTText("TOTAL", style: .caption, glowIntensity: .subtle, color: theme.primary)
                            Spacer()
                            CRTText(formatTokenCount(tokens.total), style: .mono, glowIntensity: .medium)
                        }
                    }
                } else {
                    EmptyStateView(
                        title: "NO TOKEN DATA",
                        icon: "number"
                    )
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, CRTTheme.Spacing.sm)
                }
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
    }

    private func tokenRow(_ label: String, count: Int, total: Int) -> some View {
        HStack {
            CRTText(label, style: .caption, glowIntensity: .none, color: theme.dim)

            Spacer()

            // Percentage bar
            if total > 0 {
                let fraction = Double(count) / Double(total)
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(theme.dim.opacity(0.1))
                            .frame(height: 4)
                        RoundedRectangle(cornerRadius: 2)
                            .fill(theme.primary.opacity(0.6))
                            .frame(width: geo.size.width * fraction, height: 4)
                    }
                }
                .frame(width: 60, height: 4)
            }

            CRTText(formatTokenCount(count), style: .mono, glowIntensity: .subtle, color: theme.dim)
                .frame(minWidth: 60, alignment: .trailing)
        }
    }

    /// Formats a token count for display (e.g., "1.2M", "45.3K")
    private func formatTokenCount(_ count: Int) -> String {
        if count >= 1_000_000 {
            return String(format: "%.1fM", Double(count) / 1_000_000.0)
        } else if count >= 1_000 {
            return String(format: "%.1fK", Double(count) / 1_000.0)
        }
        return "\(count)"
    }
}

// MARK: - Preview

#Preview("Cost Dashboard") {
    CostDashboardView()
}

#Preview("Cost Dashboard - Pipboy") {
    CostDashboardView()
        .crtTheme(.pipboy)
}
