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
        // TODO: Send token to backend when NotificationService is implemented
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        print("[AppDelegate] Failed to register for remote notifications: \(error.localizedDescription)")
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
