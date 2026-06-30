/**
 * The Bridge — session activity collector (adj-202.6.2: auto-learn from conversations).
 *
 * The avatar already persists EXPLICIT learnings when the Commander states a preference or
 * corrects it (store_memory / record_correction, adj-202.6.1). This module closes the
 * IMPLICIT gap: it observes the avatar's tool-call activity over a single Bridge session and,
 * on session end, distills the session's DOMINANT usage pattern into the SAME adjutant
 * {@link MemoryStore} the rest of the self-improvement loop already reads (memory-reviewer,
 * self-improver). It is NOT a parallel memory system — it writes one learning to the existing
 * store, exactly like the memory-collector behavior writes learnings from bead outcomes
 * (Constitution Rules 4 + 9).
 *
 * Why a usage PATTERN and not a transcript: server-side we have the avatar's tool calls, not
 * the Commander's spoken words (the Runway SDK exposes no transcript stream — see avatar.ts).
 * The tool calls ARE the Commander's directives turned into actions, so the SHAPE of a session
 * (mostly directing? triaging? planning? monitoring?) is the honest, cheap signal. Recurring
 * patterns REINFORCE one bounded learning (confidence rises) instead of accumulating noise; a
 * one-off pattern inserts a single low-confidence learning the memory-reviewer decays away
 * unless it recurs. Memory-tool-only sessions emit nothing (already captured explicitly).
 *
 * Resilience: finalize never throws — it runs during session teardown, which must not break.
 */

import type { MemoryStore } from "./adjutant/memory-store.js";
import { logInfo, logWarn } from "../utils/logger.js";

/** Topic under which Bridge usage-pattern learnings are filed (stable → dedup/reinforce). */
export const BRIDGE_USAGE_TOPIC = "bridge-usage";

/** source_type that distinguishes implicit Bridge-session learnings from agent/system ones. */
export const BRIDGE_SESSION_SOURCE_TYPE = "bridge_session";

/** Starting confidence for a freshly-observed pattern — low, so it must RECUR to survive decay. */
const BRIDGE_SESSION_CONFIDENCE = 0.3;

/** Hard cap on buffered entries per session so a long/abusive session can't grow unbounded. */
const MAX_ENTRIES_PER_SESSION = 256;

/** One observed avatar tool call within a Bridge session. */
export interface BridgeActivityEntry {
  /** The tool the avatar invoked (read, directive, or memory tool). */
  tool: string;
  /** Whether the call returned an ok envelope. Attempts count regardless (intent is signal). */
  ok: boolean;
}

/** The coarse usage categories a session's tool calls roll up into. */
export type BridgeUsagePattern = "direct" | "triage" | "plan" | "monitor";

/**
 * Map each Bridge tool to its usage category. The avatar's MEMORY tools (store_memory,
 * reinforce_memory, record_correction) are deliberately ABSENT: they already persist their
 * own learnings, so they must not drive a session's dominant pattern or trigger a redundant
 * implicit learning.
 */
const TOOL_PATTERN: Readonly<Record<string, BridgeUsagePattern>> = {
  // Directing the swarm by name.
  send_message: "direct",
  nudge_agent: "direct",
  // Triaging the open question queue.
  list_questions: "triage",
  answer_question: "triage",
  // Planning / dispatching work.
  create_bead: "plan",
  spawn_worker: "plan",
  // Checking live fleet status / recalling context.
  list_agents: "monitor",
  get_agent_detail: "monitor",
  get_project_state: "monitor",
  list_beads: "monitor",
  get_auto_develop_status: "monitor",
  read_messages: "monitor",
  query_memories: "monitor",
};

/** Human-readable phrasing for each pattern, used as the learning's content. */
const PATTERN_PHRASE: Readonly<Record<BridgeUsagePattern, string>> = {
  direct: "direct agents by name to dispatch and steer work",
  triage: "review and answer the open question queue",
  plan: "plan work — filing beads and spawning workers",
  monitor: "check live fleet status and recent activity",
};

/**
 * Deterministic tie-break order when two patterns are equally frequent: the more "active"
 * (decision-bearing) pattern wins, since it is the more useful thing to have learned.
 */
const PATTERN_PRIORITY: readonly BridgeUsagePattern[] = ["direct", "triage", "plan", "monitor"];

