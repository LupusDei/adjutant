/**
 * APNs (Apple Push Notification Service) types for Adjutant.
 *
 * This module defines types for device token management and push notifications.
 */

import { z } from "zod";

// ============================================================================
// Enums and Primitives
// ============================================================================

/** Supported device platforms for push notifications. */
export type DevicePlatform = "ios" | "macos";

/** APNs environment (sandbox for development, production for App Store). */
export type APNsEnvironment = "development" | "production";

/** Push notification priority levels. */
export type PushPriority = "high" | "normal";

// ============================================================================
// Device Token Types
// ============================================================================

/** A registered device token for push notifications. */
export interface DeviceToken {
  /** The APNs device token (hex string) */
  token: string;
  /** Device platform: ios or macos */
  platform: DevicePlatform;
  /** Agent this device is associated with (optional) */
  agentId?: string | undefined;
  /** Bundle ID of the app */
  bundleId: string;
  /** ISO 8601 timestamp when token was registered */
  registeredAt: string;
  /** ISO 8601 timestamp when token was last seen */
  lastSeenAt: string;
}

/** Request payload for registering a device token. */
export interface RegisterDeviceTokenRequest {
  /** The APNs device token (hex string) */
  token: string;
  /** Device platform: ios or macos */
  platform: DevicePlatform;
  /** Agent this device is associated with (optional) */
  agentId?: string | undefined;
  /** Bundle ID of the app (for multi-app support) */
  bundleId?: string | undefined;
}

/** Response from device token registration. */
export interface RegisterDeviceTokenResponse {
  /** Whether this was a new registration or update */
  isNew: boolean;
  /** The registered device token */
  token: DeviceToken;
}

// ============================================================================
// Push Notification Types
// ============================================================================

/** APNs notification payload. */
export interface APNsNotification {
  /** Notification title */
  title: string;
  /** Notification body text */
  body: string;
  /** Badge count to display (optional) */
  badge?: number | undefined;
  /** Sound to play (optional, default: "default") */
  sound?: string | undefined;
  /** Category for actionable notifications (optional) */
  category?: string | undefined;
  /** Thread ID for notification grouping (optional) */
  threadId?: string | undefined;
  /** Custom data payload (optional) */
  data?: Record<string, unknown> | undefined;
}

// ============================================================================
// Push Notification Data Payloads
// ============================================================================

/**
 * APNs data payload for chat messages (agent → user).
 *
 * iOS mapping (AppDelegate.swift handleChatMessageNotification):
 *   - type → switch case "chat_message"
 *   - agentId → userInfo["agentId"]
 *   - body → userInfo["body"]
 *   - messageId → userInfo["messageId"]
 */
export interface ChatMessagePayload {
  type: "chat_message";
  /** ID of the stored message */
  messageId: string;
  /** Agent that sent the message (server-resolved, not client-supplied) */
  agentId: string;
  /** Message body text (truncated to 200 chars for push) */
  body: string;
}

/**
 * APNs data payload for agent announcements (completion, blocker, question).
 *
 * iOS mapping (AppDelegate.swift handleAnnouncementNotification):
 *   - type → switch case "announcement"
 *   - agentId → userInfo["agentId"]
 *   - body → userInfo["body"]
 *   - messageId → userInfo["messageId"]
 *   - announcementType → userInfo["announcementType"]
 *   - beadId → userInfo["beadId"] (optional)
 */
export interface AnnouncementPayload {
  type: "announcement";
  /** ID of the stored announcement message */
  messageId: string;
  /** Agent that made the announcement */
  agentId: string;
  /** Announcement body text (truncated to 200 chars for push) */
  body: string;
  /** Announcement category */
  announcementType: "completion" | "blocker" | "question";
  /** Related bead ID (optional) */
  beadId?: string | undefined;
}

/**
 * APNs data payload for legacy mail notifications.
 *
 * iOS mapping (AppDelegate.swift handleNewMailNotification):
 *   - type → switch case "new_mail"
 *   - from → userInfo["from"]
 *   - subject → userInfo["subject"]
 *   - messageId → userInfo["messageId"]
 */
export interface NewMailPayload {
  type: "new_mail";
  /** Mail message ID */
  messageId: string;
  /** Sender of the mail */
  from: string;
  /** Mail subject line */
  subject: string;
}

/** Union of all push notification data payload types. */
export type PushNotificationPayload =
  | ChatMessagePayload
  | AnnouncementPayload
  | NewMailPayload;

/** Result from sending a push notification. */
export interface PushNotificationResult {
  /** Whether the notification was sent successfully */
  success: boolean;
  /** APNs ID for the sent notification (if successful) */
  apnsId?: string | undefined;
  /** Error reason (if failed) */
  reason?: string | undefined;
  /** Device token that was targeted */
  deviceToken: string;
}

// ============================================================================
// APNs Configuration Types
// ============================================================================

/** APNs service configuration. */
export interface APNsConfig {
  /** Apple Developer Team ID */
  teamId: string;
  /** APNs Key ID */
  keyId: string;
  /** App Bundle ID */
  bundleId: string;
  /** Path to the .p8 key file */
  keyPath: string;
  /** APNs environment */
  environment: APNsEnvironment;
}

// ============================================================================
// Zod Schemas (for runtime validation)
// ============================================================================

export const DevicePlatformSchema = z.enum(["ios", "macos"]);

export const APNsEnvironmentSchema = z.enum(["development", "production"]);

export const PushPrioritySchema = z.enum(["high", "normal"]);

export const RegisterDeviceTokenRequestSchema = z.object({
  token: z.string().min(1, "Device token is required"),
  platform: DevicePlatformSchema,
  agentId: z.string().optional(),
  bundleId: z.string().optional(),
});

export const DeviceTokenSchema = z.object({
  token: z.string(),
  platform: DevicePlatformSchema,
  agentId: z.string().optional(),
  bundleId: z.string(),
  registeredAt: z.string(),
  lastSeenAt: z.string(),
});

export const APNsNotificationSchema = z.object({
  title: z.string().min(1, "Notification title is required"),
  body: z.string().min(1, "Notification body is required"),
  badge: z.number().int().min(0).optional(),
  sound: z.string().optional(),
  category: z.string().optional(),
  threadId: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});
