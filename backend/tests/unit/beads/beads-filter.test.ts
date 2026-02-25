import { describe, it, expect } from "vitest";

import type { BeadInfo, BeadStatus } from "../../../src/services/beads/types.js";

import {
  parseStatusFilter,
  excludeWisps,
  deduplicateById,
  filterByAssignee,
  filterByStatuses,
  excludePrefixes,
  filterByRig,
} from "../../../src/services/beads/beads-filter.js";

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
// parseStatusFilter
// ============================================================================

describe("parseStatusFilter", () => {
  it("should return null for undefined input (show all)", () => {
    expect(parseStatusFilter(undefined)).toBeNull();
  });

  it("should return null for empty string (show all)", () => {
    expect(parseStatusFilter("")).toBeNull();
  });

  it("should return null for 'all' filter", () => {
    expect(parseStatusFilter("all")).toBeNull();
  });

  it("should return DEFAULT_STATUSES for 'default' filter", () => {
    const result = parseStatusFilter("default");
    expect(result).toEqual(["open", "hooked", "in_progress", "blocked"]);
  });

  it("should parse a single valid status", () => {
    expect(parseStatusFilter("open")).toEqual(["open"]);
  });

  it("should parse comma-separated statuses", () => {
    const result = parseStatusFilter("open,closed");
    expect(result).toEqual(["open", "closed"]);
  });

  it("should handle whitespace in comma-separated values", () => {
    const result = parseStatusFilter("open , in_progress , blocked");
    expect(result).toEqual(["open", "in_progress", "blocked"]);
  });

  it("should filter out invalid status values", () => {
    const result = parseStatusFilter("open,garbage,closed");
    expect(result).toEqual(["open", "closed"]);
  });

  it("should return null if all values are invalid", () => {
    expect(parseStatusFilter("garbage,invalid,nonsense")).toBeNull();
  });

  it("should normalize to lowercase", () => {
    const result = parseStatusFilter("OPEN,CLOSED");
    expect(result).toEqual(["open", "closed"]);
  });
});

// ============================================================================
// excludeWisps
// ============================================================================

describe("excludeWisps", () => {
  it("should return empty array for empty input", () => {
    expect(excludeWisps([])).toEqual([]);
  });

  it("should keep non-wisp items", () => {
    const items = [
      { id: "hq-abc", wisp: false },
      { id: "hq-def" },
    ];
    expect(excludeWisps(items)).toEqual(items);
  });

  it("should filter items with wisp=true flag", () => {
    const items = [
      { id: "hq-abc", wisp: false },
      { id: "hq-wispy", wisp: true },
    ];
    const result = excludeWisps(items);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("hq-abc");
  });

  it("should filter items with -wisp- in ID", () => {
    const items = [
      { id: "hq-abc" },
      { id: "hq-wisp-123" },
      { id: "gb-wisp-xyz" },
    ];
    const result = excludeWisps(items);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("hq-abc");
  });

  it("should filter both wisp flag and wisp ID pattern", () => {
    const items = [
      { id: "hq-abc" },
      { id: "hq-wisp-123", wisp: true },
      { id: "gb-wisp-xyz" },
      { id: "hq-def", wisp: true },
    ];
    const result = excludeWisps(items);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("hq-abc");
  });

  it("should preserve generic type information", () => {
    // Verifying it works with any type that has { id: string; wisp?: boolean }
    const items = [
      { id: "hq-abc", title: "Keep me", extra: 42 },
      { id: "hq-wisp-123", title: "Exclude me", extra: 99 },
    ];
    const result = excludeWisps(items);
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("Keep me");
    expect(result[0]!.extra).toBe(42);
  });
});

// ============================================================================
// deduplicateById
// ============================================================================

describe("deduplicateById", () => {
  it("should return empty array for empty input", () => {
    expect(deduplicateById([])).toEqual([]);
  });

  it("should return same items when no duplicates", () => {
    const items = [
      { id: "hq-abc" },
      { id: "hq-def" },
      { id: "hq-ghi" },
    ];
    expect(deduplicateById(items)).toEqual(items);
  });

  it("should keep first occurrence and remove duplicates", () => {
    const items = [
      { id: "hq-abc", val: 1 },
      { id: "hq-def", val: 2 },
      { id: "hq-abc", val: 3 },
    ];
    const result = deduplicateById(items);
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe("hq-abc");
    expect(result[0]!.val).toBe(1); // first occurrence kept
    expect(result[1]!.id).toBe("hq-def");
  });

  it("should handle all duplicates", () => {
    const items = [
      { id: "hq-abc" },
      { id: "hq-abc" },
      { id: "hq-abc" },
    ];
    const result = deduplicateById(items);
    expect(result).toHaveLength(1);
  });

  it("should preserve generic type information", () => {
    const items = [
      { id: "a", name: "first", priority: 0 },
      { id: "b", name: "second", priority: 1 },
      { id: "a", name: "duplicate", priority: 2 },
    ];
    const result = deduplicateById(items);
    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe("first");
  });
});

// ============================================================================
// filterByAssignee
// ============================================================================

