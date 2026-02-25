import { describe, it, expect } from "vitest";

import type { BeadInfo } from "../../../src/services/beads/types.js";

import {
  sortByPriorityThenDate,
  sortByClosedAtDesc,
  sortByUpdatedAtDesc,
  applyLimit,
} from "../../../src/services/beads/beads-sorter.js";

// ============================================================================
// Test Helpers
// ============================================================================

/** Creates a minimal BeadInfo for testing. */
function makeBead(overrides: Partial<BeadInfo> & { id: string }): BeadInfo {
  return {
    title: "Test Bead",
    status: "open",
    priority: 1,
    type: "task",
    assignee: null,
    rig: null,
    source: "town",
    labels: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: null,
    ...overrides,
  };
}

// ============================================================================
// sortByPriorityThenDate
// ============================================================================

describe("sortByPriorityThenDate", () => {
  it("should return empty array for empty input", () => {
    expect(sortByPriorityThenDate([])).toEqual([]);
  });

  it("should sort by priority ascending (lower = higher priority)", () => {
    const beads: BeadInfo[] = [
      makeBead({ id: "hq-3", priority: 3 }),
      makeBead({ id: "hq-0", priority: 0 }),
      makeBead({ id: "hq-1", priority: 1 }),
    ];
    const result = sortByPriorityThenDate(beads);
    expect(result.map((b) => b.id)).toEqual(["hq-0", "hq-1", "hq-3"]);
  });

  it("should sort by updatedAt descending for same priority", () => {
    const beads: BeadInfo[] = [
      makeBead({ id: "hq-old", priority: 1, updatedAt: "2026-01-01T00:00:00Z" }),
      makeBead({ id: "hq-new", priority: 1, updatedAt: "2026-01-15T00:00:00Z" }),
      makeBead({ id: "hq-mid", priority: 1, updatedAt: "2026-01-10T00:00:00Z" }),
    ];
    const result = sortByPriorityThenDate(beads);
    expect(result.map((b) => b.id)).toEqual(["hq-new", "hq-mid", "hq-old"]);
  });

  it("should fall back to createdAt when updatedAt is null", () => {
    const beads: BeadInfo[] = [
      makeBead({ id: "hq-old", priority: 1, updatedAt: null, createdAt: "2026-01-01T00:00:00Z" }),
      makeBead({ id: "hq-new", priority: 1, updatedAt: null, createdAt: "2026-01-15T00:00:00Z" }),
    ];
    const result = sortByPriorityThenDate(beads);
    expect(result.map((b) => b.id)).toEqual(["hq-new", "hq-old"]);
  });

  it("should not mutate the original array", () => {
    const beads: BeadInfo[] = [
      makeBead({ id: "hq-3", priority: 3 }),
      makeBead({ id: "hq-0", priority: 0 }),
    ];
    const original = [...beads];
    sortByPriorityThenDate(beads);
    expect(beads.map((b) => b.id)).toEqual(original.map((b) => b.id));
  });

  it("should handle single element", () => {
    const beads: BeadInfo[] = [makeBead({ id: "hq-only", priority: 2 })];
    const result = sortByPriorityThenDate(beads);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("hq-only");
  });

  it("should combine priority and date sorting correctly", () => {
    const beads: BeadInfo[] = [
      makeBead({ id: "hq-p2-old", priority: 2, updatedAt: "2026-01-01T00:00:00Z" }),
      makeBead({ id: "hq-p0-old", priority: 0, updatedAt: "2026-01-01T00:00:00Z" }),
      makeBead({ id: "hq-p0-new", priority: 0, updatedAt: "2026-01-15T00:00:00Z" }),
      makeBead({ id: "hq-p2-new", priority: 2, updatedAt: "2026-01-15T00:00:00Z" }),
    ];
    const result = sortByPriorityThenDate(beads);
    expect(result.map((b) => b.id)).toEqual([
      "hq-p0-new", "hq-p0-old", "hq-p2-new", "hq-p2-old",
    ]);
  });
});

// ============================================================================
// sortByClosedAtDesc
// ============================================================================

