//
//  BackgroundTaskService.swift
//  Adjutant
//
//  Created by Gas Town on 2026-01-26.
//

import Foundation
import Combine
import AdjutantKit

#if os(iOS)
import BackgroundTasks
#endif

/// Manages background task scheduling and execution for app refresh and mail checking.
///
/// Uses iOS BGTaskScheduler to register and handle:
/// - App refresh tasks (periodic mail and status checks)
/// - Background processing tasks (heavier sync operations)
///
/// Call `scheduleAppRefresh()` when the app enters background to ensure
/// periodic updates continue.
@MainActor
public final class BackgroundTaskService: ObservableObject {
    // MARK: - Constants

    /// Task identifier for app refresh (quick updates)
    public static let appRefreshTaskIdentifier = "com.jmm.Adjutant.refresh"

    /// Task identifier for background processing (longer operations)
    public static let processingTaskIdentifier = "com.jmm.Adjutant.processing"

    /// Minimum interval between refresh tasks (15 minutes)
    private static let refreshInterval: TimeInterval = 15 * 60

    // MARK: - Singleton

    public static let shared = BackgroundTaskService()

    // MARK: - Published Properties

    /// Last time a background refresh completed successfully
    @Published public private(set) var lastRefreshDate: Date?

    /// Whether a background task is currently running
    @Published public private(set) var isRefreshing = false

    /// Last error encountered during background refresh
    @Published public private(set) var lastError: Error?

    /// Number of successful background refreshes since app launch
    @Published public private(set) var successfulRefreshCount = 0

    // MARK: - Private Properties

    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization

    private init() {
        loadLastRefreshDate()
    }

    // MARK: - Task Registration

