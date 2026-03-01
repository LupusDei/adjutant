import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BeadsIssue, BdResult } from "../../../src/services/bd-client.js";

// =============================================================================
// Mocks (must be before imports)
// =============================================================================

vi.mock("../../../src/services/bd-client.js", () => ({
  execBd: vi.fn(),
  resolveBeadsDir: vi.fn((dir: string) => `${dir}/.beads`),
  stripBeadPrefix: vi.fn((fullId: string) => {
    const match = fullId.match(/^[a-z0-9]{2,5}-(.+)$/i);
    return match?.[1] ?? fullId;
  }),
}));

vi.mock("../../../src/services/workspace/index.js", () => ({
  resolveWorkspaceRoot: vi.fn(() => "/tmp/town"),
  listAllBeadsDirs: vi.fn(() => Promise.resolve([])),
  getDeploymentMode: vi.fn(() => "swarm"),
}));

vi.mock("../../../src/services/event-bus.js", () => {
  const mockEmit = vi.fn();
  return {
    getEventBus: vi.fn(() => ({
      emit: mockEmit,
    })),
    _mockEmit: mockEmit,
  };
});

vi.mock("../../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("fs", async () => {
  const actual = await vi.importActual("fs");
  return {
    ...actual,
    readFileSync: vi.fn(() => {
      throw new Error("File not found");
    }),
  };
});

// =============================================================================
// Imports
// =============================================================================

import { execBd } from "../../../src/services/bd-client.js";
import { listAllBeadsDirs } from "../../../src/services/workspace/index.js";
import { getEventBus } from "../../../src/services/event-bus.js";

// Import from the barrel (re-exports from decomposed modules)
import {
  listBeads,
  listAllBeads,
  getBead,
  updateBead,
  updateBeadStatus,
  listBeadSources,
  refreshPrefixMap,
  startPrefixMapRefreshScheduler,
  stopPrefixMapRefreshScheduler,
  getEpicChildren,
  isBeadEpic,
  autoCompleteEpics,
  listEpicsWithProgress,
  listRecentlyClosed,
  getProjectOverview,
  computeEpicProgress,
  getRecentlyCompletedEpics,
  getBeadsGraph,
  // Exported for testing
  _extractRig,
  _prefixToSource,
  _resetPrefixMap,
} from "../../../src/services/beads/index.js";

// =============================================================================
// Test Fixtures
// =============================================================================

