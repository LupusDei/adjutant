/**
 * Tests for the Bridge operating-lessons layer (adj-202.6.3 — evolving persona).
 *
 * The per-session memory seed (adj-202.6.4) injects the RECALL layer — raw learnings +
 * unresolved corrections the avatar "already knows". This is the higher-order EVOLUTION
 * layer: durable OPERATING LESSONS distilled from how recent SESSIONS actually went, i.e.
 * the recurring action items the coordinator's own self-improvement loop (memory-reviewer)
 * surfaces from recent retrospectives. Surfacing them into the persona means the avatar
 * applies accumulated lessons over time, not just recalls memories — its guidance GROWS.
 *
 * The two layers read DISJOINT sources (seed = learnings/corrections; lessons =
 * retrospective action items), so composing them never double-applies a fact.
 */

import { describe, it, expect, vi } from "vitest";

import type { Correction, Learning, Retrospective } from "../../src/services/adjutant/memory-store.js";
import {
  buildBridgeOperatingLessons,
  joinPersonaEvolution,
  buildBridgePersonaEvolution,
  OPERATING_LESSONS_MAX,
  OPERATING_LESSONS_MIN_RECURRENCE,
  OPERATING_LESSONS_MAX_CHARS,
} from "../../src/services/bridge-operating-lessons.js";

function retro(partial: Partial<Retrospective> & Pick<Retrospective, "id">): Retrospective {
  const now = new Date().toISOString();
  return {
    id: partial.id,
    sessionDate: partial.sessionDate ?? now,
    beadsClosed: partial.beadsClosed ?? 0,
    beadsFailed: partial.beadsFailed ?? 0,
    correctionsReceived: partial.correctionsReceived ?? 0,
    agentsUsed: partial.agentsUsed ?? 0,
    avgBeadTimeMins: partial.avgBeadTimeMins ?? null,
    wentWell: partial.wentWell ?? null,
    wentWrong: partial.wentWrong ?? null,
    actionItems: partial.actionItems ?? null,
    metrics: partial.metrics ?? null,
    createdAt: partial.createdAt ?? now,
  };
}

/** A retro whose actionItems are the given array, JSON-encoded as the store stores them. */
function retroWithItems(id: number, items: string[]): Retrospective {
  return retro({ id, actionItems: JSON.stringify(items) });
}

function makeStore(retros: Retrospective[]) {
  return { getRecentRetrospectives: vi.fn(() => retros) };
}

describe("buildBridgeOperatingLessons", () => {
  it("returns null when there are no retrospectives (blank slate)", () => {
    const store = makeStore([]);
    expect(buildBridgeOperatingLessons({ memoryStore: store })).toBeNull();
  });

  it("returns null when no action item recurs across enough retros", () => {
    // Each item appears once → below the recurrence threshold → not a durable lesson.
    const store = makeStore([
      retroWithItems(1, ["Spawn QA earlier"]),
      retroWithItems(2, ["Rebase before merge"]),
    ]);
    expect(buildBridgeOperatingLessons({ memoryStore: store })).toBeNull();
  });

  it("surfaces an action item that recurs across the recurrence threshold of retros", () => {
    const repeated = "Spawn the QA sentinel before engineers finish";
    const retros: Retrospective[] = [];
    for (let i = 1; i <= OPERATING_LESSONS_MIN_RECURRENCE; i++) {
      retros.push(retroWithItems(i, [repeated]));
    }
    const result = buildBridgeOperatingLessons({ memoryStore: makeStore(retros) });
    expect(result).not.toBeNull();
    expect(result).toContain("OPERATING LESSONS");
    expect(result).toContain(repeated);
  });

  it("counts an item once per retro even if that retro lists it twice (no inflation)", () => {
    // Same item duplicated WITHIN one retro must not satisfy the cross-retro recurrence bar.
    const store = makeStore([retroWithItems(1, ["Tighten spawn prompts", "Tighten spawn prompts"])]);
    expect(buildBridgeOperatingLessons({ memoryStore: store })).toBeNull();
  });

  it("ignores retros with null/blank/invalid action items without throwing", () => {
    const store = makeStore([
      retro({ id: 1, actionItems: null }),
      retro({ id: 2, actionItems: "not-json" }),
      retro({ id: 3, actionItems: "{}" }),
      retro({ id: 4, actionItems: JSON.stringify([""]) }),
    ]);
    expect(buildBridgeOperatingLessons({ memoryStore: store })).toBeNull();
  });

  it("orders the most-recurring lesson first and caps the number rendered", () => {
    // Build many distinct recurring items, each repeated; the busiest should lead.
    const retros: Retrospective[] = [];
    const top = "Most recurring lesson";
    // top appears in 4 retros; others appear in exactly the threshold.
    for (let i = 0; i < 4; i++) retros.push(retroWithItems(100 + i, [top]));
    for (let n = 0; n < OPERATING_LESSONS_MAX + 3; n++) {
      const item = `Lesson number ${n}`;
      for (let r = 0; r < OPERATING_LESSONS_MIN_RECURRENCE; r++) {
        retros.push(retroWithItems(1000 + n * 10 + r, [item]));
      }
    }
    const result = buildBridgeOperatingLessons({ memoryStore: makeStore(retros) });
    expect(result).not.toBeNull();
    // Most-recurring item leads the lesson list (after the header line).
    const lessonLines = result!.split("\n").filter((l) => l.startsWith("- "));
    expect(lessonLines.length).toBeLessThanOrEqual(OPERATING_LESSONS_MAX);
    expect(lessonLines[0]).toContain(top);
  });

  it("keeps the rendered block within the hard char cap", () => {
    const long = "x".repeat(500);
    const retros: Retrospective[] = [];
    for (let n = 0; n < OPERATING_LESSONS_MAX + 2; n++) {
      for (let r = 0; r < OPERATING_LESSONS_MIN_RECURRENCE; r++) {
        retros.push(retroWithItems(n * 10 + r, [`${long}-${n}`]));
      }
    }
    const result = buildBridgeOperatingLessons({ memoryStore: makeStore(retros) });
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(OPERATING_LESSONS_MAX_CHARS);
  });
});

