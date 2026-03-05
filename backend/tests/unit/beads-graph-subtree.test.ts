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
