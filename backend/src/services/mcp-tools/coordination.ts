/**
 * MCP Coordination Tools for Adjutant.
 *
 * LLM-controlled action tools: spawn_worker, assign_bead, nudge_agent,
 * decommission_agent, rebalance_work, schedule_check, watch_for.
 * These are restricted to the adjutant agent only (adj-054.3.6 access guard).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAgentBySession } from "../mcp-server.js";
import { spawnAgent } from "../agent-spawner-service.js";
import { updateBead } from "../beads/beads-mutations.js";
import { getSessionBridge } from "../session-bridge.js";
import { getEventBus } from "../event-bus.js";
import type { EventName } from "../event-bus.js";
import { execBd } from "../bd-client.js";
import { logInfo, logWarn } from "../../utils/index.js";
import { getPersonaService } from "../persona-service.js";
import { generatePrompt } from "../prompt-generator.js";
import { writeAgentFile } from "../agent-file-writer.js";
import type { AdjutantState } from "../adjutant/state-store.js";
import type { MessageStore } from "../message-store.js";
import type { StimulusEngine } from "../adjutant/stimulus-engine.js";
import type { EventStore } from "../event-store.js";
import type { CronScheduleStore } from "../adjutant/cron-schedule-store.js";
import { computeNextFireAt } from "../adjutant/cron-schedule-store.js";
import { cronToIntervalMs } from "../adjutant/adjutant-core.js";

// ============================================================================
// Constants
// ============================================================================

/** Agent IDs that can use coordination tools */
const ALLOWED_AGENTS = new Set(["adjutant-coordinator", "adjutant"]);

/** Agent IDs that cannot be decommissioned */
const PROTECTED_AGENTS = new Set(["adjutant-coordinator", "adjutant"]);

/** Counter for auto-generated agent names */
let autoNameCounter = 0;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check that the calling agent is adjutant or adjutant-coordinator.
 * Returns the agentId on success, or null on failure.
 */
function checkAccess(sessionId: string | undefined): string | null {
  if (!sessionId) return null;
  const agentId = getAgentBySession(sessionId);
  if (!agentId) return null;
  if (!ALLOWED_AGENTS.has(agentId)) return null;
  return agentId;
}

/**
 * Resolve the calling agent, checking access. Returns agentId or returns
 * an error result. Caller must check the `error` field to decide whether
 * to early-return.
 */
function resolveCallerOrError(sessionId: string | undefined): { agentId: string; error?: undefined } | { agentId?: undefined; error: ReturnType<typeof restrictedResult> | ReturnType<typeof unknownSessionResult> } {
  if (!sessionId) return { error: unknownSessionResult() };
  const agentId = getAgentBySession(sessionId);
  if (!agentId) return { error: unknownSessionResult() };
  if (!ALLOWED_AGENTS.has(agentId)) return { error: restrictedResult() };
  return { agentId };
}

/**
 * Resolve any MCP-connected agent (not restricted to coordinator).
 * Used by scheduling tools to allow self-scheduling by any agent.
 * Returns the agentId on success, or null if session is unknown.
 */
function resolveCallerAgent(sessionId: string | undefined): string | null {
  if (!sessionId) return null;
  return getAgentBySession(sessionId) ?? null;
}

/**
 * Check whether the calling agent is the coordinator (or adjutant).
 * Used for ownership checks where coordinator has admin privileges.
 */
function isCoordinator(agentId: string): boolean {
  return ALLOWED_AGENTS.has(agentId);
}

function unknownSessionResult() {
  return {
    content: [{ type: "text" as const, text: "Unknown agent: session not found" }],
    isError: true as const,
  };
}

function restrictedResult() {
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ error: "Coordination tools are restricted to the adjutant agent" }),
    }],
    isError: true as const,
  };
}

function jsonResult(data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  };
}

/**
 * Parse a delay string like "15m", "1h", "30s" into milliseconds.
 * Returns null if the format is invalid.
 */
function parseDelay(delay: string): number | null {
  const match = /^(\d+)(s|m|h)$/.exec(delay);
  if (!match) return null;
  const value = parseInt(match[1]!, 10);
  if (value <= 0) return null;
  const unit = match[2]!;
  switch (unit) {
    case "s": return value * 1_000;
    case "m": return value * 60_000;
    case "h": return value * 3_600_000;
    default: return null;
  }
}

