import type { AdjutantBehavior, BehaviorEvent } from "../behavior-registry.js";
import type { AdjutantState } from "../state-store.js";
import type { CommunicationManager } from "../communication.js";
import { ADJUTANT_TMUX_SESSION } from "../../adjutant-spawner.js";
import { getSessionBridge } from "../../session-bridge.js";

/**
 * Build the heartbeat prompt that gets injected into the Adjutant agent's tmux pane.
 */
export function getHeartbeatPrompt(routineMessages: string[]): string {
  const lines = [
    "HOURLY HEARTBEAT CHECK -- Perform the following steps in order:",
    "",
    "1. Call list_agents() to get all agent statuses.",
    '2. Call list_beads({ status: "in_progress" }) to see active work.',
    '3. Call list_beads({ status: "open" }) to see available unassigned work.',
    "4. Identify stale agents: any agent whose last status update was more than 1 hour ago.",
    "5. For each stale agent, send a nudge:",
    '   send_message({ to: "<agent-name>", body: "Please update your status -- it has been over an hour since your last update." })',
    "6. Compile an hourly summary and send it to the user:",
    '   send_message({ to: "user", body: "## Hourly Status Report\\n\\nActive agents: <count>\\nStale agents: <list or none>\\nIn-progress beads: <count>\\nOpen beads: <count>\\n\\n<brief summary of activity and any concerns>" })',
    "",
    "Be concise. Do not ask for confirmation -- just execute all steps now.",
  ];

  if (routineMessages.length > 0) {
    lines.push("");
    lines.push("--- ROUTINE NOTES (from Adjutant Core) ---");
    for (const msg of routineMessages) {
      lines.push(`- ${msg}`);
    }
  }

  return lines.join("\n");
}

/**
 * Send the heartbeat prompt to the Adjutant tmux session.
 *
 * Routes through SessionBridge.sendInput() → InputRouter which properly
 * resolves the tmux pane reference and handles the Enter key submission.
 * Direct tmux send-keys targeting a session name (instead of a pane) was
 * unreliable — the text would paste into the input buffer but Enter
 * wouldn't submit it.
 */
async function sendHeartbeat(routineMessages: string[]): Promise<boolean> {
  const prompt = getHeartbeatPrompt(routineMessages);

  try {
    const bridge = getSessionBridge();
    const session = bridge.registry.findByTmuxSession(ADJUTANT_TMUX_SESSION);
    if (!session) {
      return false;
    }

    // Collapse to single line — multiline text via tmux send-keys -l puts
    // Claude Code's TUI into multiline editing mode where Enter doesn't submit
    const singleLine = prompt.replace(/\n+/g, " ").trim();
    return await bridge.sendInput(session.id, singleLine);
  } catch {
    return false;
  }
}

export function createPeriodicSummaryBehavior(): AdjutantBehavior {
  return {
    name: "periodic-summary",
    triggers: [],
    schedule: "0 * * * *", // Every hour on the hour

    shouldAct(_event: BehaviorEvent, _state: AdjutantState): boolean {
      return true;
    },

    async act(
      _event: BehaviorEvent,
      state: AdjutantState,
      comm: CommunicationManager,
    ): Promise<void> {

      // Flush routine messages to include in the prompt
      const routineMessages = comm.flushRoutineQueue();

      const success = await sendHeartbeat(routineMessages);

      if (success) {
        state.setMeta("last_heartbeat_sent", new Date().toISOString());
        state.logDecision({
          behavior: "periodic-summary",
          action: "heartbeat_sent",
          target: ADJUTANT_TMUX_SESSION,
          reason:
            routineMessages.length > 0
              ? `Included ${routineMessages.length} routine messages`
              : null,
        });
      } else {
        state.logDecision({
          behavior: "periodic-summary",
          action: "heartbeat_failed",
          target: ADJUTANT_TMUX_SESSION,
          reason: "tmux send-keys failed — session may not exist",
        });
      }
    },
  };
}