function createIssue(overrides: Partial<BeadsIssue> = {}): BeadsIssue {
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

function bdSuccess<T>(data: T): BdResult<T> {
  return { success: true, data, exitCode: 0 };
}

function bdFailure(code = "COMMAND_FAILED", message = "bd failed"): BdResult<never> {
  return {
    success: false,
    error: { code, message },
    exitCode: 1,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("beads-repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the cached prefix map between tests
    _resetPrefixMap();
  });

  afterEach(() => {
    stopPrefixMapRefreshScheduler();
  });

  // ===========================================================================
  // extractRig
  // ===========================================================================

  describe("extractRig", () => {
    it("should return null for null/undefined input", () => {
      expect(_extractRig(null)).toBeNull();
      expect(_extractRig(undefined)).toBeNull();
    });

    it("should return null for empty string", () => {
      expect(_extractRig("")).toBeNull();
    });

    it("should return null for mayor/ (town-level)", () => {
      expect(_extractRig("mayor/")).toBeNull();
      expect(_extractRig("mayor/commands")).toBeNull();
    });

    it("should extract rig from path-style assignee", () => {
      expect(_extractRig("proj1/agents/ace")).toBe("proj1");
      expect(_extractRig("proj2/worker")).toBe("proj2");
    });

    it("should return assignee directly when no slash", () => {
      expect(_extractRig("myrig")).toBe("myrig");
    });
  });

  // ===========================================================================
  // prefixToSource
  // ===========================================================================

  describe("prefixToSource", () => {
    it("should return 'town' for hq prefix by default", () => {
      // The default prefix map always maps hq -> town
      expect(_prefixToSource("hq-001")).toBe("town");
    });

    it("should return 'unknown' for unrecognized prefixes", () => {
      expect(_prefixToSource("xyz-001")).toBe("unknown");
    });

    it("should return 'unknown' for empty id", () => {
      expect(_prefixToSource("")).toBe("unknown");
    });
  });

  // ===========================================================================
  // listBeads
  // ===========================================================================

  describe("listBeads", () => {
    it("should return transformed beads on success", async () => {
      vi.mocked(execBd).mockResolvedValue(
        bdSuccess([
          createIssue({ id: "hq-001", title: "Bead 1" }),
          createIssue({ id: "hq-002", title: "Bead 2" }),
        ])
      );

      const result = await listBeads();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data?.[0]?.id).toBe("hq-001");
      expect(result.data?.[0]?.source).toBe("town");
    });

    it("should handle bd failure gracefully", async () => {
      vi.mocked(execBd).mockResolvedValue(bdFailure());

      const result = await listBeads();
      expect(result.success).toBe(false);
      expect(result.error?.code).toBeTruthy();
    });

    it("should filter wisps from results", async () => {
      vi.mocked(execBd).mockResolvedValue(
        bdSuccess([
          createIssue({ id: "hq-001", wisp: false }),
          createIssue({ id: "hq-wisp-001", wisp: true }),
          createIssue({ id: "hq-002" }),
        ])
      );

      const result = await listBeads();
      expect(result.success).toBe(true);
      // Should filter out wisp bead
      const ids = result.data?.map((b) => b.id) ?? [];
      expect(ids).not.toContain("hq-wisp-001");
    });

    it("should filter by assignee when provided", async () => {
      vi.mocked(execBd).mockResolvedValue(
        bdSuccess([
          createIssue({ id: "hq-001", assignee: "proj2/agents/toast" }),
          createIssue({ id: "hq-002", assignee: "other/agent" }),
        ])
      );

      const result = await listBeads({ assignee: "toast" });
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0]?.id).toBe("hq-001");
    });

    it("should sort by priority then by date", async () => {
      vi.mocked(execBd).mockResolvedValue(
        bdSuccess([
          createIssue({ id: "hq-002", priority: 3, updated_at: "2026-01-12T12:00:00Z" }),
          createIssue({ id: "hq-001", priority: 1, updated_at: "2026-01-10T12:00:00Z" }),
          createIssue({ id: "hq-003", priority: 1, updated_at: "2026-01-13T12:00:00Z" }),
        ])
      );

      const result = await listBeads();
      expect(result.success).toBe(true);
      // Priority 1 items first, sorted by date desc
      expect(result.data?.[0]?.id).toBe("hq-003");
      expect(result.data?.[1]?.id).toBe("hq-001");
      expect(result.data?.[2]?.id).toBe("hq-002");
    });

    it("should apply limit", async () => {
      vi.mocked(execBd).mockResolvedValue(
        bdSuccess([
          createIssue({ id: "hq-001", priority: 1 }),
          createIssue({ id: "hq-002", priority: 2 }),
          createIssue({ id: "hq-003", priority: 3 }),
        ])
      );

      const result = await listBeads({ limit: 2 });
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it("should filter by rig when rig option is provided", async () => {
      vi.mocked(execBd).mockResolvedValue(
        bdSuccess([
          createIssue({ id: "hq-001", assignee: "proj2/agents/ace" }),
          createIssue({ id: "hq-002", assignee: "adjutant/crew/worker" }),
        ])
      );

      const result = await listBeads({ rig: "proj2" });
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0]?.rig).toBe("proj2");
    });
  });

  // ===========================================================================
  // listAllBeads
  // ===========================================================================

  describe("listAllBeads", () => {
    it("should query town database and return results", async () => {
      vi.mocked(execBd).mockResolvedValue(
        bdSuccess([
          createIssue({ id: "hq-001" }),
        ])
      );

      const result = await listAllBeads();
      expect(result.success).toBe(true);
      expect(result.data?.length).toBeGreaterThanOrEqual(1);
    });

    it("should deduplicate beads across databases", async () => {
      // Two databases return the same bead ID
      vi.mocked(listAllBeadsDirs).mockResolvedValue([
        { path: "/tmp/town/.beads", workDir: "/tmp/town", rig: null },
        { path: "/tmp/rig1/.beads", workDir: "/tmp/rig1", rig: "rig1" },
      ]);

      vi.mocked(execBd)
        .mockResolvedValueOnce(bdSuccess([createIssue({ id: "hq-001" })]))
        .mockResolvedValueOnce(bdSuccess([createIssue({ id: "hq-001" })]));

      const result = await listAllBeads();
      expect(result.success).toBe(true);
      // Should deduplicate - only one instance
      expect(result.data).toHaveLength(1);
    });

    it("should filter out excluded prefixes", async () => {
      vi.mocked(execBd).mockResolvedValue(
        bdSuccess([
          createIssue({ id: "hq-001" }),
          createIssue({ id: "gb-002" }),
        ])
      );

      const result = await listAllBeads({ excludePrefixes: ["hq-"] });
      expect(result.success).toBe(true);
      const ids = result.data?.map((b) => b.id) ?? [];
      expect(ids).not.toContain("hq-001");
      expect(ids).toContain("gb-002");
    });

    it("should return error when all databases fail", async () => {
      vi.mocked(execBd).mockResolvedValue(bdFailure());

      const result = await listAllBeads();
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  // ===========================================================================
  // getBead
  // ===========================================================================

  describe("getBead", () => {
    it("should return bead detail on success", async () => {
      const issue = createIssue({
        id: "hq-abc1",
        description: "Detailed description",
        assignee: "proj1/agents/ace",
        dependencies: [{ issue_id: "hq-abc1", depends_on_id: "hq-xyz1", type: "depends_on" }],
      });

      vi.mocked(execBd).mockResolvedValue(bdSuccess([issue]));

      const result = await getBead("hq-abc1");
      expect(result.success).toBe(true);
      expect(result.data?.id).toBe("hq-abc1");
      expect(result.data?.description).toBe("Detailed description");
      expect(result.data?.rig).toBe("proj1");
      expect(result.data?.dependencies).toHaveLength(1);
      expect(result.data?.dependencies[0]?.dependsOnId).toBe("hq-xyz1");
    });

    it("should return error for invalid bead ID format", async () => {
      const result = await getBead("");
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_BEAD_ID");
    });

    it("should return error when bead is not found", async () => {
      vi.mocked(execBd).mockResolvedValue(bdSuccess([]));

      const result = await getBead("hq-notexist");
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("BEAD_NOT_FOUND");
    });

    it("should return error when bd command fails", async () => {
      vi.mocked(execBd).mockResolvedValue(bdFailure("BD_EXEC_FAILED", "bd crashed"));

      const result = await getBead("hq-abc1");
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("BD_EXEC_FAILED");
    });
  });

  // ===========================================================================
  // updateBead
  // ===========================================================================

  describe("updateBead", () => {
    it("should update status successfully", async () => {
      // First call: resolveBeadDatabase may call execBd, second: isBeadEpic check, third: update
      vi.mocked(execBd).mockResolvedValue(bdSuccess(undefined));

      const result = await updateBead("hq-abc1", { status: "in_progress" });
      expect(result.success).toBe(true);
      expect(result.data?.id).toBe("hq-abc1");
    });

    it("should reject when no fields provided", async () => {
      const result = await updateBead("hq-abc1", {});
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_REQUEST");
    });

    it("should reject invalid status", async () => {
      // Type cast to bypass TypeScript check for test purposes
      const result = await updateBead("hq-abc1", { status: "invalid" as "open" });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_STATUS");
    });

    it("should block closing epics directly", async () => {
      // First call resolves the database, second checks isBeadEpic (returns true)
      vi.mocked(execBd)
        .mockResolvedValueOnce(
          bdSuccess([createIssue({ id: "hq-epic1", issue_type: "epic" })])
        );

      const result = await updateBead("hq-epic1", { status: "closed" });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("EPIC_CLOSE_BLOCKED");
    });

    it("should emit bead:closed event when closing a bead", async () => {
      const mockEmit = getEventBus().emit;
      // isBeadEpic returns false (not an epic), then update succeeds
      vi.mocked(execBd)
        .mockResolvedValueOnce(bdSuccess([createIssue({ issue_type: "task" })]))
        .mockResolvedValueOnce(bdSuccess(undefined))
        // autoCompleteEpics call
        .mockResolvedValueOnce(bdSuccess([]));

      await updateBead("hq-abc1", { status: "closed" });

      expect(mockEmit).toHaveBeenCalledWith("bead:closed", expect.objectContaining({
        id: "hq-abc1",
      }));
    });

    it("should emit bead:updated event for non-close updates", async () => {
      const mockEmit = getEventBus().emit;
      vi.mocked(execBd).mockResolvedValue(bdSuccess(undefined));

      await updateBead("hq-abc1", { status: "in_progress" });

      expect(mockEmit).toHaveBeenCalledWith("bead:updated", expect.objectContaining({
        id: "hq-abc1",
        status: "in_progress",
      }));
    });
  });

  // ===========================================================================
  // updateBeadStatus
  // ===========================================================================

  describe("updateBeadStatus", () => {
    it("should delegate to updateBead and return compatible response", async () => {
      vi.mocked(execBd).mockResolvedValue(bdSuccess(undefined));

      const result = await updateBeadStatus("hq-abc1", "in_progress");
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe("in_progress");
    });
  });

  // ===========================================================================
  // listBeadSources
  // ===========================================================================

  describe("listBeadSources", () => {
    it("should return discovered bead sources", async () => {
      vi.mocked(listAllBeadsDirs).mockResolvedValue([
        { path: "/tmp/town/.beads", workDir: "/tmp/town", rig: null },
        { path: "/tmp/rig1/.beads", workDir: "/tmp/rig1", rig: "rig1" },
      ]);

      const result = await listBeadSources();
      expect(result.success).toBe(true);
      expect(result.data?.sources).toHaveLength(2);
      expect(result.data?.sources[0]?.name).toBe("project");
      expect(result.data?.sources[1]?.name).toBe("rig1");
      expect(result.data?.mode).toBeTruthy();
    });

    it("should return error when discovery fails", async () => {
      vi.mocked(listAllBeadsDirs).mockRejectedValue(new Error("Discovery failed"));

      const result = await listBeadSources();
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("SOURCES_ERROR");
    });
  });

  // ===========================================================================
  // Prefix map scheduler
  // ===========================================================================

  describe("prefix map scheduler", () => {
    it("should start and stop without errors", () => {
      startPrefixMapRefreshScheduler(60000);
      stopPrefixMapRefreshScheduler();
    });

    it("should not start duplicate schedulers", () => {
      startPrefixMapRefreshScheduler(60000);
      startPrefixMapRefreshScheduler(60000); // Should be no-op
      stopPrefixMapRefreshScheduler();
    });

    it("refreshPrefixMap should rebuild the map", async () => {
      vi.mocked(listAllBeadsDirs).mockResolvedValue([]);
      await refreshPrefixMap();
      // After refresh, hq -> town should still work
      expect(_prefixToSource("hq-001")).toBe("town");
    });
  });

  // ===========================================================================
  // isBeadEpic
  // ===========================================================================

  describe("isBeadEpic", () => {
    it("should return true for epic type beads", async () => {
      vi.mocked(execBd).mockResolvedValue(
        bdSuccess([createIssue({ id: "hq-ep1", issue_type: "epic" })])
      );

      const result = await isBeadEpic("hq-ep1", {
        workDir: "/tmp/town",
        beadsDir: "/tmp/town/.beads",
      });
      expect(result).toBe(true);
    });

    it("should return false for non-epic beads", async () => {
      vi.mocked(execBd).mockResolvedValue(
        bdSuccess([createIssue({ id: "hq-tsk1", issue_type: "task" })])
      );

      const result = await isBeadEpic("hq-tsk1", {
        workDir: "/tmp/town",
        beadsDir: "/tmp/town/.beads",
      });
      expect(result).toBe(false);
    });

    it("should return false on bd failure", async () => {
      vi.mocked(execBd).mockResolvedValue(bdFailure());

      const result = await isBeadEpic("hq-missing", {
        workDir: "/tmp/town",
        beadsDir: "/tmp/town/.beads",
      });
      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // autoCompleteEpics
  // ===========================================================================

  describe("autoCompleteEpics", () => {
    it("should return empty array when no epics to close", async () => {
      vi.mocked(execBd).mockResolvedValue(bdSuccess([]));

      const result = await autoCompleteEpics("/tmp/town", "/tmp/town/.beads");
      expect(result).toEqual([]);
    });

    it("should emit bead:closed for auto-completed epics", async () => {
      const mockEmit = getEventBus().emit;
      vi.mocked(execBd).mockResolvedValue(
        bdSuccess([{ id: "hq-ep1", title: "Auto-closed Epic" }])
      );

      const result = await autoCompleteEpics("/tmp/town", "/tmp/town/.beads");
      expect(result).toEqual(["hq-ep1"]);
      expect(mockEmit).toHaveBeenCalledWith("bead:closed", expect.objectContaining({
        id: "hq-ep1",
      }));
    });
  });

  // ===========================================================================
  // getEpicChildren
  // ===========================================================================

  describe("getEpicChildren", () => {
    it("should return children for an epic", async () => {
      vi.mocked(execBd).mockResolvedValue(
        bdSuccess([
          createIssue({ id: "hq-child1", status: "open" }),
          createIssue({ id: "hq-child2", status: "closed" }),
        ])
      );

      const result = await getEpicChildren("hq-ep1");
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it("should return empty data when no children found", async () => {
      vi.mocked(execBd).mockResolvedValue(bdSuccess([]));

      const result = await getEpicChildren("hq-ep1");
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it("should return error for invalid epic ID", async () => {
      const result = await getEpicChildren("");
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_BEAD_ID");
    });
  });

  // ===========================================================================
  // listRecentlyClosed
  // ===========================================================================

  describe("listRecentlyClosed", () => {
    it("should return recently closed beads within the time window", async () => {
      const recentTime = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min ago
      vi.mocked(execBd).mockResolvedValue(
        bdSuccess([
          createIssue({
            id: "hq-cls1",
            status: "closed",
            closed_at: recentTime,
          }),
        ])
      );

      const result = await listRecentlyClosed(1);
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0]?.id).toBe("hq-cls1");
    });

    it("should filter out beads closed outside the time window", async () => {
      const oldTime = new Date(Date.now() - 48 * 3600 * 1000).toISOString(); // 48h ago
      vi.mocked(execBd).mockResolvedValue(
        bdSuccess([
          createIssue({
            id: "hq-old1",
            status: "closed",
            closed_at: oldTime,
          }),
        ])
      );

      const result = await listRecentlyClosed(1);
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(0);
    });
  });

  // ===========================================================================
  // getBeadsGraph
  // ===========================================================================

  describe("getBeadsGraph", () => {
    it("should return nodes and edges from town database", async () => {
      vi.mocked(execBd).mockResolvedValue(
        bdSuccess([
          createIssue({
            id: "hq-001",
            dependencies: [
              { issue_id: "hq-001", depends_on_id: "hq-002", type: "depends_on" },
            ],
          }),
          createIssue({ id: "hq-002" }),
        ])
      );

      const result = await getBeadsGraph();
      expect(result.success).toBe(true);
      expect(result.data?.nodes).toHaveLength(2);
      expect(result.data?.edges).toHaveLength(1);
      expect(result.data?.edges[0]?.issueId).toBe("hq-001");
    });

    it("should deduplicate edges", async () => {
      // Same dependency appears on both sides
      vi.mocked(execBd).mockResolvedValue(
        bdSuccess([
          createIssue({
            id: "hq-001",
            dependencies: [
              { issue_id: "hq-001", depends_on_id: "hq-002", type: "depends_on" },
              { issue_id: "hq-001", depends_on_id: "hq-002", type: "depends_on" },
            ],
          }),
        ])
      );

      const result = await getBeadsGraph();
      expect(result.success).toBe(true);
      expect(result.data?.edges).toHaveLength(1);
    });

    it("should return error when all databases fail", async () => {
      vi.mocked(execBd).mockResolvedValue(bdFailure());

      const result = await getBeadsGraph();
      expect(result.success).toBe(false);
    });
  });

  // ===========================================================================
  // getProjectOverview
  // ===========================================================================

  describe("getProjectOverview", () => {
    it("should return grouped beads by status category", async () => {
      // Open beads query
      vi.mocked(execBd)
        .mockResolvedValueOnce(bdSuccess([createIssue({ id: "hq-001", status: "open" })]))
        // in_progress beads
        .mockResolvedValueOnce(bdSuccess([createIssue({ id: "hq-002", status: "in_progress" })]))
        // hooked beads
        .mockResolvedValueOnce(bdSuccess([]))
        // blocked beads
        .mockResolvedValueOnce(bdSuccess([]))
        // closed beads
        .mockResolvedValueOnce(bdSuccess([]));

      const result = await getProjectOverview("/tmp/project");
      expect(result.success).toBe(true);
      expect(result.data?.open).toHaveLength(1);
      expect(result.data?.inProgress).toHaveLength(1);
    });
  });

  // ===========================================================================
  // computeEpicProgress
  // ===========================================================================

  describe("computeEpicProgress", () => {
    it("should return empty array when no epics exist", async () => {
      vi.mocked(execBd).mockResolvedValue(bdSuccess([]));

      const result = await computeEpicProgress("/tmp/project");
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  // ===========================================================================
  // getRecentlyCompletedEpics
  // ===========================================================================

  describe("getRecentlyCompletedEpics", () => {
    it("should return closed epics sorted by closedAt descending", async () => {
      vi.mocked(execBd).mockResolvedValue(
        bdSuccess([
          createIssue({
            id: "hq-ep1",
            issue_type: "epic",
            status: "closed",
            closed_at: "2026-01-10T10:00:00Z",
          }),
          createIssue({
            id: "hq-ep2",
            issue_type: "epic",
            status: "closed",
            closed_at: "2026-01-15T10:00:00Z",
          }),
        ])
      );

      const result = await getRecentlyCompletedEpics("/tmp/project");
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data?.[0]?.id).toBe("hq-ep2"); // Most recent first
    });

    it("should respect limit parameter", async () => {
      vi.mocked(execBd).mockResolvedValue(
        bdSuccess([
          createIssue({ id: "hq-ep1", issue_type: "epic", status: "closed", closed_at: "2026-01-10T10:00:00Z" }),
          createIssue({ id: "hq-ep2", issue_type: "epic", status: "closed", closed_at: "2026-01-11T10:00:00Z" }),
          createIssue({ id: "hq-ep3", issue_type: "epic", status: "closed", closed_at: "2026-01-12T10:00:00Z" }),
        ])
      );

      const result = await getRecentlyCompletedEpics("/tmp/project", 2);
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });
  });

  // ===========================================================================
  // listEpicsWithProgress
  // ===========================================================================

  describe("listEpicsWithProgress", () => {
    it("should return empty array when no epics found", async () => {
      vi.mocked(execBd).mockResolvedValue(bdSuccess([]));

      const result = await listEpicsWithProgress();
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });
});
