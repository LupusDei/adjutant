//
//  OverseerMailAnnouncer.swift
//  Adjutant
//
//  Created by Gas Town on 2026-02-01.
//

import Foundation
import AdjutantKit

/// Service that announces new mail directed to the overseer via voice synthesis.
///
/// Filters messages where the 'to' field contains 'overseer' and uses
/// TTSPlaybackService to announce them with humanized text.
@MainActor
public final class OverseerMailAnnouncer: ObservableObject {
    // MARK: - Singleton

    public static let shared = OverseerMailAnnouncer()

    // MARK: - Published Properties

    /// Whether the announcer is currently processing
    @Published public private(set) var isProcessing: Bool = false

    /// Last error message if any
    @Published public private(set) var lastError: String?

    // MARK: - Private Properties

    /// Set of mail IDs that have already been announced
    private var announcedMailIds: Set<String> = []

    /// UserDefaults key for persisting announced mail IDs
    private let announcedMailIdsKey = "OverseerMailAnnouncer.announcedMailIds"

    /// Maximum number of announced IDs to persist (to prevent unbounded growth)
    private let maxPersistedIds = 500

    /// API client for voice synthesis
    private var apiClient: APIClient {
        AppState.shared.apiClient
    }

    // MARK: - Initialization

    private init() {
        loadAnnouncedMailIds()
    }

    // MARK: - Public Methods

    /// Handles a push notification for new mail, bypassing polling delay.
    ///
    /// Call this from `application(_:didReceiveRemoteNotification:fetchCompletionHandler:)`
    /// when receiving a mail push notification.
    ///
    /// - Parameter payload: The parsed push notification payload
    /// - Returns: `true` if the notification was handled successfully
    @discardableResult
    public func handlePushNotification(_ payload: PushNotificationPayload) async -> Bool {
        guard payload.type == .mail else {
            print("[OverseerMailAnnouncer] Ignoring non-mail notification type: \(payload.type)")
            return false
        }

        guard let mailData = payload.mailData else {
            print("[OverseerMailAnnouncer] Failed to parse mail notification data")
            return false
        }

        // Only announce overseer mail
        guard mailData.isOverseerMail else {
            print("[OverseerMailAnnouncer] Skipping non-overseer mail notification")
            return false
        }

        // Skip if already announced
        guard !announcedMailIds.contains(mailData.messageId) else {
            print("[OverseerMailAnnouncer] Mail \(mailData.messageId) already announced")
            return false
        }

        guard !AppState.shared.isVoiceMuted else {
            print("[OverseerMailAnnouncer] Voice is muted, skipping push announcement")
            return false
        }

        guard AppState.shared.isVoiceAvailable else {
            print("[OverseerMailAnnouncer] Voice not available, skipping push announcement")
            return false
        }

        print("[OverseerMailAnnouncer] Handling push notification for mail \(mailData.messageId)")

        do {
            try await announceMailFromPush(mailData)
            announcedMailIds.insert(mailData.messageId)
            saveAnnouncedMailIds()
            return true
        } catch {
            print("[OverseerMailAnnouncer] Failed to announce push notification: \(error.localizedDescription)")
            lastError = error.localizedDescription
            return false
        }
    }

    /// Processes messages and announces any new unread mail directed to overseer.
    ///
    /// - Parameter messages: Array of messages to process
    /// - Returns: Number of messages announced
    @discardableResult
    public func processMessages(_ messages: [Message]) async -> Int {
        guard !AppState.shared.isVoiceMuted else {
            print("[OverseerMailAnnouncer] Voice is muted, skipping announcements")
            return 0
        }

        guard AppState.shared.isVoiceAvailable else {
            print("[OverseerMailAnnouncer] Voice not available, skipping announcements")
            return 0
        }

        isProcessing = true
        defer { isProcessing = false }

        // Filter to overseer messages that are new and unread
        let overseerMessages = messages.filter { message in
            isOverseerMessage(message) && !message.read && !announcedMailIds.contains(message.id)
        }

        guard !overseerMessages.isEmpty else {
            return 0
        }

        print("[OverseerMailAnnouncer] Found \(overseerMessages.count) new overseer messages to announce")

        var announcedCount = 0

        for message in overseerMessages {
            do {
                try await announceMessage(message)
                announcedMailIds.insert(message.id)
                announcedCount += 1
            } catch {
                print("[OverseerMailAnnouncer] Failed to announce message \(message.id): \(error.localizedDescription)")
                lastError = error.localizedDescription
            }
        }

        // Persist the announced IDs
        saveAnnouncedMailIds()

        return announcedCount
    }

    /// Clears all announced mail IDs (useful for testing or reset)
    public func clearAnnouncedMailIds() {
        announcedMailIds.removeAll()
        UserDefaults.standard.removeObject(forKey: announcedMailIdsKey)
    }

    // MARK: - Private Methods

    /// Checks if a message is directed to the overseer
    private func isOverseerMessage(_ message: Message) -> Bool {
        message.to.lowercased().contains("overseer")
    }

