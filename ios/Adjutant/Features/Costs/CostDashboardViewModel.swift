import Foundation
import Combine
import AdjutantKit

/// ViewModel for the cost dashboard, coordinating cost summary, burn rate, and budget data.
/// Auto-refreshes every 15 seconds while the view is visible.
@MainActor
final class CostDashboardViewModel: BaseViewModel {
    // MARK: - Published Properties

    /// Overall cost summary
    @Published private(set) var costSummary: CostSummary?

    /// Current burn rate
    @Published private(set) var burnRate: BurnRate?

    /// Active budgets
    @Published private(set) var budgets: [BudgetStatus] = []

    /// Whether the view has loaded data at least once
    @Published private(set) var hasLoadedOnce = false

    // MARK: - Dependencies

    private let apiClient: APIClient
    private var refreshTimer: Timer?

    // MARK: - Initialization

    init(apiClient: APIClient? = nil) {
        self.apiClient = apiClient ?? AppState.shared.apiClient
        super.init()
    }

    // MARK: - Lifecycle

    override func onAppear() {
        startTrackedTask {
            await self.refresh()
        }
        startAutoRefresh()
    }

    override func onDisappear() {
        super.onDisappear()
        stopAutoRefresh()
    }

    // MARK: - Data Loading

    override func refresh() async {
        await fetchAll()
    }

    /// Fetches cost summary, burn rate, and budgets concurrently.
    private func fetchAll() async {
        let client = self.apiClient

        // Launch all three fetches independently
        let summaryHandle = Task<CostSummary?, Error> {
            try await client.getCostSummary()
        }
        let burnRateHandle = Task<BurnRate?, Error> {
            try await client.getBurnRate()
        }
        let budgetsHandle = Task<[BudgetStatus]?, Error> {
            try await client.getBudgets()
        }

        // Await results independently — partial success is OK
        if let summary = try? await summaryHandle.value {
            costSummary = summary
        }

        if let rate = try? await burnRateHandle.value {
            burnRate = rate
        }

        if let budgetList = try? await budgetsHandle.value {
            budgets = budgetList
        }

        // If nothing loaded at all and we have no cached data, show error
        if costSummary == nil && burnRate == nil && budgets.isEmpty && !hasLoadedOnce {
            errorMessage = "Failed to load cost data"
        } else {
            errorMessage = nil
        }

        hasLoadedOnce = true
    }

    // MARK: - Auto-Refresh

    private func startAutoRefresh() {
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 15.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor [weak self] in
                await self?.refresh()
            }
        }
    }

    private func stopAutoRefresh() {
        refreshTimer?.invalidate()
        refreshTimer = nil
    }

    // MARK: - Computed Properties

    /// Formatted total cost string (e.g., "$47.32")
    var formattedTotalCost: String {
        guard let cost = costSummary?.totalCost else { return "$0.00" }
        return formatDollars(cost)
    }

    /// Number of active sessions
    var sessionCount: Int {
        costSummary?.sessions.count ?? 0
    }

    /// Formatted burn rate string (e.g., "$18/hr")
    var formattedBurnRate: String {
        guard let rate = burnRate else { return "$0/hr" }
        let hourlyRate = rate.rate1h
        if hourlyRate < 1.0 {
            return String(format: "$%.2f/hr", hourlyRate)
        }
        return String(format: "$%.0f/hr", hourlyRate)
    }

    /// Trend symbol for burn rate
    var trendSymbol: String {
        burnRate?.trendSymbol ?? "\u{2192}"
    }

    /// Trend description
    var trendDescription: String {
        burnRate?.trend.uppercased() ?? "STABLE"
    }

    /// Per-session costs sorted by most expensive first
    var sortedSessionCosts: [SessionCost] {
        guard let summary = costSummary else { return [] }
        return summary.sessions.values.sorted { $0.cost > $1.cost }
    }

    /// Total token counts
    var totalTokens: TokenBreakdown? {
        costSummary?.totalTokens
    }

    /// First (primary) budget, if any
    var primaryBudget: BudgetStatus? {
        budgets.first
    }

    // MARK: - Helpers

    /// Formats a dollar amount for display
    func formatDollars(_ amount: Double) -> String {
        if amount < 0.01 && amount > 0 {
            return "<$0.01"
        }
        return String(format: "$%.2f", amount)
    }
}
