/**
 * JSONL session log parser service.
 *
 * Reads Claude Code JSONL session logs and computes authoritative
 * per-session costs from actual token usage data.
 *
 * JSONL files live at:
 *   ~/.claude/projects/<project-key>/sessions/<session-id>.jsonl
 *   ~/.claude/projects/<project-key>/sessions/subagents/agent-<id>.jsonl
 */

import { createReadStream } from "node:fs";
import { readdir, access } from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";

import { logWarn } from "../utils/index.js";

// ============================================================================
// Types
// ============================================================================

export interface JsonlSessionCost {
  sessionId: string;
  totalCost: number;
  tokenBreakdown: {
    input: number;
    output: number;
    cacheWrite: number;
    cacheRead: number;
  };
  messageCount: number;
  models: string[];
  firstTimestamp?: string;
  lastTimestamp?: string;
}

/** Pricing per 1M tokens for known Claude models. */
interface ModelPricing {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

// ============================================================================
// Pricing Table
// ============================================================================

const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-6": { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4, cacheWrite: 1.0, cacheRead: 0.08 },
};

/** Default pricing for unknown models (use Sonnet as a reasonable default). */
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const DEFAULT_PRICING: ModelPricing = MODEL_PRICING["claude-sonnet-4-6"]!;

/**
 * Resolve pricing for a model name. Falls back to Sonnet pricing for unknown models.
 */
function getPricing(model: string): ModelPricing {
  const exact = MODEL_PRICING[model];
  if (exact) return exact;

  // Try prefix matching for versioned model names (e.g., "claude-opus-4-6-20260301")
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key)) return pricing;
  }

  logWarn("Unknown model in JSONL log, using Sonnet pricing as default", { model });
  return DEFAULT_PRICING;
}

/**
 * Compute the dollar cost for a single message's token usage.
 */
function computeMessageCost(
  pricing: ModelPricing,
  inputTokens: number,
  outputTokens: number,
  cacheWriteTokens: number,
  cacheReadTokens: number,
): number {
  return (
    (inputTokens * pricing.input +
      outputTokens * pricing.output +
      cacheWriteTokens * pricing.cacheWrite +
      cacheReadTokens * pricing.cacheRead) /
    1_000_000
  );
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Read a single JSONL file and compute per-session cost.
 * Uses readline + createReadStream for efficient line-by-line reading.
 */
export async function parseJsonlSessionCost(filePath: string): Promise<JsonlSessionCost> {
  const result: JsonlSessionCost = {
    sessionId: "",
    totalCost: 0,
    tokenBreakdown: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
    messageCount: 0,
    models: [],
  };

  let firstTimestamp: string | undefined;
  let lastTimestamp: string | undefined;

  const modelsSet = new Set<string>();

  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      logWarn("Skipping malformed JSON line in JSONL file", { filePath });
      continue;
    }

    // Only assistant messages have usage data
    if (parsed["type"] !== "assistant") continue;

    const message = parsed["message"] as Record<string, unknown> | undefined;
    if (!message) continue;

    const usage = message["usage"] as Record<string, unknown> | undefined;
    if (!usage) continue;

    // Extract token counts
    const inputTokens = (usage["input_tokens"] as number) || 0;
    const outputTokens = (usage["output_tokens"] as number) || 0;
    const cacheWriteTokens = (usage["cache_creation_input_tokens"] as number) || 0;
    const cacheReadTokens = (usage["cache_read_input_tokens"] as number) || 0;

    // Extract model
    const model = (message["model"] as string) || "unknown";
    modelsSet.add(model);

    // Session ID from the first message
    if (!result.sessionId && parsed["sessionId"]) {
      result.sessionId = parsed["sessionId"] as string;
    }

    // Timestamps
    const timestamp = parsed["timestamp"] as string | undefined;
    if (timestamp) {
      if (!firstTimestamp || timestamp < firstTimestamp) {
        firstTimestamp = timestamp;
      }
      if (!lastTimestamp || timestamp > lastTimestamp) {
        lastTimestamp = timestamp;
      }
    }

    // Accumulate tokens
    result.tokenBreakdown.input += inputTokens;
    result.tokenBreakdown.output += outputTokens;
    result.tokenBreakdown.cacheWrite += cacheWriteTokens;
    result.tokenBreakdown.cacheRead += cacheReadTokens;

    // Compute cost for this message
    const pricing = getPricing(model);
    result.totalCost += computeMessageCost(
      pricing,
      inputTokens,
      outputTokens,
      cacheWriteTokens,
      cacheReadTokens,
    );

    result.messageCount += 1;
  }

  result.models = Array.from(modelsSet);
  if (firstTimestamp) result.firstTimestamp = firstTimestamp;
  if (lastTimestamp) result.lastTimestamp = lastTimestamp;

  // If no sessionId was found in the data, derive from filename
  if (!result.sessionId) {
    result.sessionId = path.basename(filePath, ".jsonl");
  }

  return result;
}

/**
 * Convert a project path to the Claude project key format.
 * Slashes are replaced with dashes (e.g., "/Users/Reason/code" -> "-Users-Reason-code").
 */
function projectPathToKey(projectPath: string): string {
  return projectPath.replace(/\//g, "-");
}

/**
 * Find all JSONL files for a project path.
 *
 * @param homeDirOverride - Override for ~/.claude base directory (for testing)
 * @param projectPath - The project path to look up
 */
export async function findSessionLogs(
  homeDirOverride: string,
  projectPath: string,
): Promise<string[]> {
  const projectKey = projectPathToKey(projectPath);
  const sessionsDir = path.join(homeDirOverride, ".claude", "projects", projectKey, "sessions");

  const results: string[] = [];

  try {
    await access(sessionsDir);
  } catch {
    return [];
  }

  // Read top-level session files
  try {
    const entries = await readdir(sessionsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        results.push(path.join(sessionsDir, entry.name));
      }
    }

    // Check for subagents directory
    const subagentsDir = path.join(sessionsDir, "subagents");
    try {
      await access(subagentsDir);
      const subEntries = await readdir(subagentsDir, { withFileTypes: true });
      for (const entry of subEntries) {
        if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          results.push(path.join(subagentsDir, entry.name));
        }
      }
    } catch {
      // No subagents directory, that's fine
    }
  } catch {
    // Directory not readable
    return [];
  }

  return results;
}

/**
 * Compute costs for all sessions in a project.
 *
 * @param homeDirOverride - Override for ~/.claude base directory (for testing)
 * @param projectPath - The project path to look up
 */
export async function computeProjectCosts(
  homeDirOverride: string,
  projectPath: string,
): Promise<JsonlSessionCost[]> {
  const logFiles = await findSessionLogs(homeDirOverride, projectPath);
  if (logFiles.length === 0) return [];

  const results: JsonlSessionCost[] = [];
  for (const filePath of logFiles) {
    try {
      const cost = await parseJsonlSessionCost(filePath);
      results.push(cost);
    } catch (err) {
      logWarn("Failed to parse JSONL session log", { filePath, error: String(err) });
    }
  }

  return results;
}
