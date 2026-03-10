import SwiftUI
import AdjutantKit

/// Compact cost summary widget for embedding in the Dashboard overview.
/// Loads independently of other overview sections with its own data lifecycle.
struct CostOverviewWidget: View {
    @Environment(\.crtTheme) private var theme
    @StateObject private var viewModel = CostOverviewWidgetViewModel()

    var body: some View {
        CRTCard(style: .standard) {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                // Header
                HStack {
                    Image(systemName: "dollarsign.circle.fill")
                        .foregroundColor(theme.primary)
                    CRTText("SPENDING", style: .subheader)

                    Spacer()

                    if viewModel.isLoading && !viewModel.hasLoadedOnce {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: theme.primary))
                            .scaleEffect(0.7)
                    }
                }

                Divider()
                    .background(theme.dim.opacity(0.3))

                if viewModel.hasLoadedOnce {
                    // Total cost with confidence label
                    HStack(alignment: .firstTextBaseline) {
                        HStack(alignment: .firstTextBaseline, spacing: 4) {
                            CRTText(viewModel.formattedTotalCostWithConfidence, style: .header, glowIntensity: .bright)
                                .crtGlow(color: theme.primary, radius: 8, intensity: 0.5)

                            CRTText(
                                viewModel.confidenceLabel,
                                style: .caption,
                                glowIntensity: .none,
                                color: viewModel.isAllVerified ? CRTTheme.State.success : theme.dim
                            )
                        }

                        Spacer()

                        // Burn rate
                        VStack(alignment: .trailing, spacing: 2) {
                            HStack(spacing: CRTTheme.Spacing.xxs) {
                                CRTText(viewModel.formattedBurnRate, style: .caption, color: theme.dim)
                                CRTText(viewModel.trendSymbol, style: .caption, color: trendColor)
                            }
                            CRTText("\(viewModel.sessionCount) SESSIONS", style: .caption, glowIntensity: .none, color: theme.dim)
                        }
                    }

                    // Budget bar (if exists)
                    if let budget = viewModel.primaryBudget {
                        let spend = budget.spendStatus(totalSpent: viewModel.costSummary?.totalCost ?? 0)
                        budgetMiniBar(budget, spend: spend)
                    }
                } else if viewModel.errorMessage != nil {
                    EmptyStateView(
                        title: "COST DATA UNAVAILABLE",
                        icon: "exclamationmark.triangle"
                    )
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, CRTTheme.Spacing.xs)
                } else {
                    // Loading placeholder
                    RoundedRectangle(cornerRadius: 4)
                        .fill(theme.dim.opacity(0.1))
                        .frame(height: 40)
                }
            }
        }
        .task {
            await viewModel.loadData()
        }
        .onAppear {
            viewModel.startAutoRefresh()
        }
        .onDisappear {
            viewModel.stopAutoRefresh()
        }
    }

    // MARK: - Budget Mini Bar

    private func budgetMiniBar(_ budget: BudgetStatus, spend: BudgetSpendStatus) -> some View {
        VStack(spacing: CRTTheme.Spacing.xxs) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(theme.dim.opacity(0.15))
                        .frame(height: 6)
                    RoundedRectangle(cornerRadius: 2)
                        .fill(budgetColor(spend))
                        .frame(width: geo.size.width * min(spend.percentUsed / 100.0, 1.0), height: 6)
                }
            }
            .frame(height: 6)

            HStack {
                CRTText(
                    "\(formatDollars(spend.spent)) / \(formatDollars(spend.budget))",
                    style: .caption,
                    glowIntensity: .none,
                    color: theme.dim
                )
                Spacer()
                CRTText(
                    String(format: "%.0f%%", spend.percentUsed),
                    style: .caption,
                    glowIntensity: .none,
                    color: budgetColor(spend)
                )
            }
        }
    }

    private var trendColor: Color {
        switch viewModel.burnRate?.trend {
        case "increasing": return CRTTheme.State.warning
        case "decreasing": return CRTTheme.State.success
        default: return theme.primary
        }
    }

    private func budgetColor(_ spend: BudgetSpendStatus) -> Color {
        switch spend.status {
        case "exceeded", "critical": return CRTTheme.State.error
        case "warning": return CRTTheme.State.warning
        default: return CRTTheme.State.success
        }
    }

    private func formatDollars(_ amount: Double) -> String {
        if amount < 0.01 && amount > 0 { return "<$0.01" }
        return String(format: "$%.2f", amount)
    }
}

