//
//  NotificationService.swift
//  Adjutant
//
//  Created by Gas Town on 2026-01-26.
//

import Foundation
import UserNotifications
import AdjutantKit

/// Singleton service for managing local and push notifications.
///
/// Handles UNUserNotificationCenter permission requests, local notification scheduling,
/// notification categories/actions, and new mail detection.
@MainActor
public final class NotificationService: NSObject, ObservableObject {
    // MARK: - Singleton

    public static let shared = NotificationService()

    // MARK: - Published Properties

    /// Current authorization status for notifications
    @Published public private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined

    /// Whether notifications are fully authorized
    @Published public private(set) var isAuthorized: Bool = false

    /// Whether the user has explicitly denied notifications
    @Published public private(set) var isDenied: Bool = false

    /// Number of pending notifications
    @Published public private(set) var pendingNotificationCount: Int = 0

    // MARK: - Notification Categories

    /// Category identifiers for different notification types
    public enum Category: String {
        case newMail = "NEW_MAIL"
        case taskUpdate = "TASK_UPDATE"
        case systemAlert = "SYSTEM_ALERT"
        case reminder = "REMINDER"
    }

    /// Action identifiers for notification responses
    public enum Action: String {
        case view = "VIEW_ACTION"
        case dismiss = "DISMISS_ACTION"
        case reply = "REPLY_ACTION"
        case markRead = "MARK_READ_ACTION"
        case snooze = "SNOOZE_ACTION"
    }

    // MARK: - Private Properties

    private let notificationCenter = UNUserNotificationCenter.current()

    // MARK: - Initialization

    private override init() {
        super.init()
        notificationCenter.delegate = self
        registerCategories()
        Task {
            await refreshAuthorizationStatus()
        }
    }

    // MARK: - Authorization

    /// Requests notification authorization from the user.
    /// - Parameter options: The notification options to request (default: alert, badge, sound)
    /// - Returns: Whether authorization was granted
    @discardableResult
    public func requestAuthorization(
        options: UNAuthorizationOptions = [.alert, .badge, .sound]
    ) async -> Bool {
        do {
            let granted = try await notificationCenter.requestAuthorization(options: options)
            await refreshAuthorizationStatus()
            return granted
        } catch {
            print("[NotificationService] Authorization request failed: \(error.localizedDescription)")
            return false
        }
    }

    /// Refreshes the current authorization status from the system.
    public func refreshAuthorizationStatus() async {
        let settings = await notificationCenter.notificationSettings()
        authorizationStatus = settings.authorizationStatus
        isAuthorized = settings.authorizationStatus == .authorized
        isDenied = settings.authorizationStatus == .denied
    }

    // MARK: - Category Registration

    /// Registers notification categories with their associated actions.
    private func registerCategories() {
        // New Mail category with view and mark read actions
        let viewAction = UNNotificationAction(
            identifier: Action.view.rawValue,
            title: "View",
            options: [.foreground]
        )

        let markReadAction = UNNotificationAction(
            identifier: Action.markRead.rawValue,
            title: "Mark Read",
            options: []
        )

        let dismissAction = UNNotificationAction(
            identifier: Action.dismiss.rawValue,
            title: "Dismiss",
            options: [.destructive]
        )

        let snoozeAction = UNNotificationAction(
            identifier: Action.snooze.rawValue,
            title: "Snooze (15 min)",
            options: []
        )

        let newMailCategory = UNNotificationCategory(
            identifier: Category.newMail.rawValue,
            actions: [viewAction, markReadAction, dismissAction],
            intentIdentifiers: [],
            options: [.customDismissAction]
        )

        let taskUpdateCategory = UNNotificationCategory(
            identifier: Category.taskUpdate.rawValue,
            actions: [viewAction, dismissAction],
            intentIdentifiers: [],
            options: []
        )

        let systemAlertCategory = UNNotificationCategory(
            identifier: Category.systemAlert.rawValue,
            actions: [viewAction, dismissAction],
            intentIdentifiers: [],
            options: [.customDismissAction]
        )

        let reminderCategory = UNNotificationCategory(
            identifier: Category.reminder.rawValue,
            actions: [viewAction, snoozeAction, dismissAction],
            intentIdentifiers: [],
            options: []
        )

        notificationCenter.setNotificationCategories([
            newMailCategory,
            taskUpdateCategory,
            systemAlertCategory,
            reminderCategory
        ])
    }

    // MARK: - Local Notification Scheduling