export interface ClassifiedSession {
  pattern: BridgeUsagePattern;
  /** The content stored as the learning — a stable phrase so identical sessions dedup/reinforce. */
  content: string;
}

/**
 * Distill a session's buffered activity into its dominant usage pattern, or `null` when there
 * is nothing implicit to learn (empty session, or only memory-tool calls already captured).
 * Pure + exported for direct unit testing.
 */
export function classifyBridgeSession(entries: readonly BridgeActivityEntry[]): ClassifiedSession | null {
  const counts = new Map<BridgeUsagePattern, number>();
  for (const entry of entries) {
    const pattern = TOOL_PATTERN[entry.tool];
    if (pattern === undefined) continue; // memory tools / unknown tools don't drive the pattern
    counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  let dominant: BridgeUsagePattern = PATTERN_PRIORITY[0]!;
  let best = -1;
  for (const pattern of PATTERN_PRIORITY) {
    const count = counts.get(pattern) ?? 0;
    if (count > best) {
      best = count;
      dominant = pattern;
    }
  }

  return { pattern: dominant, content: `In the Bridge, the Commander tends to ${PATTERN_PHRASE[dominant]}.` };
}

export interface BridgeSessionCollector {
  /** Note one avatar tool call against a session's running buffer. */
  record(sessionId: string, entry: BridgeActivityEntry): void;
  /**
   * End a session: distill its activity and reinforce-or-insert the implicit learning, then
   * drop the buffer. Idempotent (a finalized/unknown session is a no-op) and never throws.
   */
  finalize(sessionId: string): void;
  /** Whether a session currently has a live buffer (used to keep finalize idempotent). */
  has(sessionId: string): boolean;
}

export interface BridgeSessionCollectorDeps {
  /**
   * The SAME adjutant memory store the MCP memory tools and the memory-reviewer/self-improver
   * behaviors use. We only need to insert, look up by topic (for dedup), and reinforce.
   */
  memoryStore: Pick<MemoryStore, "insertLearning" | "queryLearnings" | "reinforceLearning">;
}

/**
 * Create the per-session activity collector. Buffers are in-memory only (a session is a few
 * minutes; learnings are persisted on finalize), so a restart simply forgets in-flight sessions
 * — acceptable for an implicit, best-effort learning signal.
 */
export function createBridgeSessionCollector(deps: BridgeSessionCollectorDeps): BridgeSessionCollector {
  const buffers = new Map<string, BridgeActivityEntry[]>();

  function record(sessionId: string, entry: BridgeActivityEntry): void {
    const buffer = buffers.get(sessionId) ?? [];
    if (buffer.length < MAX_ENTRIES_PER_SESSION) buffer.push(entry);
    buffers.set(sessionId, buffer);
  }

  function finalize(sessionId: string): void {
    const buffer = buffers.get(sessionId);
    if (!buffer) return; // already finalized, or never started — idempotent no-op
    buffers.delete(sessionId);

    const classified = classifyBridgeSession(buffer);
    if (!classified) return; // empty / memory-tool-only session — nothing implicit to learn

    try {
      // Reinforce an existing identical usage learning so RECURRING patterns strengthen and
      // the topic stays bounded; otherwise insert one low-confidence learning.
      const existing = deps.memoryStore
        .queryLearnings({ topic: BRIDGE_USAGE_TOPIC, limit: 50 })
        .find((l) => l.content === classified.content);

      if (existing) {
        deps.memoryStore.reinforceLearning(existing.id);
        logInfo("bridge session learning reinforced", {
          sessionId,
          learningId: existing.id,
          pattern: classified.pattern,
        });
        return;
      }

      const learning = deps.memoryStore.insertLearning({
        category: "coordination",
        topic: BRIDGE_USAGE_TOPIC,
        content: classified.content,
        sourceType: BRIDGE_SESSION_SOURCE_TYPE,
        sourceRef: sessionId,
        confidence: BRIDGE_SESSION_CONFIDENCE,
      });
      logInfo("bridge session learning stored", {
        sessionId,
        learningId: learning.id,
        pattern: classified.pattern,
      });
    } catch (err) {
      // Best-effort: a memory write failure must never break session teardown.
      logWarn("bridge session finalize failed", {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    record,
    finalize,
    has: (sessionId) => buffers.has(sessionId),
  };
}
