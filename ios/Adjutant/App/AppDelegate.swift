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

    /// Handles incoming remote notifications in both foreground and background.
    /// Triggers voice announcements for mail and bead status updates.
    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        print("[AppDelegate] Received remote notification: \(userInfo)")

        Task {
            let result = await handleRemoteNotification(userInfo: userInfo)
            completionHandler(result)
        }
    }

    /// Handles a remote notification and triggers appropriate voice announcements.
    ///
    /// - Parameter userInfo: The notification payload
    /// - Returns: The background fetch result
    @MainActor
    private func handleRemoteNotification(userInfo: [AnyHashable: Any]) async -> UIBackgroundFetchResult {
        // Ensure audio session is activated for background playback
        activateAudioSessionForBackground()

        // Get notification type from payload
        guard let type = userInfo["type"] as? String else {
            print("[AppDelegate] Remote notification missing 'type' field")
            return .noData
        }

        switch type {
        case "mail", "new_mail":
            return await handleMailNotification(userInfo: userInfo)

        case "task", "bead_update", "bead_status":
            return await handleTaskNotification(userInfo: userInfo)

        case "system":
            return await handleSystemNotification(userInfo: userInfo)

        default:
            print("[AppDelegate] Unknown notification type: \(type)")
            return .noData
        }
    }

    /// Handles mail notifications by triggering voice announcements directly from push payload.
    /// Falls back to fetching messages if push data is incomplete.
    @MainActor
    private func handleMailNotification(userInfo: [AnyHashable: Any]) async -> UIBackgroundFetchResult {
        // Try direct push handling first (bypasses polling delay)
        if let payload = PushNotificationPayload(userInfo: userInfo) {
            let handled = await OverseerMailAnnouncer.shared.handlePushNotification(payload)
            if handled {
                print("[AppDelegate] Announced mail directly from push notification")
                return .newData
            }
        }

        // Fallback: fetch all mail and process (for incomplete push payloads)
        do {
            let apiClient = APIClient()
            let mailResponse = try await apiClient.getMail()
            let messages = mailResponse.items

            let announcedCount = await OverseerMailAnnouncer.shared.processMessages(messages)

            if announcedCount > 0 {
                print("[AppDelegate] Announced \(announcedCount) mail message(s) via fetch fallback")
                return .newData
            } else {
                return .noData
            }
        } catch {
            print("[AppDelegate] Failed to handle mail notification: \(error.localizedDescription)")
            return .failed
        }
    }

    /// Handles task/bead notifications by triggering voice announcements directly from push payload.
    /// Falls back to polling if push data is incomplete.
    @MainActor
    private func handleTaskNotification(userInfo: [AnyHashable: Any]) async -> UIBackgroundFetchResult {
        // Try direct push handling first (bypasses polling delay)
        if let payload = PushNotificationPayload(userInfo: userInfo) {
            let handled = await BeadStatusMonitor.shared.handlePushNotification(payload)
            if handled {
                print("[AppDelegate] Announced bead status directly from push notification")
                return .newData
            }
        }

        // Fallback: poll for all bead changes (for incomplete push payloads)
        await BeadStatusMonitor.shared.pollNow()

        if BeadStatusMonitor.shared.changesDetectedCount > 0 {
            print("[AppDelegate] Detected bead changes via poll fallback")
            return .newData
        } else {
            return .noData
        }
    }

    /// Handles system notifications by processing alert announcements.
    ///
    /// System alerts are announced through the TTS service when voice is enabled.
    @MainActor
    private func handleSystemNotification(userInfo: [AnyHashable: Any]) async -> UIBackgroundFetchResult {
        guard let message = userInfo["message"] as? String else {
            print("[AppDelegate] System notification missing 'message' field")
            return .noData
        }

        print("[AppDelegate] System notification: \(message)")

        // Create a synthetic message to process through OverseerMailAnnouncer's TTS pipeline
        let messageId = "system-\(UUID().uuidString)"
        let syntheticMessage = Message(
            id: messageId,
            from: "system",
            to: "overseer",
            subject: message,
            body: message,
            timestamp: ISO8601DateFormatter().string(from: Date()),
            read: false,
            priority: .high,
            type: .notification,
            threadId: messageId,
            pinned: false,
            isInfrastructure: true
        )

        let announcedCount = await OverseerMailAnnouncer.shared.processMessages([syntheticMessage])
        return announcedCount > 0 ? .newData : .noData
    }

    /// Activates the audio session for background playback.
    private func activateAudioSessionForBackground() {
        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(
                .playback,
                mode: .spokenAudio,
                options: [.allowBluetoothA2DP, .allowAirPlay, .mixWithOthers]
            )
            try audioSession.setActive(true)
            print("[AppDelegate] Audio session activated for background playback")
        } catch {
            print("[AppDelegate] Failed to activate audio session: \(error.localizedDescription)")
        }
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