    /// Schedules a local notification.
    /// - Parameters:
    ///   - title: The notification title
    ///   - body: The notification body text
    ///   - category: The notification category
    ///   - userInfo: Additional data to include with the notification
    ///   - delay: Time interval before showing the notification (default: immediate)
    ///   - identifier: Unique identifier for the notification (auto-generated if nil)
    /// - Returns: The notification identifier
    @discardableResult
    public func scheduleNotification(
        title: String,
        body: String,
        category: Category,
        userInfo: [String: Any] = [:],
        delay: TimeInterval = 0,
        identifier: String? = nil
    ) async -> String {
        let id = identifier ?? UUID().uuidString

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.categoryIdentifier = category.rawValue
        content.userInfo = userInfo

        let trigger: UNNotificationTrigger?
        if delay > 0 {
            trigger = UNTimeIntervalNotificationTrigger(timeInterval: delay, repeats: false)
        } else {
            trigger = nil
        }

        let request = UNNotificationRequest(identifier: id, content: content, trigger: trigger)

        do {
            try await notificationCenter.add(request)
            await refreshPendingCount()
            print("[NotificationService] Scheduled notification: \(id)")
        } catch {
            print("[NotificationService] Failed to schedule notification: \(error.localizedDescription)")
        }

        return id
    }

    /// Schedules a new mail notification.
    /// - Parameters:
    ///   - from: The sender of the mail
    ///   - subject: The mail subject
    ///   - mailId: The unique mail identifier
    ///   - delay: Time interval before showing (default: immediate)
    /// - Returns: The notification identifier
    @discardableResult
    public func scheduleNewMailNotification(
        from sender: String,
        subject: String,
        mailId: String,
        delay: TimeInterval = 0
    ) async -> String {
        return await scheduleNotification(
            title: "New Mail from \(sender)",
            body: subject,
            category: .newMail,
            userInfo: ["mailId": mailId, "type": "mail"],
            delay: delay,
            identifier: "mail-\(mailId)"
        )
    }

    /// Schedules a task update notification.
    /// - Parameters:
    ///   - taskTitle: The task title
    ///   - updateMessage: Description of the update
    ///   - taskId: The unique task identifier
    /// - Returns: The notification identifier
    @discardableResult
    public func scheduleTaskUpdateNotification(
        taskTitle: String,
        updateMessage: String,
        taskId: String
    ) async -> String {
        return await scheduleNotification(
            title: "Task Update: \(taskTitle)",
            body: updateMessage,
            category: .taskUpdate,
            userInfo: ["taskId": taskId, "type": "task"],
            identifier: "task-\(taskId)-\(Date().timeIntervalSince1970)"
        )
    }

    /// Schedules a system alert notification.
    /// - Parameters:
    ///   - title: The alert title
    ///   - message: The alert message
    ///   - alertType: Type identifier for the alert
    /// - Returns: The notification identifier
    @discardableResult
    public func scheduleSystemAlertNotification(
        title: String,
        message: String,
        alertType: String = "general"
    ) async -> String {
        return await scheduleNotification(
            title: title,
            body: message,
            category: .systemAlert,
            userInfo: ["alertType": alertType, "type": "system"],
            identifier: "system-\(alertType)-\(Date().timeIntervalSince1970)"
        )
    }

    // MARK: - Notification Management

    /// Cancels a pending notification by identifier.
    /// - Parameter identifier: The notification identifier to cancel
    public func cancelNotification(identifier: String) {
        notificationCenter.removePendingNotificationRequests(withIdentifiers: [identifier])
        Task {
            await refreshPendingCount()
        }
    }

    /// Cancels all pending notifications.
    public func cancelAllNotifications() {
        notificationCenter.removeAllPendingNotificationRequests()
        pendingNotificationCount = 0
    }

    /// Cancels all delivered (shown) notifications.
    public func clearDeliveredNotifications() {
        notificationCenter.removeAllDeliveredNotifications()
    }

    /// Cancels delivered notifications matching a prefix.
    /// - Parameter prefix: The identifier prefix to match (e.g., "mail-" for all mail notifications)
    public func clearDeliveredNotifications(withPrefix prefix: String) async {
        let delivered = await notificationCenter.deliveredNotifications()
        let matching = delivered.filter { $0.request.identifier.hasPrefix(prefix) }
        let identifiers = matching.map { $0.request.identifier }
        notificationCenter.removeDeliveredNotifications(withIdentifiers: identifiers)
    }

    /// Refreshes the count of pending notifications.
    private func refreshPendingCount() async {
        let pending = await notificationCenter.pendingNotificationRequests()
        pendingNotificationCount = pending.count
    }

    // MARK: - Badge Management

    /// Updates the app badge count.
    /// - Parameter count: The badge count (0 to clear)
    public func setBadgeCount(_ count: Int) async {
        do {
            try await notificationCenter.setBadgeCount(count)
        } catch {
            print("[NotificationService] Failed to set badge count: \(error.localizedDescription)")
        }
    }

    /// Clears the app badge.
    public func clearBadge() async {
        await setBadgeCount(0)
    }

    // MARK: - New Mail Processing

