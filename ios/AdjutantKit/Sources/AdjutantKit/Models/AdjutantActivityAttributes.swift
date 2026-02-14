import Foundation

#if canImport(ActivityKit)
import ActivityKit
#endif

/// Activity attributes for Adjutant Live Activity on Lock Screen and Dynamic Island.
///
/// This struct defines the static attributes (unchanging data) and dynamic content state
/// (data that updates in real-time) for the system status Live Activity.
#if os(iOS)
@available(iOS 16.1, *)
public struct AdjutantActivityAttributes: ActivityAttributes {

    /// Dynamic content state that updates during the Live Activity lifecycle.
    ///
    /// ContentState contains the real-time data displayed in the Live Activity,
    /// including power state, unread mail count, and active agent information.
    public struct ContentState: Codable, Hashable {
        /// Current power state of the system
        public let powerState: PowerState

        /// Number of unread mail messages for the operator
        public let unreadMailCount: Int

        /// Number of currently active agents across all rigs
        public let activeAgents: Int

        /// Number of beads currently in progress
        public let beadsInProgress: Int

        /// Number of beads currently hooked (assigned to workers)
        public let beadsHooked: Int

        /// Timestamp of the last status update
        public let lastUpdated: Date

        public init(
            powerState: PowerState,
            unreadMailCount: Int,
            activeAgents: Int,
            beadsInProgress: Int = 0,
            beadsHooked: Int = 0,
            lastUpdated: Date
        ) {
            self.powerState = powerState
            self.unreadMailCount = unreadMailCount
            self.activeAgents = activeAgents
            self.beadsInProgress = beadsInProgress
            self.beadsHooked = beadsHooked
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

/// Backward-compatible typealias
@available(iOS 16.1, *)
public typealias GastownActivityAttributes = AdjutantActivityAttributes
#endif
