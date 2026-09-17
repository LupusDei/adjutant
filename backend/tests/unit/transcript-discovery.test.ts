/**
 * Tests for transcript-discovery (adj-dpgqc).
 *
 * These use a REAL temp directory with REAL Claude Code transcript line shapes
 * (captured from ~/.claude/projects on 2026-09-17), not hand-made objects — the
 * adj-067 lesson. The shapes that matter and are easy to get wrong:
 *   - a project dir name is the cwd with EVERY non-alphanumeric char replaced by
 *     "-", not just "/" ("eric_ai" -> "eric-ai"), and it starts with "-"
 *   - the dir holds `<sessionId>.jsonl` files AND a `<sessionId>/` subdirectory
 *   - the first lines carry no cwd; only later user/assistant entries do
 *   - a "user" entry is a real prompt only when it has no toolUseResult; tool
 *     results are also type "user" but carry an array content
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  claudeProjectDirName,
  listResumableSessions,
  listResumableSessionsForAgent,
} from "../../src/services/transcript-discovery.js";

let home: string;

/** Real header lines — no cwd on any of them. */
function headerLines(sessionId: string): string[] {
  return [
    JSON.stringify({ type: "last-prompt", leafUuid: "2ec17895", sessionId }),
    JSON.stringify({ type: "mode", mode: "normal", sessionId }),
    JSON.stringify({ type: "permission-mode", permissionMode: "bypassPermissions", sessionId }),
  ];
}

function userPrompt(sessionId: string, cwd: string, text: string, timestamp: string): string {
  return JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    cwd,
    sessionId,
    entrypoint: "cli",
    gitBranch: "main",
    promptSource: "user",
    origin: "terminal",
    type: "user",
    message: { role: "user", content: text },
    timestamp,
  });
}

/** A tool RESULT: also type "user", but array content + toolUseResult. Not a prompt. */
function toolResult(sessionId: string, cwd: string, timestamp: string): string {
  return JSON.stringify({
    parentUuid: "abc",
    isSidechain: false,
    cwd,
    sessionId,
    type: "user",
    toolUseResult: { stdout: "ok" },
    message: {
      role: "user",
      content: [{ tool_use_id: "toolu_1", type: "tool_result", content: "ok" }],
    },
    timestamp,
  });
}

function assistantTurn(sessionId: string, cwd: string, text: string, timestamp: string): string {
  return JSON.stringify({
    parentUuid: "abc",
    isSidechain: false,
    cwd,
    sessionId,
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
    timestamp,
  });
}

/** Write a transcript and stamp its mtime so ordering is deterministic. */
function writeTranscript(
  projectDir: string,
  sessionId: string,
  lines: string[],
  mtimeEpochSec: number,
): string {
  const file = join(projectDir, `${sessionId}.jsonl`);
  writeFileSync(file, lines.join("\n") + "\n", "utf-8");
  utimesSync(file, mtimeEpochSec, mtimeEpochSec);
  return file;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "adj-transcripts-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("claudeProjectDirName", () => {
  it("should replace every slash with a dash and keep the leading dash", () => {
    expect(claudeProjectDirName("/Users/6lockdash/code/adjutant")).toBe(
      "-Users-6lockdash-code-adjutant",
    );
  });

  it("should replace underscores too — the agent 'eric_ai' lives in '...worktrees-eric-ai'", () => {
    expect(claudeProjectDirName("/Users/6lockdash/code/6lock/worktrees/eric_ai")).toBe(
      "-Users-6lockdash-code-6lock-worktrees-eric-ai",
    );
  });

  it("should replace dots, so a hidden worktree dir cannot break the lookup", () => {
    expect(claudeProjectDirName("/repo/.claude/worktrees/agent-7")).toBe(
      "-repo--claude-worktrees-agent-7",
    );
  });

  it("should drop a trailing slash rather than emit a trailing dash", () => {
    expect(claudeProjectDirName("/Users/x/code/adjutant/")).toBe("-Users-x-code-adjutant");
  });
});

