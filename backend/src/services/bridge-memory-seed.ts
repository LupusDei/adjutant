/**
 * The Bridge — memory-seeded sessions (adj-202.6.4).
 *
 * A new Bridge session should open ALREADY KNOWING the Commander instead of as a blank slate.
 * This module reads the SAME adjutant {@link MemoryStore} the rest of the system uses (Rules
 * 4 + 9), selects a small, high-signal slice of learnings + the corrections the coordinator
 * has already learned, and renders a concise, length-capped "what you already know" block that
 * is injected into the session PERSONALITY at create time. The avatar becomes the face of the
 * persistent, ever-learning coordinator — it can reference prior preferences/decisions without
 * the Commander having to repeat them.
 *
 * Why personality, not startScript: personality is the avatar's system context (knowledge it
 * HOLDS), whereas startScript is the opening line it SPEAKS. Seeding knowledge belongs in the
 * former — we don't want the avatar to literally recite memories on connect.
 *
 * Selection mirrors the memory-reviewer's startup review (confidence × recency for learnings,
 * recurrence-ordered unresolved corrections) so the avatar surfaces the same "lessons to
 * remember" the coordinator's own loop would. The block is hard-capped in length so the
 * session-create payload (Runway personality field) stays bounded.
 */

import type { MemoryStore, Learning } from "./adjutant/memory-store.js";

/** Floor confidence for a learning to be worth seeding (filters low-signal noise). */
export const MEMORY_SEED_MIN_CONFIDENCE = 0.4;
/** How many learnings to consider before scoring (a small candidate pool). */
export const MEMORY_SEED_CANDIDATE_POOL = 20;
/** Max learnings rendered into the seed. */
export const MEMORY_SEED_MAX_LEARNINGS = 6;
/** Max unresolved corrections rendered into the seed. */
export const MEMORY_SEED_MAX_CORRECTIONS = 3;
/** Per-line truncation so one verbose memory can't dominate the block. */
export const MEMORY_SEED_LINE_MAX = 220;
/** Hard cap on the whole block so the create payload stays reasonable. */
export const MEMORY_SEED_MAX_CHARS = 1400;

const SEED_HEADER =
  "WHAT YOU ALREADY KNOW (recalled from your persistent memory — honor this; do not ask the Commander to repeat it):";
const CORRECTIONS_HEADER = "Corrections you have already learned — do NOT repeat these mistakes:";

export interface MemorySeedDeps {
  /** The SAME adjutant memory store query_memories / the memory-reviewer read. */
  memoryStore: Pick<MemoryStore, "queryLearnings" | "getUnresolvedCorrections">;
}

/** Truncate a single rendered line to keep the block tidy and bounded. */
function clampLine(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > MEMORY_SEED_LINE_MAX ? collapsed.slice(0, MEMORY_SEED_LINE_MAX - 1) + "…" : collapsed;
}

/**
 * Score a learning by confidence weighted toward recency (mirrors memory-reviewer's startup
 * review), so the freshest high-confidence learnings rank first.
 */
function score(learning: Learning, nowMs: number): number {
  const daysSinceCreated = (nowMs - new Date(learning.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  const recencyWeight = 1 / (1 + daysSinceCreated / 30);
  return learning.confidence * recencyWeight;
}

/**
 * Build the "what you already know" seed block, or `null` when there is nothing worth seeding
 * (a fresh system stays a blank slate — unchanged behavior). The block is length-capped.
 */
export function buildBridgeMemorySeed(deps: MemorySeedDeps): string | null {
  const nowMs = Date.now();

  const learnings = deps.memoryStore
    .queryLearnings({ minConfidence: MEMORY_SEED_MIN_CONFIDENCE, limit: MEMORY_SEED_CANDIDATE_POOL })
    .slice()
    .sort((a, b) => score(b, nowMs) - score(a, nowMs))
    .slice(0, MEMORY_SEED_MAX_LEARNINGS);

  const corrections = deps.memoryStore.getUnresolvedCorrections().slice(0, MEMORY_SEED_MAX_CORRECTIONS);

  if (learnings.length === 0 && corrections.length === 0) return null;

  // Assemble line-by-line, stopping before the char cap so the block never exceeds it.
  const lines: string[] = [SEED_HEADER];
  let total = SEED_HEADER.length;

  const tryPush = (line: string): boolean => {
    const next = total + line.length + 1; // +1 for the joining newline
    if (next > MEMORY_SEED_MAX_CHARS) return false;
    lines.push(line);
    total = next;
    return true;
  };

  for (const l of learnings) {
    if (!tryPush(clampLine(`- [${l.category}/${l.topic}] ${l.content}`))) break;
  }

  if (corrections.length > 0 && total + CORRECTIONS_HEADER.length + 1 <= MEMORY_SEED_MAX_CHARS) {
    lines.push(CORRECTIONS_HEADER);
    total += CORRECTIONS_HEADER.length + 1;
    for (const c of corrections) {
      if (!tryPush(clampLine(`- ${c.description}`))) break;
    }
  }

  // Only the header survived (everything else was clipped) — nothing useful to seed.
  if (lines.length === 1) return null;

  return lines.join("\n");
}

/**
 * Append a memory seed block to a composed personality, or return the personality unchanged
 * when there is no seed. Keeps the seeding decoupled from {@link composeBridgePersonality} (the
 * drift-tested tool guidance), so the base persona stays exactly as authored when memory is empty.
 */
export function appendMemorySeed(personality: string, seed: string | null): string {
  return seed ? `${personality}\n\n${seed}` : personality;
}
