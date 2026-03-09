import Foundation

// MARK: - Cost Endpoints

extension APIClient {
    /// Fetch the overall cost summary including per-session and per-project breakdowns.
    ///
    /// - Returns: A ``CostSummary`` with total cost, token breakdown, and per-entity data.
    /// - Throws: ``APIClientError`` if the request fails.
    public func getCostSummary() async throws -> CostSummary {
        try await request(.get, path: "/costs")
    }

    /// Fetch the current burn rate (cost velocity).
    ///
    /// - Returns: A ``BurnRate`` with 10-minute and 1-hour rates plus trend direction.
    /// - Throws: ``APIClientError`` if the request fails.
    public func getBurnRate() async throws -> BurnRate {
        try await request(.get, path: "/costs/burn-rate")
    }

    /// Fetch all configured budgets with current spend status.
    ///
    /// - Returns: An array of ``BudgetStatus`` entries.
    /// - Throws: ``APIClientError`` if the request fails.
    public func getBudgets() async throws -> [BudgetStatus] {
        try await request(.get, path: "/costs/budget")
    }

    /// Create a new budget.
    ///
    /// - Parameters:
    ///   - scope: Budget scope ("session" or "project")
    ///   - scopeId: Optional scope target identifier
    ///   - amount: Budget amount in dollars
    ///   - warningPercent: Warning threshold percentage (defaults to 80)
    ///   - criticalPercent: Critical threshold percentage (defaults to 95)
    /// - Returns: The created ``BudgetStatus``.
    /// - Throws: ``APIClientError`` if the request fails.
    public func createBudget(
        scope: String,
        scopeId: String? = nil,
        amount: Double,
        warningPercent: Double? = nil,
        criticalPercent: Double? = nil
    ) async throws -> BudgetStatus {
        let body = CreateBudgetRequest(
            scope: scope,
            scopeId: scopeId,
            amount: amount,
            warningPercent: warningPercent,
            criticalPercent: criticalPercent
        )
        return try await request(.post, path: "/costs/budget", body: body)
    }

    /// Delete a budget by ID.
    ///
    /// - Parameter id: The budget identifier to delete.
    /// - Throws: ``APIClientError`` if the request fails.
    public func deleteBudget(id: Int) async throws {
        let _: EmptyResponse = try await request(.delete, path: "/costs/budget/\(id)")
    }

    /// Fetch cost data for a specific bead, optionally aggregated with child beads.
    ///
    /// - Parameters:
    ///   - beadId: The bead identifier to look up.
    ///   - children: Optional array of child bead IDs for epic cost aggregation.
    /// - Returns: A ``BeadCost`` with total cost and token breakdown.
    /// - Throws: ``APIClientError`` if the request fails.
    public func getBeadCost(beadId: String, children: [String]? = nil) async throws -> BeadCost {
        let encodedId = beadId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? beadId
        var queryItems: [URLQueryItem] = []
        if let children, !children.isEmpty {
            queryItems.append(URLQueryItem(name: "children", value: children.joined(separator: ",")))
        }
        return try await request(
            .get,
            path: "/costs/by-bead/\(encodedId)",
            queryItems: queryItems.isEmpty ? nil : queryItems
        )
    }
}
