//
//  BeadStatusMonitor.swift
//  Adjutant
//
//  Created by Gas Town on 2026-02-01.
//

import Foundation
import Combine
import AdjutantKit

/// Monitors bead status changes and triggers voice announcements.
///
/// Polls the /api/beads endpoint periodically to detect status changes.
/// When beads are hooked, moved to in_progress, or completed, triggers
/// announcements through the TTS playback service.
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

    /// Reference to TTS service for announcements
    private var ttsService: (any TTSPlaybackServiceProtocol)?

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

        // Resolve TTS service from DI container
        ttsService = DependencyContainer.shared.resolveOptional((any TTSPlaybackServiceProtocol).self)

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
        // Only handle bead-related notifications
        guard payload.type == .beadUpdate || payload.type == .beadHooked || payload.type == .beadCompleted else {
            print("[BeadStatusMonitor] Ignoring non-bead notification type: \(payload.type)")
            return false
        }

        guard let beadData = payload.beadData else {
            print("[BeadStatusMonitor] Failed to parse bead notification data")
            return false
        }

        // Skip wisp beads - internal workflow items
        guard !beadData.beadId.contains("wisp") else {
            print("[BeadStatusMonitor] Skipping wisp bead notification")
            return false
        }

        guard !AppState.shared.isVoiceMuted else {
            print("[BeadStatusMonitor] Voice is muted, skipping push announcement")
            // Still update known state even if muted
            knownBeadStates[beadData.beadId] = beadData.currentStatus
            saveKnownStates()
            return false
        }

        guard AppState.shared.isVoiceAvailable else {
            print("[BeadStatusMonitor] Voice not available, skipping push announcement")
            knownBeadStates[beadData.beadId] = beadData.currentStatus
            saveKnownStates()
            return false
        }

        // Determine if we should announce based on status transition
        let shouldAnnounce: Bool
        switch payload.type {
        case .beadCompleted:
            shouldAnnounce = true
        case .beadUpdate where beadData.currentStatus == "in_progress":
            shouldAnnounce = true
        case .beadUpdate where beadData.currentStatus == "closed":
            shouldAnnounce = true
        default:
            // Don't announce hooked or other status changes
            shouldAnnounce = false
        }

        if shouldAnnounce {
            print("[BeadStatusMonitor] Handling push notification for bead \(beadData.beadId)")
            await announceBeadFromPush(beadData, notificationType: payload.type)
        }

        // Update known state
        knownBeadStates[beadData.beadId] = beadData.currentStatus
        saveKnownStates()
        changesDetectedCount += 1

        return shouldAnnounce
    }

    /// Announces a bead update from push notification
    private func announceBeadFromPush(_ beadData: BeadNotificationData, notificationType: PushNotificationType) async {
        let tts = ttsService ?? DependencyContainer.shared.resolveOptional((any TTSPlaybackServiceProtocol).self)
        guard let ttsService = tts else {
            print("[BeadStatusMonitor] TTS service not available for push announcement")
            return
        }

        let text = AnnouncementTextFormatter.formatStatusChange(
            title: beadData.title,
            oldStatus: beadData.previousStatus,
            newStatus: beadData.currentStatus
        )

        do {
            let apiClient = AppState.shared.apiClient
            let request = SynthesizeRequest(text: text)
            let response = try await apiClient.synthesizeSpeech(request)

            // Activate audio session for background playback
            VoiceAnnouncementService.shared.activateForBackgroundPlayback()

            ttsService.enqueue(
                text: text,
                response: response,
                priority: .high,
                metadata: [
                    "source": "BeadStatusMonitor",
                    "beadId": beadData.beadId,
                    "trigger": "push"
                ]
            )

            // Start playback immediately
            ttsService.play()

        } catch {
            print("[BeadStatusMonitor] Failed to synthesize push announcement: \(error.localizedDescription)")
        }
    }

    // MARK: - Data Processing

    /// Processes beads update from DataSyncService
    private func processBeadsUpdate(_ beads: [BeadInfo]) async {
        lastPollDate = Date()
        lastError = nil

        // Detect changes
        let changes = detectChanges(in: beads)

        // Announce changes if not muted
        if !AppState.shared.isVoiceMuted {
            await announceChanges(changes)
        }

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

    // MARK: - Announcements

    private func announceChanges(_ changes: [BeadChange]) async {
        guard let ttsService = ttsService else {
            print("[BeadStatusMonitor] TTS service not available")
            return
        }

        guard AppState.shared.isVoiceAvailable else {
            print("[BeadStatusMonitor] Voice not available")
            return
        }

        for change in changes {
            let text = change.announcementText
            await synthesizeAndEnqueue(text: text, ttsService: ttsService)
        }
    }

    private func synthesizeAndEnqueue(text: String, ttsService: any TTSPlaybackServiceProtocol) async {
        do {
            let apiClient = AppState.shared.apiClient
            let request = SynthesizeRequest(text: text)
            let response = try await apiClient.synthesizeSpeech(request)

            ttsService.enqueue(
                text: text,
                response: response,
                priority: .high,
                metadata: ["source": "BeadStatusMonitor"]
            )
        } catch {
            print("[BeadStatusMonitor] Failed to synthesize announcement: \(error.localizedDescription)")
        }
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

    private func saveKnownStates() {
        if let data = try? JSONEncoder().encode(knownBeadStates) {
            UserDefaults.standard.set(data, forKey: Self.knownStatesKey)
        }
    }

    /// Clears known states (useful for testing or reset scenarios)
    public func clearKnownStates() {
        knownBeadStates.removeAll()
        UserDefaults.standard.removeObject(forKey: Self.knownStatesKey)
    }
}

// MARK: - BeadChange Text Formatting

extension BeadStatusMonitor.BeadChange {
    /// Formats this bead change into announcement text using the shared formatter.
    var announcementText: String {
        let newStatus: String
        switch changeType {
        case .inProgress: newStatus = "in_progress"
        case .completed: newStatus = "closed"
        }
        return AnnouncementTextFormatter.formatStatusChange(
            title: bead.title,
            oldStatus: previousStatus,
            newStatus: newStatus
        )
    }
}

// MARK: - Scene Phase Integration

extension BeadStatusMonitor {
    /// Call this when the app's scene phase changes.
    /// Starts monitoring when active and continues in background for audio announcements.
    public func handleScenePhaseChange(to phase: ScenePhase) {
        switch phase {
        case .active:
            startMonitoring()
        case .background:
            // Keep monitoring in background to enable audio announcements
            // The "audio" background mode in Info.plist allows this
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
