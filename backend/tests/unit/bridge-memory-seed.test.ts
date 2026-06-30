/**
 * Tests for the Bridge memory seed (adj-202.6.4 — memory-seeded sessions).
 *
 * At session-create the avatar should open ALREADY KNOWING the Commander's high-signal
 * preferences/decisions and the corrections it has already learned — instead of a blank slate.
 * `buildBridgeMemorySeed` reads the SAME adjutant MemoryStore the rest of the system uses
 * (Rules 4 + 9), selects a small, high-confidence/high-recency slice, and renders a concise,
 * length-capped "what you already know" block injected into the session personality.
 */

import { describe, it, expect, vi } from "vitest";

import type { Correction, Learning } from "../../src/services/adjutant/memory-store.js";
import {
  buildBridgeMemorySeed,
  appendMemorySeed,
  MEMORY_SEED_MAX_CHARS,
} from "../../src/services/bridge-memory-seed.js";

function learning(partial: Partial<Learning> & Pick<Learning, "id" | "content">): Learning {
  const now = new Date().toISOString();
  return {
    id: partial.id,
    category: partial.category ?? "operational",
    topic: partial.topic ?? "general",
    content: partial.content,
    sourceType: partial.sourceType ?? "user",
    sourceRef: partial.sourceRef ?? null,
    confidence: partial.confidence ?? 0.8,
    reinforcementCount: partial.reinforcementCount ?? 0,
    lastAppliedAt: partial.lastAppliedAt ?? null,
    lastValidatedAt: partial.lastValidatedAt ?? null,
    supersededBy: partial.supersededBy ?? null,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
  };
}

function correction(partial: Partial<Correction> & Pick<Correction, "id" | "description">): Correction {
  return {
    id: partial.id,
    messageId: partial.messageId ?? null,
    correctionType: partial.correctionType ?? "wrong_assumption",
    pattern: partial.pattern ?? "x",
    description: partial.description,
    learningId: partial.learningId ?? null,
    recurrenceCount: partial.recurrenceCount ?? 1,
    lastRecurrenceAt: partial.lastRecurrenceAt ?? null,
    resolved: partial.resolved ?? false,
    createdAt: partial.createdAt ?? new Date().toISOString(),
  };
}

function makeStore(learnings: Learning[], corrections: Correction[]) {
  return {
    queryLearnings: vi.fn(() => learnings),
    getUnresolvedCorrections: vi.fn(() => corrections),
  };
}

describe("buildBridgeMemorySeed", () => {
  it("returns null when there are no learnings and no corrections (blank slate, unchanged)", () => {
    const store = makeStore([], []);
    expect(buildBridgeMemorySeed({ memoryStore: store })).toBeNull();
  });

  it("renders top learnings with topic + content", () => {
    const store = makeStore(
      [
        learning({ id: 1, category: "operational", topic: "deploy", content: "Commander prefers blue-green deploys" }),
        learning({ id: 2, category: "coordination", topic: "tone", content: "Keep status reports terse" }),
      ],
      [],
    );
    const seed = buildBridgeMemorySeed({ memoryStore: store });
    expect(seed).not.toBeNull();
    expect(seed!).toContain("blue-green deploys");
    expect(seed!).toContain("deploy");
    expect(seed!.toLowerCase()).toContain("already know");
  });

  it("renders a corrections section so the avatar avoids repeating mistakes", () => {
    const store = makeStore(
      [],
      [correction({ id: 9, description: "Use projectId (UUID), never projectName, as a lookup key", recurrenceCount: 3 })],
    );
    const seed = buildBridgeMemorySeed({ memoryStore: store });
    expect(seed).not.toBeNull();
    expect(seed!).toContain("projectId");
    expect(seed!.toLowerCase()).toContain("correction");
  });

  it("caps the total length so the session-create payload stays bounded", () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      learning({ id: i + 1, topic: `t${i}`, content: "X".repeat(400), confidence: 0.9 }),
    );
    const store = makeStore(many, []);
    const seed = buildBridgeMemorySeed({ memoryStore: store });
    expect(seed).not.toBeNull();
    expect(seed!.length).toBeLessThanOrEqual(MEMORY_SEED_MAX_CHARS);
  });

  it("only requests reasonably-confident learnings (filters low-signal noise)", () => {
    const store = makeStore([learning({ id: 1, content: "ok" })], []);
    buildBridgeMemorySeed({ memoryStore: store });
    const arg = store.queryLearnings.mock.calls[0]![0] as { minConfidence?: number };
    expect(arg.minConfidence).toBeGreaterThan(0);
  });
});

describe("appendMemorySeed", () => {
  it("returns the personality unchanged when the seed is null", () => {
    expect(appendMemorySeed("PERSONA", null)).toBe("PERSONA");
  });

  it("appends the seed block after the personality when present", () => {
    const out = appendMemorySeed("PERSONA", "SEED");
    expect(out.startsWith("PERSONA")).toBe(true);
    expect(out).toContain("SEED");
  });
});
