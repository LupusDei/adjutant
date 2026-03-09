//
//  BeadStatusMonitor.swift
//  Adjutant
//
//  Created by Adjutant on 2026-02-01.
//

import Foundation
import Combine
import AdjutantKit

/// Monitors bead status changes for UI state tracking.
///
/// Polls the /api/beads endpoint periodically to detect status changes.
/// Voice synthesis is on-demand only — this monitor tracks state but does
/// not automatically trigger TTS.
@MainActor
public final class BeadStatusMonitor: ObservableObject {
    // MARK: - Constants

    /// UserDefaults key for storing known bead states
    private static let knownStatesKey = "BeadStatusMonitor.knownStates"

    // MARK: - Singleton

    public static let shared = BeadStatusMonitor()

    // MARK: - Published Properties

    /// Whether the monitor is currently active
    @Published public private(set) var isMonitoring = false

    /// Last time beads were successfully polled
    @Published public private(set) var lastPollDate: Date?

    /// Last error encountered during polling
    @Published public private(set) var lastError: Error?

    /// Number of status changes detected since monitoring started
    @Published public private(set) var changesDetectedCount = 0

    // MARK: - Private Properties

    /// Known bead states from previous poll (id -> status)
    private var knownBeadStates: [String: String] = [:]

    /// Reference to centralized data sync service
    private let dataSync = DataSyncService.shared

    /// Cancellables for Combine subscriptions
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization

    private init() {
        loadKnownStates()
    }

    // MARK: - Monitoring Control

    /// Starts monitoring bead status changes.
    /// Subscribes to DataSyncService for bead updates.
    public func startMonitoring() {
        guard !isMonitoring else { return }

        isMonitoring = true
        lastError = nil

        // Subscribe to DataSyncService beads updates
        dataSync.$beads
            .receive(on: DispatchQueue.main)
            .sink { [weak self] beads in
                guard let self = self, !beads.isEmpty else { return }
                Task { @MainActor in
                    await self.processBeadsUpdate(beads)
                }
            }
            .store(in: &cancellables)

        // Subscribe to beads polling
        dataSync.subscribeBeads()

        print("[BeadStatusMonitor] Started monitoring via DataSyncService")
    }

    /// Stops monitoring bead status changes.
    public func stopMonitoring() {
        dataSync.unsubscribeBeads()
        cancellables.removeAll()
        isMonitoring = false
        print("[BeadStatusMonitor] Stopped monitoring")
    }

    /// Manually triggers a refresh (useful for pull-to-refresh scenarios).
    public func pollNow() async {
        await dataSync.refreshBeads()
    }

    // MARK: - Push Notification Handling

    /// Handles a push notification for bead updates, bypassing polling delay.
    ///
    /// Call this from `application(_:didReceiveRemoteNotification:fetchCompletionHandler:)`
    /// when receiving a bead update push notification.
    ///
    /// - Parameter payload: The parsed push notification payload
    /// - Returns: `true` if the notification was handled successfully
    @discardableResult
    public func handlePushNotification(_ payload: PushNotificationPayload) async -> Bool {
        await AppState.shared.waitForServicesReady()

        // Only handle bead-related notifications
        guard payload.type == .beadUpdate || payload.type == .beadHooked || payload.type == .beadCompleted else {
            return false
        }

        guard let beadData = payload.beadData else {
            return false
        }

        // Skip wisp beads - internal workflow items
        guard !beadData.beadId.contains("wisp") else {
            return false
        }

        // Update known state (no automatic voice synthesis — on-demand only)
        knownBeadStates[beadData.beadId] = beadData.currentStatus
        saveKnownStates()
        changesDetectedCount += 1

        return true
    }

    // MARK: - Data Processing

    /// Processes beads update from DataSyncService
    private func processBeadsUpdate(_ beads: [BeadInfo]) async {
        lastPollDate = Date()
        lastError = nil

        // Detect changes (for UI state tracking only — no automatic voice synthesis)
        _ = detectChanges(in: beads)

        // Update known states
        updateKnownStates(from: beads)
    }

    // MARK: - Change Detection

    /// Represents a detected bead status change
    struct BeadChange {
        let bead: BeadInfo
        let previousStatus: String?
        let changeType: ChangeType

        enum ChangeType {
            case inProgress   // Bead moved to in_progress
            case completed    // Bead was closed/completed
        }
    }

    private func detectChanges(in beads: [BeadInfo]) -> [BeadChange] {
        var changes: [BeadChange] = []

        for bead in beads {
            // Skip wisp beads entirely - they are internal workflow items
            if bead.id.contains("wisp") {
                continue
            }

            let previousStatus = knownBeadStates[bead.id]

            // Skip if status hasn't changed
            if previousStatus == bead.status {
                continue
            }

            // Determine change type
            // Note: We skip "hooked" announcements - only announce in_progress and completed
            let changeType: BeadChange.ChangeType

            if previousStatus == nil {
                // First time seeing this bead - only announce if moving to in_progress
                if bead.status == "in_progress" {
                    changeType = .inProgress
                } else {
                    // Don't announce new beads in other states (including hooked)
                    continue
                }
            } else if bead.status == "in_progress" {
                changeType = .inProgress
            } else if bead.status == "closed" {
                changeType = .completed
            } else {
                // Other status changes (hooked, deferred, etc.) - don't announce
                continue
            }

            changes.append(BeadChange(
                bead: bead,
                previousStatus: previousStatus,
                changeType: changeType
            ))
        }

        if !changes.isEmpty {
            changesDetectedCount += changes.count
            print("[BeadStatusMonitor] Detected \(changes.count) status change(s)")
        }

        return changes
    }

    // MARK: - State Management

    private func updateKnownStates(from beads: [BeadInfo]) {
        for bead in beads {
            knownBeadStates[bead.id] = bead.status
        }
        saveKnownStates()
    }

    private func loadKnownStates() {
        if let data = UserDefaults.standard.data(forKey: Self.knownStatesKey),
           let states = try? JSONDecoder().decode([String: String].self, from: data) {
            knownBeadStates = states
        }
    }

    /// Debounced save task to avoid JSON-encoding + UserDefaults write on every single beads update.
    /// Without debouncing, a warm launch that processes 100+ beads would encode + write 100 times.
    private var saveDebounceTask: Task<Void, Never>?

    private func saveKnownStates() {
        saveDebounceTask?.cancel()
        let states = knownBeadStates
        saveDebounceTask = Task {
            try? await Task.sleep(nanoseconds: 500_000_000) // 0.5s debounce
            guard !Task.isCancelled else { return }
            await Task.detached(priority: .utility) {
                if let data = try? JSONEncoder().encode(states) {
                    UserDefaults.standard.set(data, forKey: BeadStatusMonitor.knownStatesKey)
                }
            }.value
        }
    }

    /// Clears known states (useful for testing or reset scenarios)
    public func clearKnownStates() {
        knownBeadStates.removeAll()
        UserDefaults.standard.removeObject(forKey: Self.knownStatesKey)
    }
}

// MARK: - Scene Phase Integration

extension BeadStatusMonitor {
    /// Call this when the app's scene phase changes.
    /// Starts monitoring when active for UI state tracking.
    public func handleScenePhaseChange(to phase: ScenePhase) {
        switch phase {
        case .active:
            startMonitoring()
        case .background:
            print("[BeadStatusMonitor] Continuing monitoring in background")
        case .inactive:
            // Keep monitoring during brief inactive periods
            break
        @unknown default:
            break
        }
    }
}

// MARK: - ScenePhase Import

import SwiftUI