function generateAgentName(): string {
  autoNameCounter++;
  return `agent-${autoNameCounter}`;
}

/** Reset auto-name counter (for testing). */
export function _resetAutoNameCounter(): void {
  autoNameCounter = 0;
}

/**
 * Bridge a logDecision call to eventStore + EventBus for timeline integration.
 * No-ops when eventStore is not provided.
 */
function emitCoordinatorAction(
  eventStore: EventStore | undefined,
  callerAgent: string | undefined,
  decision: { behavior: string; action: string; target?: string; reason?: string },
  extraDetail?: Record<string, unknown>,
): void {
  if (!eventStore) return;
  const target = decision.target ?? null;
  const input: Parameters<EventStore["insertEvent"]>[0] = {
    eventType: "coordinator_action",
    agentId: callerAgent ?? "adjutant-coordinator",
    action: `${decision.action}: ${target ?? "system"}`,
    detail: { behavior: decision.behavior, action: decision.action, target, reason: decision.reason ?? null, ...extraDetail },
  };
  if (target?.startsWith("adj-")) {
    input.beadId = target;
  }
  eventStore.insertEvent(input);
  getEventBus().emit("coordinator:action", {
    behavior: decision.behavior,
    action: decision.action,
    target,
    reason: decision.reason ?? null,
  });
}

// ============================================================================
// Tool Registration
// ============================================================================

/**
 * Register all coordination MCP tools on the given server.
 */
