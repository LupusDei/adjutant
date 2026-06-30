/**
 * The Bridge — evolving persona via accumulated operating lessons (adj-202.6.3).
 *
 * The per-session memory seed (adj-202.6.4, {@link buildBridgeMemorySeed}) injects the RECALL
 * layer: the raw learnings + unresolved corrections the avatar "already knows". This module
 * adds the HIGHER-ORDER layer that closes the self-improvement loop into the avatar's persona:
 * durable OPERATING LESSONS distilled from how recent SESSIONS actually went.
 *
 * It reuses the EXACT signal the coordinator's own memory-reviewer surfaces at startup
 * (memory-reviewer.ts → "Recurring Action Items (from recent retros)"): action items that
 * recur across multiple recent retrospectives. Those recurring items are the coordinator's
 * earned operating wisdom — "this keeps coming up; do it". Surfacing them into the Bridge
 * persona means the avatar APPLIES accumulated lessons as it coordinates, not just recalls
 * facts — its guidance/behavior GROWS over time (Rules 4 + 9: reuse the existing loop, don't
 * build a parallel one).
 *
 * Disjoint sources, no double-apply: the memory seed reads learnings + corrections; this layer
 * reads retrospectives' action items. They never overlap, so composing them never repeats a
 * fact. Both are hard length-capped so the Runway session-create personality payload stays
 * bounded.
 */

import type { MemoryStore } from "./adjutant/memory-store.js";
import { buildBridgeMemorySeed, type MemorySeedDeps } from "./bridge-memory-seed.js";

/** How many recent retrospectives to scan for recurring action items. */
export const OPERATING_LESSONS_RETRO_POOL = 5;
/** An action item must appear in at least this many DISTINCT retros to count as a lesson. */
export const OPERATING_LESSONS_MIN_RECURRENCE = 2;
/** Max lessons rendered into the block (the most-recurring win). */
export const OPERATING_LESSONS_MAX = 4;
/** Per-line truncation so one verbose action item can't dominate the block. */
export const OPERATING_LESSONS_LINE_MAX = 200;
/** Hard cap on the whole block so the create payload stays reasonable. */
export const OPERATING_LESSONS_MAX_CHARS = 900;

const LESSONS_HEADER =
  "OPERATING LESSONS (durable lessons distilled from how your recent sessions went — apply these as you coordinate, not just recall them):";

export interface OperatingLessonsDeps {
  /** The SAME adjutant memory store the memory-reviewer reads its retros from. */
  memoryStore: Pick<MemoryStore, "getRecentRetrospectives">;
}

/**
 * Parse a retrospective's `action_items` field (a JSON string array in the DB) into a list of
 * non-empty trimmed strings, returning `[]` on null/blank/invalid input. Mirrors the
 * memory-reviewer's tolerant parsing so malformed rows never break session create.
 */
function parseActionItems(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  } catch {
    return [];
  }
}

/** Truncate a single rendered line to keep the block tidy and bounded. */
function clampLine(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > OPERATING_LESSONS_LINE_MAX
    ? collapsed.slice(0, OPERATING_LESSONS_LINE_MAX - 1) + "…"
    : collapsed;
}

/**
 * Build the "operating lessons" block from recurring retrospective action items, or `null` when
 * nothing recurs often enough to be a durable lesson (a fresh/quiet system stays a blank slate).
 * The block is length-capped.
 */
export function buildBridgeOperatingLessons(deps: OperatingLessonsDeps): string | null {
  const retros = deps.memoryStore.getRecentRetrospectives(OPERATING_LESSONS_RETRO_POOL);

  // Count how many DISTINCT retros each action item appears in. Dedup within a single retro so
  // one retro repeating an item can't, by itself, satisfy the cross-retro recurrence bar.
  const retroCounts = new Map<string, number>();
  for (const retro of retros) {
    const items = new Set(parseActionItems(retro.actionItems));
    for (const item of items) {
      retroCounts.set(item, (retroCounts.get(item) ?? 0) + 1);
    }
  }

  // Most-recurring first; a stable sort preserves first-seen order on ties (deterministic).
  const recurring = [...retroCounts.entries()]
    .filter(([, count]) => count >= OPERATING_LESSONS_MIN_RECURRENCE)
    .sort((a, b) => b[1] - a[1])
    .slice(0, OPERATING_LESSONS_MAX)
    .map(([item]) => item);

  if (recurring.length === 0) return null;

  // Assemble line-by-line, stopping before the char cap so the block never exceeds it.
  const lines: string[] = [LESSONS_HEADER];
  let total = LESSONS_HEADER.length;

  for (const item of recurring) {
    const line = clampLine(`- ${item}`);
    const next = total + line.length + 1; // +1 for the joining newline
    if (next > OPERATING_LESSONS_MAX_CHARS) break;
    lines.push(line);
    total = next;
  }

  // Only the header survived (everything else was clipped) — nothing useful to surface.
  if (lines.length === 1) return null;

  return lines.join("\n");
}

/**
 * Join the persona-evolution blocks (recall seed + operating lessons) with a blank line,
 * dropping any that are null/empty. Returns `null` when nothing is present, so callers can keep
 * the base persona exactly as authored on a fresh system.
 */
export function joinPersonaEvolution(...blocks: (string | null)[]): string | null {
  const present = blocks.filter((b): b is string => b !== null && b.length > 0);
  return present.length === 0 ? null : present.join("\n\n");
}

export interface BridgePersonaEvolutionDeps {
  /** Memory store satisfying BOTH the recall-seed and operating-lessons reads. */
  memoryStore: MemorySeedDeps["memoryStore"] & OperatingLessonsDeps["memoryStore"];
}

/**
 * Build the full persona-evolution block injected at session-create: the per-session recall
 * seed (what the avatar already knows) PLUS the accumulated operating lessons (how to apply it).
 * Either part may be absent; returns `null` when both are. This is the single entry point the
 * route wiring uses so the dashboard and iOS/default avatars evolve identically.
 */
export function buildBridgePersonaEvolution(deps: BridgePersonaEvolutionDeps): string | null {
  return joinPersonaEvolution(
    buildBridgeMemorySeed({ memoryStore: deps.memoryStore }),
    buildBridgeOperatingLessons({ memoryStore: deps.memoryStore }),
  );
}
