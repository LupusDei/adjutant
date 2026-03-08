// ============================================================================
// Scheduler Service - adj-051.2.1 / adj-051.2.2
// Sends hourly heartbeat prompts to the Adjutant agent via tmux
// ============================================================================

import { execFile } from "child_process";
import cron from "node-cron";
import type { ScheduledTask } from "node-cron";

import { logInfo, logWarn } from "../utils/index.js";

// ============================================================================
// Constants
// ============================================================================

/** Tmux session name for the Adjutant agent */
const ADJUTANT_TMUX_SESSION = "adj-swarm-adjutant";

/** Cron expression: every hour on the hour */
const HEARTBEAT_CRON = "0 * * * *";

// ============================================================================
// State
// ============================================================================

let cronTask: ScheduledTask | null = null;

// ============================================================================
// Heartbeat Prompt
// ============================================================================

/**
 * Returns the heartbeat prompt text injected into the Adjutant agent tmux pane.
 *
 * This prompt instructs the Adjutant agent to perform an hourly status check:
 * gather agent statuses, review active and open beads, detect stale agents,
 * and compile a summary report for the user.
 */
export function getHeartbeatPrompt(): string {
  return [
    "HOURLY HEARTBEAT CHECK -- Perform the following steps in order:",
    "",
    "1. Call list_agents() to get all agent statuses.",
    "2. Call list_beads({ status: \"in_progress\" }) to see active work.",
    "3. Call list_beads({ status: \"open\" }) to see available unassigned work.",
    "4. Identify stale agents: any agent whose last status update was more than 1 hour ago.",
    "5. For each stale agent, send a nudge:",
    "   send_message({ to: \"<agent-name>\", body: \"Please update your status -- it has been over an hour since your last update.\" })",
    "6. Compile an hourly summary and send it to the user:",
    "   send_message({ to: \"user\", body: \"## Hourly Status Report\\n\\nActive agents: <count>\\nStale agents: <list or none>\\nIn-progress beads: <count>\\nOpen beads: <count>\\n\\n<brief summary of activity and any concerns>\" })",
    "",
    "Be concise. Do not ask for confirmation -- just execute all steps now.",
  ].join("\n");
}

// ============================================================================
// Tmux Interaction
// ============================================================================

/**
 * Sends the heartbeat prompt to the Adjutant agent tmux pane.
 *
 * Uses `execFile` (not `exec`) to avoid shell injection. The `-l` flag on
 * `tmux send-keys` sends literal text. `Enter` is sent as a separate command
 * without `-l` so tmux interprets it as a keypress.
 *
 * If tmux is unavailable or the session does not exist, the error is logged
 * and the function resolves normally -- it never throws.
 */
export async function sendHeartbeat(): Promise<void> {
  const prompt = getHeartbeatPrompt();

  // Step 1: Send the prompt text literally
  const promptSent = await tmuxSendKeys([
    "send-keys",
    "-t",
    ADJUTANT_TMUX_SESSION,
    "-l",
    prompt,
  ]);

  if (!promptSent) {
    // If the prompt failed to send, skip Enter
    return;
  }

  // Step 2: Send Enter as a separate command (no -l flag)
  await tmuxSendKeys([
    "send-keys",
    "-t",
    ADJUTANT_TMUX_SESSION,
    "Enter",
  ]);
}

/**
 * Executes a tmux command via execFile. Returns true on success, false on failure.
 */
function tmuxSendKeys(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("tmux", args, (err, _stdout, _stderr) => {
      if (err) {
        logWarn("tmux send-keys failed", {
          args: args.join(" "),
          error: String(err),
        });
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

// ============================================================================
// Scheduler Lifecycle
// ============================================================================

/**
 * Starts the heartbeat scheduler. Registers a cron job that fires every hour
 * on the hour. If the scheduler is already running, this is a no-op.
 */
export function startScheduler(): void {
  if (cronTask) {
    logInfo("Heartbeat scheduler already running, skipping start");
    return;
  }

  cronTask = cron.schedule(HEARTBEAT_CRON, () => {
    logInfo("Heartbeat cron triggered, sending heartbeat to Adjutant agent");
    sendHeartbeat().catch((err: unknown) => {
      logWarn("Heartbeat send failed unexpectedly", { error: String(err) });
    });
  });

  logInfo("Heartbeat scheduler started", { cron: HEARTBEAT_CRON });
}

/**
 * Stops the heartbeat scheduler. Safe to call even if no scheduler is running.
 */
export function stopScheduler(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logInfo("Heartbeat scheduler stopped");
  }
}
