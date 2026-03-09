//
//  OverseerMailAnnouncer.swift
//  Adjutant
//
//  Created by Adjutant on 2026-02-01.
//

import Foundation
import AdjutantKit

/// Service that tracks new mail directed to the overseer.
///
/// Filters messages where the 'to' field contains 'overseer' and tracks
/// which messages have been seen. Voice synthesis is on-demand only.
@MainActor
public final class OverseerMailAnnouncer: ObservableObject {
    // MARK: - Singleton

    public static let shared = OverseerMailAnnouncer()

    // MARK: - Published Properties

    /// Whether the announcer is currently processing
    @Published public private(set) var isProcessing: Bool = false

    // MARK: - Private Properties

    /// Set of mail IDs that have already been announced
    private var announcedMailIds: Set<String> = []

    /// UserDefaults key for persisting announced mail IDs
    private let announcedMailIdsKey = "OverseerMailAnnouncer.announcedMailIds"

    /// Maximum number of announced IDs to persist (to prevent unbounded growth)
    private let maxPersistedIds = 500

    // MARK: - Initialization

    private init() {
        loadAnnouncedMailIds()
    }

    // MARK: - Public Methods

    /// Handles a push notification for new mail — tracks the message as seen.
    ///
    /// No automatic voice synthesis. Call this from
    /// `application(_:didReceiveRemoteNotification:fetchCompletionHandler:)`
    /// when receiving a mail push notification.
    ///
    /// - Parameter payload: The parsed push notification payload
    /// - Returns: `true` if the notification was handled successfully
    @discardableResult
    public func handlePushNotification(_ payload: PushNotificationPayload) async -> Bool {
        await AppState.shared.waitForServicesReady()

        guard payload.type == .mail else {
            return false
        }

        guard let mailData = payload.mailData else {
            return false
        }

        guard mailData.isOverseerMail else {
            return false
        }

        // Track as seen (no automatic voice synthesis — on-demand only)
        announcedMailIds.insert(mailData.messageId)
        saveAnnouncedMailIds()
        return true
    }

    /// Processes messages and tracks new unread overseer mail as seen.
    /// No automatic voice synthesis — on-demand only.
    ///
    /// - Parameter messages: Array of messages to process
    /// - Returns: Number of new overseer messages tracked
    @discardableResult
    public func processMessages(_ messages: [Message]) async -> Int {
        await AppState.shared.waitForServicesReady()

        isProcessing = true
        defer { isProcessing = false }

        // Filter to overseer messages that are new and unread
        let overseerMessages = messages.filter { message in
            isOverseerMessage(message) && !message.read && !announcedMailIds.contains(message.id)
        }

        guard !overseerMessages.isEmpty else {
            return 0
        }

        // Track as seen (no automatic voice synthesis)
        for message in overseerMessages {
            announcedMailIds.insert(message.id)
        }

        saveAnnouncedMailIds()
        return overseerMessages.count
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

