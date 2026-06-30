/**
 * The Bridge — REST routes (adj-202.3.5).
 *
 * Thin HTTP adapters over the session broker + read-only tool bridge. No business logic,
 * no DB access — input validation (Zod) at the boundary, then delegate:
 *
 *   POST /api/bridge/session  — broker.startSession() (cost-guard ceiling check + record spend,
 *                               create→READY via runway-client) → { sessionId, sessionKey,
 *                               avatarId, expiresAt }. The Runway secret stays server-side; only
 *                               the short-lived sessionKey flows to the browser.
 *   POST /api/bridge/tool     — toolBridge.executeTool({ tool, projectId?, args? }) → structured
 *                               result. Non-whitelisted tools are rejected 403 (fail-closed).
 *
 * Mounted behind `apiKeyAuth` in index.ts — the dashboard calls it with the API key. This is a
 * read-only surface today, but startSession() spends real Runway credits, so it is NOT public.
 *
 * Architecture: route → service (per .claude/rules/04-architecture.md).
 */

import { Router } from "express";
import { z } from "zod";

import type { BridgeSessionBroker, StartSessionOptions } from "../services/bridge-session-broker.js";
import { BridgeCostCeilingError } from "../services/bridge-session-broker.js";
import type { BridgeToolBridge } from "../services/bridge-tool-bridge.js";
import type { BridgeRpcManager } from "../services/bridge-rpc-handler.js";
import { BRIDGE_RPC_TOOLS, composeBridgePersonality } from "../services/bridge-rpc-tools.js";
import { appendMemorySeed } from "../services/bridge-memory-seed.js";
import { success, error, validationError, ErrorCode } from "../utils/responses.js";
import { logError } from "../utils/logger.js";

/** The slice of each service the router needs (keeps the router testable with fakes). */
export interface BridgeRouterDeps {
  broker: Pick<BridgeSessionBroker, "startSession">;
  toolBridge: Pick<BridgeToolBridge, "executeTool">;
  /**
   * Owns the server-side read-only tool loop (adj-202.7). When present, every
   * session that opens gets a handler attached so the avatar can actually CALL the
   * fleet tools. Optional: if omitted, the avatar still talks — it just can't query
   * (the pre-202.7 behaviour). `attach` never throws, so it cannot break a session.
   */
  rpcManager?: Pick<BridgeRpcManager, "attach">;
  /**
   * Memory-seeded sessions (adj-202.6.4). When provided, its result is appended to the
   * session personality so the avatar opens already knowing the Commander's high-signal
   * preferences/decisions + recent corrections. Returns null (⇒ no change) on a blank-slate
   * memory. Optional: omit it and sessions are unseeded (the pre-6.4 behaviour).
   */
  buildMemorySeed?: (() => string | null) | undefined;
}

const SessionBodySchema = z
  .object({
    avatarId: z.string().min(1).optional(),
    personality: z.string().optional(),
    startScript: z.string().optional(),
    /** The dashboard's selected project — default context for project-scoped tools. */
    projectId: z.string().min(1).optional(),
  })
  .strict();

const ToolBodySchema = z.object({
  tool: z.string().min(1),
  projectId: z.string().min(1).optional(),
  args: z.record(z.string(), z.unknown()).optional(),
});

/** Map a tool-bridge error code to an HTTP status. Unknown codes default to 400. */
const TOOL_ERROR_STATUS: Record<string, number> = {
  TOOL_NOT_ALLOWED: 403,
  PROJECT_NOT_FOUND: 404,
  PROJECT_REQUIRED: 400,
  INVALID_ARGS: 400,
  TOOL_FAILED: 500,
};

export function createBridgeRouter(deps: BridgeRouterDeps): Router {
  const router = Router();

  // -------------------------------------------------------------------------
  // POST /api/bridge/session — open a managed avatar session.
  // -------------------------------------------------------------------------
  router.post("/session", async (req, res) => {
    const parsed = SessionBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json(validationError("Invalid session request", parsed.error.message));
    }

    // Build options with only the keys actually present (exactOptionalPropertyTypes).
    // The Bridge avatar is always tool-enabled: it gets the read-only fleet tools and
    // a persona that tells GWM-1 to CALL them (instead of stalling on "querying…").
    // adj-202.6.4 — seed the personality with what the coordinator already knows, so the
    // avatar opens with context instead of a blank slate. Best-effort: a seed-build failure
    // must not block a session, so fall back to no seed.
    let memorySeed: string | null = null;
    if (deps.buildMemorySeed) {
      try {
        memorySeed = deps.buildMemorySeed();
      } catch {
        memorySeed = null;
      }
    }

    const opts: StartSessionOptions = {
      tools: BRIDGE_RPC_TOOLS,
      personality: appendMemorySeed(composeBridgePersonality(parsed.data.personality), memorySeed),
    };
    if (parsed.data.avatarId !== undefined) opts.avatarId = parsed.data.avatarId;
    if (parsed.data.startScript !== undefined) opts.startScript = parsed.data.startScript;

    try {
      const creds = await deps.broker.startSession(opts);

      // Attach the server-side tool loop so the avatar can actually query the fleet.
      // `attach` swallows its own errors (a live, billable session must never be torn
      // down by a tool-loop hiccup), so awaiting it is safe and makes the loop ready
      // before the browser finishes connecting.
      if (deps.rpcManager) {
        const attachOpts: { sessionId: string; projectId?: string } = { sessionId: creds.sessionId };
        if (parsed.data.projectId !== undefined) attachOpts.projectId = parsed.data.projectId;
        await deps.rpcManager.attach(attachOpts);
      }

      return res.json(success(creds));
    } catch (err) {
      // Cost ceiling is an expected, recoverable condition — surface it distinctly (429).
      if (err instanceof BridgeCostCeilingError) {
        return res.status(429).json(error(err.code, err.message));
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      logError("bridge session create failed", { error: message });
      return res.status(502).json(error("BRIDGE_SESSION_FAILED", message));
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/bridge/tool — execute one read-only, whitelisted fleet tool.
  // -------------------------------------------------------------------------
  router.post("/tool", async (req, res) => {
    const parsed = ToolBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json(validationError("Invalid tool request", parsed.error.message));
    }

    try {
      const result = await deps.toolBridge.executeTool(parsed.data);
      if (!result.ok) {
        const status = TOOL_ERROR_STATUS[result.error.code] ?? 400;
        return res.status(status).json(error(result.error.code, result.error.message));
      }
      return res.json(success({ tool: result.tool, projectId: result.projectId, data: result.data }));
    } catch (err) {
      // executeTool is designed not to throw, but stay defensive at the HTTP boundary.
      const message = err instanceof Error ? err.message : "Unknown error";
      logError("bridge tool execution threw", { error: message });
      return res.status(500).json(error(ErrorCode.INTERNAL_ERROR, message));
    }
  });

  return router;
}
