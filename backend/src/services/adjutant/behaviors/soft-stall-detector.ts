import type { AdjutantBehavior, BehaviorEvent } from "../behavior-registry.js";
import type { AdjutantState } from "../state-store.js";
import type { CommunicationManager } from "../communication.js";

/**
 * Soft-stall detector (adj-y2vq, PART B).
 *
 * Detects and auto-recovers the "soft-stall" failure mode: an agent's tmux
 * session is alive but its Claude Code loop is not processing input — it looks
 * alive on the dashboard but makes no progress (no output, no status change).
 *
 * PART A hardened the SPAWN path so dropped-Enter stalls don't happen at
 * dispatch. This behavior is the MID-SESSION safety net for stalls from other
 * causes (e.g. an MCP message that didn't wake the loop, a dropped keystroke).
 *
 * Detection signature (all must hold — deliberately conservative so we never
 * disrupt an agent that is genuinely working):
 *   1. status === "working"  — the agent believes it is mid-task
 *   2. lastActivity is stale beyond STALL_IDLE_THRESHOLD_MS
 *   3. the tmux pane is NOT changing over a short sample window — a working
 *      agent's status line/spinner ticks and output streams, so a static pane
 *      means the loop is idle. (Same version-proof primitive as PART A.)
 *
 * Recovery: re-send a bare Enter to submit any unsubmitted input (the exact
 * manual "nudge" that has historically un-stuck these agents). Enter on an
 * already-empty Claude input box is a no-op, so this is safe. After
 * MAX_AUTO_RECOVERIES failed attempts, escalate to the coordinator ONCE.
 */

export interface StallSession {
  id: string;
  name: string;
  status: string;
  tmuxPane: string;
  lastActivity: Date;
}

export interface SoftStallDeps {
  listSessions: () => StallSession[];
  /** Capture current pane content (used for change detection). */
  capturePane: (pane: string) => Promise<string>;
  /** Re-send a bare Enter to a pane to submit any pending input. */
  sendEnter: (pane: string) => Promise<void>;
  /** Injectable clock (tests). Defaults to Date.now. */
  now?: () => number;
  /** Gap between the two pane samples (tests override to 0). Defaults 800ms. */
  sampleGapMs?: number;
}

/** Stale-activity threshold before a working agent is a stall candidate. */
export const STALL_IDLE_THRESHOLD_MS = 4 * 60_000; // 4 min → MTTD < 5 min
/** Enter re-send attempts before escalating to the coordinator. */
export const MAX_AUTO_RECOVERIES = 2;
/** Sessions managed elsewhere (health-monitor owns the coordinator). */
const EXCLUDED_NAMES = new Set(["adjutant-coordinator", "adjutant"]);

const metaKey = (id: string) => `soft_stall_recovery_${id}`;

export function createSoftStallDetector(deps: SoftStallDeps): AdjutantBehavior {
  const now = deps.now ?? (() => Date.now());
  const sampleGapMs = deps.sampleGapMs ?? 800;

  async function paneIsChanging(pane: string): Promise<boolean> {
    let first: string;
    try {
      first = await deps.capturePane(pane);
    } catch {
      // Can't read the pane — treat as not-changing so we still surface it.
      return false;
    }
    await new Promise((r) => setTimeout(r, sampleGapMs));
    let second: string;
    try {
      second = await deps.capturePane(pane);
    } catch {
      return false;
    }
    return first !== second;
  }

  return {
    name: "soft-stall-detector",
    triggers: [],
    schedule: "*/2 * * * *", // every 2 minutes

    shouldAct(_event: BehaviorEvent, _state: AdjutantState): boolean {
      return true;
    },

    async act(
      _event: BehaviorEvent,
      state: AdjutantState,
      comm: CommunicationManager,
    ): Promise<void> {
      const sessions = deps.listSessions();
      const nowMs = now();

      for (const s of sessions) {
        const key = metaKey(s.id);

        // Only a "working" agent can be soft-stalled; anything else (idle, done,
        // offline, awaiting permission) is excluded so we never nudge it.
        if (s.status !== "working" || EXCLUDED_NAMES.has(s.name)) {
          if (state.getMeta(key)) state.setMeta(key, "0");
          continue;
        }

        const idleMs = nowMs - s.lastActivity.getTime();
        if (idleMs < STALL_IDLE_THRESHOLD_MS) {
          // Recently active — healthy. Reset any prior stall counter.
          if (state.getMeta(key)) state.setMeta(key, "0");
          continue;
        }

        // Stale + working. Confirm the pane is actually static (not deep work).
        if (await paneIsChanging(s.tmuxPane)) {
          // Working, just not updating status/lastActivity — not a stall.
          if (state.getMeta(key)) state.setMeta(key, "0");
          continue;
        }

        // Soft-stall confirmed.
        const attempts = parseInt(state.getMeta(key) ?? "0", 10) || 0;

        if (attempts < MAX_AUTO_RECOVERIES) {
          await deps.sendEnter(s.tmuxPane);
          state.setMeta(key, String(attempts + 1));
          state.logDecision({
            behavior: "soft-stall-detector",
            action: "auto_recover_soft_stall",
            target: s.name,
            reason: `alive but idle ${Math.round(idleMs / 1000)}s, pane static; re-sent Enter (attempt ${attempts + 1}/${MAX_AUTO_RECOVERIES})`,
          });
        } else if (attempts === MAX_AUTO_RECOVERIES) {
          // Auto-recovery exhausted — escalate ONCE, then go quiet until recovered.
          state.setMeta(key, String(attempts + 1));
          state.logDecision({
            behavior: "soft-stall-detector",
            action: "escalate_soft_stall",
            target: s.name,
            reason: `still not processing after ${MAX_AUTO_RECOVERIES} auto-recover attempts`,
          });
          await comm.sendImportant(
            `⚠️ Soft-stall: agent "${s.name}" has been alive but not processing for ~${Math.round(idleMs / 60_000)}m and did not recover after ${MAX_AUTO_RECOVERIES} auto-Enter nudges. Manual intervention (respawn / strong nudge) may be needed.`,
          );
        }
        // attempts > MAX: already escalated; stay quiet to avoid spamming.
      }
    },
  };
}