    /// Registers background task handlers with BGTaskScheduler.
    /// Call this from AppDelegate's `application(_:didFinishLaunchingWithOptions:)`.
    public func registerBackgroundTasks() {
        #if os(iOS)
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.appRefreshTaskIdentifier,
            using: nil
        ) { [weak self] task in
            Task { @MainActor in
                await self?.handleAppRefresh(task: task as! BGAppRefreshTask)
            }
        }

        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.processingTaskIdentifier,
            using: nil
        ) { [weak self] task in
            Task { @MainActor in
                await self?.handleBackgroundProcessing(task: task as! BGProcessingTask)
            }
        }

        print("[BackgroundTaskService] Registered background tasks")
        #else
        print("[BackgroundTaskService] Background tasks not available on this platform")
        #endif
    }

    // MARK: - Task Scheduling

    /// Schedules an app refresh task to run in the background.
    /// Call this when the app enters the background.
    public func scheduleAppRefresh() {
        #if os(iOS)
        let request = BGAppRefreshTaskRequest(identifier: Self.appRefreshTaskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: Self.refreshInterval)

        do {
            try BGTaskScheduler.shared.submit(request)
            print("[BackgroundTaskService] Scheduled app refresh for \(Self.refreshInterval / 60) minutes from now")
        } catch {
            print("[BackgroundTaskService] Failed to schedule app refresh: \(error.localizedDescription)")
            lastError = error
        }
        #endif
    }

    /// Schedules a background processing task for heavier operations.
    /// Processing tasks have more execution time but stricter scheduling.
    public func scheduleBackgroundProcessing() {
        #if os(iOS)
        let request = BGProcessingTaskRequest(identifier: Self.processingTaskIdentifier)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false

        do {
            try BGTaskScheduler.shared.submit(request)
            print("[BackgroundTaskService] Scheduled background processing")
        } catch {
            print("[BackgroundTaskService] Failed to schedule background processing: \(error.localizedDescription)")
            lastError = error
        }
        #endif
    }

    /// Cancels all pending background tasks.
    public func cancelAllTasks() {
        #if os(iOS)
        BGTaskScheduler.shared.cancelAllTaskRequests()
        print("[BackgroundTaskService] Cancelled all pending tasks")
        #endif
    }

    // MARK: - Task Handlers

    #if os(iOS)
    private func handleAppRefresh(task: BGAppRefreshTask) async {
        // Schedule next refresh immediately to ensure continuity
        scheduleAppRefresh()

        isRefreshing = true
        lastError = nil

        // Set up expiration handler
        task.expirationHandler = { [weak self] in
            Task { @MainActor in
                self?.isRefreshing = false
                task.setTaskCompleted(success: false)
            }
        }

        // Perform the refresh
        let success = await performRefresh()

        isRefreshing = false
        task.setTaskCompleted(success: success)
    }

    private func handleBackgroundProcessing(task: BGProcessingTask) async {
        isRefreshing = true
        lastError = nil

        // Set up expiration handler
        task.expirationHandler = { [weak self] in
            Task { @MainActor in
                self?.isRefreshing = false
                task.setTaskCompleted(success: false)
            }
        }

        // Perform sync operations
        let success = await performFullSync()

        isRefreshing = false
        task.setTaskCompleted(success: success)
    }
    #endif

    // MARK: - Refresh Operations

    /// Performs a quick refresh: checks mail and updates unread count.
    /// - Returns: True if refresh completed successfully
    private func performRefresh() async -> Bool {
        guard NetworkMonitor.shared.isConnected else {
            print("[BackgroundTaskService] Skipping refresh - no network")
            return false
        }

        do {
            // Check mail and update unread count
            let unreadCount = try await checkMail()
            AppState.shared.updateUnreadMailCount(unreadCount)

            // Record successful refresh
            lastRefreshDate = Date()
            successfulRefreshCount += 1
            saveLastRefreshDate()

            print("[BackgroundTaskService] Refresh complete - \(unreadCount) unread messages")
            return true
        } catch {
            print("[BackgroundTaskService] Refresh failed: \(error.localizedDescription)")
            lastError = error
            return false
        }
    }

    /// Performs a full sync: mail check, status refresh, and voice availability.
    /// - Returns: True if sync completed successfully
    private func performFullSync() async -> Bool {
        guard NetworkMonitor.shared.isConnected else {
            print("[BackgroundTaskService] Skipping sync - no network")
            return false
        }

        var allSuccess = true

        // Check mail
        do {
            let unreadCount = try await checkMail()
            AppState.shared.updateUnreadMailCount(unreadCount)
        } catch {
            print("[BackgroundTaskService] Mail check failed: \(error.localizedDescription)")
            lastError = error
            allSuccess = false
        }

        // Refresh system status and available rigs
        await AppState.shared.fetchAvailableRigs()

        // Check voice availability
        await AppState.shared.checkVoiceAvailability()

        if allSuccess {
            lastRefreshDate = Date()
            successfulRefreshCount += 1
            saveLastRefreshDate()
        }

        print("[BackgroundTaskService] Full sync complete (success: \(allSuccess))")
        return allSuccess
    }

    /// Checks mail and returns the count of unread messages.
    /// - Returns: Number of unread messages
    private func checkMail() async throws -> Int {
        let apiClient = AppState.shared.apiClient
        let response = try await apiClient.getMail()

        // Count unread messages
        let unreadCount = response.items.filter { !$0.read }.count
        return unreadCount
    }

    // MARK: - Persistence

    private func loadLastRefreshDate() {
        if let timestamp = UserDefaults.standard.object(forKey: "lastBackgroundRefreshDate") as? Date {
            lastRefreshDate = timestamp
        }
    }

    private func saveLastRefreshDate() {
        UserDefaults.standard.set(lastRefreshDate, forKey: "lastBackgroundRefreshDate")
    }
}

// MARK: - Scene Phase Integration

extension BackgroundTaskService {
    /// Call this when the app's scene phase changes to background.
    /// Schedules refresh tasks to keep data fresh while backgrounded.
    public func handleScenePhaseChange(to phase: ScenePhase) {
        switch phase {
        case .background:
            scheduleAppRefresh()
            print("[BackgroundTaskService] App entered background - scheduled refresh")
        case .active:
            // Cancel pending tasks when becoming active (we'll refresh immediately)
            // Keep scheduled tasks in case user backgrounds quickly
            print("[BackgroundTaskService] App became active")
        case .inactive:
            break
        @unknown default:
            break
        }
    }
}

// MARK: - ScenePhase Import

import SwiftUI
