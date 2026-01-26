//
//  AppDelegate.swift
//  Adjutant
//
//  Created by Gas Town on 2026-01-26.
//

import UIKit
import UserNotifications
import BackgroundTasks

class AppDelegate: NSObject, UIApplicationDelegate {

    // MARK: - Application Lifecycle

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        registerForPushNotifications(application)
        registerBackgroundTasks()
        return true
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
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: "com.adjutant.refresh",
            using: nil
        ) { task in
            self.handleAppRefresh(task: task as! BGAppRefreshTask)
        }

        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: "com.adjutant.processing",
            using: nil
        ) { task in
            self.handleBackgroundProcessing(task: task as! BGProcessingTask)
        }
    }

    private func handleAppRefresh(task: BGAppRefreshTask) {
        scheduleAppRefresh()

        task.expirationHandler = {
            task.setTaskCompleted(success: false)
        }

        // TODO: Implement refresh logic when BackgroundTaskService is available
        task.setTaskCompleted(success: true)
    }

    private func handleBackgroundProcessing(task: BGProcessingTask) {
        task.expirationHandler = {
            task.setTaskCompleted(success: false)
        }

        // TODO: Implement processing logic when BackgroundTaskService is available
        task.setTaskCompleted(success: true)
    }

    func scheduleAppRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: "com.adjutant.refresh")
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60) // 15 minutes

        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            print("[AppDelegate] Could not schedule app refresh: \(error.localizedDescription)")
        }
    }

    func scheduleBackgroundProcessing() {
        let request = BGProcessingTaskRequest(identifier: "com.adjutant.processing")
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false

        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            print("[AppDelegate] Could not schedule background processing: \(error.localizedDescription)")
        }
    }
}
