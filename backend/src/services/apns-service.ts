/**
 * APNs (Apple Push Notification Service) service for Adjutant.
 *
 * This service handles sending push notifications to iOS/macOS devices
 * using the @parse/node-apn library.
 */

import * as apn from "@parse/node-apn";
import { existsSync } from "fs";
import { logInfo, logError, logWarn, logDebug } from "../utils/index.js";
import { getAllDeviceTokens } from "./device-token-service.js";
import type {
  APNsNotification,
  APNsConfig,
  APNsEnvironment,
  PushNotificationResult,
} from "../types/apns.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Result type for APNs service operations.
 */
export interface APNsServiceResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Get APNs configuration from environment variables.
 */
function getAPNsConfig(): APNsConfig | null {
  const teamId = process.env["APNS_TEAM_ID"];
  const keyId = process.env["APNS_KEY_ID"];
  const bundleId = process.env["APNS_BUNDLE_ID"];
  const keyPath = process.env["APNS_KEY_PATH"];
  const environment = (process.env["APNS_ENVIRONMENT"] ?? "development") as APNsEnvironment;

  if (!teamId || !keyId || !bundleId || !keyPath) {
    return null;
  }

  return {
    teamId,
    keyId,
    bundleId,
    keyPath,
    environment,
  };
}

/**
 * Check if APNs is configured and available.
 */
export function isAPNsConfigured(): boolean {
  const config = getAPNsConfig();
  if (!config) {
    return false;
  }

  // Also check if the key file exists
  if (!existsSync(config.keyPath)) {
    logWarn("APNs key file not found", { keyPath: config.keyPath });
    return false;
  }

  return true;
}

// ============================================================================
// APNs Provider Management
// ============================================================================

let apnProvider: apn.Provider | null = null;

/**
 * Get or create the APNs provider instance.
 */