describe("filterByAssignee", () => {
  const beads: BeadInfo[] = [
    makeBead({ id: "hq-1", assignee: "gastown_boy/polecats/ace" }),
    makeBead({ id: "hq-2", assignee: "gastown_boy/polecats/toast" }),
    makeBead({ id: "hq-3", assignee: null }),
    makeBead({ id: "hq-4", assignee: "adjutant/crew/worker" }),
    makeBead({ id: "hq-5", assignee: "ace" }),
  ];

  it("should return empty array for empty input", () => {
    expect(filterByAssignee([], "ace")).toEqual([]);
  });

  it("should filter by exact match", () => {
    const result = filterByAssignee(beads, "gastown_boy/polecats/ace");
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("hq-1");
  });

  it("should filter by last path component", () => {
    const result = filterByAssignee(beads, "ace");
    expect(result).toHaveLength(2);
    expect(result.map((b) => b.id)).toEqual(["hq-1", "hq-5"]);
  });

  it("should be case-insensitive", () => {
    const result = filterByAssignee(beads, "ACE");
    expect(result).toHaveLength(2);
  });

  it("should exclude beads with null assignee", () => {
    const result = filterByAssignee(beads, "toast");
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("hq-2");
  });

  it("should return empty when no match", () => {
    const result = filterByAssignee(beads, "nonexistent");
    expect(result).toEqual([]);
  });
});

// ============================================================================
// filterByStatuses
// ============================================================================

describe("filterByStatuses", () => {
  const beads: BeadInfo[] = [
    makeBead({ id: "hq-1", status: "open" }),
    makeBead({ id: "hq-2", status: "in_progress" }),
    makeBead({ id: "hq-3", status: "closed" }),
    makeBead({ id: "hq-4", status: "blocked" }),
    makeBead({ id: "hq-5", status: "hooked" }),
  ];

  it("should return empty array for empty input", () => {
    expect(filterByStatuses([], ["open"])).toEqual([]);
  });

  it("should filter by a single status", () => {
    const result = filterByStatuses(beads, ["open"]);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("hq-1");
  });

  it("should filter by multiple statuses", () => {
    const result = filterByStatuses(beads, ["open", "in_progress", "blocked"]);
    expect(result).toHaveLength(3);
    expect(result.map((b) => b.id)).toEqual(["hq-1", "hq-2", "hq-4"]);
  });

  it("should return empty when no statuses match", () => {
    const result = filterByStatuses(beads, ["hooked"]);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("hq-5");
  });

  it("should handle case-insensitive status matching", () => {
    // Beads have lowercase statuses, so this tests the toLowerCase in the filter
    const mixedCaseBeads: BeadInfo[] = [
      makeBead({ id: "hq-1", status: "Open" }),
      makeBead({ id: "hq-2", status: "CLOSED" }),
    ];
    const result = filterByStatuses(mixedCaseBeads, ["open"]);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("hq-1");
  });

  it("should return all beads when all statuses are included", () => {
    const allStatuses: BeadStatus[] = ["open", "hooked", "in_progress", "blocked", "closed"];
    const result = filterByStatuses(beads, allStatuses);
    expect(result).toHaveLength(5);
  });
});

// ============================================================================
// excludePrefixes
// ============================================================================

describe("excludePrefixes", () => {
  const beads: BeadInfo[] = [
    makeBead({ id: "hq-abc", source: "town" }),
    makeBead({ id: "hq-def", source: "town" }),
    makeBead({ id: "gb-123", source: "gastown_boy" }),
    makeBead({ id: "adj-456", source: "adjutant" }),
  ];

  it("should return empty array for empty input", () => {
    expect(excludePrefixes([], ["hq-"])).toEqual([]);
  });

  it("should return all beads when no prefixes to exclude", () => {
    expect(excludePrefixes(beads, [])).toEqual(beads);
  });

  it("should exclude beads with a single prefix", () => {
    const result = excludePrefixes(beads, ["hq-"]);
    expect(result).toHaveLength(2);
    expect(result.map((b) => b.id)).toEqual(["gb-123", "adj-456"]);
  });

  it("should exclude beads with multiple prefixes", () => {
    const result = excludePrefixes(beads, ["hq-", "gb-"]);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("adj-456");
  });

  it("should keep all beads when prefix matches nothing", () => {
    const result = excludePrefixes(beads, ["zzz-"]);
    expect(result).toHaveLength(4);
  });
});

// ============================================================================
// filterByRig
// ============================================================================

describe("filterByRig", () => {
  const beads: BeadInfo[] = [
    makeBead({ id: "hq-1", rig: "gastown_boy" }),
    makeBead({ id: "hq-2", rig: "gastown_boy" }),
    makeBead({ id: "hq-3", rig: "adjutant" }),
    makeBead({ id: "hq-4", rig: null }),
  ];

  it("should return empty array for empty input", () => {
    expect(filterByRig([], "gastown_boy")).toEqual([]);
  });

  it("should filter beads by rig name", () => {
    const result = filterByRig(beads, "gastown_boy");
    expect(result).toHaveLength(2);
    expect(result.map((b) => b.id)).toEqual(["hq-1", "hq-2"]);
  });

  it("should return empty when no beads match rig", () => {
    const result = filterByRig(beads, "nonexistent_rig");
    expect(result).toEqual([]);
  });

  it("should not include beads with null rig", () => {
    const result = filterByRig(beads, "adjutant");
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("hq-3");
  });
});