export function registerCoordinationTools(
  server: McpServer,
  state: AdjutantState,
  messageStore: MessageStore,
  stimulusEngine?: StimulusEngine,
  eventStore?: EventStore,
  cronScheduleStore?: CronScheduleStore,
): void {
  // --------------------------------------------------------------------------
  // spawn_worker
  // --------------------------------------------------------------------------
  server.tool(
    "spawn_worker",
    "Spawn a new agent worker with a specific task prompt",
    {
      prompt: z.string().describe("The task prompt for the new agent"),
      beadId: z.string().optional().describe("Optional bead to associate with the spawn"),
      agentName: z.string().optional().describe("Optional name (auto-generated if omitted)"),
      projectPath: z.string().optional().describe("Project directory for the agent to work in (e.g., /Users/user/code/project). Defaults to server CWD if omitted."),
    },
    async ({ prompt, beadId, agentName, projectPath }, extra) => {
      const callerAgentId = checkAccess(extra.sessionId);
      if (!callerAgentId) {
        const resolved = resolveCallerOrError(extra.sessionId);
        // Safe: resolved.error is always defined when agentId is undefined
        return resolved.error!;
      }

      const name = agentName ?? generateAgentName();
      const resolvedProjectPath = projectPath ?? process.env["ADJUTANT_PROJECT_ROOT"] ?? process.cwd();

      // Living Personas (adj-158.3.2): Check if the callsign has a linked persona.
      // If yes, write agent file with persona prompt and pass --agent flag.
      // Also set ADJUTANT_PERSONA_ID env var so the persona-inject.sh SessionStart
      // hook can fetch and inject the persona prompt into the agent's context.
      // (adj-180: the --agent flag alone is insufficient for untracked/gitignored files)
      // If no, the agent-spawner-service will handle genesis prompt injection.
      let agentFile: string | undefined;
      let spawnEnvVars: Record<string, string> | undefined;
      const personaService = getPersonaService();
      if (personaService) {
        const linkedPersona = personaService.getPersonaByCallsign(name);
        if (linkedPersona) {
          const personaPrompt = generatePrompt(linkedPersona);
          const agentName_sanitized = await writeAgentFile(resolvedProjectPath, linkedPersona.name, personaPrompt, linkedPersona.description);
          agentFile = agentName_sanitized;
          spawnEnvVars = { ADJUTANT_PERSONA_ID: linkedPersona.id };
          logInfo("spawn_worker: using linked persona", { name, personaId: linkedPersona.id });
        }
      }

      const result = await spawnAgent({
        name,
        projectPath: resolvedProjectPath,
        initialPrompt: prompt,
        ...(agentFile ? { agentFile } : {}),
        ...(spawnEnvVars ? { envVars: spawnEnvVars } : {}),
      });

      if (!result.success) {
        logWarn("spawn_worker failed", { name, error: result.error });
        return jsonResult({ success: false, error: result.error ?? "Spawn failed" });
      }

      const spawnDecision = {
        behavior: "adjutant",
        action: "spawn_worker",
        target: name,
        reason: `Spawned with prompt: ${prompt.slice(0, 100)}`,
      };
      state.logDecision(spawnDecision);
      emitCoordinatorAction(eventStore, callerAgentId, spawnDecision);

      state.logSpawn(name, `Spawned via spawn_worker tool`, beadId);

      logInfo("spawn_worker: agent spawned", { name, sessionId: result.sessionId });

      return jsonResult({
        success: true,
        agentName: name,
        sessionId: result.sessionId,
      });
    },
  );

  // --------------------------------------------------------------------------
  // assign_bead
  // --------------------------------------------------------------------------
  server.tool(
    "assign_bead",
    "Assign a bead to a specific agent with reasoning",
    {
      beadId: z.string().describe("The bead to assign"),
      agentId: z.string().describe("The agent to assign it to"),
      reason: z.string().describe("Why this assignment makes sense"),
    },
    async ({ beadId, agentId, reason }, extra) => {
      const callerAgentId = checkAccess(extra.sessionId);
      if (!callerAgentId) {
        const resolved = resolveCallerOrError(extra.sessionId);
        return resolved.error!;
      }

      const result = await updateBead(beadId, {
        assignee: agentId,
        status: "in_progress",
      });

      if (!result.success) {
        logWarn("assign_bead failed", { beadId, agentId, error: result.error });
        return jsonResult({
          success: false,
          error: result.error?.message ?? "Failed to assign bead",
        });
      }

      // Update agent profile in state store
      state.upsertAgentProfile({
        agentId,
        currentBeadId: beadId,
      });

      // Emit bead:assigned event
      getEventBus().emit("bead:assigned", {
        beadId,
        agentId,
        assignedBy: callerAgentId,
      });

      const assignDecision = {
        behavior: "adjutant",
        action: "assign_bead",
        target: beadId,
        reason,
      };
      state.logDecision(assignDecision);
      emitCoordinatorAction(eventStore, callerAgentId, assignDecision, { agentId });

      logInfo("assign_bead: bead assigned", { beadId, agentId });

      return jsonResult({ success: true, beadId, agentId });
    },
  );

  // --------------------------------------------------------------------------
  // nudge_agent
  // --------------------------------------------------------------------------
  server.tool(
    "nudge_agent",
    "Send a targeted prompt to an agent's tmux session to nudge them",
    {
      agentId: z.string().describe("The agent to nudge"),
      message: z.string().describe("The nudge message/prompt"),
    },
    async ({ agentId, message }, extra) => {
      const callerAgentId = checkAccess(extra.sessionId);
      if (!callerAgentId) {
        const resolved = resolveCallerOrError(extra.sessionId);
        return resolved.error!;
      }

      const bridge = getSessionBridge();
      const sessions = bridge.registry.findByName(agentId);

      if (!sessions || sessions.length === 0) {
        return jsonResult({
          success: false,
          error: `Agent session not found: ${agentId}`,
        });
      }

      // Collapse to single line for tmux compatibility
      const singleLine = message.replace(/\n+/g, " ").trim();

      // Send to the first matching session — length check above guarantees index 0 exists
      const session = sessions[0]!;
      const sent = await bridge.sendInput(session.id, singleLine);

      if (!sent) {
        return jsonResult({
          success: false,
          error: `Failed to send input to agent: ${agentId}`,
        });
      }

      const nudgeDecision = {
        behavior: "adjutant",
        action: "nudge_agent",
        target: agentId,
        reason: `Nudge: ${singleLine.slice(0, 100)}`,
      };
      state.logDecision(nudgeDecision);
      emitCoordinatorAction(eventStore, callerAgentId, nudgeDecision);

      logInfo("nudge_agent: message sent", { agentId });

      return jsonResult({ success: true, agentId });
    },
  );

  // --------------------------------------------------------------------------
  // decommission_agent
  // --------------------------------------------------------------------------
  server.tool(
    "decommission_agent",
    "Gracefully shut down an idle agent",
    {
      agentId: z.string().describe("The agent to decommission"),
      reason: z.string().describe("Why decommissioning"),
    },
    async ({ agentId, reason }, extra) => {
      const callerAgentId = checkAccess(extra.sessionId);
      if (!callerAgentId) {
        const resolved = resolveCallerOrError(extra.sessionId);
        return resolved.error!;
      }

      // Validate: cannot decommission protected agents
      if (PROTECTED_AGENTS.has(agentId)) {
        return jsonResult({
          success: false,
          error: `Cannot decommission protected agent: ${agentId}`,
        });
      }

      // Guard: refuse to decommission agents that are actively working or recently active
      const profile = state.getAgentProfile(agentId);
      if (profile) {
        // Never decommission a working agent
        if (profile.lastStatus === "working") {
          return jsonResult({
            success: false,
            error: `Cannot decommission agent "${agentId}" — currently working on: ${profile.currentTask ?? "unknown task"}. Wait until the agent is idle or done.`,
          });
        }

        // Grace period: don't decommission agents active in the last 10 minutes
        // (unless they explicitly reported "done")
        if (profile.lastStatus !== "done" && profile.lastStatusAt) {
          const lastActiveMs = Date.now() - new Date(profile.lastStatusAt).getTime();
          const GRACE_PERIOD_MS = 10 * 60 * 1000; // 10 minutes
          if (lastActiveMs < GRACE_PERIOD_MS) {
            const minutesAgo = Math.round(lastActiveMs / 60_000);
            return jsonResult({
              success: false,
              error: `Cannot decommission agent "${agentId}" — recently active (${minutesAgo}m ago, status: ${profile.lastStatus}). Wait at least 10 minutes after last activity.`,
            });
          }
        }
      }

      // Send shutdown message to the agent via message store
      messageStore.insertMessage({
        agentId: callerAgentId,
        recipient: agentId,
        role: "agent",
        body: `Shutdown requested: ${reason}. Please finish your work and shut down gracefully.`,
      });

      // Mark spawn as decommissioned if applicable
      const lastSpawn = state.getLastSpawn(agentId);
      if (lastSpawn && !lastSpawn.decommissionedAt) {
        state.markDecommissioned(lastSpawn.id);
      }

      const decommDecision = {
        behavior: "adjutant",
        action: "decommission_agent",
        target: agentId,
        reason,
      };
      state.logDecision(decommDecision);
      emitCoordinatorAction(eventStore, callerAgentId, decommDecision);

      logInfo("decommission_agent: shutdown requested", { agentId, reason });

      return jsonResult({ success: true, agentId });
    },
  );

  // --------------------------------------------------------------------------
  // rebalance_work
  // --------------------------------------------------------------------------
  server.tool(
    "rebalance_work",
    "Return an agent's in-progress beads to the open pool",
    {
      agentId: z.string().describe("The agent whose work to rebalance"),
      reason: z.string().optional().describe("Why rebalancing"),
    },
    async ({ agentId, reason }, extra) => {
      const callerAgentId = checkAccess(extra.sessionId);
      if (!callerAgentId) {
        const resolved = resolveCallerOrError(extra.sessionId);
        return resolved.error!;
      }

      // Find all in-progress beads assigned to the agent
      const listResult = await execBd(
        ["list", "--status", "in_progress", "--assignee", agentId, "--json"],
      );

      if (!listResult.success || !listResult.data) {
        logWarn("rebalance_work: failed to list beads", { agentId, error: listResult.error });
        return jsonResult({
          success: true,
          rebalancedBeads: [],
          error: "Failed to list beads",
        });
      }

      const beads = listResult.data as { id: string; title?: string }[];
      const rebalancedIds: string[] = [];

      for (const bead of beads) {
        const result = await updateBead(bead.id, {
          status: "open",
          assignee: "",
        });

        if (result.success) {
          rebalancedIds.push(bead.id);

          const rebalanceDecision = {
            behavior: "adjutant",
            action: "rebalance_work",
            target: bead.id,
            reason: reason ?? `Rebalanced from ${agentId}`,
          };
          state.logDecision(rebalanceDecision);
          emitCoordinatorAction(eventStore, callerAgentId, rebalanceDecision);
        } else {
          logWarn("rebalance_work: failed to unassign bead", {
            beadId: bead.id,
            error: result.error,
          });
        }
      }

      logInfo("rebalance_work: beads rebalanced", { agentId, count: rebalancedIds.length });

      return jsonResult({
        success: true,
        rebalancedBeads: rebalancedIds,
      });
    },
  );

  // --------------------------------------------------------------------------
  // schedule_check
  // --------------------------------------------------------------------------
  server.tool(
    "schedule_check",
    "Schedule a future wake-up for the adjutant",
    {
      delay: z.string().describe('Delay before firing, e.g. "15m", "1h", "30s"'),
      reason: z.string().describe("Why this check is needed"),
    },
    async ({ delay, reason }, extra) => {
      const callerAgentId = checkAccess(extra.sessionId);
      if (!callerAgentId) {
        const resolved = resolveCallerOrError(extra.sessionId);
        return resolved.error!;
      }

      const delayMs = parseDelay(delay);
      if (delayMs === null) {
        return jsonResult({
          success: false,
          error: `Invalid delay format: "${delay}". Use e.g. "30s", "15m", "1h".`,
        });
      }

      if (!stimulusEngine) {
        return jsonResult({
          success: false,
          error: "Stimulus engine not available",
        });
      }

      const checkId = stimulusEngine.scheduleCheck(delayMs, reason);
      const firesAt = new Date(Date.now() + delayMs).toISOString();

      const scheduleDecision = {
        behavior: "adjutant",
        action: "schedule_check",
        target: `next check at ${new Date(Date.now() + delayMs).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })} (in ${delay})`,
        reason,
      };
      state.logDecision(scheduleDecision);
      emitCoordinatorAction(eventStore, callerAgentId, scheduleDecision);

      logInfo("schedule_check: check scheduled", { checkId, delay, reason });

      return jsonResult({ success: true, checkId, firesAt });
    },
  );

  // --------------------------------------------------------------------------
  // watch_for
  // --------------------------------------------------------------------------
  server.tool(
    "watch_for",
    "Register a conditional wake-up — fire when event occurs or timeout expires",
    {
      event: z.string().describe("EventBus event name to watch"),
      filter: z.record(z.string(), z.string()).optional().describe("Optional field matching on event data"),
      timeout: z.string().optional().describe('Optional timeout, e.g. "30m" — fire even if event doesn\'t occur'),
      reason: z.string().describe("Why watching"),
    },
    async ({ event, filter, timeout, reason }, extra) => {
      const callerAgentId = checkAccess(extra.sessionId);
      if (!callerAgentId) {
        const resolved = resolveCallerOrError(extra.sessionId);
        return resolved.error!;
      }

      let timeoutMs: number | undefined;
      if (timeout) {
        const parsed = parseDelay(timeout);
        if (parsed === null) {
          return jsonResult({
            success: false,
            error: `Invalid timeout format: "${timeout}". Use e.g. "30s", "15m", "1h".`,
          });
        }
        timeoutMs = parsed;
      }

      if (!stimulusEngine) {
        return jsonResult({
          success: false,
          error: "Stimulus engine not available",
        });
      }

      // Cast event string to EventName — the adjutant knows valid event names
      const eventName = event as EventName;
      const watchId = stimulusEngine.registerWatch(eventName, filter, timeoutMs, reason);

      const watchDecision = {
        behavior: "adjutant",
        action: "watch_for",
        target: watchId,
        reason: `Watching ${event}: ${reason}`,
      };
      state.logDecision(watchDecision);
      emitCoordinatorAction(eventStore, callerAgentId, watchDecision);

      logInfo("watch_for: watch registered", { watchId, event, reason });

      return jsonResult({
        success: true,
        watchId,
        watching: event,
        timeout: timeout ?? null,
      });
    },
  );

  // --------------------------------------------------------------------------
  // create_schedule
  // --------------------------------------------------------------------------
  server.tool(
    "create_schedule",
    "Create a persistent recurring schedule that survives restarts. Any MCP agent can self-schedule.",
    {
      cron: z.string().describe('5-field cron expression, e.g. "*/15 * * * *"'),
      reason: z.string().describe("Why this schedule exists"),
      maxFires: z.number().optional().describe("Maximum fires before auto-disable (null = unlimited)"),
      targetAgent: z.string().optional().describe(
        "Agent to receive the scheduled prompt. Defaults to the calling agent (self-scheduling). " +
        "Only the coordinator can target other agents.",
      ),
    },
    async ({ cron, reason, maxFires, targetAgent }, extra) => {
      // adj-163.4: Any MCP agent can call scheduling tools (not just coordinator)
      const callerAgentId = resolveCallerAgent(extra.sessionId);
      if (!callerAgentId) {
        return unknownSessionResult();
      }

      // adj-163.4.3: targetAgent access control
      const resolvedTargetAgent = targetAgent ?? callerAgentId;
      if (resolvedTargetAgent !== callerAgentId && !isCoordinator(callerAgentId)) {
        return jsonResult({
          success: false,
          error: "Can only create schedules for yourself",
        });
      }

      if (!stimulusEngine) {
        return jsonResult({ success: false, error: "Stimulus engine not available" });
      }

      if (!cronScheduleStore) {
        return jsonResult({ success: false, error: "Cron schedule store not available" });
      }

      // Validate cron expression
      try {
        cronToIntervalMs(cron);
      } catch (err) {
        return jsonResult({
          success: false,
          error: `Invalid cron expression: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      const nextFireAt = computeNextFireAt(cron);
      const resolvedTmuxSession = `adj-swarm-${resolvedTargetAgent}`;
      const createParams: {
        cronExpr: string;
        reason: string;
        createdBy: string;
        nextFireAt: string;
        maxFires?: number;
        targetAgent: string;
        targetTmuxSession: string;
      } = {
        cronExpr: cron,
        reason,
        createdBy: callerAgentId,
        nextFireAt,
        targetAgent: resolvedTargetAgent,
        targetTmuxSession: resolvedTmuxSession,
      };
      if (maxFires !== undefined) {
        createParams.maxFires = maxFires;
      }
      const schedule = cronScheduleStore.create(createParams);

      stimulusEngine.registerRecurringSchedule(schedule, cronScheduleStore);

      const decision = {
        behavior: "adjutant",
        action: "create_schedule",
        target: schedule.id,
        reason: `Created schedule "${cron}": ${reason}`,
      };
      state.logDecision(decision);
      emitCoordinatorAction(eventStore, callerAgentId, decision);

      logInfo("create_schedule: schedule created", { id: schedule.id, cron, reason, targetAgent: resolvedTargetAgent });

      return jsonResult({
        success: true,
        id: schedule.id,
        cronExpr: schedule.cronExpr,
        nextFireAt: schedule.nextFireAt,
      });
    },
  );

  // --------------------------------------------------------------------------
  // list_schedules
  // --------------------------------------------------------------------------
  server.tool(
    "list_schedules",
    "List recurring schedules. Coordinator sees all; other agents see only their own.",
    {},
    async (_params, extra) => {
      // adj-163.4: Any MCP agent can list schedules (filtered by ownership)
      const callerAgentId = resolveCallerAgent(extra.sessionId);
      if (!callerAgentId) {
        return unknownSessionResult();
      }

      if (!cronScheduleStore) {
        return jsonResult({ success: true, schedules: [] });
      }

      // adj-163.4.2: Coordinator sees all, others see only their own
      const schedules = isCoordinator(callerAgentId)
        ? cronScheduleStore.listAll()
        : cronScheduleStore.listByAgent(callerAgentId);
      return jsonResult({ success: true, schedules });
    },
  );

  // --------------------------------------------------------------------------
  // cancel_schedule
  // --------------------------------------------------------------------------
  server.tool(
    "cancel_schedule",
    "Cancel and delete a recurring schedule. Agents can only cancel their own schedules.",
    {
      id: z.string().describe("Schedule ID to cancel"),
    },
    async ({ id }, extra) => {
      // adj-163.4: Any MCP agent can call scheduling tools
      const callerAgentId = resolveCallerAgent(extra.sessionId);
      if (!callerAgentId) {
        return unknownSessionResult();
      }

      if (!cronScheduleStore) {
        return jsonResult({ success: false, error: "Cron schedule store not available" });
      }

      // adj-163.4.2: Ownership check — non-coordinators can only cancel own schedules
      if (!isCoordinator(callerAgentId)) {
        const schedule = cronScheduleStore.getById(id);
        if (!schedule) {
          return jsonResult({ success: false, error: `Schedule not found: ${id}` });
        }
        if (schedule.targetAgent !== callerAgentId) {
          return jsonResult({ success: false, error: `Access denied: cannot cancel another agent's schedule` });
        }
      }

      const deleted = cronScheduleStore.delete(id);
      if (!deleted) {
        return jsonResult({ success: false, error: `Schedule not found: ${id}` });
      }

      if (stimulusEngine) {
        stimulusEngine.cancelRecurringSchedule(id);
      }

      const decision = {
        behavior: "adjutant",
        action: "cancel_schedule",
        target: id,
        reason: `Cancelled schedule ${id}`,
      };
      state.logDecision(decision);
      emitCoordinatorAction(eventStore, callerAgentId, decision);

      logInfo("cancel_schedule: schedule cancelled", { id });

      return jsonResult({ success: true, id });
    },
  );

  // --------------------------------------------------------------------------
  // pause_schedule
  // --------------------------------------------------------------------------
  server.tool(
    "pause_schedule",
    "Pause a recurring schedule (can be resumed later). Agents can only pause their own.",
    {
      id: z.string().describe("Schedule ID to pause"),
    },
    async ({ id }, extra) => {
      // adj-163.4: Any MCP agent can call scheduling tools
      const callerAgentId = resolveCallerAgent(extra.sessionId);
      if (!callerAgentId) {
        return unknownSessionResult();
      }

      if (!cronScheduleStore) {
        return jsonResult({ success: false, error: "Cron schedule store not available" });
      }

      // adj-163.4.2: Ownership check — non-coordinators can only pause own schedules
      if (!isCoordinator(callerAgentId)) {
        const schedule = cronScheduleStore.getById(id);
        if (!schedule) {
          return jsonResult({ success: false, error: `Schedule not found: ${id}` });
        }
        if (schedule.targetAgent !== callerAgentId) {
          return jsonResult({ success: false, error: `Access denied: cannot pause another agent's schedule` });
        }
      }

      cronScheduleStore.disable(id);

      if (stimulusEngine) {
        stimulusEngine.cancelRecurringSchedule(id);
      }

      const decision = {
        behavior: "adjutant",
        action: "pause_schedule",
        target: id,
        reason: `Paused schedule ${id}`,
      };
      state.logDecision(decision);
      emitCoordinatorAction(eventStore, callerAgentId, decision);

      logInfo("pause_schedule: schedule paused", { id });

      return jsonResult({ success: true, id, enabled: false });
    },
  );

  // --------------------------------------------------------------------------
  // resume_schedule
  // --------------------------------------------------------------------------
  server.tool(
    "resume_schedule",
    "Resume a paused recurring schedule. Agents can only resume their own.",
    {
      id: z.string().describe("Schedule ID to resume"),
    },
    async ({ id }, extra) => {
      // adj-163.4: Any MCP agent can call scheduling tools
      const callerAgentId = resolveCallerAgent(extra.sessionId);
      if (!callerAgentId) {
        return unknownSessionResult();
      }

      if (!cronScheduleStore) {
        return jsonResult({ success: false, error: "Cron schedule store not available" });
      }

      const schedule = cronScheduleStore.getById(id);
      if (!schedule) {
        return jsonResult({ success: false, error: `Schedule not found: ${id}` });
      }

      // adj-163.4.2: Ownership check — non-coordinators can only resume own schedules
      if (!isCoordinator(callerAgentId) && schedule.targetAgent !== callerAgentId) {
        return jsonResult({ success: false, error: `Access denied: cannot resume another agent's schedule` });
      }

      const nextFireAt = computeNextFireAt(schedule.cronExpr);
      cronScheduleStore.update(id, { enabled: true, nextFireAt });

      const updatedSchedule = { ...schedule, enabled: true, nextFireAt };

      if (stimulusEngine) {
        stimulusEngine.registerRecurringSchedule(updatedSchedule, cronScheduleStore);
      }

      const decision = {
        behavior: "adjutant",
        action: "resume_schedule",
        target: id,
        reason: `Resumed schedule ${id}`,
      };
      state.logDecision(decision);
      emitCoordinatorAction(eventStore, callerAgentId, decision);

      logInfo("resume_schedule: schedule resumed", { id, nextFireAt });

      return jsonResult({ success: true, id, enabled: true, nextFireAt });
    },
  );
}
