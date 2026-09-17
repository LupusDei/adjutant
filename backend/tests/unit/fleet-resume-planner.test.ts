/**
 * Post-reboot sweep (adj-dpgqc, item 4) — who CAN come back, and who is already here.
 *
 * Deliberately plan-only. On 2026-09-17 the General brought back kerrigan first, then
 * nova and zeratul, and left the rest down: which agents return is a command decision,
 * not something a sweep should take. This produces the list and nothing else.
 *
 * Real temp directories throughout: after a reboot the only sources of truth are the
 * filesystem (worktrees, transcripts) and tmux.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { claudeProjectDirName } from "../../src/services/transcript-discovery.js";
import { planFleetResume } from "../../src/services/fleet-resume-planner.js";

let home: string;
let projectRoot: string;

function makeWorktree(agent: string): string {
  const path = join(projectRoot, "worktrees", agent);
  mkdirSync(path, { recursive: true });
  return path;
}

function makeTranscript(cwd: string, sessionId: string, mtimeEpochSec: number, prompt = "do the thing"): void {
  const dir = join(home, ".claude", "projects", claudeProjectDirName(cwd));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${sessionId}.jsonl`);
  writeFileSync(
    file,
    [
      JSON.stringify({ type: "mode", mode: "normal", sessionId }),
      JSON.stringify({
        type: "user",
        isSidechain: false,
        cwd,
        sessionId,
        message: { role: "user", content: prompt },
        timestamp: new Date(mtimeEpochSec * 1000).toISOString(),
      }),
    ].join("\n") + "\n",
    "utf-8",
  );
  utimesSync(file, mtimeEpochSec, mtimeEpochSec);
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "adj-resume-home-"));
  projectRoot = mkdtempSync(join(tmpdir(), "adj-resume-repo-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("planFleetResume", () => {
  it("should propose resuming an agent whose session is gone but whose transcript survived", async () => {
    const cwd = makeWorktree("kerrigan");
    makeTranscript(cwd, "kerrigan-session-1", 1_758_000_000);

    const plan = await planFleetResume({
      projectRoot,
      liveTmuxSessions: new Set<string>(),
      homeDir: home,
    });

    expect(plan.resumable).toHaveLength(1);
    expect(plan.resumable[0]).toMatchObject({
      agentName: "kerrigan",
      sessionId: "kerrigan-session-1",
      cwd,
    });
    expect(plan.resumable[0]!.lastPrompt).toBe("do the thing");
  });

  it("should propose the NEWEST session when an agent has several", async () => {
    const cwd = makeWorktree("kerrigan");
    makeTranscript(cwd, "old-session-0001", 1_000_000, "old work");
    makeTranscript(cwd, "new-session-0001", 3_000_000, "current work");

    const plan = await planFleetResume({
      projectRoot,
      liveTmuxSessions: new Set<string>(),
      homeDir: home,
    });

    expect(plan.resumable[0]!.sessionId).toBe("new-session-0001");
  });

  it("should skip an agent that is still running, with that reason", async () => {
    const cwd = makeWorktree("nova");
    makeTranscript(cwd, "nova-session-0001", 2_000_000);

    const plan = await planFleetResume({
      projectRoot,
      liveTmuxSessions: new Set(["adj-swarm-nova"]),
      homeDir: home,
    });

    expect(plan.resumable).toHaveLength(0);
    expect(plan.skipped).toEqual([{ agentName: "nova", reason: "running" }]);
  });

  it("should skip an agent with a worktree but no transcript", async () => {
    // A worktree provisioned for an agent that never actually ran there.
    makeWorktree("ghost");

    const plan = await planFleetResume({
      projectRoot,
      liveTmuxSessions: new Set<string>(),
      homeDir: home,
    });

    expect(plan.resumable).toHaveLength(0);
    expect(plan.skipped).toEqual([{ agentName: "ghost", reason: "no-transcript" }]);
  });

  it("should include explicitly named agents that have no worktree — the coordinator runs in the main repo", async () => {
    makeTranscript(projectRoot, "coordinator-sess1", 2_000_000, "coordinate the fleet");

    const plan = await planFleetResume({
      projectRoot,
      agentNames: ["adjutant-coordinator"],
      liveTmuxSessions: new Set<string>(),
      homeDir: home,
    });

    expect(plan.resumable.map((r) => r.agentName)).toContain("adjutant-coordinator");
  });

  it("should order the proposals by last activity, newest first", async () => {
    const a = makeWorktree("agent-a");
    const b = makeWorktree("agent-b");
    const c = makeWorktree("agent-c");
    makeTranscript(a, "a-session-000001", 1_000_000);
    makeTranscript(b, "b-session-000001", 3_000_000);
    makeTranscript(c, "c-session-000001", 2_000_000);

    const plan = await planFleetResume({
      projectRoot,
      liveTmuxSessions: new Set<string>(),
      homeDir: home,
    });

    expect(plan.resumable.map((r) => r.agentName)).toEqual(["agent-b", "agent-c", "agent-a"]);
  });

  it("should hand back the exact call that would bring each agent back", async () => {
    // The sweep never spawns. It hands the General something to approve.
    const cwd = makeWorktree("kerrigan");
    makeTranscript(cwd, "kerrigan-session-1", 2_000_000);

    const plan = await planFleetResume({
      projectRoot,
      liveTmuxSessions: new Set<string>(),
      homeDir: home,
    });

    expect(plan.resumable[0]!.resumeCommand).toEqual({
      tool: "spawn_worker",
      args: {
        agentName: "kerrigan",
        projectPath: projectRoot,
        resumeSessionId: "kerrigan-session-1",
      },
    });
    expect(plan.dryRun).toBe(true);
  });

  it("should return an empty plan when the project has no worktrees at all", async () => {
    const plan = await planFleetResume({
      projectRoot,
      liveTmuxSessions: new Set<string>(),
      homeDir: home,
    });

    expect(plan.resumable).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  it("should ignore files sitting in the worktrees directory", async () => {
    mkdirSync(join(projectRoot, "worktrees"), { recursive: true });
    writeFileSync(join(projectRoot, "worktrees", "README.md"), "not an agent", "utf-8");

    const plan = await planFleetResume({
      projectRoot,
      liveTmuxSessions: new Set<string>(),
      homeDir: home,
    });

    expect(plan.skipped).toEqual([]);
    expect(plan.resumable).toEqual([]);
  });

  it("should not list the same agent twice when it is both named and has a worktree", async () => {
    const cwd = makeWorktree("kerrigan");
    makeTranscript(cwd, "kerrigan-session-1", 2_000_000);

    const plan = await planFleetResume({
      projectRoot,
      agentNames: ["kerrigan"],
      liveTmuxSessions: new Set<string>(),
      homeDir: home,
    });

    expect(plan.resumable).toHaveLength(1);
  });
});
