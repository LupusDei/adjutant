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

        // Extract notification type from payload
        let notificationType = userInfo["type"] as? String ?? "unknown"

        Task {
            await handleRemoteNotification(type: notificationType, userInfo: userInfo)
            completionHandler(.newData)
        }
    }

    /// Processes remote notification based on type and triggers appropriate voice services.
    @MainActor
    private func handleRemoteNotification(type: String, userInfo: [AnyHashable: Any]) async {
        // Ensure audio session is active for background playback
        activateAudioSessionForBackground()

        switch type {
        case "mail", "new_mail":
            await handleMailNotification(userInfo: userInfo)
        case "bead_update", "bead_status":
            await handleBeadUpdateNotification(userInfo: userInfo)
        default:
            print("[AppDelegate] Unknown notification type: \(type)")
        }
    }

    /// Handles mail notifications by fetching new messages and announcing them.
    @MainActor
    private func handleMailNotification(userInfo: [AnyHashable: Any]) async {
        print("[AppDelegate] Processing mail notification")

        do {
            // Fetch recent messages (filter: .user excludes infrastructure messages)
            let apiClient = APIClient()
            let response = try await apiClient.getMail(filter: .user)

            // Process through the mail announcer (it filters for overseer + unread)
            let announcedCount = await OverseerMailAnnouncer.shared.processMessages(response.items)
            print("[AppDelegate] Announced \(announcedCount) new mail messages")
        } catch {
            print("[AppDelegate] Failed to fetch mail for notification: \(error.localizedDescription)")
        }
    }

    /// Handles bead update notifications by polling for status changes.
    @MainActor
    private func handleBeadUpdateNotification(userInfo: [AnyHashable: Any]) async {
        print("[AppDelegate] Processing bead update notification")

        // Trigger immediate poll of bead status
        await BeadStatusMonitor.shared.pollNow()
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
