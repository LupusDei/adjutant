/**
 * Permissions route for the Adjutant API.
 *
 * Endpoints:
 * - GET    /api/permissions         - Get permission config
 * - PATCH  /api/permissions         - Update permission config
 * - GET    /api/permissions/:sessionId  - Get effective mode for a session
 */

import { Router } from "express";
import { z } from "zod";
import {
  getPermissionConfig,
  updatePermissionConfig,
  getEffectiveMode,
  type PermissionConfig,
} from "../services/permission-service.js";
import {
  success,
  validationError,
} from "../utils/index.js";

export const permissionsRouter = Router();

// ============================================================================
// Validation
// ============================================================================

const UpdateConfigSchema = z.object({
  defaultMode: z.enum(["auto_accept", "auto_deny", "manual"]).optional(),
  sessions: z.record(z.string(), z.enum(["auto_accept", "auto_deny", "manual"])).optional(),
  toolOverrides: z.record(z.string(), z.enum(["auto_accept", "auto_deny", "manual"])).optional(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /api/permissions
 * Get the current permission configuration.
 */
permissionsRouter.get("/", (_req, res) => {
  const config = getPermissionConfig();
  return res.json(success(config));
});

/**
 * PATCH /api/permissions
 * Update the permission configuration.
 */
permissionsRouter.patch("/", (req, res) => {
  const parsed = UpdateConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json(validationError("Invalid request", parsed.error.message));
  }

  const updated = updatePermissionConfig(parsed.data as PermissionConfig);
  return res.json(success(updated));
});

/**
 * GET /api/permissions/:sessionId
 * Get the effective permission mode for a specific session.
 */
permissionsRouter.get("/:sessionId", (req, res) => {
  const mode = getEffectiveMode(req.params.sessionId);
  return res.json(success({ sessionId: req.params.sessionId, mode }));
});
