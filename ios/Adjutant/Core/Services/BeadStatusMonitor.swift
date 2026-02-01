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

    /// Polling interval in seconds (30 seconds)
    private static let pollInterval: TimeInterval = 30

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

    /// Timer for periodic polling
    private var pollTimer: Timer?

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
    /// Immediately polls for current state, then continues at regular intervals.
    public func startMonitoring() {
        guard !isMonitoring else { return }

        isMonitoring = true
        lastError = nil

        // Resolve TTS service from DI container
        ttsService = DependencyContainer.shared.resolveOptional((any TTSPlaybackServiceProtocol).self)

        // Poll immediately
        Task {
            await pollBeads()
        }

        // Schedule periodic polling
        pollTimer = Timer.scheduledTimer(withTimeInterval: Self.pollInterval, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                await self?.pollBeads()
            }
        }

        print("[BeadStatusMonitor] Started monitoring (interval: \(Self.pollInterval)s)")
    }

    /// Stops monitoring bead status changes.
    public func stopMonitoring() {
        pollTimer?.invalidate()
        pollTimer = nil
        isMonitoring = false
        print("[BeadStatusMonitor] Stopped monitoring")
    }

    /// Manually triggers a poll (useful for pull-to-refresh scenarios).
    public func pollNow() async {
        await pollBeads()
    }

    // MARK: - Polling

    private func pollBeads() async {
        guard NetworkMonitor.shared.isConnected else {
            print("[BeadStatusMonitor] Skipping poll - no network")
            return
        }

        do {
            let apiClient = AppState.shared.apiClient

            // Fetch beads with overseer-relevant statuses
            // We want to track hooked, in_progress, and recently closed beads
            let beads = try await apiClient.getBeads(
                rig: AppState.shared.isOverseerMode ? AppState.shared.selectedRig : nil,
                status: nil, // Get all statuses to detect transitions
                limit: 100
            )

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

        } catch {
            print("[BeadStatusMonitor] Poll failed: \(error.localizedDescription)")
            lastError = error
        }
    }

    // MARK: - Change Detection

    /// Represents a detected bead status change
    struct BeadChange {
        let bead: BeadInfo
        let previousStatus: String?
        let changeType: ChangeType

        enum ChangeType {
            case hooked       // Bead was just hooked
            case inProgress   // Bead moved to in_progress
            case completed    // Bead was closed/completed
            case newBead      // First time seeing this bead
        }
    }

    private func detectChanges(in beads: [BeadInfo]) -> [BeadChange] {
        var changes: [BeadChange] = []

        for bead in beads {
            let previousStatus = knownBeadStates[bead.id]

            // Skip if status hasn't changed
            if previousStatus == bead.status {
                continue
            }

            // Determine change type
            let changeType: BeadChange.ChangeType

            if previousStatus == nil {
                // First time seeing this bead - only announce if it's in an active state
                if bead.status == "hooked" {
                    changeType = .hooked
                } else if bead.status == "in_progress" {
                    changeType = .inProgress
                } else {
                    // Don't announce new beads in other states
                    continue
                }
            } else if bead.status == "hooked" {
                changeType = .hooked
            } else if bead.status == "in_progress" {
                changeType = .inProgress
            } else if bead.status == "closed" {
                changeType = .completed
            } else {
                // Other status changes (blocked, deferred, etc.) - don't announce
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
            let text = AnnouncementTextFormatter.format(change: change)
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

// MARK: - AnnouncementTextFormatter

/// Formats bead status changes into human-readable announcement text.
enum AnnouncementTextFormatter {
    /// Formats a bead change into announcement text.
    static func format(change: BeadStatusMonitor.BeadChange) -> String {
        let title = humanizeTitle(change.bead.title)

        switch change.changeType {
        case .hooked:
            return "New task hooked: \(title)"
        case .inProgress:
            return "Starting work on: \(title)"
        case .completed:
            return "Task completed: \(title)"
        case .newBead:
            return "New bead: \(title)"
        }
    }

    /// Humanizes a bead title for speech.
    /// - Removes technical prefixes and IDs
    /// - Converts camelCase and snake_case to spaces
    /// - Truncates overly long titles
    static func humanizeTitle(_ title: String) -> String {
        var humanized = title

        // Remove common prefixes like "feat:", "fix:", "chore:", etc.
        let prefixPattern = #"^(feat|fix|chore|docs|refactor|test|style|perf|ci|build|revert)(\([^)]*\))?:\s*"#
        if let regex = try? NSRegularExpression(pattern: prefixPattern, options: .caseInsensitive) {
            let range = NSRange(humanized.startIndex..., in: humanized)
            humanized = regex.stringByReplacingMatches(in: humanized, range: range, withTemplate: "")
        }

        // Remove bead IDs like (hq-abc123) or [adj-xyz]
        let idPattern = #"[\(\[](hq|adj|gb)-[a-z0-9]+[\)\]]"#
        if let regex = try? NSRegularExpression(pattern: idPattern, options: .caseInsensitive) {
            let range = NSRange(humanized.startIndex..., in: humanized)
            humanized = regex.stringByReplacingMatches(in: humanized, range: range, withTemplate: "")
        }

        // Trim whitespace
        humanized = humanized.trimmingCharacters(in: .whitespaces)

        // Truncate if too long (keep first ~100 chars for reasonable speech length)
        if humanized.count > 100 {
            let index = humanized.index(humanized.startIndex, offsetBy: 100)
            humanized = String(humanized[..<index]) + "..."
        }

        return humanized
    }
}

// MARK: - Scene Phase Integration

extension BeadStatusMonitor {
    /// Call this when the app's scene phase changes.
    /// Starts monitoring when active, stops when backgrounded.
    public func handleScenePhaseChange(to phase: ScenePhase) {
        switch phase {
        case .active:
            startMonitoring()
        case .background:
            stopMonitoring()
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
