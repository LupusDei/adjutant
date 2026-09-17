/**
 * Post-reboot sweep (adj-dpgqc) — who can come back, and who is already here.
 *
 * After the 2026-09-16 kernel panic somebody had to work out, agent by agent, which
 * sessions had died and which transcripts survived. This does that survey.
 *
 * It is PLAN-ONLY and stays that way. On the night, the General brought back kerrigan
 * first, watched it, then nova and zeratul, and left the rest down. Which agents return
 * — and in what order — is a command decision: a sweep that resumed the whole fleet
 * would spend real tokens on agents nobody asked for and put several of them back to
 * work on branches that had moved. So this returns proposals, each with the exact call
 * that would execute it, and executes nothing.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { listResumableSessionsForAgent } from "./transcript-discovery.js";
import { logInfo } from "../utils/index.js";

// ============================================================================
// Types
// ============================================================================

export interface ResumeProposal {
  agentName: string;
  /** The session to resume — the newest transcript for that agent. */
  sessionId: string;
  /** Working directory the transcript belongs to. */
  cwd?: string | undefined;
  /** Last entry timestamp inside the transcript, ISO (falls back to the file mtime). */
  lastActivityAt: string;
  /** Transcript file mtime, ISO — when the session was last WRITTEN to. Orders the plan. */
  modifiedAt: string;
  /** What the agent was last asked to do, so a human can judge whether to bring it back. */
  lastPrompt?: string | undefined;
  /** How many sessions exist for this agent (the proposal picks the newest). */
  sessionCount: number;
  /** The exact call that would execute this proposal. Nothing here calls it. */
  resumeCommand: {
    tool: "spawn_worker";
    args: { agentName: string; projectPath: string; resumeSessionId: string };
  };
}

export type SkipReason = "running" | "no-transcript";

export interface SkippedAgent {
  agentName: string;
  reason: SkipReason;
}

export interface FleetResumePlan {
  /** Always true: this service never spawns. Present so callers can report it honestly. */
  dryRun: true;
  resumable: ResumeProposal[];
  skipped: SkippedAgent[];
}

export interface PlanFleetResumeOptions {
  /** The canonical checkout. Agent worktrees live under `<projectRoot>/worktrees/`. */
  projectRoot: string;
  /**
   * Agents to consider in addition to the worktree directories — e.g. the coordinator,
   * which runs in the main repo and has no worktree of its own.
   */
  agentNames?: string[] | undefined;
  /** tmux session names that exist right now (`adj-swarm-<agent>`). */
  liveTmuxSessions: Set<string>;
  homeDir?: string | undefined;
}

// ============================================================================
// Public API
// ============================================================================

export async function planFleetResume(opts: PlanFleetResumeOptions): Promise<FleetResumePlan> {
  const names = new Set<string>(opts.agentNames ?? []);
  for (const name of await worktreeAgentNames(opts.projectRoot)) {
    names.add(name);
  }

  const resumable: ResumeProposal[] = [];
  const skipped: SkippedAgent[] = [];

  for (const agentName of names) {
    // A live pane means the agent survived (or was already brought back). Resuming it
    // would put a second Claude on one transcript.
    if (opts.liveTmuxSessions.has(`adj-swarm-${agentName}`)) {
      skipped.push({ agentName, reason: "running" });
      continue;
    }

    const sessions = await listResumableSessionsForAgent({
      agentName,
      projectRoot: opts.projectRoot,
      homeDir: opts.homeDir,
    });

    const newest = sessions[0];
    if (!newest) {
      skipped.push({ agentName, reason: "no-transcript" });
      continue;
    }

    resumable.push({
      agentName,
      sessionId: newest.sessionId,
      cwd: newest.cwd,
      lastActivityAt: newest.lastActivityAt ?? newest.modifiedAt,
      modifiedAt: newest.modifiedAt,
      lastPrompt: newest.lastPrompt,
      sessionCount: sessions.length,
      resumeCommand: {
        tool: "spawn_worker",
        args: {
          agentName,
          projectPath: opts.projectRoot,
          resumeSessionId: newest.sessionId,
        },
      },
    });
  }

  // Newest first: the agents that were working when the lights went out are the ones
  // whose in-flight work is most likely to still matter. Ordered on the file mtime
  // rather than the transcript's own last timestamp — a session killed mid-write may
  // never have recorded that final turn, but the write itself still touched the file.
  resumable.sort((a, b) =>
    a.modifiedAt < b.modifiedAt ? 1 : a.modifiedAt > b.modifiedAt ? -1 : 0,
  );

  logInfo("Fleet resume plan", {
    resumable: resumable.length,
    skipped: skipped.length,
  });

  return { dryRun: true, resumable, skipped };
}

// ============================================================================
// Internals
// ============================================================================

/**
 * Agent names taken from `<projectRoot>/worktrees/<name>` (adj-182.5). Directories only:
 * a stray README in there is not an agent.
 */
async function worktreeAgentNames(projectRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(join(projectRoot, "worktrees"), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    // No worktrees directory — a project where every agent runs in the main repo.
    return [];
  }
}