    /// Processes an array of messages to detect and notify about new unread mail.
    ///
    /// This method checks each message against the known mail IDs in AppState.
    /// For any new unread messages, it schedules a local notification.
    ///
    /// - Parameter messages: The array of messages to process
    /// - Returns: The number of new notifications scheduled
    @discardableResult
    public func processNewMessages(_ messages: [Message]) async -> Int {
        guard isAuthorized else {
            print("[NotificationService] Skipping new mail notifications - not authorized")
            return 0
        }

        // Extract all message IDs
        let allIds = Set(messages.map { $0.id })

        // Find new IDs using AppState
        let newIds = AppState.shared.addMailIds(allIds)

        guard !newIds.isEmpty else {
            return 0
        }

        // Filter to only new unread messages
        let newUnreadMessages = messages.filter { newIds.contains($0.id) && !$0.read }

        guard !newUnreadMessages.isEmpty else {
            return 0
        }

        print("[NotificationService] Processing \(newUnreadMessages.count) new unread messages")

        // Schedule notifications for new unread messages
        var scheduledCount = 0
        for message in newUnreadMessages {
            await scheduleNewMailNotification(
                from: message.from,
                subject: message.subject,
                mailId: message.id
            )
            scheduledCount += 1
        }

        // Update badge with total unread count
        let totalUnread = messages.filter { !$0.read }.count
        await setBadgeCount(totalUnread)

        return scheduledCount
    }
}

// MARK: - UNUserNotificationCenterDelegate

extension NotificationService: UNUserNotificationCenterDelegate {
    /// Called when a notification is about to be presented while the app is in foreground.
    nonisolated public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        // Show notifications even when app is in foreground
        return [.banner, .sound, .badge]
    }

    /// Called when the user interacts with a notification.
    nonisolated public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let userInfo = response.notification.request.content.userInfo
        let actionId = response.actionIdentifier

        print("[NotificationService] Received action: \(actionId) for notification: \(response.notification.request.identifier)")

        // Handle standard actions
        switch actionId {
        case UNNotificationDefaultActionIdentifier:
            // User tapped the notification
            await handleNotificationTap(userInfo: userInfo)

        case UNNotificationDismissActionIdentifier:
            // User dismissed the notification
            break

        case Action.view.rawValue:
            await handleNotificationTap(userInfo: userInfo)

        case Action.markRead.rawValue:
            await handleMarkRead(userInfo: userInfo)

        case Action.snooze.rawValue:
            await handleSnooze(originalNotification: response.notification)

        case Action.dismiss.rawValue:
            // Explicit dismiss, no action needed
            break

        default:
            print("[NotificationService] Unknown action: \(actionId)")
        }
    }

    // MARK: - Action Handlers

    private func handleNotificationTap(userInfo: [AnyHashable: Any]) async {
        guard let type = userInfo["type"] as? String else { return }

        switch type {
        case "mail":
            if let mailId = userInfo["mailId"] as? String {
                // Post notification for navigation
                await MainActor.run {
                    NotificationCenter.default.post(
                        name: .navigateToMail,
                        object: nil,
                        userInfo: ["mailId": mailId]
                    )
                }
            }

        case "task":
            if let taskId = userInfo["taskId"] as? String {
                await MainActor.run {
                    NotificationCenter.default.post(
                        name: .navigateToTask,
                        object: nil,
                        userInfo: ["taskId": taskId]
                    )
                }
            }

        default:
            break
        }
    }

    private func handleMarkRead(userInfo: [AnyHashable: Any]) async {
        guard let mailId = userInfo["mailId"] as? String else { return }

        await MainActor.run {
            NotificationCenter.default.post(
                name: .markMailAsRead,
                object: nil,
                userInfo: ["mailId": mailId]
            )
        }
    }

    private func handleSnooze(originalNotification: UNNotification) async {
        // Re-schedule the notification for 15 minutes later
        let content = originalNotification.request.content.mutableCopy() as! UNMutableNotificationContent
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 15 * 60, repeats: false)
        let request = UNNotificationRequest(
            identifier: originalNotification.request.identifier + "-snoozed",
            content: content,
            trigger: trigger
        )

        do {
            try await notificationCenter.add(request)
        } catch {
            print("[NotificationService] Failed to snooze notification: \(error.localizedDescription)")
        }
    }
}

// MARK: - Notification Names

extension Notification.Name {
    /// Posted when the user wants to navigate to a specific mail
    static let navigateToMail = Notification.Name("navigateToMail")

    /// Posted when the user wants to navigate to a specific task
    static let navigateToTask = Notification.Name("navigateToTask")

    /// Posted when the user marks mail as read from a notification
    static let markMailAsRead = Notification.Name("markMailAsRead")
}

// MARK: - Notification Error

public enum NotificationError: LocalizedError {
    case notAuthorized
    case schedulingFailed(Error)
    case categoryNotRegistered

    public var errorDescription: String? {
        switch self {
        case .notAuthorized:
            return "Notifications are not authorized"
        case .schedulingFailed(let error):
            return "Failed to schedule notification: \(error.localizedDescription)"
        case .categoryNotRegistered:
            return "Notification category not registered"
        }
    }
}