// MARK: - Widget ViewModel

/// Lightweight view model for the cost overview widget.
/// Loads cost summary and burn rate independently.
@MainActor
final class CostOverviewWidgetViewModel: ObservableObject {
    @Published private(set) var costSummary: CostSummary?
    @Published private(set) var burnRate: BurnRate?
    @Published private(set) var budgets: [BudgetStatus] = []
    @Published private(set) var isLoading = false
    @Published private(set) var hasLoadedOnce = false
    @Published var errorMessage: String?

    private let apiClient: APIClient
    private var refreshTimer: Timer?

    init(apiClient: APIClient? = nil) {
        self.apiClient = apiClient ?? AppState.shared.apiClient
    }

    /// Starts a 15-second repeating timer to refresh cost data.
    func startAutoRefresh() {
        stopAutoRefresh()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 15.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task<Void, Never> { @MainActor [weak self] in
                await self?.loadData()
            }
        }
    }

    /// Stops the auto-refresh timer.
    func stopAutoRefresh() {
        refreshTimer?.invalidate()
        refreshTimer = nil
    }

    func loadData() async {
        isLoading = true
        let client = apiClient

        let summaryHandle = Task<CostSummary?, Error> {
            try await client.getCostSummary()
        }
        let burnRateHandle = Task<BurnRate?, Error> {
            try await client.getBurnRate()
        }
        let budgetsHandle = Task<[BudgetStatus]?, Error> {
            try await client.getBudgets()
        }

        if let summary = try? await summaryHandle.value {
            costSummary = summary
        }
        if let rate = try? await burnRateHandle.value {
            burnRate = rate
        }
        if let budgetList = try? await budgetsHandle.value {
            budgets = budgetList
        }

        if costSummary == nil && !hasLoadedOnce {
            errorMessage = "Failed to load cost data"
        } else {
            errorMessage = nil
        }

        hasLoadedOnce = true
        isLoading = false
    }

    var formattedTotalCost: String {
        guard let cost = costSummary?.totalCost else { return "$0.00" }
        if cost < 0.01 && cost > 0 { return "<$0.01" }
        return String(format: "$%.2f", cost)
    }

    /// Total cost with tilde prefix when not fully verified.
    var formattedTotalCostWithConfidence: String {
        let base = formattedTotalCost
        return isAllVerified ? base : "~\(base)"
    }

    /// Whether all sessions have verified reconciliation status.
    var isAllVerified: Bool {
        guard let sessions = costSummary?.sessions, !sessions.isEmpty else { return false }
        return sessions.values.allSatisfy { $0.effectiveReconciliationStatus == "verified" }
    }

    /// Short confidence label for display.
    var confidenceLabel: String {
        isAllVerified ? "(VERIFIED)" : "(EST.)"
    }

    var sessionCount: Int {
        costSummary?.sessions.count ?? 0
    }

    var formattedBurnRate: String {
        guard let rate = burnRate else { return "$0/hr" }
        let hourlyRate = rate.rate1h
        if hourlyRate < 1.0 {
            return String(format: "$%.2f/hr", hourlyRate)
        }
        return String(format: "$%.0f/hr", hourlyRate)
    }

    var trendSymbol: String {
        burnRate?.trendSymbol ?? "\u{2192}"
    }

    var primaryBudget: BudgetStatus? {
        budgets.first
    }
}

// MARK: - Preview

#Preview("Cost Overview Widget") {
    CostOverviewWidget()
        .padding()
        .background(CRTTheme.ColorTheme.pipboy.background.screen)
}
