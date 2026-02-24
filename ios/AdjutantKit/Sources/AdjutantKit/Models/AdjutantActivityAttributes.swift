import Foundation

#if canImport(ActivityKit)
import ActivityKit
#endif

/// Activity attributes for Adjutant Live Activity on Lock Screen and Dynamic Island.
///
/// This struct defines the static attributes (unchanging data) and dynamic content state
/// (data that updates in real-time) for the Adjutant system status Live Activity.
#if os(iOS)
@available(iOS 16.1, *)
public struct AdjutantActivityAttributes: ActivityAttributes {

    /// Dynamic content state that updates during the Live Activity lifecycle.
    ///
    /// ContentState contains the real-time data displayed in the Live Activity,
    /// including power state, active agent summaries, and bead summaries.
    public struct ContentState: Codable, Hashable {
        /// Current power state of the system
        public let powerState: PowerState

        /// Number of unread mail messages for the operator
        public let unreadMailCount: Int

        /// Active agent summaries (up to 4 agents with status)
        public let activeAgents: [AgentSummary]

        /// Beads currently in progress with details
        public let beadsInProgress: [BeadSummary]

        /// Beads recently completed (within last hour)
        public let recentlyCompleted: [BeadSummary]

        /// Timestamp of the last status update
        public let lastUpdated: Date

        public init(
            powerState: PowerState,
            unreadMailCount: Int,
            activeAgents: [AgentSummary],
            beadsInProgress: [BeadSummary] = [],
            recentlyCompleted: [BeadSummary] = [],
            lastUpdated: Date
        ) {
            self.powerState = powerState
            self.unreadMailCount = unreadMailCount
            self.activeAgents = activeAgents
            self.beadsInProgress = beadsInProgress
            self.recentlyCompleted = recentlyCompleted
            self.lastUpdated = lastUpdated
        }
    }

    /// Static identifier for this Live Activity type
    public static let activityIdentifier = "com.adjutant.status"

    /// Name of the instance (static, doesn't change during activity)
    public let townName: String

    public init(townName: String) {
        self.townName = townName
    }
}
#endif