describe("joinPersonaEvolution", () => {
  it("returns null when every block is null/empty", () => {
    expect(joinPersonaEvolution(null, null)).toBeNull();
    expect(joinPersonaEvolution(null, "")).toBeNull();
  });

  it("returns the single present block unchanged", () => {
    expect(joinPersonaEvolution(null, "lessons")).toBe("lessons");
    expect(joinPersonaEvolution("seed", null)).toBe("seed");
  });

  it("joins present blocks with a blank line, preserving order", () => {
    expect(joinPersonaEvolution("seed", "lessons")).toBe("seed\n\nlessons");
  });
});

describe("buildBridgePersonaEvolution", () => {
  function learning(content: string): Learning {
    const now = new Date().toISOString();
    return {
      id: 1,
      category: "operational",
      topic: "deploy",
      content,
      sourceType: "user",
      sourceRef: null,
      confidence: 0.9,
      reinforcementCount: 0,
      lastAppliedAt: null,
      lastValidatedAt: null,
      supersededBy: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  function fullStore(opts: {
    learnings?: Learning[];
    corrections?: Correction[];
    retros?: Retrospective[];
  }) {
    return {
      queryLearnings: vi.fn(() => opts.learnings ?? []),
      getUnresolvedCorrections: vi.fn(() => opts.corrections ?? []),
      getRecentRetrospectives: vi.fn(() => opts.retros ?? []),
    };
  }

  it("returns null when neither the seed nor the lessons have anything", () => {
    const store = fullStore({});
    expect(buildBridgePersonaEvolution({ memoryStore: store })).toBeNull();
  });

  it("combines the recall seed and the operating lessons into one block", () => {
    const repeated = "Confirm spawns before launching";
    const store = fullStore({
      learnings: [learning("Commander prefers blue-green deploys")],
      retros: [retroWithItems(1, [repeated]), retroWithItems(2, [repeated])],
    });
    const result = buildBridgePersonaEvolution({ memoryStore: store });
    expect(result).not.toBeNull();
    expect(result).toContain("WHAT YOU ALREADY KNOW");
    expect(result).toContain("blue-green");
    expect(result).toContain("OPERATING LESSONS");
    expect(result).toContain(repeated);
  });

  it("returns only the seed when there are no recurring lessons", () => {
    const store = fullStore({ learnings: [learning("Commander prefers blue-green deploys")] });
    const result = buildBridgePersonaEvolution({ memoryStore: store });
    expect(result).not.toBeNull();
    expect(result).toContain("WHAT YOU ALREADY KNOW");
    expect(result).not.toContain("OPERATING LESSONS");
  });
});
