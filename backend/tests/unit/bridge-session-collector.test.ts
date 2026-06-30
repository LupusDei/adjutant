/**
 * Tests for the Bridge session collector (adj-202.6.2 — auto-learn from conversations).
 *
 * The avatar already persists EXPLICIT learnings when the Commander states a preference
 * or correction (store_memory / record_correction, adj-202.6.1). This collector closes the
 * IMPLICIT gap: it watches the avatar's tool-call activity across a Bridge session and, on
 * session end, distills the session's DOMINANT usage pattern into the SAME adjutant
 * MemoryStore the rest of the self-improvement loop reads — no parallel store (Rules 4 + 9).
 *
 * Recurring patterns REINFORCE an existing learning (confidence rises, bounded growth)
 * instead of accumulating noise; a fresh pattern inserts one low-confidence learning that
 * the memory-reviewer will decay away unless it recurs. Memory-tool-only sessions emit
 * nothing (already captured explicitly).
 */

import { describe, it, expect, vi } from "vitest";

import type { Learning, NewLearning } from "../../src/services/adjutant/memory-store.js";
import {
  createBridgeSessionCollector,
  classifyBridgeSession,
  BRIDGE_USAGE_TOPIC,
  BRIDGE_SESSION_SOURCE_TYPE,
} from "../../src/services/bridge-session-collector.js";

// A minimal in-memory MemoryStore fake exposing only the slice the collector uses.
function makeMemoryStoreFake() {
  const learnings: Learning[] = [];
  let nextId = 1;
  const insertLearning = vi.fn((l: NewLearning): Learning => {
    const row: Learning = {
      id: nextId++,
      category: l.category,
      topic: l.topic,
      content: l.content,
      sourceType: l.sourceType,
      sourceRef: l.sourceRef ?? null,
      confidence: l.confidence ?? 0.5,
      reinforcementCount: 0,
      lastAppliedAt: null,
      lastValidatedAt: null,
      supersededBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    learnings.push(row);
    return row;
  });
  const queryLearnings = vi.fn((q: { topic?: string }): Learning[] =>
    learnings.filter((l) => (q.topic === undefined ? true : l.topic === q.topic)),
  );
  const reinforceLearning = vi.fn((id: number) => {
    const l = learnings.find((x) => x.id === id);
    if (l) l.reinforcementCount += 1;
  });
  return { learnings, insertLearning, queryLearnings, reinforceLearning };
}

describe("classifyBridgeSession", () => {
  it("returns null for an empty session (nothing to learn)", () => {
    expect(classifyBridgeSession([])).toBeNull();
  });

  it("returns null for a memory-tool-only session (already captured explicitly)", () => {
    const out = classifyBridgeSession([
      { tool: "store_memory", ok: true },
      { tool: "record_correction", ok: true },
      { tool: "reinforce_memory", ok: true },
    ]);
    expect(out).toBeNull();
  });

  it("classifies a directing-heavy session as the 'direct' pattern", () => {
    const out = classifyBridgeSession([
      { tool: "send_message", ok: true },
      { tool: "send_message", ok: true },
      { tool: "nudge_agent", ok: true },
      { tool: "list_agents", ok: true },
    ]);
    expect(out).not.toBeNull();
    expect(out!.pattern).toBe("direct");
    expect(out!.content).toContain("direct");
  });

  it("classifies a status-heavy session as the 'monitor' pattern", () => {
    const out = classifyBridgeSession([
      { tool: "list_agents", ok: true },
      { tool: "get_project_state", ok: true },
      { tool: "read_messages", ok: true },
    ]);
    expect(out!.pattern).toBe("monitor");
  });

  it("counts attempts regardless of ok (a failed directive still signals intent)", () => {
    const out = classifyBridgeSession([
      { tool: "send_message", ok: false },
      { tool: "send_message", ok: false },
      { tool: "list_beads", ok: true },
    ]);
    expect(out!.pattern).toBe("direct");
  });
});

describe("createBridgeSessionCollector", () => {
  it("inserts ONE bounded-confidence learning into the memory store on finalize", () => {
    const store = makeMemoryStoreFake();
    const collector = createBridgeSessionCollector({ memoryStore: store });

    collector.record("sess-1", { tool: "send_message", ok: true });
    collector.record("sess-1", { tool: "nudge_agent", ok: true });
    expect(collector.has("sess-1")).toBe(true);

    collector.finalize("sess-1");

    expect(store.insertLearning).toHaveBeenCalledTimes(1);
    const inserted = store.learnings[0]!;
    expect(inserted.topic).toBe(BRIDGE_USAGE_TOPIC);
    expect(inserted.sourceType).toBe(BRIDGE_SESSION_SOURCE_TYPE);
    expect(inserted.sourceRef).toBe("sess-1");
    expect(inserted.category).toBe("coordination");
    expect(inserted.confidence).toBeLessThan(0.5);
    // Buffer cleared after finalize.
    expect(collector.has("sess-1")).toBe(false);
  });

  it("REINFORCES an existing identical usage learning instead of duplicating it", () => {
    const store = makeMemoryStoreFake();
    const collector = createBridgeSessionCollector({ memoryStore: store });

    // First directing session — inserts.
    collector.record("a", { tool: "send_message", ok: true });
    collector.finalize("a");
    // Second directing session — same dominant pattern → reinforce, not insert.
    collector.record("b", { tool: "send_message", ok: true });
    collector.record("b", { tool: "nudge_agent", ok: true });
    collector.finalize("b");

    expect(store.insertLearning).toHaveBeenCalledTimes(1);
    expect(store.reinforceLearning).toHaveBeenCalledTimes(1);
    expect(store.learnings[0]!.reinforcementCount).toBe(1);
  });

  it("emits NOTHING for a memory-tool-only session (no double-store)", () => {
    const store = makeMemoryStoreFake();
    const collector = createBridgeSessionCollector({ memoryStore: store });

    collector.record("m", { tool: "store_memory", ok: true });
    collector.record("m", { tool: "record_correction", ok: true });
    collector.finalize("m");

    expect(store.insertLearning).not.toHaveBeenCalled();
    expect(store.reinforceLearning).not.toHaveBeenCalled();
  });

  it("finalize is idempotent and a no-op for an unknown session", () => {
    const store = makeMemoryStoreFake();
    const collector = createBridgeSessionCollector({ memoryStore: store });

    collector.record("x", { tool: "create_bead", ok: true });
    collector.finalize("x");
    collector.finalize("x"); // second call: buffer already gone
    collector.finalize("never-started");

    expect(store.insertLearning).toHaveBeenCalledTimes(1);
  });

  it("never throws if the store insert fails (resilient — must not break session teardown)", () => {
    const store = makeMemoryStoreFake();
    store.insertLearning.mockImplementation(() => {
      throw new Error("db down");
    });
    const collector = createBridgeSessionCollector({ memoryStore: store });
    collector.record("s", { tool: "spawn_worker", ok: true });
    expect(() => {
      collector.finalize("s");
    }).not.toThrow();
  });
});
