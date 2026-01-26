//
//  LiveActivityService.swift
//  Adjutant
//
//  Service to start, update, and end Live Activities.
//  Manages activity lifecycle and state updates.
//

import Foundation
import Combine
import AdjutantKit

#if os(iOS)
import ActivityKit

// MARK: - Live Activity Service

/// Service for managing Gastown Live Activities.
///
/// Handles starting, updating, and ending Live Activities that display
/// real-time Gastown status on the lock screen and Dynamic Island.
@MainActor
public final class LiveActivityService: ObservableObject {

    // MARK: - Singleton

    public static let shared = LiveActivityService()

    // MARK: - Published Properties

    /// Whether Live Activities are supported on this device
    @Published public private(set) var isSupported: Bool = false

    /// Whether there's an active Live Activity running
    @Published public private(set) var hasActiveActivity: Bool = false

    /// The current activity ID if one is running
    @Published public private(set) var currentActivityId: String?

    // MARK: - Private Properties

    /// Reference to the current activity
    private var currentActivity: Activity<GastownActivityAttributes>?

    /// Cancellables for observation
    private var cancellables = Set<AnyCancellable>()

    /// Timer for activity state observation
    private var observationTask: Task<Void, Never>?

    // MARK: - Initialization

    private init() {
        checkSupport()
        observeActivityState()
    }

    deinit {
        observationTask?.cancel()
    }

    // MARK: - Support Check

    /// Checks if Live Activities are supported on the current device
    private func checkSupport() {
        isSupported = ActivityAuthorizationInfo().areActivitiesEnabled
    }

    // MARK: - Activity Lifecycle

    /// Starts a new Live Activity for the specified town.
    ///
    /// - Parameters:
    ///   - townName: The name of the town to monitor
    ///   - initialState: The initial state to display
    /// - Returns: The activity ID if successful, nil otherwise
    @discardableResult
    public func startActivity(
        townName: String,
        initialState: GastownActivityAttributes.ContentState
    ) async -> String? {
        guard isSupported else {
            print("[LiveActivityService] Live Activities not supported")
            return nil
        }

        // End any existing activity first
        await endActivity()

        let attributes = GastownActivityAttributes(townName: townName)
        let activityContent = ActivityContent(
            state: initialState,
            staleDate: Date().addingTimeInterval(60 * 15) // 15 minutes
        )

        do {
            let activity = try Activity.request(
                attributes: attributes,
                content: activityContent,
                pushType: nil // No push updates for now
            )

            currentActivity = activity
            currentActivityId = activity.id
            hasActiveActivity = true

            print("[LiveActivityService] Started activity: \(activity.id)")
            return activity.id
        } catch {
            print("[LiveActivityService] Failed to start activity: \(error.localizedDescription)")
            return nil
        }
    }

    /// Updates the current Live Activity with new state.
    ///
    /// - Parameter state: The new state to display
    public func updateActivity(with state: GastownActivityAttributes.ContentState) async {
        guard let activity = currentActivity else {
            print("[LiveActivityService] No active activity to update")
            return
        }

        let activityContent = ActivityContent(
            state: state,
            staleDate: Date().addingTimeInterval(60 * 15) // 15 minutes
        )

        await activity.update(activityContent)
        print("[LiveActivityService] Updated activity with state: power=\(state.powerState)")
    }

    /// Ends the current Live Activity.
    ///
    /// - Parameter dismissalPolicy: How to dismiss the activity (default: immediate)
    public func endActivity(
        dismissalPolicy: ActivityUIDismissalPolicy = .immediate
    ) async {
        guard let activity = currentActivity else {
            return
        }

        // Create a final state to show
        let finalState = GastownActivityAttributes.ContentState(
            powerState: .stopped,
            unreadMailCount: 0,
            activeAgents: 0,
            lastUpdated: Date()
        )

        let finalContent = ActivityContent(
            state: finalState,
            staleDate: nil
        )

        await activity.end(finalContent, dismissalPolicy: dismissalPolicy)

        currentActivity = nil
        currentActivityId = nil
        hasActiveActivity = false

        print("[LiveActivityService] Ended activity")
    }

    /// Ends all active Live Activities for this app.
    public func endAllActivities() async {
        for activity in Activity<GastownActivityAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }

        currentActivity = nil
        currentActivityId = nil
        hasActiveActivity = false

        print("[LiveActivityService] Ended all activities")
    }

    // MARK: - State Observation

    /// Observes the activity state for changes
    private func observeActivityState() {
        observationTask = Task { [weak self] in
            // Check for any existing activities on startup
            await self?.checkForExistingActivities()

            // Monitor authorization changes
            for await enabled in ActivityAuthorizationInfo().activityEnablementUpdates {
                await MainActor.run {
                    self?.isSupported = enabled
                    if !enabled {
                        Task {
                            await self?.endAllActivities()
                        }
                    }
                }
            }
        }
    }

    /// Checks for and resumes any existing activities
    private func checkForExistingActivities() async {
        let activities = Activity<GastownActivityAttributes>.activities
        if let existingActivity = activities.first {
            currentActivity = existingActivity
            currentActivityId = existingActivity.id
            hasActiveActivity = true
            print("[LiveActivityService] Resumed existing activity: \(existingActivity.id)")
        }
    }

    // MARK: - Convenience Methods

    /// Creates a ContentState from dashboard data.
    ///
    /// - Parameters:
    ///   - powerState: Current power state
    ///   - unreadMailCount: Number of unread mail messages
    ///   - activeAgents: Number of active agents
    /// - Returns: A ContentState populated with current values
    static func createState(
        powerState: AdjutantKit.PowerState,
        unreadMailCount: Int,
        activeAgents: Int
    ) -> GastownActivityAttributes.ContentState {
        return GastownActivityAttributes.ContentState(
            powerState: powerState,
            unreadMailCount: unreadMailCount,
            activeAgents: activeAgents,
            lastUpdated: Date()
        )
    }

    /// Starts or updates the activity based on current state.
    ///
    /// If no activity exists, starts a new one. Otherwise, updates the existing one.
    ///
    /// - Parameters:
    ///   - townName: The town name (used for new activities)
    ///   - state: The state to display
    public func syncActivity(
        townName: String,
        state: GastownActivityAttributes.ContentState
    ) async {
        if hasActiveActivity {
            await updateActivity(with: state)
        } else {
            await startActivity(townName: townName, initialState: state)
        }
    }
}

// MARK: - Live Activity Error

/// Errors that can occur during Live Activity operations
public enum LiveActivityError: LocalizedError {
    case notSupported
    case alreadyActive
    case noActiveActivity
    case startFailed(Error)
    case updateFailed(Error)

    public var errorDescription: String? {
        switch self {
        case .notSupported:
            return "Live Activities are not supported on this device"
        case .alreadyActive:
            return "A Live Activity is already running"
        case .noActiveActivity:
            return "No active Live Activity to update"
        case .startFailed(let error):
            return "Failed to start Live Activity: \(error.localizedDescription)"
        case .updateFailed(let error):
            return "Failed to update Live Activity: \(error.localizedDescription)"
        }
    }
}
#endif
