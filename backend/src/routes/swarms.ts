/**
 * Swarms route for the Adjutant API.
 *
 * Endpoints:
 * - GET    /api/swarms             - List all swarms
 * - GET    /api/swarms/:id         - Get swarm status
 * - POST   /api/swarms             - Create a new swarm
 * - POST   /api/swarms/:id/agents  - Add an agent to a swarm
 * - DELETE /api/swarms/:id/agents/:sessionId - Remove agent from swarm
 * - DELETE /api/swarms/:id         - Destroy a swarm
 */

import { Router } from "express";
import { z } from "zod";
import {
  createSwarm,
  addAgentToSwarm,
  removeAgentFromSwarm,
  getSwarmStatus,
  listSwarms,
  destroySwarm,
} from "../services/swarm-service.js";
import {
  success,
  notFound,
  badRequest,
  validationError,
} from "../utils/index.js";

export const swarmsRouter = Router();

// ============================================================================
// Validation Schemas
// ============================================================================

const CreateSwarmSchema = z.object({
  projectPath: z.string().min(1, "Project path is required"),
  agentCount: z.number().int().min(1).max(20),
  workspaceType: z.enum(["worktree", "copy"]).optional(),
  coordinatorIndex: z.number().int().min(0).optional(),
  baseName: z.string().optional(),
});

const AddAgentSchema = z.object({
  name: z.string().optional(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /api/swarms
 * List all swarms.
 */
swarmsRouter.get("/", (_req, res) => {
  const swarms = listSwarms();
  return res.json(success(swarms));
});

/**
 * GET /api/swarms/:id
 * Get swarm status with live agent info.
 */
swarmsRouter.get("/:id", (req, res) => {
  const swarm = getSwarmStatus(req.params.id);

  if (!swarm) {
    return res.status(404).json(notFound("Swarm", req.params.id));
  }

  return res.json(success(swarm));
});

/**
 * POST /api/swarms
 * Create a new swarm of N agents.
 */
swarmsRouter.post("/", async (req, res) => {
  const parsed = CreateSwarmSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json(validationError("Invalid request", parsed.error.message));
  }

  const result = await createSwarm(parsed.data);

  if (!result.success) {
    return res.status(400).json(badRequest(result.error ?? "Failed to create swarm"));
  }

  return res.status(201).json(success(result.swarm));
});

/**
 * POST /api/swarms/:id/agents
 * Add an agent to an existing swarm.
 */
swarmsRouter.post("/:id/agents", async (req, res) => {
  const parsed = AddAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json(validationError("Invalid request", parsed.error.message));
  }

  const result = await addAgentToSwarm(req.params.id, parsed.data.name);

  if (!result.success) {
    return res.status(400).json(badRequest(result.error ?? "Failed to add agent"));
  }

  return res.status(201).json(success(result.agent));
});

/**
 * DELETE /api/swarms/:id/agents/:sessionId
 * Remove an agent from a swarm.
 */
swarmsRouter.delete("/:id/agents/:sessionId", async (req, res) => {
  const removeWorktree = req.query.removeWorktree === "true";
  const removed = await removeAgentFromSwarm(
    req.params.id,
    req.params.sessionId,
    removeWorktree
  );

  if (!removed) {
    return res.status(404).json(notFound("Agent in swarm", req.params.sessionId));
  }

  return res.json(success({ removed: true }));
});

/**
 * DELETE /api/swarms/:id
 * Destroy a swarm (kill all agents, optionally remove worktrees).
 */
swarmsRouter.delete("/:id", async (req, res) => {
  const removeWorktrees = req.query.removeWorktrees !== "false"; // default true
  const destroyed = await destroySwarm(req.params.id, removeWorktrees);

  if (!destroyed) {
    return res.status(404).json(notFound("Swarm", req.params.id));
  }

  return res.json(success({ destroyed: true }));
});
