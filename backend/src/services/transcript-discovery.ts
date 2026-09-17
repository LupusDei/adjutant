/**
 * Transcript discovery (adj-dpgqc) — find the Claude Code sessions an agent can be
 * RESUMED from.
 *
 * On 2026-09-16 the fleet host kernel-panicked. Every tmux session died; every
 * worktree, uncommitted file and Claude Code transcript survived. Bringing an agent
 * back is `claude --resume <sessionId>` — but only if you can find the session id,
 * which meant hand-globbing `~/.claude/projects` at 3am. This service is the
 * supported way to ask "what can <agent> be resumed from?".
 *
 * Layout, verified on disk 2026-09-17:
 *
 *   ~/.claude/projects/<dir-encoded cwd>/<sessionId>.jsonl   <- the transcript
 *   ~/.claude/projects/<dir-encoded cwd>/<sessionId>/        <- a sibling directory
 *   ~/.claude/projects/<dir-encoded cwd>/memory/             <- unrelated
 *
 * The directory name is the cwd with every non-alphanumeric character replaced by
 * "-", so it always begins with "-" (`/Users/x` -> `-Users-x`). Note this is NOT
 * just slash replacement: the agent `eric_ai` works in `.../worktrees/eric_ai` and
 * its transcripts live in `...-worktrees-eric-ai`. The encoding is lossy and cannot
 * be reversed, which is why the real `cwd` is read back out of the transcript.
 *
 * Because the leading "-" makes these names look like CLI flags, always pass such a
 * path as a single argument to a Node fs call (never interpolate it into a shell
 * command without `--`).
 */

import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import * as readline from "node:readline";

import { logWarn } from "../utils/index.js";

// ============================================================================
// Types
// ============================================================================

export interface ResumableSession {
  /** Claude Code session id — the argument to `claude --resume`. */
  sessionId: string;
  /** Absolute path of the `<sessionId>.jsonl` transcript. */
  transcriptPath: string;
  /** The cwd recorded INSIDE the transcript (authoritative; the dir name is lossy). */
  cwd?: string | undefined;
  /** Transcript file mtime, ISO — the practical "when was this session last alive". */
  modifiedAt: string;
  sizeBytes: number;
  /** Timestamp of the last entry of any kind, ISO, when the transcript carries one. */
  lastActivityAt?: string | undefined;
  /** First real user prompt (truncated) — usually the spawn prompt, so it names the mission. */
  firstPrompt?: string | undefined;
  /** Most recent real user prompt (truncated) — what the agent was last told to do. */
  lastPrompt?: string | undefined;
}

export interface ListResumableSessionsOptions {
  /** The agent's working directory (worktree for isolated agents). */
  projectPath: string;
  /** Override the home directory that holds `.claude/projects` (tests). */
  homeDir?: string | undefined;
  /** Cap the number of sessions returned (newest first). */
  limit?: number | undefined;
}

/** Longest excerpt returned for a prompt, including the ellipsis. */
const MAX_EXCERPT_CHARS = 300;

// ============================================================================
// Public API
// ============================================================================

/**
 * Encode a working directory the way Claude Code names its project directory:
 * every non-alphanumeric character becomes "-". A trailing slash is dropped first
 * so `/repo/` and `/repo` resolve to the same directory.
 */
export function claudeProjectDirName(cwd: string): string {
  const trimmed = cwd.length > 1 ? cwd.replace(/\/+$/, "") : cwd;
  return trimmed.replace(/[^a-zA-Z0-9]/g, "-");
}

/**
 * List the sessions that can be resumed for a working directory, newest first.
 *
 * Never throws: a missing directory, an unreadable file or a transcript torn in half
 * by a power loss yields fewer results, not an error. Recovery tooling that throws
 * during an outage is worse than useless.
 */
export async function listResumableSessions(
  opts: ListResumableSessionsOptions,
): Promise<ResumableSession[]> {
  const home = opts.homeDir ?? homedir();
  const projectDir = join(home, ".claude", "projects", claudeProjectDirName(opts.projectPath));

  let entries;
  try {
    entries = await readdir(projectDir, { withFileTypes: true });
  } catch {
    // No transcripts for this cwd (agent never ran here, or a different home).
    return [];
  }

  // Files only: the `<sessionId>/` sibling directory and `memory/` are not transcripts.
  const transcripts = entries
    .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
    .map((e) => e.name);

  const withStats: { name: string; path: string; mtimeMs: number; size: number }[] = [];
  for (const name of transcripts) {
    const path = join(projectDir, name);
    try {
      const s = await stat(path);
      withStats.push({ name, path, mtimeMs: s.mtimeMs, size: s.size });
    } catch {
      // Vanished between readdir and stat — skip it.
    }
  }

  // Newest first: after a crash the session you want is nearly always the last one.
  withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const sessions: ResumableSession[] = [];
  for (const file of withStats) {
    if (opts.limit !== undefined && sessions.length >= opts.limit) break;

    const summary = await summarizeTranscript(file.path);
    // A transcript with no parsable entry has nothing to resume into.
    if (!summary.hasEntries) continue;

    sessions.push({
      sessionId: file.name.replace(/\.jsonl$/, ""),
      transcriptPath: file.path,
      cwd: summary.cwd,
      modifiedAt: new Date(file.mtimeMs).toISOString(),
      sizeBytes: file.size,
      lastActivityAt: summary.lastActivityAt,
      firstPrompt: summary.firstPrompt,
      lastPrompt: summary.lastPrompt,
    });
  }

  return sessions;
}