describe("listResumableSessions", () => {
  const cwd = "/Users/6lockdash/code/adjutant/worktrees/zeratul";

  function projectDir(): string {
    const dir = join(home, ".claude", "projects", claudeProjectDirName(cwd));
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  it("should return an empty list when the project has no transcript directory", async () => {
    const sessions = await listResumableSessions({ homeDir: home, projectPath: cwd });
    expect(sessions).toEqual([]);
  });

  it("should list a transcript with its sessionId, mtime, size and cwd", async () => {
    const dir = projectDir();
    const sid = "ccc9f2df-5b0b-428a-a3f9-323c51d1c388";
    writeTranscript(
      dir,
      sid,
      [
        ...headerLines(sid),
        userPrompt(sid, cwd, "You are a Layer 3 Squad Leader on adjutant.", "2026-09-14T07:06:02.640Z"),
        assistantTurn(sid, cwd, "On it.", "2026-09-14T07:06:20.000Z"),
      ],
      1_757_000_000,
    );

    const sessions = await listResumableSessions({ homeDir: home, projectPath: cwd });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: sid,
      cwd,
      transcriptPath: join(dir, `${sid}.jsonl`),
    });
    expect(sessions[0]!.sizeBytes).toBeGreaterThan(0);
    expect(sessions[0]!.modifiedAt).toBe(new Date(1_757_000_000 * 1000).toISOString());
  });

  it("should sort newest-first by mtime", async () => {
    const dir = projectDir();
    writeTranscript(dir, "older", [...headerLines("older"), userPrompt("older", cwd, "first", "t")], 1_000_000);
    writeTranscript(dir, "newest", [...headerLines("newest"), userPrompt("newest", cwd, "third", "t")], 3_000_000);
    writeTranscript(dir, "middle", [...headerLines("middle"), userPrompt("middle", cwd, "second", "t")], 2_000_000);

    const sessions = await listResumableSessions({ homeDir: home, projectPath: cwd });

    expect(sessions.map((s) => s.sessionId)).toEqual(["newest", "middle", "older"]);
  });

  it("should ignore non-jsonl entries and the per-session subdirectory", async () => {
    const dir = projectDir();
    const sid = "real-session";
    writeTranscript(dir, sid, [...headerLines(sid), userPrompt(sid, cwd, "hello", "t")], 2_000_000);
    // Claude Code creates a directory named after the session alongside the file.
    mkdirSync(join(dir, sid), { recursive: true });
    mkdirSync(join(dir, "memory"), { recursive: true });
    writeFileSync(join(dir, "notes.txt"), "not a transcript", "utf-8");
    writeFileSync(join(dir, ".DS_Store"), "junk", "utf-8");

    const sessions = await listResumableSessions({ homeDir: home, projectPath: cwd });

    expect(sessions.map((s) => s.sessionId)).toEqual([sid]);
  });

  it("should excerpt the first and last real user prompts, skipping tool results", async () => {
    const dir = projectDir();
    const sid = "excerpt-session";
    writeTranscript(
      dir,
      sid,
      [
        ...headerLines(sid),
        userPrompt(sid, cwd, "FIRST PROMPT: fix adj-128", "2026-09-14T07:06:02.640Z"),
        assistantTurn(sid, cwd, "working", "2026-09-14T07:07:00.000Z"),
        toolResult(sid, cwd, "2026-09-14T07:07:05.000Z"),
        userPrompt(sid, cwd, "LAST PROMPT: push it", "2026-09-14T09:00:00.000Z"),
        toolResult(sid, cwd, "2026-09-14T09:00:05.000Z"),
      ],
      2_000_000,
    );

    const [session] = await listResumableSessions({ homeDir: home, projectPath: cwd });

    expect(session!.firstPrompt).toBe("FIRST PROMPT: fix adj-128");
    expect(session!.lastPrompt).toBe("LAST PROMPT: push it");
    expect(session!.lastActivityAt).toBe("2026-09-14T09:00:05.000Z");
  });

  it("should truncate long excerpts instead of returning the whole prompt", async () => {
    const dir = projectDir();
    const sid = "long-session";
    const long = "x".repeat(5000);
    writeTranscript(dir, sid, [...headerLines(sid), userPrompt(sid, cwd, long, "t")], 2_000_000);

    const [session] = await listResumableSessions({ homeDir: home, projectPath: cwd });

    expect(session!.firstPrompt!.length).toBeLessThanOrEqual(300);
  });

  it("should survive a truncated final line — a transcript killed mid-write by a panic", async () => {
    const dir = projectDir();
    const sid = "torn-session";
    const file = join(dir, `${sid}.jsonl`);
    writeFileSync(
      file,
      [...headerLines(sid), userPrompt(sid, cwd, "before the crash", "t")].join("\n") +
        '\n{"type":"assistant","message":{"content":[{"type":"te',
      "utf-8",
    );

    const sessions = await listResumableSessions({ homeDir: home, projectPath: cwd });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.firstPrompt).toBe("before the crash");
  });

  it("should skip an empty transcript file — there is nothing to resume", async () => {
    const dir = projectDir();
    writeTranscript(dir, "empty-session", [], 2_000_000);
    writeTranscript(dir, "good-session", [...headerLines("good-session"), userPrompt("good-session", cwd, "hi", "t")], 1_000_000);

    const sessions = await listResumableSessions({ homeDir: home, projectPath: cwd });

    expect(sessions.map((s) => s.sessionId)).toEqual(["good-session"]);
  });

  it("should cap the number of returned sessions when a limit is given", async () => {
    const dir = projectDir();
    for (let i = 0; i < 5; i++) {
      const sid = `session-${i}`;
      writeTranscript(dir, sid, [...headerLines(sid), userPrompt(sid, cwd, `p${i}`, "t")], 1_000_000 + i);
    }

    const sessions = await listResumableSessions({ homeDir: home, projectPath: cwd, limit: 2 });

    expect(sessions.map((s) => s.sessionId)).toEqual(["session-4", "session-3"]);
  });

  it("should skip Claude Code's own injected wrappers when excerpting", async () => {
    // Real excerpts from live transcripts: a /resume caveat and a skill preamble are
    // stored as user turns, but they are machinery, not something a human asked for.
    const dir = projectDir();
    const sid = "wrapper-session";
    writeTranscript(
      dir,
      sid,
      [
        ...headerLines(sid),
        userPrompt(sid, cwd, "<local-command-caveat>Caveat: The messages below were generated…</local-command-caveat>", "t1"),
        userPrompt(sid, cwd, "REAL PROMPT: ship adj-dpgqc", "t2"),
        userPrompt(sid, cwd, "<command-name>/model</command-name>", "t3"),
        userPrompt(sid, cwd, "<local-command-stdout>Set model to Fable 5</local-command-stdout>", "t4"),
      ],
      2_000_000,
    );

    const [session] = await listResumableSessions({ homeDir: home, projectPath: cwd });

    expect(session!.firstPrompt).toBe("REAL PROMPT: ship adj-dpgqc");
    expect(session!.lastPrompt).toBe("REAL PROMPT: ship adj-dpgqc");
  });

  it("should ignore a sidechain (subagent) prompt when excerpting", async () => {
    const dir = projectDir();
    const sid = "sidechain-session";
    const sidechain = JSON.parse(userPrompt(sid, cwd, "TEAMMATE PROMPT", "2026-09-14T08:00:00.000Z"));
    sidechain.isSidechain = true;
    writeTranscript(
      dir,
      sid,
      [
        ...headerLines(sid),
        userPrompt(sid, cwd, "LEADER PROMPT", "2026-09-14T07:00:00.000Z"),
        JSON.stringify(sidechain),
      ],
      2_000_000,
    );

    const [session] = await listResumableSessions({ homeDir: home, projectPath: cwd });

    expect(session!.firstPrompt).toBe("LEADER PROMPT");
    expect(session!.lastPrompt).toBe("LEADER PROMPT");
  });
});

