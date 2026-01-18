/**
 * Beads route for the gastown-boy API.
 *
 * Endpoints:
 * - GET /api/beads - List beads for the rig
 */

import { Router } from "express";
import { listBeads, listAllBeads } from "../services/beads-service.js";
import { resolveTownRoot, resolveRigPath } from "../services/gastown-workspace.js";
import { success, internalError } from "../utils/responses.js";

export const beadsRouter = Router();

/**
 * GET /api/beads
 * Returns beads for the beads tab.
 *
 * IMPORTANT: gastown_boy is the dashboard for ALL of Gas Town.
 * By default, we show ALL beads from the town, not filtered by rig.
 * See .claude/rules/00-critical-scope.md for context.
 *
 * Query params:
 * - rig: Filter by rig (optional - omit to show all beads)
 * - status: Status filter. Options:
 *   - "default": Shows open + in_progress + blocked (active work)
 *   - "open", "in_progress", "blocked", "deferred", "closed": Single status
 *   - "open,in_progress,blocked": Comma-separated list
 *   - "all": Shows everything
 *   Default: "default" (active work only)
 * - type: Filter by bead type (e.g., "task", "bug", "feature")
 * - limit: Max results (default: 100)
 * - excludeTown: Set to "true" to exclude hq- town beads (default: false - shows all)
 */
beadsRouter.get("/", async (req, res) => {
  const rig = req.query["rig"] as string | undefined;
  const statusParam = req.query["status"] as string | undefined;
  const typeParam = req.query["type"] as string | undefined;
  const limitStr = req.query["limit"] as string | undefined;
  const excludeTown = req.query["excludeTown"] === "true";
  // Higher default to show low-priority bugs (P3) which sort to the end
  const limit = limitStr ? parseInt(limitStr, 10) : 500;

  // Default to showing active work (open + in_progress + blocked)
  const status = statusParam ?? "default";

  // Include hq- town beads by default (gastown_boy is the dashboard for ALL of Gas Town)
  const excludePrefixes = excludeTown ? ["hq-"] : [];

  // If no rig specified, fetch from ALL beads databases
  if (!rig) {
    const result = await listAllBeads({
      ...(typeParam && { type: typeParam }),
      status,
      limit,
      excludePrefixes,
    });

    if (!result.success) {
      return res.status(500).json(
        internalError(result.error?.message ?? "Failed to list beads")
      );
    }

    return res.json(success(result.data));
  }

  // Rig specified - fetch from that rig's database only
  const townRoot = resolveTownRoot();
  const rigPath = resolveRigPath(rig, townRoot) ?? undefined;

  const result = await listBeads({
    rig,
    ...(rigPath && { rigPath }),
    ...(typeParam && { type: typeParam }),
    status,
    limit,
  });

  if (!result.success) {
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to list beads")
    );
  }

  return res.json(success(result.data));
});