    /// Announces mail from a push notification payload
    private func announceMailFromPush(_ mailData: MailNotificationData) async throws {
        let announcementText = formatAnnouncementTextFromPush(mailData)

        print("[OverseerMailAnnouncer] Announcing from push: \(announcementText)")

        // Synthesize the announcement
        let request = SynthesizeRequest(
            text: announcementText,
            agentId: mailData.from,
            messageId: "announcement-\(mailData.messageId)"
        )

        let response = try await apiClient.synthesizeSpeech(request)

        // Get the TTS playback service and enqueue the audio
        guard let ttsService = DependencyContainer.shared.resolveOptional((any TTSPlaybackServiceProtocol).self) else {
            throw OverseerMailAnnouncerError.ttsServiceUnavailable
        }

        // Activate audio session for background playback
        VoiceAnnouncementService.shared.activateForBackgroundPlayback()

        ttsService.enqueue(
            text: announcementText,
            response: response,
            priority: priorityForPushMail(mailData),
            metadata: [
                "type": "mail_announcement",
                "mailId": mailData.messageId,
                "from": mailData.from,
                "source": "push"
            ]
        )

        // Start playback immediately
        ttsService.play()
    }

    /// Announces a single message via voice synthesis
    private func announceMessage(_ message: Message) async throws {
        let announcementText = formatAnnouncementText(message)

        print("[OverseerMailAnnouncer] Announcing: \(announcementText)")

        // Synthesize the announcement
        let request = SynthesizeRequest(
            text: announcementText,
            agentId: message.from,
            messageId: "announcement-\(message.id)"
        )

        let response = try await apiClient.synthesizeSpeech(request)

        // Get the TTS playback service and enqueue the audio
        guard let ttsService = DependencyContainer.shared.resolveOptional((any TTSPlaybackServiceProtocol).self) else {
            throw OverseerMailAnnouncerError.ttsServiceUnavailable
        }

        ttsService.enqueue(
            text: announcementText,
            response: response,
            priority: priorityForMessage(message),
            metadata: [
                "type": "mail_announcement",
                "mailId": message.id,
                "from": message.from
            ]
        )
    }

    /// Formats the announcement text for a message
    private func formatAnnouncementText(_ message: Message) -> String {
        // Format: "New mail from [sender]: [subject]"
        // If subject is long, truncate with ellipsis
        let maxSubjectLength = 100
        var subject = message.subject

        if subject.count > maxSubjectLength {
            subject = String(subject.prefix(maxSubjectLength)) + "..."
        }

        return "New mail from \(message.senderName): \(subject)"
    }

    /// Formats the announcement text from push notification data
    private func formatAnnouncementTextFromPush(_ mailData: MailNotificationData) -> String {
        let maxSubjectLength = 100
        var subject = mailData.subject

        if subject.count > maxSubjectLength {
            subject = String(subject.prefix(maxSubjectLength)) + "..."
        }

        return "New mail from \(mailData.senderName): \(subject)"
    }

    /// Determines playback priority based on message priority
    private func priorityForMessage(_ message: Message) -> PlaybackPriority {
        switch message.priority {
        case .urgent:
            return .urgent
        case .high:
            return .high
        case .normal:
            return .normal
        case .low, .lowest:
            return .low
        }
    }

    /// Determines playback priority from push notification priority value
    private func priorityForPushMail(_ mailData: MailNotificationData) -> PlaybackPriority {
        switch mailData.priority {
        case 0:
            return .urgent
        case 1:
            return .high
        case 2:
            return .normal
        default:
            return .low
        }
    }

    // MARK: - Persistence

    /// Loads announced mail IDs from UserDefaults
    private func loadAnnouncedMailIds() {
        if let savedIds = UserDefaults.standard.array(forKey: announcedMailIdsKey) as? [String] {
            announcedMailIds = Set(savedIds)
        }
    }

    /// Saves announced mail IDs to UserDefaults, trimming to max size
    private func saveAnnouncedMailIds() {
        // If we have too many IDs, keep only the most recent ones
        var idsToSave = Array(announcedMailIds)
        if idsToSave.count > maxPersistedIds {
            // Sort by ID (assuming newer IDs are alphabetically later) and keep the last N
            idsToSave.sort()
            idsToSave = Array(idsToSave.suffix(maxPersistedIds))
            announcedMailIds = Set(idsToSave)
        }
        UserDefaults.standard.set(idsToSave, forKey: announcedMailIdsKey)
    }
}

// MARK: - Errors

public enum OverseerMailAnnouncerError: LocalizedError {
    case ttsServiceUnavailable
    case synthesizeFailed(Error)

    public var errorDescription: String? {
        switch self {
        case .ttsServiceUnavailable:
            return "TTS playback service is not available"
        case .synthesizeFailed(let error):
            return "Failed to synthesize speech: \(error.localizedDescription)"
        }
    }
}
