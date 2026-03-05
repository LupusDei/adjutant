/**
 * Tests for epic subtree graph filtering (adj-036.1).
 *
 * Verifies that getBeadsGraph() with epicId returns only the epic,
 * its parent (if any), and all descendant beads recursively,
 * plus only the edges between those filtered nodes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing service
vi.mock("../../src/services/bd-client.js", () => ({
  execBd: vi.fn(),
  resolveBeadsDir: vi.fn((dir: string) => `${dir}/.beads`),
  stripBeadPrefix: vi.fn((fullId: string) => {
    const match = fullId.match(/^[a-z0-9]{2,5}-(.+)$/i);
    return match?.[1] ?? fullId;
  }),
}));

vi.mock("../../src/services/workspace/index.js", () => ({
  resolveWorkspaceRoot: vi.fn(() => "/tmp/town"),
  listAllBeadsDirs: vi.fn(() => Promise.resolve([])),
  getDeploymentMode: vi.fn(() => "swarm"),
}));

import { execBd, type BeadsIssue } from "../../src/services/bd-client.js";
import { getBeadsGraph } from "../../src/services/beads/index.js";
import { filterGraphToEpicSubtree } from "../../src/services/beads/beads-dependency.js";

// =============================================================================
// Test Fixtures
// =============================================================================

function createBead(overrides: Partial<BeadsIssue> = {}): BeadsIssue {
  return {
    id: "hq-001",
    title: "Test Bead",
    description: "A test bead",
    status: "open",
    priority: 2,
    issue_type: "task",
    created_at: "2026-01-11T12:00:00Z",
    labels: [],
    ...overrides,
  };
}

// =============================================================================
// Unit Tests: filterGraphToEpicSubtree (pure function)
// =============================================================================

describe("filterGraphToEpicSubtree", () => {
  it("should return only the epic and its direct children", () => {
    const issues: BeadsIssue[] = [
      createBead({
        id: "adj-001",
        title: "Root Epic",
        issue_type: "epic",
        dependencies: [
          { issue_id: "adj-001", depends_on_id: "adj-002", type: "parent" },
          { issue_id: "adj-001", depends_on_id: "adj-003", type: "parent" },
        ],
      }),
      createBead({ id: "adj-002", title: "Task A", issue_type: "task" }),
      createBead({ id: "adj-003", title: "Task B", issue_type: "task" }),
      createBead({ id: "adj-099", title: "Unrelated Task", issue_type: "task" }),
    ];

    const filtered = filterGraphToEpicSubtree(issues, "adj-001");

    expect(filtered.map((i) => i.id).sort()).toEqual(["adj-001", "adj-002", "adj-003"]);
  });

  it("should include the parent of the epic", () => {
    const issues: BeadsIssue[] = [
      createBead({
        id: "adj-000",
        title: "Parent Epic",
        issue_type: "epic",
        dependencies: [
          { issue_id: "adj-000", depends_on_id: "adj-001", type: "parent" },
        ],
      }),
      createBead({
        id: "adj-001",
        title: "Target Epic",
        issue_type: "epic",
        dependencies: [
          { issue_id: "adj-001", depends_on_id: "adj-002", type: "parent" },
        ],
      }),
      createBead({ id: "adj-002", title: "Child Task", issue_type: "task" }),
      createBead({ id: "adj-099", title: "Unrelated", issue_type: "task" }),
    ];

    const filtered = filterGraphToEpicSubtree(issues, "adj-001");

    const ids = filtered.map((i) => i.id).sort();
    expect(ids).toEqual(["adj-000", "adj-001", "adj-002"]);
  });

  it("should recursively include deeply nested descendants", () => {
    const issues: BeadsIssue[] = [
      createBead({
        id: "adj-001",
        title: "Root Epic",
        issue_type: "epic",
        dependencies: [
          { issue_id: "adj-001", depends_on_id: "adj-002", type: "parent" },
        ],
      }),
      createBead({
        id: "adj-002",
        title: "Sub-Epic",
        issue_type: "epic",
        dependencies: [
          { issue_id: "adj-002", depends_on_id: "adj-003", type: "parent" },
        ],
      }),
      createBead({
        id: "adj-003",
        title: "Sub-Sub-Task",
        issue_type: "task",
        dependencies: [
          { issue_id: "adj-003", depends_on_id: "adj-004", type: "parent" },
        ],
      }),
      createBead({ id: "adj-004", title: "Leaf Task", issue_type: "task" }),
      createBead({ id: "adj-099", title: "Unrelated", issue_type: "task" }),
    ];

    const filtered = filterGraphToEpicSubtree(issues, "adj-001");

    const ids = filtered.map((i) => i.id).sort();
    expect(ids).toEqual(["adj-001", "adj-002", "adj-003", "adj-004"]);
  });

  it("should return only the epic itself when it has no children and no parent", () => {
    const issues: BeadsIssue[] = [
      createBead({ id: "adj-001", title: "Lonely Epic", issue_type: "epic" }),
      createBead({ id: "adj-099", title: "Unrelated", issue_type: "task" }),
    ];

    const filtered = filterGraphToEpicSubtree(issues, "adj-001");

    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.id).toBe("adj-001");
  });

  it("should return empty array when epicId is not found in issues", () => {
    const issues: BeadsIssue[] = [
      createBead({ id: "adj-099", title: "Some Task", issue_type: "task" }),
    ];

    const filtered = filterGraphToEpicSubtree(issues, "adj-nonexistent");

    expect(filtered).toEqual([]);
  });

  it("should handle circular dependencies without infinite loop", () => {
    const issues: BeadsIssue[] = [
      createBead({
        id: "adj-001",
        title: "Epic A",
        issue_type: "epic",
        dependencies: [
          { issue_id: "adj-001", depends_on_id: "adj-002", type: "parent" },
        ],
      }),
      createBead({
        id: "adj-002",
        title: "Epic B",
        issue_type: "epic",
        dependencies: [
          { issue_id: "adj-002", depends_on_id: "adj-001", type: "parent" },
        ],
      }),
    ];

    // Should not hang and should return both
    const filtered = filterGraphToEpicSubtree(issues, "adj-001");

    const ids = filtered.map((i) => i.id).sort();
    expect(ids).toEqual(["adj-001", "adj-002"]);
  });

  it("should include multiple parents if multiple beads depend on the epic", () => {
    const issues: BeadsIssue[] = [
      createBead({
        id: "adj-000",
        title: "Parent A",
        issue_type: "epic",
        dependencies: [
          { issue_id: "adj-000", depends_on_id: "adj-001", type: "parent" },
        ],
      }),
      createBead({
        id: "adj-010",
        title: "Parent B",
        issue_type: "epic",
        dependencies: [
          { issue_id: "adj-010", depends_on_id: "adj-001", type: "parent" },
        ],
      }),
      createBead({
        id: "adj-001",
        title: "Target Epic",
        issue_type: "epic",
        dependencies: [
          { issue_id: "adj-001", depends_on_id: "adj-002", type: "parent" },
        ],
      }),
      createBead({ id: "adj-002", title: "Child", issue_type: "task" }),
    ];

    const filtered = filterGraphToEpicSubtree(issues, "adj-001");

    const ids = filtered.map((i) => i.id).sort();
    // Both parents should be included
    expect(ids).toEqual(["adj-000", "adj-001", "adj-002", "adj-010"]);
  });

  // =========================================================================
  // QA Edge Cases (adj-036.4)
  // =========================================================================

  it("should handle epic with exactly one child", () => {
    const issues: BeadsIssue[] = [
      createBead({
        id: "adj-001",
        title: "Single Child Epic",
        issue_type: "epic",
        dependencies: [
          { issue_id: "adj-001", depends_on_id: "adj-002", type: "parent" },
        ],
      }),
      createBead({ id: "adj-002", title: "Only Child", issue_type: "task" }),
      createBead({ id: "adj-099", title: "Unrelated", issue_type: "task" }),
    ];

    const filtered = filterGraphToEpicSubtree(issues, "adj-001");

    expect(filtered).toHaveLength(2);
    expect(filtered.map((i) => i.id).sort()).toEqual(["adj-001", "adj-002"]);
  });

  it("should handle very deeply nested hierarchy (5+ levels)", () => {
    const issues: BeadsIssue[] = [
      createBead({
        id: "adj-001",
        title: "Level 0",
        issue_type: "epic",
        dependencies: [
          { issue_id: "adj-001", depends_on_id: "adj-002", type: "parent" },
        ],
      }),
      createBead({
        id: "adj-002",
        title: "Level 1",
        issue_type: "epic",
        dependencies: [
          { issue_id: "adj-002", depends_on_id: "adj-003", type: "parent" },
        ],
      }),
      createBead({
        id: "adj-003",
        title: "Level 2",
        issue_type: "epic",
        dependencies: [
          { issue_id: "adj-003", depends_on_id: "adj-004", type: "parent" },
        ],
      }),
      createBead({
        id: "adj-004",
        title: "Level 3",
        issue_type: "epic",
        dependencies: [
          { issue_id: "adj-004", depends_on_id: "adj-005", type: "parent" },
        ],
      }),
      createBead({
        id: "adj-005",
        title: "Level 4",
        issue_type: "task",
        dependencies: [
          { issue_id: "adj-005", depends_on_id: "adj-006", type: "parent" },
        ],
      }),
      createBead({ id: "adj-006", title: "Level 5 Leaf", issue_type: "task" }),
      createBead({ id: "adj-099", title: "Unrelated", issue_type: "task" }),
    ];

    const filtered = filterGraphToEpicSubtree(issues, "adj-001");

    expect(filtered).toHaveLength(6);
    const ids = filtered.map((i) => i.id).sort();
    expect(ids).toEqual(["adj-001", "adj-002", "adj-003", "adj-004", "adj-005", "adj-006"]);
  });

  it("should handle 3-way circular dependencies without infinite loop", () => {
    const issues: BeadsIssue[] = [
      createBead({
        id: "adj-001",
        title: "A",
        issue_type: "epic",
        dependencies: [
          { issue_id: "adj-001", depends_on_id: "adj-002", type: "parent" },
        ],
      }),
      createBead({
        id: "adj-002",
        title: "B",
        issue_type: "epic",
        dependencies: [
          { issue_id: "adj-002", depends_on_id: "adj-003", type: "parent" },
        ],
      }),
      createBead({
        id: "adj-003",
        title: "C",
        issue_type: "epic",
        dependencies: [
          { issue_id: "adj-003", depends_on_id: "adj-001", type: "parent" },
        ],
      }),
    ];

    // Must not hang, and should include all 3
    const filtered = filterGraphToEpicSubtree(issues, "adj-001");

    const ids = filtered.map((i) => i.id).sort();
    expect(ids).toEqual(["adj-001", "adj-002", "adj-003"]);
  });

  it("should handle large graph (50+ nodes) without performance issues", () => {
    const issues: BeadsIssue[] = [];
    // Create a root epic with 50 children
    const childDeps = [];
    for (let i = 1; i <= 50; i++) {
      const childId = `adj-${String(i).padStart(3, "0")}`;
      childDeps.push({ issue_id: "adj-root", depends_on_id: childId, type: "parent" });
      issues.push(createBead({ id: childId, title: `Task ${i}`, issue_type: "task" }));
    }
    issues.push(createBead({
      id: "adj-root",
      title: "Root Epic",
      issue_type: "epic",
      dependencies: childDeps,
    }));
    // Add some unrelated beads
    for (let i = 100; i < 120; i++) {
      issues.push(createBead({ id: `adj-${i}`, title: `Unrelated ${i}`, issue_type: "task" }));
    }

    const startTime = Date.now();
    const filtered = filterGraphToEpicSubtree(issues, "adj-root");
    const elapsed = Date.now() - startTime;

    expect(filtered).toHaveLength(51); // root + 50 children
    expect(elapsed).toBeLessThan(100); // Should complete in under 100ms
  });

  it("should handle mixed status nodes (open, in_progress, closed together)", () => {
    const issues: BeadsIssue[] = [
      createBead({
        id: "adj-001",
        title: "Mixed Epic",
        issue_type: "epic",
        status: "in_progress",
        dependencies: [
          { issue_id: "adj-001", depends_on_id: "adj-002", type: "parent" },
          { issue_id: "adj-001", depends_on_id: "adj-003", type: "parent" },
          { issue_id: "adj-001", depends_on_id: "adj-004", type: "parent" },
        ],
      }),
      createBead({ id: "adj-002", title: "Open Task", issue_type: "task", status: "open" }),
      createBead({ id: "adj-003", title: "In Progress Task", issue_type: "task", status: "in_progress" }),
      createBead({ id: "adj-004", title: "Closed Task", issue_type: "task", status: "closed" }),
    ];

    const filtered = filterGraphToEpicSubtree(issues, "adj-001");

    // All statuses should be included - filtering is by subtree, not status
    expect(filtered).toHaveLength(4);
    const statuses = filtered.map((i) => i.status).sort();
    expect(statuses).toEqual(["closed", "in_progress", "in_progress", "open"]);
  });

  it("should work when epicId targets a non-epic type (task)", () => {
    const issues: BeadsIssue[] = [
      createBead({
        id: "adj-001",
        title: "A Task Being Queried",
        issue_type: "task",
        dependencies: [
          { issue_id: "adj-001", depends_on_id: "adj-002", type: "parent" },
        ],
      }),
      createBead({ id: "adj-002", title: "Sub-Task", issue_type: "task" }),
      createBead({ id: "adj-099", title: "Unrelated", issue_type: "task" }),
    ];

    // Should still work - it filters by ID, not by type
    const filtered = filterGraphToEpicSubtree(issues, "adj-001");

    expect(filtered).toHaveLength(2);
    expect(filtered.map((i) => i.id).sort()).toEqual(["adj-001", "adj-002"]);
  });

  it("should handle empty issues array", () => {
    const filtered = filterGraphToEpicSubtree([], "adj-001");
    expect(filtered).toEqual([]);
  });

  it("should handle dependencies pointing to non-existent beads", () => {
    const issues: BeadsIssue[] = [
      createBead({
        id: "adj-001",
        title: "Epic with phantom deps",
        issue_type: "epic",
        dependencies: [
          { issue_id: "adj-001", depends_on_id: "adj-phantom", type: "parent" },
          { issue_id: "adj-001", depends_on_id: "adj-002", type: "parent" },
        ],
      }),
      createBead({ id: "adj-002", title: "Real Child", issue_type: "task" }),
    ];

    const filtered = filterGraphToEpicSubtree(issues, "adj-001");

    // Should include only the epic and the real child, not the phantom
    expect(filtered).toHaveLength(2);
    expect(filtered.map((i) => i.id).sort()).toEqual(["adj-001", "adj-002"]);
  });

  it("should not include parent's other children (siblings of the epic)", () => {
    const issues: BeadsIssue[] = [
      createBead({
        id: "adj-000",
        title: "Grand Parent",
        issue_type: "epic",
        dependencies: [
          { issue_id: "adj-000", depends_on_id: "adj-001", type: "parent" },
          { issue_id: "adj-000", depends_on_id: "adj-sibling", type: "parent" },
        ],
      }),
      createBead({
        id: "adj-001",
        title: "Target Epic",
        issue_type: "epic",
        dependencies: [
          { issue_id: "adj-001", depends_on_id: "adj-002", type: "parent" },
        ],
      }),
      createBead({ id: "adj-002", title: "Child", issue_type: "task" }),
      createBead({ id: "adj-sibling", title: "Sibling Epic", issue_type: "epic" }),
    ];

    const filtered = filterGraphToEpicSubtree(issues, "adj-001");

    const ids = filtered.map((i) => i.id).sort();
    // Parent is included, but parent's other children (sibling) are NOT
    expect(ids).toEqual(["adj-000", "adj-001", "adj-002"]);
  });
});

// =============================================================================
// Integration Tests: getBeadsGraph with epicId filter
// =============================================================================

describe("getBeadsGraph with epicId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return only subtree nodes and edges when epicId is provided", async () => {
    vi.mocked(execBd).mockResolvedValue({
      success: true,
      data: [
        createBead({
          id: "adj-001",
          title: "Root Epic",
          issue_type: "epic",
          dependencies: [
            { issue_id: "adj-001", depends_on_id: "adj-002", type: "parent" },
            { issue_id: "adj-001", depends_on_id: "adj-003", type: "parent" },
          ],
        }),
        createBead({ id: "adj-002", title: "Task A", issue_type: "task" }),
        createBead({ id: "adj-003", title: "Task B", issue_type: "task" }),
        createBead({
          id: "adj-099",
          title: "Unrelated Epic",
          issue_type: "epic",
          dependencies: [
            { issue_id: "adj-099", depends_on_id: "adj-100", type: "parent" },
          ],
        }),
        createBead({ id: "adj-100", title: "Unrelated Task", issue_type: "task" }),
      ],
      exitCode: 0,
    });

    const result = await getBeadsGraph({ epicId: "adj-001" });

    expect(result.success).toBe(true);
    expect(result.data!.nodes).toHaveLength(3);
    expect(result.data!.nodes.map((n) => n.id).sort()).toEqual([
      "adj-001",
      "adj-002",
      "adj-003",
    ]);
    // Only edges within the subtree
    expect(result.data!.edges).toHaveLength(2);
    expect(result.data!.edges).toEqual(
      expect.arrayContaining([
        { issueId: "adj-001", dependsOnId: "adj-002", type: "parent" },
        { issueId: "adj-001", dependsOnId: "adj-003", type: "parent" },
      ])
    );
  });

  it("should return all nodes when epicId is NOT provided (existing behavior)", async () => {
    vi.mocked(execBd).mockResolvedValue({
      success: true,
      data: [
        createBead({ id: "adj-001", title: "Epic", issue_type: "epic" }),
        createBead({ id: "adj-002", title: "Task", issue_type: "task" }),
        createBead({ id: "adj-099", title: "Other", issue_type: "task" }),
      ],
      exitCode: 0,
    });

    const result = await getBeadsGraph();

    expect(result.success).toBe(true);
    expect(result.data!.nodes).toHaveLength(3);
  });

  it("should include parent and deeply nested children with epicId", async () => {
    vi.mocked(execBd).mockResolvedValue({
      success: true,
      data: [
        createBead({
          id: "adj-000",
          title: "Grand Parent",
          issue_type: "epic",
          dependencies: [
            { issue_id: "adj-000", depends_on_id: "adj-001", type: "parent" },
          ],
        }),
        createBead({
          id: "adj-001",
          title: "Target Epic",
          issue_type: "epic",
          dependencies: [
            { issue_id: "adj-001", depends_on_id: "adj-002", type: "parent" },
          ],
        }),
        createBead({
          id: "adj-002",
          title: "Sub-Epic",
          issue_type: "epic",
          dependencies: [
            { issue_id: "adj-002", depends_on_id: "adj-003", type: "parent" },
          ],
        }),
        createBead({ id: "adj-003", title: "Leaf Task", issue_type: "task" }),
        createBead({ id: "adj-099", title: "Unrelated", issue_type: "task" }),
      ],
      exitCode: 0,
    });

    const result = await getBeadsGraph({ epicId: "adj-001" });

    expect(result.success).toBe(true);
    const ids = result.data!.nodes.map((n) => n.id).sort();
    // Parent (adj-000), target (adj-001), child (adj-002), grandchild (adj-003)
    expect(ids).toEqual(["adj-000", "adj-001", "adj-002", "adj-003"]);
    // Edges: adj-000->adj-001, adj-001->adj-002, adj-002->adj-003
    expect(result.data!.edges).toHaveLength(3);
  });

  it("should return empty graph when epicId does not exist in data", async () => {
    vi.mocked(execBd).mockResolvedValue({
      success: true,
      data: [
        createBead({ id: "adj-001", title: "Some Task" }),
      ],
      exitCode: 0,
    });

    const result = await getBeadsGraph({ epicId: "adj-nonexistent" });

    expect(result.success).toBe(true);
    expect(result.data!.nodes).toEqual([]);
    expect(result.data!.edges).toEqual([]);
  });

  it("should return just the epic when it has no children or parent", async () => {
    vi.mocked(execBd).mockResolvedValue({
      success: true,
      data: [
        createBead({ id: "adj-001", title: "Lonely Epic", issue_type: "epic" }),
        createBead({ id: "adj-099", title: "Unrelated", issue_type: "task" }),
      ],
      exitCode: 0,
    });

    const result = await getBeadsGraph({ epicId: "adj-001" });

    expect(result.success).toBe(true);
    expect(result.data!.nodes).toHaveLength(1);
    expect(result.data!.nodes[0]!.id).toBe("adj-001");
    expect(result.data!.edges).toEqual([]);
  });
});