describe("listResumableSessionsForAgent", () => {
  const projectRoot = "/Users/6lockdash/code/adjutant";
  const worktree = "/Users/6lockdash/code/adjutant/worktrees/kerrigan";

  function dirFor(cwd: string): string {
    const dir = join(home, ".claude", "projects", claudeProjectDirName(cwd));
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  it("should find the agent's sessions in its worktree, which is where isolated agents run", async () => {
    const dir = dirFor(worktree);
    writeTranscript(dir, "wt-session-0001", [...headerLines("wt-session-0001"), userPrompt("wt-session-0001", worktree, "own the epic", "t")], 2_000_000);

    const sessions = await listResumableSessionsForAgent({
      agentName: "kerrigan",
      projectRoot,
      homeDir: home,
    });

    expect(sessions.map((s) => s.sessionId)).toEqual(["wt-session-0001"]);
    expect(sessions[0]!.cwd).toBe(worktree);
  });

  it("should also find sessions in the project root, for agents that are not worktree-isolated", async () => {
    // The coordinator runs in the main repo by design.
    const dir = dirFor(projectRoot);
    writeTranscript(dir, "root-session-001", [...headerLines("root-session-001"), userPrompt("root-session-001", projectRoot, "coordinate", "t")], 2_000_000);

    const sessions = await listResumableSessionsForAgent({
      agentName: "adjutant-coordinator",
      projectRoot,
      homeDir: home,
    });

    expect(sessions.map((s) => s.sessionId)).toEqual(["root-session-001"]);
  });

  it("should merge candidate directories and order them newest-first across all of them", async () => {
    const wtDir = dirFor(worktree);
    const rootDir = dirFor(projectRoot);
    writeTranscript(rootDir, "older-root-0001", [...headerLines("older-root-0001"), userPrompt("older-root-0001", projectRoot, "a", "t")], 1_000_000);
    writeTranscript(wtDir, "newer-wt-00001", [...headerLines("newer-wt-00001"), userPrompt("newer-wt-00001", worktree, "b", "t")], 3_000_000);

    const sessions = await listResumableSessionsForAgent({
      agentName: "kerrigan",
      projectRoot,
      homeDir: home,
    });

    expect(sessions.map((s) => s.sessionId)).toEqual(["newer-wt-00001", "older-root-0001"]);
  });

  it("should search an explicitly given working directory first — a registered session knows best", async () => {
    const custom = "/somewhere/else/kerrigan";
    const dir = dirFor(custom);
    writeTranscript(dir, "custom-session01", [...headerLines("custom-session01"), userPrompt("custom-session01", custom, "c", "t")], 2_000_000);

    const sessions = await listResumableSessionsForAgent({
      agentName: "kerrigan",
      projectRoot,
      knownCwd: custom,
      homeDir: home,
    });

    expect(sessions.map((s) => s.sessionId)).toEqual(["custom-session01"]);
  });

  it("should not return the same session twice when candidate directories overlap", async () => {
    const dir = dirFor(worktree);
    writeTranscript(dir, "dupe-session-01", [...headerLines("dupe-session-01"), userPrompt("dupe-session-01", worktree, "d", "t")], 2_000_000);

    const sessions = await listResumableSessionsForAgent({
      agentName: "kerrigan",
      projectRoot,
      knownCwd: worktree,
      homeDir: home,
    });

    expect(sessions).toHaveLength(1);
  });

  it("should return an empty list for an agent with no transcripts anywhere", async () => {
    const sessions = await listResumableSessionsForAgent({
      agentName: "ghost",
      projectRoot,
      homeDir: home,
    });

    expect(sessions).toEqual([]);
  });
});
