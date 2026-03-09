import Foundation

// MARK: - Token Breakdown

/// Breakdown of token usage by category.
public struct TokenBreakdown: Codable, Equatable {
    /// Input tokens consumed
    public let input: Int
    /// Output tokens generated
    public let output: Int
    /// Tokens read from cache
    public let cacheRead: Int
    /// Tokens written to cache
    public let cacheWrite: Int

    public init(input: Int, output: Int, cacheRead: Int, cacheWrite: Int) {
        self.input = input
        self.output = output
        self.cacheRead = cacheRead
        self.cacheWrite = cacheWrite
    }

    /// Total tokens across all categories
    public var total: Int {
        input + output + cacheRead + cacheWrite
    }
}

// MARK: - Session Cost

/// Cost data for a single agent session.
public struct SessionCost: Codable, Equatable, Identifiable {
    /// Session identifier
    public let sessionId: String
    /// Path to the project this session is associated with
    public let projectPath: String
    /// Dollar cost for this session
    public let cost: Double
    /// Token usage breakdown
    public let tokens: TokenBreakdown
    /// ISO 8601 timestamp of last cost update
    public let lastUpdated: String

    public var id: String { sessionId }

    public init(sessionId: String, projectPath: String, cost: Double, tokens: TokenBreakdown, lastUpdated: String) {
        self.sessionId = sessionId
        self.projectPath = projectPath
        self.cost = cost
        self.tokens = tokens
        self.lastUpdated = lastUpdated
    }
}

// MARK: - Project Cost

/// Aggregated cost data for a project.
public struct ProjectCost: Codable, Equatable {
    /// Path to the project
    public let projectPath: String
    /// Total dollar cost across all sessions in this project
    public let totalCost: Double
    /// Aggregated token usage
    public let totalTokens: TokenBreakdown
    /// Number of sessions contributing to this cost
    public let sessionCount: Int

    public init(projectPath: String, totalCost: Double, totalTokens: TokenBreakdown, sessionCount: Int) {
        self.projectPath = projectPath
        self.totalCost = totalCost
        self.totalTokens = totalTokens
        self.sessionCount = sessionCount
    }
}

// MARK: - Cost Summary

/// Top-level cost summary returned by GET /api/costs.
public struct CostSummary: Codable, Equatable {
    /// Total dollar cost across all sessions
    public let totalCost: Double
    /// Aggregated token usage across all sessions
    public let totalTokens: TokenBreakdown
    /// Per-session cost data keyed by session ID
    public let sessions: [String: SessionCost]
    /// Per-project cost data keyed by project path
    public let projects: [String: ProjectCost]

    public init(totalCost: Double, totalTokens: TokenBreakdown, sessions: [String: SessionCost], projects: [String: ProjectCost]) {
        self.totalCost = totalCost
        self.totalTokens = totalTokens
        self.sessions = sessions
        self.projects = projects
    }
}

// MARK: - Burn Rate

/// Cost burn rate data returned by GET /api/costs/burn-rate.
public struct BurnRate: Codable, Equatable {
    /// Burn rate over the last 10 minutes (dollars per hour)
    public let rate10m: Double
    /// Burn rate over the last hour (dollars per hour)
    public let rate1h: Double
    /// Trend direction: "increasing", "stable", or "decreasing"
    public let trend: String

    public init(rate10m: Double, rate1h: Double, trend: String) {
        self.rate10m = rate10m
        self.rate1h = rate1h
        self.trend = trend
    }

    /// Trend as a display symbol
    public var trendSymbol: String {
        switch trend {
        case "increasing": return "\u{2191}" // up arrow
        case "decreasing": return "\u{2193}" // down arrow
        default: return "\u{2192}"           // right arrow (stable)
        }
    }
}

// MARK: - Budget Status

/// Budget configuration and current spend status.
/// Returned by GET /api/costs/budget.
public struct BudgetStatus: Codable, Identifiable, Equatable {
    /// Unique budget identifier
    public let id: Int
    /// Budget scope: "session" or "project"
    public let scope: String
    /// Scope target identifier (session ID or project path), nil for global
    public let scopeId: String?
    /// Budget amount in dollars
    public let amount: Double
    /// Percentage threshold for warning alerts
    public let warningPercent: Double
    /// Percentage threshold for critical alerts
    public let criticalPercent: Double
    /// Current amount spent in dollars
    public let spent: Double
    /// Current spend as percentage of budget (0-100)
    public let percentUsed: Double
    /// Current budget status: "ok", "warning", "critical", or "exceeded"
    public let status: String

    public init(
        id: Int,
        scope: String,
        scopeId: String?,
        amount: Double,
        warningPercent: Double,
        criticalPercent: Double,
        spent: Double,
        percentUsed: Double,
        status: String
    ) {
        self.id = id
        self.scope = scope
        self.scopeId = scopeId
        self.amount = amount
        self.warningPercent = warningPercent
        self.criticalPercent = criticalPercent
        self.spent = spent
        self.percentUsed = percentUsed
        self.status = status
    }

    /// Remaining budget amount
    public var remaining: Double {
        max(0, amount - spent)
    }
}

// MARK: - Bead Cost

/// Cost data for a bead (issue/task), optionally aggregated with children.
/// Returned by GET /api/costs/by-bead/:id.
public struct BeadCost: Codable, Equatable {
    /// Bead identifier
    public let beadId: String
    /// Total dollar cost for this bead (and children if requested)
    public let totalCost: Double
    /// Number of sessions that contributed to this bead's cost
    public let sessionCount: Int
    /// Token usage breakdown
    public let tokenBreakdown: TokenBreakdown

    public init(beadId: String, totalCost: Double, sessionCount: Int, tokenBreakdown: TokenBreakdown) {
        self.beadId = beadId
        self.totalCost = totalCost
        self.sessionCount = sessionCount
        self.tokenBreakdown = tokenBreakdown
    }
}

// MARK: - Create Budget Request

/// Request body for POST /api/costs/budget.
public struct CreateBudgetRequest: Encodable {
    /// Budget scope: "session" or "project"
    public let scope: String
    /// Scope target identifier (optional)
    public let scopeId: String?
    /// Budget amount in dollars
    public let amount: Double
    /// Warning threshold percentage (optional, defaults to 80)
    public let warningPercent: Double?
    /// Critical threshold percentage (optional, defaults to 95)
    public let criticalPercent: Double?

    public init(scope: String, scopeId: String? = nil, amount: Double, warningPercent: Double? = nil, criticalPercent: Double? = nil) {
        self.scope = scope
        self.scopeId = scopeId
        self.amount = amount
        self.warningPercent = warningPercent
        self.criticalPercent = criticalPercent
    }
}
