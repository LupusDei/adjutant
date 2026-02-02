//
//  AppDelegate.swift
//  Adjutant
//
//  Created by Gas Town on 2026-01-26.
//

import UIKit
import UserNotifications
import BackgroundTasks
import ActivityKit
import AVFoundation
import AdjutantKit
import AdjutantUI

class AppDelegate: NSObject, UIApplicationDelegate {

    // MARK: - Application Lifecycle

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        registerForPushNotifications(application)
        registerBackgroundTasks()
        startLiveActivityOnLaunch()
        return true
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // End Live Activity when app terminates
        if #available(iOS 16.1, *) {
            Task {
                await LiveActivityService.shared.endActivity()
            }
        }
    }

    // MARK: - Push Notifications

    private func registerForPushNotifications(_ application: UIApplication) {
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .badge, .sound]
        ) { granted, error in
            if let error = error {
                print("[AppDelegate] Notification authorization error: \(error.localizedDescription)")
                return
            }

            if granted {
                DispatchQueue.main.async {
                    application.registerForRemoteNotifications()
                }
            }
        }
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        print("[AppDelegate] Device token: \(token)")

        // Register token with backend
        Task {
            await registerDeviceTokenWithBackend(token)
        }
    }

    /// Registers the device token with the backend for push notifications.
    private func registerDeviceTokenWithBackend(_ token: String) async {
        do {
            let apiClient = APIClient()
            let request = RegisterDeviceTokenRequest(
                token: token,
                platform: .ios,
                agentId: nil,
                bundleId: Bundle.main.bundleIdentifier
            )

            let response = try await apiClient.registerDeviceToken(request)
            print("[AppDelegate] Device token registered: \(response.isNew ? "new" : "updated")")
        } catch {
            print("[AppDelegate] Failed to register device token: \(error.localizedDescription)")
        }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        print("[AppDelegate] Failed to register for remote notifications: \(error.localizedDescription)")
    }

    /// Handles incoming remote notifications, including silent pushes for content-available.
    /// Triggers voice announcements based on notification type.
    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        print("[AppDelegate] Received remote notification: \(userInfo)")

        Task {
            let result = await handleRemoteNotification(userInfo: userInfo, application: application)
            completionHandler(result)
        }
    }

    /// Processes the remote notification payload and triggers appropriate voice services.
    private func handleRemoteNotification(
        userInfo: [AnyHashable: Any],
        application: UIApplication
    ) async -> UIBackgroundFetchResult {
        // Ensure audio session is active for background playback
        activateAudioSessionForBackground()

        // Extract notification type from payload
        let notificationType = userInfo["type"] as? String

        switch notificationType {
        case "new_mail":
            return await handleNewMailNotification(userInfo: userInfo)

        case "bead_update":
            return await handleBeadUpdateNotification(userInfo: userInfo)

        default:
            // Unknown or missing type - try general refresh
            print("[AppDelegate] Unknown notification type: \(notificationType ?? "nil"), performing general refresh")
            return await performGeneralRefresh()
        }
    }

    /// Handles new mail notifications by fetching mail and triggering voice announcements.
    private func handleNewMailNotification(userInfo: [AnyHashable: Any]) async -> UIBackgroundFetchResult {
        print("[AppDelegate] Handling new mail notification")

        guard await checkNetworkConnected() else {
            print("[AppDelegate] No network connection, skipping mail check")
            return .failed
        }

        do {
            let apiClient = APIClient()
            let response = try await apiClient.getMail()

            // Process messages for voice announcements
            let announcedCount = await OverseerMailAnnouncer.shared.processMessages(response.items)

            // Update unread count
            let unreadCount = response.items.filter { !$0.read }.count
            await updateUnreadMailCount(unreadCount)

            print("[AppDelegate] Mail check complete: \(announcedCount) announced, \(unreadCount) unread")
            return announcedCount > 0 ? .newData : .noData

        } catch {
            print("[AppDelegate] Failed to check mail: \(error.localizedDescription)")
            return .failed
        }
    }

    /// Handles bead update notifications by triggering the bead status monitor.
    private func handleBeadUpdateNotification(userInfo: [AnyHashable: Any]) async -> UIBackgroundFetchResult {
        print("[AppDelegate] Handling bead update notification")

        guard await checkNetworkConnected() else {
            print("[AppDelegate] No network connection, skipping bead poll")
            return .failed
        }

        // Trigger immediate poll for bead status changes
        await BeadStatusMonitor.shared.pollNow()

        let changesDetected = await getBeadChangesCount() > 0
        print("[AppDelegate] Bead poll complete, changes detected: \(changesDetected)")

        return changesDetected ? .newData : .noData
    }

    /// Performs a general refresh when notification type is unknown.
    private func performGeneralRefresh() async -> UIBackgroundFetchResult {
        guard await checkNetworkConnected() else {
            print("[AppDelegate] No network connection, skipping refresh")
            return .failed
        }

        var hasNewData = false

        // Check mail
        do {
            let apiClient = APIClient()
            let response = try await apiClient.getMail()

            let announcedCount = await OverseerMailAnnouncer.shared.processMessages(response.items)
            if announcedCount > 0 {
                hasNewData = true
            }

            let unreadCount = response.items.filter { !$0.read }.count
            await updateUnreadMailCount(unreadCount)
        } catch {
            print("[AppDelegate] Mail check failed during refresh: \(error.localizedDescription)")
        }

        // Poll beads
        await BeadStatusMonitor.shared.pollNow()

        return hasNewData ? .newData : .noData
    }

    /// Activates the audio session for background playback.
    /// Called before processing notifications to ensure voice announcements can play.
    private func activateAudioSessionForBackground() {
        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(
                .playback,
                mode: .spokenAudio,
                options: [.allowBluetooth, .allowAirPlay, .mixWithOthers]
            )
            try audioSession.setActive(true)
            print("[AppDelegate] Audio session activated for background playback")
        } catch {
            print("[AppDelegate] Failed to activate audio session: \(error.localizedDescription)")
        }
    }

    // MARK: - Main Actor Helpers

    /// Updates the unread mail count on the main actor.
    @MainActor
    private func updateUnreadMailCount(_ count: Int) {
        AppState.shared.updateUnreadMailCount(count)
    }

    /// Checks network connectivity on the main actor.
    @MainActor
    private func checkNetworkConnected() -> Bool {
        NetworkMonitor.shared.isConnected
    }

    /// Gets the bead status changes count on the main actor.
    @MainActor
    private func getBeadChangesCount() -> Int {
        BeadStatusMonitor.shared.changesDetectedCount
    }

    // MARK: - Background Tasks

    private func registerBackgroundTasks() {
        BackgroundTaskService.shared.registerBackgroundTasks()
    }

    func scheduleAppRefresh() {
        BackgroundTaskService.shared.scheduleAppRefresh()
    }

    func scheduleBackgroundProcessing() {
        BackgroundTaskService.shared.scheduleBackgroundProcessing()
    }

    // MARK: - Live Activity

    /// Starts a Live Activity on app launch with initial state.
    /// The activity will be updated by DashboardViewModel polling.
    private func startLiveActivityOnLaunch() {
        guard #available(iOS 16.1, *) else { return }

        Task {
            let initialState = GastownActivityAttributes.ContentState(
                powerState: .stopped,
                unreadMailCount: 0,
                activeAgents: 0,
                lastUpdated: Date()
            )

            await LiveActivityService.shared.startActivity(
                townName: "Gastown",
                initialState: initialState
            )
        }
    }
}