function getProvider(): apn.Provider | null {
  if (apnProvider) {
    return apnProvider;
  }

  const config = getAPNsConfig();
  if (!config) {
    logWarn("APNs not configured - missing environment variables");
    return null;
  }

  if (!existsSync(config.keyPath)) {
    logError("APNs key file not found", { keyPath: config.keyPath });
    return null;
  }

  try {
    apnProvider = new apn.Provider({
      token: {
        key: config.keyPath,
        keyId: config.keyId,
        teamId: config.teamId,
      },
      production: config.environment === "production",
    });

    logInfo("APNs provider initialized", {
      environment: config.environment,
      bundleId: config.bundleId,
    });

    return apnProvider;
  } catch (err) {
    logError("Failed to initialize APNs provider", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Shutdown the APNs provider (call on app shutdown).
 */
export function shutdownAPNs(): void {
  if (apnProvider) {
    apnProvider.shutdown();
    apnProvider = null;
    logInfo("APNs provider shutdown");
  }
}

// ============================================================================
// Notification Sending
// ============================================================================

/**
 * Create an APNs notification object.
 */
function createNotification(
  notification: APNsNotification,
  bundleId: string
): apn.Notification {
  const note = new apn.Notification();

  // Required fields
  note.alert = {
    title: notification.title,
    body: notification.body,
  };

  // Topic is required (bundle ID)
  note.topic = bundleId;

  // Optional fields
  if (notification.badge !== undefined) {
    note.badge = notification.badge;
  }

  if (notification.sound) {
    note.sound = notification.sound;
  } else {
    note.sound = "default";
  }

  if (notification.category) {
    note.category = notification.category;
  }

  if (notification.threadId) {
    note.threadId = notification.threadId;
  }

  if (notification.data) {
    note.payload = notification.data;
  }

  // Set expiry to 24 hours from now
  note.expiry = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

  return note;
}

/**
 * Send a push notification to a single device.
 */
export async function sendNotification(
  deviceToken: string,
  notification: APNsNotification
): Promise<APNsServiceResult<PushNotificationResult>> {
  const provider = getProvider();
  if (!provider) {
    return {
      success: false,
      error: {
        code: "APNS_NOT_CONFIGURED",
        message: "APNs is not configured. Check environment variables.",
      },
    };
  }

  const config = getAPNsConfig()!;
  const note = createNotification(notification, config.bundleId);

  try {
    logDebug("Sending push notification", {
      tokenPrefix: deviceToken.substring(0, 8),
      title: notification.title,
    });

    const result = await provider.send(note, deviceToken);

    if (result.failed.length > 0) {
      const failure = result.failed[0];
      const reason = failure?.response?.reason ?? "Unknown error";

      logError("Push notification failed", {
        tokenPrefix: deviceToken.substring(0, 8),
        reason,
      });

      return {
        success: false,
        data: {
          success: false,
          reason,
          deviceToken,
        },
      };
    }

    const success = result.sent[0];
    logInfo("Push notification sent", {
      tokenPrefix: deviceToken.substring(0, 8),
      title: notification.title,
    });

    return {
      success: true,
      data: {
        success: true,
        apnsId: success?.device,
        deviceToken,
      },
    };
  } catch (err) {
    logError("Push notification error", {
      tokenPrefix: deviceToken.substring(0, 8),
      error: err instanceof Error ? err.message : String(err),
    });

    return {
      success: false,
      error: {
        code: "SEND_ERROR",
        message: err instanceof Error ? err.message : "Failed to send notification",
      },
    };
  }
}

/**
 * Send a push notification to all registered devices.
 */
export async function sendNotificationToAll(
  notification: APNsNotification
): Promise<APNsServiceResult<{ sent: number; failed: number; results: PushNotificationResult[] }>> {
  const tokensResult = await getAllDeviceTokens();

  if (!tokensResult.success || !tokensResult.data) {
    return {
      success: false,
      error: {
        code: "LIST_TOKENS_ERROR",
        message: tokensResult.error?.message ?? "Failed to get device tokens",
      },
    };
  }

  const tokens = tokensResult.data;
  if (tokens.length === 0) {
    return {
      success: true,
      data: {
        sent: 0,
        failed: 0,
        results: [],
      },
    };
  }

  const results: PushNotificationResult[] = [];
  let sent = 0;
  let failed = 0;

  // Send to all devices in parallel
  const sendPromises = tokens.map(async (token) => {
    const result = await sendNotification(token.token, notification);
    if (result.success && result.data?.success) {
      sent++;
    } else {
      failed++;
    }
    if (result.data) {
      results.push(result.data);
    }
  });

  await Promise.all(sendPromises);

  logInfo("Broadcast notification complete", {
    sent,
    failed,
    total: tokens.length,
  });

  return {
    success: true,
    data: {
      sent,
      failed,
      results,
    },
  };
}

/**
 * Send a push notification to devices for a specific agent.
 */
export async function sendNotificationToAgent(
  agentId: string,
  notification: APNsNotification
): Promise<APNsServiceResult<{ sent: number; failed: number }>> {
  const tokensResult = await getAllDeviceTokens();

  if (!tokensResult.success || !tokensResult.data) {
    return {
      success: false,
      error: {
        code: "LIST_TOKENS_ERROR",
        message: tokensResult.error?.message ?? "Failed to get device tokens",
      },
    };
  }

  const agentTokens = tokensResult.data.filter((t) => t.agentId === agentId);
  if (agentTokens.length === 0) {
    // No devices for this agent, but not an error
    return {
      success: true,
      data: { sent: 0, failed: 0 },
    };
  }

  let sent = 0;
  let failed = 0;

  for (const token of agentTokens) {
    const result = await sendNotification(token.token, notification);
    if (result.success && result.data?.success) {
      sent++;
    } else {
      failed++;
    }
  }

  return {
    success: true,
    data: { sent, failed },
  };
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Send a new mail notification to all devices.
 */
export async function sendNewMailNotification(
  from: string,
  subject: string,
  messageId: string
): Promise<APNsServiceResult<{ sent: number; failed: number }>> {
  if (!isAPNsConfigured()) {
    // APNs not configured, silently return (not an error for local dev)
    logDebug("APNs not configured, skipping push notification");
    return {
      success: true,
      data: { sent: 0, failed: 0 },
    };
  }

  const notification: APNsNotification = {
    title: `New mail from ${from}`,
    body: subject,
    sound: "default",
    category: "NEW_MAIL",
    threadId: "mail",
    data: {
      type: "new_mail",
      messageId,
      from,
      subject,
    },
  };

  const result = await sendNotificationToAll(notification);

  if (result.success && result.data) {
    return {
      success: true,
      data: {
        sent: result.data.sent,
        failed: result.data.failed,
      },
    };
  }

  return {
    success: false,
    error: result.error ?? {
      code: "UNKNOWN_ERROR",
      message: "Failed to send notification",
    },
  };
}

/**
 * Get APNs service status.
 */
export function getAPNsStatus(): {
  configured: boolean;
  environment: APNsEnvironment | null;
  bundleId: string | null;
} {
  const config = getAPNsConfig();
  return {
    configured: isAPNsConfigured(),
    environment: config?.environment ?? null,
    bundleId: config?.bundleId ?? null,
  };
}
