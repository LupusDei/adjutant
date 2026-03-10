/**
 * Event-driven cost extraction service (adj-066.5.3).
 *
 * Subscribes to `agent:status_changed` events on the EventBus.
 * When an agent changes status, performs a one-shot tmux capture-pane
 * to extract current cost and context window % from the agent's session,
 * then records it via the cost tracker.
 *
 * This decouples cost tracking from the UI — costs are captured whenever
 * agents report status, not only when a user opens the session terminal.
 */

import { getEventBus, type AgentStatusEvent } from "./event-bus.js";
import { getSessionRegistry } from "./session-registry.js";
import { extractCostOnce } from "./session-connector.js";
import { recordCostUpdate } from "./cost-tracker.js";
import { getAgentStatuses } from "./mcp-tools/status.js";
import { logInfo, logWarn } from "../utils/index.js";

// ============================================================================
// Constants
// ============================================================================

/** Debounce window in milliseconds. Multiple status changes for the same agent
 *  within this window will only trigger a single extraction. */
export const DEBOUNCE_MS = 2000;

// ============================================================================
// State
// ============================================================================

/** Debounce timers per agent ID */
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Reference to the event handler so we can unsubscribe */
let statusHandler: ((data: AgentStatusEvent, seq: number) => void) | null = null;

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize the event-driven cost extraction subscription.
 * Call this during server startup after the EventBus is available.
 */
export function initEventDrivenCostExtraction(): void {
  if (statusHandler) {
    // Already initialized
    return;
  }

  statusHandler = (data: AgentStatusEvent) => {
    handleStatusChanged(data.agent);
  };

  getEventBus().on("agent:status_changed", statusHandler);
  logInfo("Event-driven cost extraction initialized");
}

/**
 * Stop the event-driven cost extraction subscription and clear timers.
 * Call this during server shutdown.
 */
export function stopEventDrivenCostExtraction(): void {
  if (statusHandler) {
    getEventBus().off("agent:status_changed", statusHandler);
    statusHandler = null;
  }

  // Clear all pending debounce timers
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();
}

// ============================================================================
// Private
// ============================================================================

/**
 * Handle an agent status change with debouncing.
 * If the same agent fires multiple status changes within DEBOUNCE_MS,
 * only the last one triggers extraction.
 */
function handleStatusChanged(agentId: string): void {
  // Clear any existing debounce timer for this agent
  const existing = debounceTimers.get(agentId);
  if (existing) {
    clearTimeout(existing);
  }

  // Set a new debounce timer
  const timer = setTimeout(() => {
    debounceTimers.delete(agentId);
    runExtraction(agentId).catch((err) => {
      logWarn("Event-driven cost extraction failed", {
        agentId,
        error: String(err),
      });
    });
  }, DEBOUNCE_MS);

  debounceTimers.set(agentId, timer);
}

/**
 * Run one-shot cost extraction for an agent.
 */
async function runExtraction(agentId: string): Promise<void> {
  const registry = getSessionRegistry();
  const sessions = registry.findByName(agentId);

  if (sessions.length === 0) {
    // Agent has no managed session — skip silently
    return;
  }

  // Use the first matching session (agents typically have one session)
  const session = sessions[0]!;

  // Skip if the session doesn't have tmux info
  if (!session.tmuxSession || !session.tmuxPane) {
    return;
  }

  const result = await extractCostOnce(session.tmuxSession, session.tmuxPane);

  if (!result) {
    // No cost data could be extracted — skip
    return;
  }

  // Look up the agent's current beadId from MCP status
  const agentStatuses = getAgentStatuses();
  const agentStatus = agentStatuses.get(agentId);
  const beadId = agentStatus?.beadId;

  recordCostUpdate(session.id, session.projectPath, {
    ...(result.cost !== undefined ? { cost: result.cost } : {}),
    ...(result.contextPercent !== undefined ? { contextPercent: result.contextPercent } : {}),
    ...(result.tokens ? { tokens: result.tokens } : {}),
    agentId,
    ...(beadId ? { beadId } : {}),
  });
}
