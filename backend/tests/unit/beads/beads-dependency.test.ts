import { describe, it, expect } from "vitest";

import type {
  BeadsIssue,
  GraphDependency,
  GraphNode,
  BeadInfo,
  EpicProgress,
  EpicWithChildren,
} from "../../../src/services/beads/types.js";

import {
  extractGraphEdges,
  buildGraphNodes,
  processEpicChildren,
  computeEpicProgressFromDeps,
  buildEpicWithChildren,
  transformClosedEpics,
} from "../../../src/services/beads/beads-dependency.js";

// ============================================================================
// Test Fixtures
// ============================================================================

/** Helper to create a minimal BeadsIssue for testing. */
function makeIssue(overrides: Partial<BeadsIssue> = {}): BeadsIssue {
  return {
    id: "hq-test1",
    title: "Test Issue",
    description: "A test issue",
    status: "open",
    priority: 1,
    issue_type: "task",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Helper to create a minimal BeadInfo for testing. */
function makeBeadInfo(overrides: Partial<BeadInfo> = {}): BeadInfo {
  return {
    id: "hq-test1",
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
// extractGraphEdges
// ============================================================================

describe("extractGraphEdges", () => {
  it("should return empty array for empty input", () => {
    const result = extractGraphEdges([]);
    expect(result).toEqual([]);
  });

  it("should return empty array for issues with no dependencies", () => {
    const issues: BeadsIssue[] = [
      makeIssue({ id: "hq-a1" }),
      makeIssue({ id: "hq-a2" }),
    ];
    const result = extractGraphEdges(issues);
    expect(result).toEqual([]);
  });

  it("should extract edges from issue dependencies", () => {
    const issues: BeadsIssue[] = [
      makeIssue({
        id: "hq-a1",
        dependencies: [
          { issue_id: "hq-a1", depends_on_id: "hq-a2", type: "depends_on" },
        ],
      }),
    ];
    const result = extractGraphEdges(issues);
    expect(result).toEqual([
      { issueId: "hq-a1", dependsOnId: "hq-a2", type: "depends_on" },
    ]);
  });

  it("should deduplicate identical edges across issues", () => {
    const issues: BeadsIssue[] = [
      makeIssue({
        id: "hq-a1",
        dependencies: [
          { issue_id: "hq-a1", depends_on_id: "hq-a2", type: "depends_on" },
        ],
      }),
      makeIssue({
        id: "hq-a2",
        dependencies: [
          { issue_id: "hq-a1", depends_on_id: "hq-a2", type: "depends_on" },
        ],
      }),
    ];
    const result = extractGraphEdges(issues);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      issueId: "hq-a1",
      dependsOnId: "hq-a2",
      type: "depends_on",
    });
  });

  it("should keep different directional edges (A->B and B->A)", () => {
    const issues: BeadsIssue[] = [
      makeIssue({
        id: "hq-a1",
        dependencies: [
          { issue_id: "hq-a1", depends_on_id: "hq-a2", type: "depends_on" },
          { issue_id: "hq-a2", depends_on_id: "hq-a1", type: "depends_on" },
        ],
      }),
    ];
    const result = extractGraphEdges(issues);
    expect(result).toHaveLength(2);
  });

  it("should handle multiple dependencies per issue", () => {
    const issues: BeadsIssue[] = [
      makeIssue({
        id: "hq-ep1",
        dependencies: [
          { issue_id: "hq-ep1", depends_on_id: "hq-t1", type: "depends_on" },
          { issue_id: "hq-ep1", depends_on_id: "hq-t2", type: "depends_on" },
          { issue_id: "hq-ep1", depends_on_id: "hq-t3", type: "depends_on" },
        ],
      }),
    ];
    const result = extractGraphEdges(issues);
    expect(result).toHaveLength(3);
  });

  it("should skip issues with undefined dependencies", () => {
    const issues: BeadsIssue[] = [
      makeIssue({ id: "hq-a1" }), // no dependencies field
      makeIssue({
        id: "hq-a2",
        dependencies: [
          { issue_id: "hq-a2", depends_on_id: "hq-a3", type: "depends_on" },
        ],
      }),
    ];
    const result = extractGraphEdges(issues);
    expect(result).toHaveLength(1);
  });
});

// ============================================================================
// buildGraphNodes
// ============================================================================

describe("buildGraphNodes", () => {
  it("should return empty array for empty input", () => {
    const result = buildGraphNodes([], () => "town");
    expect(result).toEqual([]);
  });

  it("should map issue fields to graph node fields", () => {
    const issues: BeadsIssue[] = [
      makeIssue({
        id: "hq-abc1",
        title: "My Task",
        status: "in_progress",
        issue_type: "task",
        priority: 2,
        assignee: "agent-1",
      }),
    ];
    const result = buildGraphNodes(issues, () => "town");
    expect(result).toEqual([
      {
        id: "hq-abc1",
        title: "My Task",
        status: "in_progress",
        type: "task",
        priority: 2,
        assignee: "agent-1",
        source: "town",
      },
    ]);
  });

  it("should use prefixToSourceFn to determine source", () => {
    const issues: BeadsIssue[] = [
      makeIssue({ id: "hq-abc" }),
      makeIssue({ id: "adj-xyz" }),
    ];
    const prefixFn = (beadId: string) =>
      beadId.startsWith("hq-") ? "town" : "adjutant";
    const result = buildGraphNodes(issues, prefixFn);
    expect(result[0]!.source).toBe("town");
    expect(result[1]!.source).toBe("adjutant");
  });

  it("should handle null assignee", () => {
    const issues: BeadsIssue[] = [
      makeIssue({ id: "hq-a1", assignee: null }),
      makeIssue({ id: "hq-a2" }), // assignee undefined
    ];
    const result = buildGraphNodes(issues, () => "town");
    expect(result[0]!.assignee).toBeNull();
    expect(result[1]!.assignee).toBeNull();
  });

  it("should preserve all issues in output order", () => {
    const issues: BeadsIssue[] = [
      makeIssue({ id: "hq-z" }),
      makeIssue({ id: "hq-a" }),
      makeIssue({ id: "hq-m" }),
    ];
    const result = buildGraphNodes(issues, () => "town");
    expect(result.map((n) => n.id)).toEqual(["hq-z", "hq-a", "hq-m"]);
  });
});

// ============================================================================
// processEpicChildren
// ============================================================================

describe("processEpicChildren", () => {
  const identityTransform = (issue: BeadsIssue, source: string): BeadInfo => ({
    id: issue.id,
    title: issue.title,
    status: issue.status,
    priority: issue.priority,
    type: issue.issue_type,
    assignee: issue.assignee ?? null,
    rig: null,
    source,
    labels: issue.labels ?? [],
    createdAt: issue.created_at,
    updatedAt: issue.updated_at ?? null,
  });

  it("should return empty array for empty input", () => {
    const result = processEpicChildren([], "town", identityTransform);
    expect(result).toEqual([]);
  });

  it("should filter out wisps (wisp=true)", () => {
    const issues: BeadsIssue[] = [
      makeIssue({ id: "hq-t1", wisp: false }),
      makeIssue({ id: "hq-w1", wisp: true }),
    ];
    const result = processEpicChildren(issues, "town", identityTransform);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("hq-t1");
  });

  it("should filter out wisps by id pattern (-wisp-)", () => {
    const issues: BeadsIssue[] = [
      makeIssue({ id: "hq-t1" }),
      makeIssue({ id: "hq-wisp-abc" }),
    ];
    const result = processEpicChildren(issues, "town", identityTransform);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("hq-t1");
  });

  it("should sort by priority first (ascending)", () => {
    const issues: BeadsIssue[] = [
      makeIssue({ id: "hq-low", priority: 3, created_at: "2026-01-01" }),
      makeIssue({ id: "hq-high", priority: 0, created_at: "2026-01-01" }),
      makeIssue({ id: "hq-mid", priority: 1, created_at: "2026-01-01" }),
    ];
    const result = processEpicChildren(issues, "town", identityTransform);
    expect(result.map((b) => b.id)).toEqual(["hq-high", "hq-mid", "hq-low"]);
  });

  it("should sort by date descending when priorities are equal", () => {
    const issues: BeadsIssue[] = [
      makeIssue({
        id: "hq-old",
        priority: 1,
        created_at: "2026-01-01",
        updated_at: "2026-01-05",
      }),
      makeIssue({
        id: "hq-new",
        priority: 1,
        created_at: "2026-01-01",
        updated_at: "2026-01-10",
      }),
    ];
    const result = processEpicChildren(issues, "town", identityTransform);
    // Newer date first
    expect(result[0]!.id).toBe("hq-new");
    expect(result[1]!.id).toBe("hq-old");
  });

  it("should use createdAt when updatedAt is null", () => {
    const issues: BeadsIssue[] = [
      makeIssue({
        id: "hq-older",
        priority: 1,
        created_at: "2026-01-01",
      }),
      makeIssue({
        id: "hq-newer",
        priority: 1,
        created_at: "2026-01-10",
      }),
    ];
    const result = processEpicChildren(issues, "town", identityTransform);
    expect(result[0]!.id).toBe("hq-newer");
    expect(result[1]!.id).toBe("hq-older");
  });

  it("should pass source to the transform function", () => {
    const issues: BeadsIssue[] = [makeIssue({ id: "adj-t1" })];
    const result = processEpicChildren(issues, "adjutant", identityTransform);
    expect(result[0]!.source).toBe("adjutant");
  });
});

// ============================================================================
// computeEpicProgressFromDeps
// ============================================================================

describe("computeEpicProgressFromDeps", () => {
  it("should return zero progress for epic with no dependencies", () => {
    const epic = makeIssue({ id: "hq-ep1", title: "Epic 1" });
    const deps: Array<{ issue_id: string; depends_on_id: string; type: string }> = [];
    const statusMap = new Map<string, string>();

    const result = computeEpicProgressFromDeps(epic, deps, statusMap);
    expect(result).toEqual({
      id: "hq-ep1",
      title: "Epic 1",
      status: "open",
      totalChildren: 0,
      closedChildren: 0,
      completionPercent: 0,
      assignee: null,
    });
  });

  it("should compute correct progress for partially completed epic", () => {
    const epic = makeIssue({ id: "hq-ep1", title: "Epic" });
    const deps = [
      { issue_id: "hq-ep1", depends_on_id: "hq-t1", type: "depends_on" },
      { issue_id: "hq-ep1", depends_on_id: "hq-t2", type: "depends_on" },
      { issue_id: "hq-ep1", depends_on_id: "hq-t3", type: "depends_on" },
      { issue_id: "hq-ep1", depends_on_id: "hq-t4", type: "depends_on" },
    ];
    const statusMap = new Map([
      ["hq-t1", "closed"],
      ["hq-t2", "open"],
      ["hq-t3", "closed"],
      ["hq-t4", "in_progress"],
    ]);

    const result = computeEpicProgressFromDeps(epic, deps, statusMap);
    expect(result.totalChildren).toBe(4);
    expect(result.closedChildren).toBe(2);
    expect(result.completionPercent).toBe(0.5);
  });

  it("should return 100% progress when all children closed", () => {
    const epic = makeIssue({ id: "hq-ep1" });
    const deps = [
      { issue_id: "hq-ep1", depends_on_id: "hq-t1", type: "depends_on" },
      { issue_id: "hq-ep1", depends_on_id: "hq-t2", type: "depends_on" },
    ];
    const statusMap = new Map([
      ["hq-t1", "closed"],
      ["hq-t2", "closed"],
    ]);

    const result = computeEpicProgressFromDeps(epic, deps, statusMap);
    expect(result.completionPercent).toBe(1);
    expect(result.closedChildren).toBe(2);
  });

  it("should only count deps where issue_id matches the epic", () => {
    const epic = makeIssue({ id: "hq-ep1" });
    const deps = [
      { issue_id: "hq-ep1", depends_on_id: "hq-t1", type: "depends_on" },
      { issue_id: "hq-ep2", depends_on_id: "hq-t2", type: "depends_on" }, // different epic
    ];
    const statusMap = new Map([
      ["hq-t1", "closed"],
      ["hq-t2", "closed"],
    ]);

    const result = computeEpicProgressFromDeps(epic, deps, statusMap);
    expect(result.totalChildren).toBe(1);
    expect(result.closedChildren).toBe(1);
  });

  it("should handle assignee field", () => {
    const epic = makeIssue({ id: "hq-ep1", assignee: "agent-1" });
    const result = computeEpicProgressFromDeps(epic, [], new Map());
    expect(result.assignee).toBe("agent-1");
  });

  it("should handle null assignee", () => {
    const epic = makeIssue({ id: "hq-ep1", assignee: null });
    const result = computeEpicProgressFromDeps(epic, [], new Map());
    expect(result.assignee).toBeNull();
  });

  it("should handle undefined assignee as null", () => {
    const epic = makeIssue({ id: "hq-ep1" }); // assignee not set = undefined
    const result = computeEpicProgressFromDeps(epic, [], new Map());
    expect(result.assignee).toBeNull();
  });
});

// ============================================================================
// buildEpicWithChildren
// ============================================================================

describe("buildEpicWithChildren", () => {
  it("should return zero progress for epic with no dependencies", () => {
    const epicInfo = makeBeadInfo({ id: "hq-ep1" });
    const detail = makeIssue({ id: "hq-ep1" });

    const result = buildEpicWithChildren(epicInfo, detail);
    expect(result).toEqual({
      epic: epicInfo,
      children: [],
      totalCount: 0,
      closedCount: 0,
      progress: 0,
    });
  });

  it("should compute progress from dependency status field", () => {
    const epicInfo = makeBeadInfo({ id: "hq-ep1" });
    const detail = makeIssue({
      id: "hq-ep1",
      dependencies: [
        { issue_id: "hq-ep1", depends_on_id: "hq-t1", type: "depends_on" },
        { issue_id: "hq-ep1", depends_on_id: "hq-t2", type: "depends_on" },
        { issue_id: "hq-ep1", depends_on_id: "hq-t3", type: "depends_on" },
      ],
    });
    // Simulate bd show output where dep objects have status field
    // Cast is needed because BeadsIssue dependency type doesn't include status
    const deps = detail.dependencies!;
    (deps[0] as Record<string, unknown>)["status"] = "closed";
    (deps[1] as Record<string, unknown>)["status"] = "open";
    (deps[2] as Record<string, unknown>)["status"] = "closed";

    const result = buildEpicWithChildren(epicInfo, detail);
    expect(result.totalCount).toBe(3);
    expect(result.closedCount).toBe(2);
    expect(result.progress).toBeCloseTo(2 / 3);
  });

  it("should only count deps where issue_id matches the epic", () => {
    const epicInfo = makeBeadInfo({ id: "hq-ep1" });
    const detail = makeIssue({
      id: "hq-ep1",
      dependencies: [
        { issue_id: "hq-ep1", depends_on_id: "hq-t1", type: "depends_on" },
        { issue_id: "hq-other", depends_on_id: "hq-t2", type: "depends_on" },
      ],
    });
    const deps = detail.dependencies!;
    (deps[0] as Record<string, unknown>)["status"] = "closed";
    (deps[1] as Record<string, unknown>)["status"] = "closed";

    const result = buildEpicWithChildren(epicInfo, detail);
    expect(result.totalCount).toBe(1);
    expect(result.closedCount).toBe(1);
    expect(result.progress).toBe(1);
  });

  it("should return empty children array", () => {
    const epicInfo = makeBeadInfo({ id: "hq-ep1" });
    const detail = makeIssue({ id: "hq-ep1" });

    const result = buildEpicWithChildren(epicInfo, detail);
    expect(result.children).toEqual([]);
  });

  it("should handle dependencies with no status field as not closed", () => {
    const epicInfo = makeBeadInfo({ id: "hq-ep1" });
    const detail = makeIssue({
      id: "hq-ep1",
      dependencies: [
        { issue_id: "hq-ep1", depends_on_id: "hq-t1", type: "depends_on" },
      ],
    });
    // No status field added to dep

    const result = buildEpicWithChildren(epicInfo, detail);
    expect(result.totalCount).toBe(1);
    expect(result.closedCount).toBe(0);
    expect(result.progress).toBe(0);
  });
});

// ============================================================================
// transformClosedEpics
// ============================================================================

describe("transformClosedEpics", () => {
  it("should return empty array for empty input", () => {
    const result = transformClosedEpics([]);
    expect(result).toEqual([]);
  });

  it("should filter out epics without closed_at", () => {
    const issues: BeadsIssue[] = [
      makeIssue({ id: "hq-ep1", closed_at: "2026-01-15T00:00:00Z" }),
      makeIssue({ id: "hq-ep2", closed_at: null }),
      makeIssue({ id: "hq-ep3" }), // no closed_at field
    ];
    const result = transformClosedEpics(issues);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("hq-ep1");
  });

  it("should sort by closed_at descending (most recent first)", () => {
    const issues: BeadsIssue[] = [
      makeIssue({ id: "hq-ep1", closed_at: "2026-01-10T00:00:00Z" }),
      makeIssue({ id: "hq-ep3", closed_at: "2026-01-20T00:00:00Z" }),
      makeIssue({ id: "hq-ep2", closed_at: "2026-01-15T00:00:00Z" }),
    ];
    const result = transformClosedEpics(issues);
    expect(result.map((e) => e.id)).toEqual(["hq-ep3", "hq-ep2", "hq-ep1"]);
  });

  it("should respect the limit parameter", () => {
    const issues: BeadsIssue[] = Array.from({ length: 10 }, (_, i) =>
      makeIssue({
        id: `hq-ep${i}`,
        closed_at: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      })
    );
    const result = transformClosedEpics(issues, 3);
    expect(result).toHaveLength(3);
  });

  it("should default limit to 5", () => {
    const issues: BeadsIssue[] = Array.from({ length: 10 }, (_, i) =>
      makeIssue({
        id: `hq-ep${i}`,
        closed_at: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      })
    );
    const result = transformClosedEpics(issues);
    expect(result).toHaveLength(5);
  });

  it("should set completionPercent to 1.0 for all closed epics", () => {
    const issues: BeadsIssue[] = [
      makeIssue({ id: "hq-ep1", closed_at: "2026-01-15T00:00:00Z" }),
    ];
    const result = transformClosedEpics(issues);
    expect(result[0]!.completionPercent).toBe(1.0);
  });

  it("should set totalChildren and closedChildren to 0", () => {
    const issues: BeadsIssue[] = [
      makeIssue({ id: "hq-ep1", closed_at: "2026-01-15T00:00:00Z" }),
    ];
    const result = transformClosedEpics(issues);
    expect(result[0]!.totalChildren).toBe(0);
    expect(result[0]!.closedChildren).toBe(0);
  });

  it("should map assignee correctly (null when not set)", () => {
    const issues: BeadsIssue[] = [
      makeIssue({
        id: "hq-ep1",
        closed_at: "2026-01-15T00:00:00Z",
        assignee: "agent-1",
      }),
      makeIssue({
        id: "hq-ep2",
        closed_at: "2026-01-16T00:00:00Z",
        assignee: null,
      }),
    ];
    const result = transformClosedEpics(issues);
    expect(result[0]!.assignee).toBeNull();  // ep2 is first (more recent)
    expect(result[1]!.assignee).toBe("agent-1");
  });

  it("should produce valid EpicProgress objects", () => {
    const issues: BeadsIssue[] = [
      makeIssue({
        id: "hq-ep1",
        title: "Done Epic",
        status: "closed",
        closed_at: "2026-01-15T00:00:00Z",
        assignee: "worker",
      }),
    ];
    const result = transformClosedEpics(issues);
    expect(result[0]).toEqual({
      id: "hq-ep1",
      title: "Done Epic",
      status: "closed",
      totalChildren: 0,
      closedChildren: 0,
      completionPercent: 1.0,
      assignee: "worker",
    });
  });
});
