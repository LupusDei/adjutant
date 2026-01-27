/**
 * Device token registration routes for APNs push notifications.
 */

import { Router } from "express";
import {
  registerDeviceToken,
  unregisterDeviceToken,
  getAllDeviceTokens,
} from "../services/device-token-service.js";
import { getAPNsStatus, sendNotificationToAll } from "../services/apns-service.js";
import { RegisterDeviceTokenRequestSchema, APNsNotificationSchema } from "../types/apns.js";
import {
  success,
  internalError,
  validationError,
  notFound,
} from "../utils/responses.js";

export const devicesRouter = Router();

/**
 * POST /api/devices/register
 * Register a device token for push notifications.
 *
 * Body: { token: string, platform: "ios" | "macos", agentId?: string, bundleId?: string }
 */
devicesRouter.post("/register", async (req, res) => {
  const parsed = RegisterDeviceTokenRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message ?? "Invalid request";
    return res.status(400).json(validationError(firstError));
  }

  const result = await registerDeviceToken(parsed.data);

  if (!result.success) {
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to register device token")
    );
  }

  // Return 201 for new registrations, 200 for updates
  const statusCode = result.data?.isNew ? 201 : 200;
  return res.status(statusCode).json(success(result.data));
});

/**
 * DELETE /api/devices/:token
 * Unregister a device token.
 */
devicesRouter.delete("/:token", async (req, res) => {
  const { token } = req.params;

  if (!token) {
    return res.status(400).json(validationError("Token is required"));
  }

  const result = await unregisterDeviceToken(token);

  if (!result.success) {
    if (result.error?.code === "TOKEN_NOT_FOUND") {
      return res.status(404).json(notFound("Device token", token));
    }
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to unregister device token")
    );
  }

  return res.json(success({ deleted: true }));
});

/**
 * GET /api/devices
 * List all registered device tokens.
 * (Admin/debug endpoint)
 */
devicesRouter.get("/", async (_req, res) => {
  const result = await getAllDeviceTokens();

  if (!result.success) {
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to list device tokens")
    );
  }

  return res.json(success(result.data));
});

/**
 * GET /api/devices/status
 * Get APNs configuration status.
 */
devicesRouter.get("/status", (_req, res) => {
  const status = getAPNsStatus();
  return res.json(success(status));
});

/**
 * POST /api/devices/test
 * Send a test notification to all registered devices.
 * (Admin/debug endpoint)
 */
devicesRouter.post("/test", async (req, res) => {
  const parsed = APNsNotificationSchema.safeParse(req.body);

  if (!parsed.success) {
    // Use default test notification if no body provided
    const testNotification = {
      title: "Test Notification",
      body: "This is a test push notification from Adjutant.",
    };

    const result = await sendNotificationToAll(testNotification);

    if (!result.success) {
      return res.status(500).json(
        internalError(result.error?.message ?? "Failed to send test notification")
      );
    }

    return res.json(success({
      sent: result.data?.sent ?? 0,
      failed: result.data?.failed ?? 0,
    }));
  }

  const result = await sendNotificationToAll(parsed.data);

  if (!result.success) {
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to send notification")
    );
  }

  return res.json(success({
    sent: result.data?.sent ?? 0,
    failed: result.data?.failed ?? 0,
  }));
});