describe("sortByClosedAtDesc", () => {
  it("should return empty array for empty input", () => {
    expect(sortByClosedAtDesc([])).toEqual([]);
  });

  it("should sort by closedAt descending (most recent first)", () => {
    const items = [
      { closedAt: "2026-01-01T00:00:00Z", id: "old" },
      { closedAt: "2026-01-15T00:00:00Z", id: "new" },
      { closedAt: "2026-01-10T00:00:00Z", id: "mid" },
    ];
    const result = sortByClosedAtDesc(items);
    expect(result.map((i) => i.id)).toEqual(["new", "mid", "old"]);
  });

  it("should not mutate the original array", () => {
    const items = [
      { closedAt: "2026-01-15T00:00:00Z" },
      { closedAt: "2026-01-01T00:00:00Z" },
    ];
    const original = [...items];
    sortByClosedAtDesc(items);
    expect(items[0]!.closedAt).toBe(original[0]!.closedAt);
  });

  it("should handle single element", () => {
    const items = [{ closedAt: "2026-01-01T00:00:00Z" }];
    const result = sortByClosedAtDesc(items);
    expect(result).toHaveLength(1);
  });

  it("should handle items with the same closedAt", () => {
    const items = [
      { closedAt: "2026-01-15T00:00:00Z", id: "a" },
      { closedAt: "2026-01-15T00:00:00Z", id: "b" },
    ];
    const result = sortByClosedAtDesc(items);
    // Order is stable (or at least both present)
    expect(result).toHaveLength(2);
  });

  it("should preserve generic type information", () => {
    const items = [
      { closedAt: "2026-01-15T00:00:00Z", extra: "keep" },
      { closedAt: "2026-01-01T00:00:00Z", extra: "also" },
    ];
    const result = sortByClosedAtDesc(items);
    expect(result[0]!.extra).toBe("keep");
  });
});

// ============================================================================
// sortByUpdatedAtDesc
// ============================================================================

describe("sortByUpdatedAtDesc", () => {
  it("should return empty array for empty input", () => {
    expect(sortByUpdatedAtDesc([])).toEqual([]);
  });

  it("should sort by updatedAt descending", () => {
    const items = [
      { epic: makeBead({ id: "hq-old", updatedAt: "2026-01-01T00:00:00Z" }) },
      { epic: makeBead({ id: "hq-new", updatedAt: "2026-01-15T00:00:00Z" }) },
      { epic: makeBead({ id: "hq-mid", updatedAt: "2026-01-10T00:00:00Z" }) },
    ];
    const result = sortByUpdatedAtDesc(items);
    expect(result.map((i) => i.epic.id)).toEqual(["hq-new", "hq-mid", "hq-old"]);
  });

  it("should fall back to createdAt when updatedAt is null", () => {
    const items = [
      { epic: makeBead({ id: "hq-old", updatedAt: null, createdAt: "2026-01-01T00:00:00Z" }) },
      { epic: makeBead({ id: "hq-new", updatedAt: null, createdAt: "2026-01-15T00:00:00Z" }) },
    ];
    const result = sortByUpdatedAtDesc(items);
    expect(result.map((i) => i.epic.id)).toEqual(["hq-new", "hq-old"]);
  });

  it("should not mutate the original array", () => {
    const items = [
      { epic: makeBead({ id: "hq-new", updatedAt: "2026-01-15T00:00:00Z" }) },
      { epic: makeBead({ id: "hq-old", updatedAt: "2026-01-01T00:00:00Z" }) },
    ];
    const original = items.map((i) => i.epic.id);
    sortByUpdatedAtDesc(items);
    expect(items.map((i) => i.epic.id)).toEqual(original);
  });

  it("should handle single element", () => {
    const items = [{ epic: makeBead({ id: "hq-only" }) }];
    const result = sortByUpdatedAtDesc(items);
    expect(result).toHaveLength(1);
  });
});

// ============================================================================
// applyLimit
// ============================================================================

describe("applyLimit", () => {
  it("should return empty array for empty input", () => {
    expect(applyLimit([], 5)).toEqual([]);
  });

  it("should return all items when limit is undefined", () => {
    const items = [1, 2, 3, 4, 5];
    expect(applyLimit(items, undefined)).toEqual(items);
  });

  it("should return all items when limit is 0", () => {
    const items = [1, 2, 3, 4, 5];
    expect(applyLimit(items, 0)).toEqual(items);
  });

  it("should return all items when limit exceeds length", () => {
    const items = [1, 2, 3];
    expect(applyLimit(items, 10)).toEqual(items);
  });

  it("should return all items when limit equals length", () => {
    const items = [1, 2, 3];
    expect(applyLimit(items, 3)).toEqual(items);
  });

  it("should truncate to limit when items exceed limit", () => {
    const items = [1, 2, 3, 4, 5];
    expect(applyLimit(items, 3)).toEqual([1, 2, 3]);
  });

  it("should return first item when limit is 1", () => {
    const items = ["a", "b", "c"];
    expect(applyLimit(items, 1)).toEqual(["a"]);
  });

  it("should preserve generic type information", () => {
    const items = [
      { id: "a", val: 1 },
      { id: "b", val: 2 },
      { id: "c", val: 3 },
    ];
    const result = applyLimit(items, 2);
    expect(result).toHaveLength(2);
    expect(result[0]!.val).toBe(1);
    expect(result[1]!.val).toBe(2);
  });
});
