//
//  PushNotification.swift
//  AdjutantKit
//
//  Created by Gas Town on 2026-02-01.
//

import Foundation

/// Types of push notifications sent by the backend.
public enum PushNotificationType: String, Codable, Sendable {
    case mail
    case beadUpdate = "bead_update"
    case beadHooked = "bead_hooked"
    case beadCompleted = "bead_completed"
}

/// Parsed push notification payload from APNs userInfo dictionary.
///
/// The backend sends push notifications with the following structure:
/// ```json
/// {
///   "aps": { "alert": { "title": "...", "body": "..." }, "sound": "default" },
///   "type": "mail" | "bead_update" | "bead_hooked" | "bead_completed",
///   "data": { ... type-specific payload ... }
/// }
/// ```
public struct PushNotificationPayload {
    /// The notification type
    public let type: PushNotificationType
    /// Raw data dictionary for type-specific payload
    public let data: [String: Any]
    /// Original userInfo dictionary
    public let userInfo: [AnyHashable: Any]

    /// Initialize from APNs userInfo dictionary.
    /// - Parameter userInfo: The userInfo dictionary from `didReceiveRemoteNotification`
    /// - Returns: Parsed payload, or nil if the payload is invalid
    public init?(userInfo: [AnyHashable: Any]) {
        guard let typeString = userInfo["type"] as? String,
              let type = PushNotificationType(rawValue: typeString) else {
            return nil
        }

        self.type = type
        self.data = userInfo["data"] as? [String: Any] ?? [:]
        self.userInfo = userInfo
    }
}

// MARK: - Mail Notification Payload

/// Payload data for mail push notifications.
public struct MailNotificationData: Sendable {
    /// Message ID
    public let messageId: String
    /// Sender address
    public let from: String
    /// Sender display name
    public let senderName: String
    /// Message subject
    public let subject: String
    /// Message priority (0-4)
    public let priority: Int
    /// Whether addressed to overseer
    public let isOverseerMail: Bool

    /// Parse from push notification data dictionary.
    public init?(data: [String: Any]) {
        guard let messageId = data["messageId"] as? String,
              let from = data["from"] as? String,
              let subject = data["subject"] as? String else {
            return nil
        }

        self.messageId = messageId
        self.from = from
        self.senderName = data["senderName"] as? String ?? from.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        self.subject = subject
        self.priority = data["priority"] as? Int ?? 2
        self.isOverseerMail = data["isOverseerMail"] as? Bool ?? false
    }
}

// MARK: - Bead Notification Payload

/// Payload data for bead update push notifications.
public struct BeadNotificationData: Sendable {
    /// Bead ID
    public let beadId: String
    /// Bead title
    public let title: String
    /// Previous status (if status changed)
    public let previousStatus: String?
    /// Current status
    public let currentStatus: String
    /// Assignee (if applicable)
    public let assignee: String?

    /// Parse from push notification data dictionary.
    public init?(data: [String: Any]) {
        guard let beadId = data["beadId"] as? String,
              let title = data["title"] as? String,
              let currentStatus = data["status"] as? String else {
            return nil
        }

        self.beadId = beadId
        self.title = title
        self.previousStatus = data["previousStatus"] as? String
        self.currentStatus = currentStatus
        self.assignee = data["assignee"] as? String
    }
}

// MARK: - Convenience Extensions

extension PushNotificationPayload {
    /// Parse mail notification data if this is a mail notification.
    public var mailData: MailNotificationData? {
        guard type == .mail else { return nil }
        return MailNotificationData(data: data)
    }

    /// Parse bead notification data if this is a bead notification.
    public var beadData: BeadNotificationData? {
        guard type == .beadUpdate || type == .beadHooked || type == .beadCompleted else { return nil }
        return BeadNotificationData(data: data)
    }
}