export interface ListResumableSessionsForAgentOptions {
  /** Agent callsign, e.g. "kerrigan". */
  agentName: string;
  /** The project the agent works on (the canonical checkout). */
  projectRoot: string;
  /**
   * A working directory already known for this agent — the registry's session
   * projectPath, or the cwd of a session that just died. Searched first.
   */
  knownCwd?: string | undefined;
  homeDir?: string | undefined;
  limit?: number | undefined;
}

/**
 * Every session an agent could be resumed from, newest first.
 *
 * An agent's transcripts are filed under the directory it RAN in, and that is not one
 * fixed place: worker agents are worktree-isolated (`<root>/worktrees/<name>`, adj-182.5)
 * while the coordinator and system agents run in the canonical checkout. Rather than
 * guess, this searches every directory the agent plausibly ran in and merges the results.
 */
export async function listResumableSessionsForAgent(
  opts: ListResumableSessionsForAgentOptions,
): Promise<ResumableSession[]> {
  const candidates = [
    opts.knownCwd,
    join(opts.projectRoot, "worktrees", opts.agentName),
    opts.projectRoot,
  ].filter((p): p is string => typeof p === "string" && p.length > 0);

  const seenDir = new Set<string>();
  const seenSession = new Set<string>();
  const all: ResumableSession[] = [];

  for (const candidate of candidates) {
    // Two candidates can encode to the same transcript directory (a knownCwd that IS
    // the worktree, say) — read it once.
    const dirKey = claudeProjectDirName(candidate);
    if (seenDir.has(dirKey)) continue;
    seenDir.add(dirKey);

    const sessions = await listResumableSessions({
      projectPath: candidate,
      homeDir: opts.homeDir,
    });
    for (const session of sessions) {
      if (seenSession.has(session.sessionId)) continue;
      seenSession.add(session.sessionId);
      all.push(session);
    }
  }

  all.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : a.modifiedAt > b.modifiedAt ? -1 : 0));
  return opts.limit === undefined ? all : all.slice(0, opts.limit);
}

// ============================================================================
// Internals
// ============================================================================

interface TranscriptSummary {
  hasEntries: boolean;
  cwd?: string | undefined;
  firstPrompt?: string | undefined;
  lastPrompt?: string | undefined;
  lastActivityAt?: string | undefined;
}

/**
 * Stream a transcript and pull out the few facts a human needs to choose a session.
 *
 * The whole file is read because the LAST prompt is only knowable at the end. Lines
 * are parsed individually, so a half-written final line (what a kernel panic leaves
 * behind) costs that one line and nothing else.
 */
async function summarizeTranscript(path: string): Promise<TranscriptSummary> {
  const summary: TranscriptSummary = { hasEntries: false };

  try {
    const stream = createReadStream(path, { encoding: "utf-8" });
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of lines) {
      if (!line.trim()) continue;

      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line) as Record<string, unknown>;
      } catch {
        // Torn or non-JSON line — the rest of the transcript is still good.
        continue;
      }

      summary.hasEntries = true;

      if (summary.cwd === undefined && typeof entry["cwd"] === "string") {
        summary.cwd = entry["cwd"];
      }
      if (typeof entry["timestamp"] === "string") {
        summary.lastActivityAt = entry["timestamp"];
      }

      const prompt = userPromptText(entry);
      if (prompt !== undefined) {
        if (summary.firstPrompt === undefined) summary.firstPrompt = prompt;
        summary.lastPrompt = prompt;
      }
    }

    lines.close();
    stream.destroy();
  } catch (err) {
    logWarn("Could not read transcript", { path, error: String(err) });
  }

  return summary;
}

/**
 * Return the text of a real user prompt, or undefined for anything else.
 *
 * Three kinds of entry are all `type: "user"` and only one is a prompt:
 *   - a typed prompt: string content, no toolUseResult   <- this one
 *   - a tool result: array content plus a toolUseResult
 *   - a subagent's turn: `isSidechain: true` (a teammate's prompt, not this agent's)
 */
function userPromptText(entry: Record<string, unknown>): string | undefined {
  if (entry["type"] !== "user") return undefined;
  if (entry["toolUseResult"] !== undefined) return undefined;
  if (entry["isSidechain"] === true) return undefined;

  const message = entry["message"];
  if (typeof message !== "object" || message === null) return undefined;
  const content = (message as Record<string, unknown>)["content"];

  let text: string;
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .filter(
        (block): block is { type: string; text: string } =>
          typeof block === "object" &&
          block !== null &&
          (block as Record<string, unknown>)["type"] === "text" &&
          typeof (block as Record<string, unknown>)["text"] === "string",
      )
      .map((block) => block.text)
      .join(" ");
  } else {
    return undefined;
  }

  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (isInjectedWrapper(trimmed)) return undefined;
  return truncate(trimmed, MAX_EXCERPT_CHARS);
}

/**
 * Claude Code stores some of its own machinery as user turns: the `/resume` caveat,
 * slash-command echoes, command stdout, skill preambles. Showing one of those as
 * "what this agent was doing" is worse than showing nothing, so they are skipped and
 * the nearest real prompt is used instead.
 */
const INJECTED_WRAPPER_PREFIXES = [
  "<local-command-",
  "<command-name>",
  "<command-message>",
  "<command-args>",
  "Caveat: The messages below",
  "Base directory for this skill:",
];

function isInjectedWrapper(text: string): boolean {
  return INJECTED_WRAPPER_PREFIXES.some((prefix) => text.startsWith(prefix));
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}
