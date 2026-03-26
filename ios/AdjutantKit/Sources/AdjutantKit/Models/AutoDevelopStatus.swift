import Foundation

/// Status of the auto-develop loop for a project.
/// Mirrors the backend auto-develop status response.
public struct AutoDevelopStatus: Codable, Equatable {
    public let enabled: Bool
    public let paused: Bool
    public let pausedAt: String?
    public let currentPhase: String?
    public let activeCycleId: String?
    public let visionContext: String?
    public let proposals: ProposalCounts
    public let epicsInExecution: Int
    public let cycleStats: CycleStats

    public init(
        enabled: Bool,
        paused: Bool,
        pausedAt: String? = nil,
        currentPhase: String? = nil,
        activeCycleId: String? = nil,
        visionContext: String? = nil,
        proposals: ProposalCounts,
        epicsInExecution: Int,
        cycleStats: CycleStats
    ) {
        self.enabled = enabled
        self.paused = paused
        self.pausedAt = pausedAt
        self.currentPhase = currentPhase
        self.activeCycleId = activeCycleId
        self.visionContext = visionContext
        self.proposals = proposals
        self.epicsInExecution = epicsInExecution
        self.cycleStats = cycleStats
    }

    /// Counts of proposals in various states.
    public struct ProposalCounts: Codable, Equatable {
        public let inReview: Int
        public let accepted: Int
        public let escalated: Int
        public let dismissed: Int

        public init(inReview: Int, accepted: Int, escalated: Int, dismissed: Int) {
            self.inReview = inReview
            self.accepted = accepted
            self.escalated = escalated
            self.dismissed = dismissed
        }
    }

    /// Cycle completion statistics.
    public struct CycleStats: Codable, Equatable {
        public let totalCycles: Int
        public let completedCycles: Int
        /// Current cycle number (1-based). Falls back to totalCycles if not provided.
        public let currentCycleNumber: Int

        public init(totalCycles: Int, completedCycles: Int, currentCycleNumber: Int? = nil) {
            self.totalCycles = totalCycles
            self.completedCycles = completedCycles
            self.currentCycleNumber = currentCycleNumber ?? totalCycles
        }
    }
}
