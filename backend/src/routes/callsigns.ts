/**
 * Callsign toggle REST routes for the Adjutant API.
 *
 * Endpoints:
 * - GET  /api/callsigns                  - List all callsigns with enabled status
 * - PUT  /api/callsigns/:name/toggle     - Toggle individual callsign enabled/disabled
 * - PUT  /api/callsigns/toggle-all       - Toggle all callsigns at once (master toggle)
 */

import { Router } from "express";
import { z } from "zod";

import type { CallsignToggleService } from "../services/callsign-toggle-service.js";
import { isKnownCallsign } from "../services/callsign-service.js";
import { success, badRequest, internalError } from "../utils/responses.js";

const ToggleSchema = z.object({
  enabled: z.boolean({ error: "enabled must be a boolean" }),
});

/**
 * Create a callsigns router with the given CallsignToggleService.
 */
export function createCallsignsRouter(service: CallsignToggleService): Router {
  const router = Router();

  /**
   * GET /api/callsigns
   * Returns all 44 callsigns with enabled/disabled status and master toggle.
   */
  router.get("/", (_req, res) => {
    try {
      const callsigns = service.getAllSettings();
      const masterEnabled = service.isMasterEnabled();
      return res.json(success({ callsigns, masterEnabled }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to get callsign settings";
      return res.status(500).json(internalError(message));
    }
  });

  /**
   * PUT /api/callsigns/toggle-all
   * Enable or disable all callsigns at once.
   * IMPORTANT: This route must be registered BEFORE /:name/toggle
   * to avoid matching "toggle-all" as a callsign name.
   */
  router.put("/toggle-all", (req, res) => {
    const parsed = ToggleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(
        badRequest(parsed.error.issues[0]?.message ?? "Invalid request"),
      );
    }

    try {
      service.setAllEnabled(parsed.data.enabled);
      service.setMasterEnabled(parsed.data.enabled);
      return res.json(
        success({ masterEnabled: parsed.data.enabled }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to toggle all callsigns";
      return res.status(500).json(internalError(message));
    }
  });

  /**
   * PUT /api/callsigns/:name/toggle
   * Enable or disable a specific callsign. Must be a known roster callsign.
   */
  router.put("/:name/toggle", (req, res) => {
    const { name } = req.params;

    if (!isKnownCallsign(name)) {
      return res.status(400).json(
        badRequest(`'${name}' is not a known callsign`),
      );
    }

    const parsed = ToggleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(
        badRequest(parsed.error.issues[0]?.message ?? "Invalid request"),
      );
    }

    try {
      service.setEnabled(name, parsed.data.enabled);
      return res.json(
        success({ name, enabled: parsed.data.enabled }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to toggle callsign";
      return res.status(500).json(internalError(message));
    }
  });

  return router;
}
