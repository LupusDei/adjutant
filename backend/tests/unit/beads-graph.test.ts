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
  getDeploymentMode: vi.fn(() => "gastown"),
}));

import { execBd, type BeadsIssue } from "../../src/services/bd-client.js";
import { listAllBeadsDirs } from "../../src/services/workspace/index.js";
import { getBeadsGraph } from "../../src/services/beads-service.js";

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
// Tests
// =============================================================================

describe("getBeadsGraph", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return nodes array with bead info", async () => {
    vi.mocked(execBd).mockResolvedValue({
      success: true,
      data: [
        createBead({ id: "hq-001", title: "Epic Task", status: "open", priority: 1, issue_type: "epic", assignee: "mayor/crew/alice" }),
        createBead({ id: "hq-002", title: "Sub Task", status: "in_progress", priority: 2, issue_type: "task", assignee: null }),
      ],
      exitCode: 0,
    });

    const result = await getBeadsGraph();

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.nodes).toHaveLength(2);

    const node1 = result.data!.nodes[0];
    expect(node1).toEqual(expect.objectContaining({
      id: "hq-001",
      title: "Epic Task",
      status: "open",
      type: "epic",
      priority: 1,
      assignee: "mayor/crew/alice",
    }));

    const node2 = result.data!.nodes[1];
    expect(node2).toEqual(expect.objectContaining({
      id: "hq-002",
      title: "Sub Task",
      status: "in_progress",
      type: "task",
      priority: 2,
      assignee: null,
    }));
  });

  it("should extract edges from dependency data", async () => {
    vi.mocked(execBd).mockResolvedValue({
      success: true,
      data: [
        createBead({
          id: "hq-001",
          title: "Parent Epic",
          issue_type: "epic",
          dependencies: [
            { issue_id: "hq-001", depends_on_id: "hq-002", type: "parent" },
            { issue_id: "hq-001", depends_on_id: "hq-003", type: "parent" },
          ],
        }),
        createBead({ id: "hq-002", title: "Child Task 1", issue_type: "task" }),
        createBead({ id: "hq-003", title: "Child Task 2", issue_type: "task" }),
      ],
      exitCode: 0,
    });

    const result = await getBeadsGraph();

    expect(result.success).toBe(true);
    expect(result.data!.edges).toHaveLength(2);
    expect(result.data!.edges[0]).toEqual({
      issueId: "hq-001",
      dependsOnId: "hq-002",
      type: "parent",
    });
    expect(result.data!.edges[1]).toEqual({
      issueId: "hq-001",
      dependsOnId: "hq-003",
      type: "parent",
    });
  });

  it("should return empty nodes and edges for empty beads list", async () => {
    vi.mocked(execBd).mockResolvedValue({
      success: true,
      data: [],
      exitCode: 0,
    });

    const result = await getBeadsGraph();

    expect(result.success).toBe(true);
    expect(result.data!.nodes).toEqual([]);
    expect(result.data!.edges).toEqual([]);
  });

  it("should handle null data from bd (empty database)", async () => {
    vi.mocked(execBd).mockResolvedValue({
      success: true,
      data: null,
      exitCode: 0,
    });

    const result = await getBeadsGraph();

    expect(result.success).toBe(true);
    expect(result.data!.nodes).toEqual([]);
    expect(result.data!.edges).toEqual([]);
  });

  it("should handle beads with no dependencies", async () => {
    vi.mocked(execBd).mockResolvedValue({
      success: true,
      data: [
        createBead({ id: "hq-001", title: "Standalone Task 1" }),
        createBead({ id: "hq-002", title: "Standalone Task 2" }),
      ],
      exitCode: 0,
    });

    const result = await getBeadsGraph();

    expect(result.success).toBe(true);
    expect(result.data!.nodes).toHaveLength(2);
    expect(result.data!.edges).toEqual([]);
  });

  it("should handle beads with undefined dependencies field", async () => {
    const beadWithUndefinedDeps = createBead({ id: "hq-001" });
    // Explicitly remove dependencies to simulate missing field
    delete beadWithUndefinedDeps.dependencies;

    vi.mocked(execBd).mockResolvedValue({
      success: true,
      data: [beadWithUndefinedDeps],
      exitCode: 0,
    });

    const result = await getBeadsGraph();

    expect(result.success).toBe(true);
    expect(result.data!.nodes).toHaveLength(1);
    expect(result.data!.edges).toEqual([]);
  });

  it("should filter out wisps from graph nodes", async () => {
    vi.mocked(execBd).mockResolvedValue({
      success: true,
      data: [
        createBead({ id: "hq-001", title: "Real Task" }),
        createBead({ id: "hq-wisp-002", title: "Wisp Task" }),
        createBead({ id: "hq-003", title: "Another Real Task", wisp: true }),
      ],
      exitCode: 0,
    });

    const result = await getBeadsGraph();

    expect(result.success).toBe(true);
    expect(result.data!.nodes).toHaveLength(1);
    expect(result.data!.nodes[0]!.id).toBe("hq-001");
  });

  it("should include source field derived from bead ID prefix", async () => {
    vi.mocked(execBd).mockResolvedValue({
      success: true,
      data: [
        createBead({ id: "hq-001", title: "Town Bead" }),
      ],
      exitCode: 0,
    });

    const result = await getBeadsGraph();

    expect(result.success).toBe(true);
    expect(result.data!.nodes[0]!.source).toBeDefined();
    // hq prefix maps to "town" source
    expect(result.data!.nodes[0]!.source).toBe("town");
  });

  it("should handle bd command failure gracefully", async () => {
    vi.mocked(execBd).mockResolvedValue({
      success: false,
      error: { code: "BD_PANIC", message: "bd crashed: nil pointer dereference" },
      exitCode: 2,
    });

    const result = await getBeadsGraph();

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("BD_PANIC");
    expect(result.error?.message).toContain("bd crashed");
  });

  it("should handle exceptions gracefully", async () => {
    vi.mocked(execBd).mockRejectedValue(new Error("Network timeout"));

    const result = await getBeadsGraph();

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("GRAPH_ERROR");
    expect(result.error?.message).toBe("Network timeout");
  });

  it("should aggregate edges from multiple beads", async () => {
    vi.mocked(execBd).mockResolvedValue({
      success: true,
      data: [
        createBead({
          id: "hq-001",
          title: "Epic 1",
          issue_type: "epic",
          dependencies: [
            { issue_id: "hq-001", depends_on_id: "hq-002", type: "parent" },
          ],
        }),
        createBead({
          id: "hq-002",
          title: "Task 1",
          issue_type: "task",
          dependencies: [
            { issue_id: "hq-002", depends_on_id: "hq-003", type: "blocks" },
          ],
        }),
        createBead({ id: "hq-003", title: "Task 2", issue_type: "task" }),
      ],
      exitCode: 0,
    });

    const result = await getBeadsGraph();

    expect(result.success).toBe(true);
    expect(result.data!.edges).toHaveLength(2);
    expect(result.data!.edges).toEqual(
      expect.arrayContaining([
        { issueId: "hq-001", dependsOnId: "hq-002", type: "parent" },
        { issueId: "hq-002", dependsOnId: "hq-003", type: "blocks" },
      ])
    );
  });

  // adj-qwb5: Verify bd list is called with -v (verbose) flag to include dependencies
  it("should call execBd with verbose flag (list --all --json -v)", async () => {
    vi.mocked(execBd).mockResolvedValue({
      success: true,
      data: [],
      exitCode: 0,
    });

    await getBeadsGraph();

    const args = vi.mocked(execBd).mock.calls[0]?.[0] ?? [];
    expect(args).toContain("list");
    expect(args).toContain("--all");
    expect(args).toContain("--json");
    // Critical: -v flag is required for dependencies to be included in output
    expect(args).toContain("-v");
  });

  // adj-eiaf: Deduplicate edges from bidirectional dependencies
  it("should deduplicate edges when same dependency appears on multiple beads", async () => {
    vi.mocked(execBd).mockResolvedValue({
      success: true,
      data: [
        createBead({
          id: "hq-001",
          title: "Epic",
          issue_type: "epic",
          dependencies: [
            { issue_id: "hq-001", depends_on_id: "hq-002", type: "blocks" },
          ],
        }),
        createBead({
          id: "hq-002",
          title: "Task",
          issue_type: "task",
          dependencies: [
            // Same dependency appearing on the other bead (bidirectional)
            { issue_id: "hq-001", depends_on_id: "hq-002", type: "blocks" },
          ],
        }),
      ],
      exitCode: 0,
    });

    const result = await getBeadsGraph();

    expect(result.success).toBe(true);
    // Should be 1 edge, not 2 (deduplicated)
    expect(result.data!.edges).toHaveLength(1);
    expect(result.data!.edges[0]).toEqual({
      issueId: "hq-001",
      dependsOnId: "hq-002",
      type: "blocks",
    });
  });

  it("should not deduplicate edges with different directions", async () => {
    vi.mocked(execBd).mockResolvedValue({
      success: true,
      data: [
        createBead({
          id: "hq-001",
          title: "Epic",
          issue_type: "epic",
          dependencies: [
            { issue_id: "hq-001", depends_on_id: "hq-002", type: "blocks" },
          ],
        }),
        createBead({
          id: "hq-002",
          title: "Task",
          issue_type: "task",
          dependencies: [
            // Reverse direction: different edge
            { issue_id: "hq-002", depends_on_id: "hq-001", type: "blocks" },
          ],
        }),
      ],
      exitCode: 0,
    });

    const result = await getBeadsGraph();

    expect(result.success).toBe(true);
    // Both edges are kept (different directions)
    expect(result.data!.edges).toHaveLength(2);
  });

  // adj-cj4j: Query params support
  it("should pass status filter to bd command", async () => {
    vi.mocked(execBd).mockResolvedValue({
      success: true,
      data: [],
      exitCode: 0,
    });

    await getBeadsGraph({ status: "open" });

    const args = vi.mocked(execBd).mock.calls[0]?.[0] ?? [];
    expect(args).toContain("--status");
    expect(args).toContain("open");
    // Should NOT contain --all when specific status is given
    expect(args).not.toContain("--all");
  });

  it("should pass type filter to bd command", async () => {
    vi.mocked(execBd).mockResolvedValue({
      success: true,
      data: [],
      exitCode: 0,
    });

    await getBeadsGraph({ type: "epic" });

    const args = vi.mocked(execBd).mock.calls[0]?.[0] ?? [];
    expect(args).toContain("--type");
    expect(args).toContain("epic");
  });

  it("should use --all flag with default status (shows active work)", async () => {
    vi.mocked(execBd).mockResolvedValue({
      success: true,
      data: [
        createBead({ id: "hq-001", status: "open" }),
        createBead({ id: "hq-002", status: "closed" }),
        createBead({ id: "hq-003", status: "in_progress" }),
      ],
      exitCode: 0,
    });

    const result = await getBeadsGraph({ status: "default" });

    expect(result.success).toBe(true);
    // "default" preset should filter to open + hooked + in_progress + blocked
    // hq-002 (closed) should be filtered out client-side
    expect(result.data!.nodes).toHaveLength(2);
    expect(result.data!.nodes.map(n => n.id)).toEqual(
      expect.arrayContaining(["hq-001", "hq-003"])
    );
  });

  it("should query all when status=all and use --all flag", async () => {
    vi.mocked(execBd).mockResolvedValue({
      success: true,
      data: [],
      exitCode: 0,
    });

    await getBeadsGraph({ status: "all" });

    const args = vi.mocked(execBd).mock.calls[0]?.[0] ?? [];
    expect(args).toContain("--all");
  });

  // adj-jrrn: Multi-database support
  it("should query all databases when rig=all", async () => {
    vi.mocked(listAllBeadsDirs).mockResolvedValue([
      { path: "/tmp/town/.beads", workDir: "/tmp/town", rig: null },
      { path: "/tmp/town/adjutant/.beads", workDir: "/tmp/town/adjutant", rig: "adjutant" },
    ]);

    vi.mocked(execBd).mockResolvedValue({
      success: true,
      data: [createBead({ id: "hq-001" })],
      exitCode: 0,
    });

    const result = await getBeadsGraph({ rig: "all" });

    expect(result.success).toBe(true);
    // Should have called execBd twice (once for town, once for adjutant rig)
    expect(vi.mocked(execBd)).toHaveBeenCalledTimes(2);
  });

  it("should query only town database by default (rig=town)", async () => {
    vi.mocked(execBd).mockResolvedValue({
      success: true,
      data: [],
      exitCode: 0,
    });

    await getBeadsGraph();

    // Should call execBd exactly once (town only)
    expect(vi.mocked(execBd)).toHaveBeenCalledTimes(1);
  });

  it("should exclude hq- beads when excludeTown=true with rig=all", async () => {
    vi.mocked(listAllBeadsDirs).mockResolvedValue([
      { path: "/tmp/town/.beads", workDir: "/tmp/town", rig: null },
      { path: "/tmp/town/adjutant/.beads", workDir: "/tmp/town/adjutant", rig: "adjutant" },
    ]);

    // First call returns town beads, second returns rig beads
    vi.mocked(execBd)
      .mockResolvedValueOnce({
        success: true,
        data: [createBead({ id: "hq-001", title: "Town Bead" })],
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        success: true,
        data: [createBead({ id: "adj-001", title: "Adjutant Bead" })],
        exitCode: 0,
      });

    const result = await getBeadsGraph({ rig: "all", excludeTown: true });

    expect(result.success).toBe(true);
    // hq-001 should be excluded
    expect(result.data!.nodes).toHaveLength(1);
    expect(result.data!.nodes[0]!.id).toBe("adj-001");
  });

  it("should deduplicate nodes from multiple databases", async () => {
    vi.mocked(listAllBeadsDirs).mockResolvedValue([
      { path: "/tmp/town/.beads", workDir: "/tmp/town", rig: null },
      { path: "/tmp/town/adjutant/.beads", workDir: "/tmp/town/adjutant", rig: "adjutant" },
    ]);

    // Same bead appears in both databases
    const sharedBead = createBead({ id: "hq-001", title: "Shared Bead" });
    vi.mocked(execBd)
      .mockResolvedValueOnce({
        success: true,
        data: [sharedBead],
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        success: true,
        data: [sharedBead],
        exitCode: 0,
      });

    const result = await getBeadsGraph({ rig: "all" });

    expect(result.success).toBe(true);
    // Should be 1 node, not 2 (deduplicated)
    expect(result.data!.nodes).toHaveLength(1);
  });

  it("should handle partial database failures gracefully", async () => {
    vi.mocked(listAllBeadsDirs).mockResolvedValue([
      { path: "/tmp/town/.beads", workDir: "/tmp/town", rig: null },
      { path: "/tmp/town/adjutant/.beads", workDir: "/tmp/town/adjutant", rig: "adjutant" },
    ]);

    // Town succeeds, adjutant fails
    vi.mocked(execBd)
      .mockResolvedValueOnce({
        success: true,
        data: [createBead({ id: "hq-001" })],
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        success: false,
        error: { code: "BD_PANIC", message: "crash" },
        exitCode: 2,
      });

    const result = await getBeadsGraph({ rig: "all" });

    // Should succeed with partial data
    expect(result.success).toBe(true);
    expect(result.data!.nodes).toHaveLength(1);
  });
});
