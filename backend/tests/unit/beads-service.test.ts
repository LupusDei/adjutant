import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing service
vi.mock("../../src/services/bd-client.js", () => ({
  execBd: vi.fn(),
  resolveBeadsDir: vi.fn((dir: string) => `${dir}/.beads`),
  stripBeadPrefix: vi.fn((fullId: string) => {
    // Known prefixes are 2-5 alphanumeric chars followed by hyphen (hq-, gt-, zt20-, etc.)
    const match = fullId.match(/^[a-z0-9]{2,5}-(.+)$/i);
    return match?.[1] ?? fullId;
  }),
}));

vi.mock("../../src/services/workspace/index.js", () => ({
  resolveWorkspaceRoot: vi.fn(() => "/tmp/town"),
  listAllBeadsDirs: vi.fn(() => Promise.resolve([])),
  getWorkspace: vi.fn(() => ({
    root: "/tmp/town",
    name: "test",
    isSwarmProject: () => true,
  })),
  resetWorkspace: vi.fn(),
}));

import { execBd, type BeadsIssue } from "../../src/services/bd-client.js";
import { listBeads, getBead, updateBead } from "../../src/services/beads/index.js";
import { listAllBeadsDirs } from "../../src/services/workspace/index.js";

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

describe("beads-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listBeads", () => {
    it("should return transformed beads", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: true,
        data: [createBead({ id: "hq-001" }), createBead({ id: "hq-002" })],
        exitCode: 0,
      });

      const result = await listBeads();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data?.[0].id).toBe("hq-001");
    });

    it("should use --all flag when status is 'default' for client-side filtering", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: true,
        data: [
          createBead({ id: "hq-001", status: "open" }),
          createBead({ id: "hq-002", status: "closed" }),
        ],
        exitCode: 0,
      });

      const result = await listBeads({ status: "default" });

      // Default filters to open, in_progress, blocked, hooked - should exclude closed
      expect(result.success).toBe(true);
      const args = vi.mocked(execBd).mock.calls[0]?.[0] ?? [];
      expect(args).toContain("--all");
    });

    it("should pass single status to bd command", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: true,
        data: [createBead({ status: "closed" })],
        exitCode: 0,
      });

      await listBeads({ status: "closed" });

      const args = vi.mocked(execBd).mock.calls[0]?.[0] ?? [];
      expect(args).toContain("--status");
      expect(args).toContain("closed");
    });

    it("should use --all when status is 'all'", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: true,
        data: [],
        exitCode: 0,
      });

      await listBeads({ status: "all" });

      const args = vi.mocked(execBd).mock.calls[0]?.[0] ?? [];
      expect(args).toContain("--all");
    });

    it("should pass type filter to bd command", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: true,
        data: [createBead({ issue_type: "bug" })],
        exitCode: 0,
      });

      await listBeads({ type: "bug" });

      const args = vi.mocked(execBd).mock.calls[0]?.[0] ?? [];
      expect(args).toContain("--type");
      expect(args).toContain("bug");
    });

    it("should pass limit to bd command (default 500 when unspecified)", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: true,
        data: [],
        exitCode: 0,
      });

      await listBeads({ limit: 10 });

      const args = vi.mocked(execBd).mock.calls[0]?.[0] ?? [];
      expect(args).toContain("--limit");
      expect(args).toContain("10");
    });

    it("should default limit to 500 when not specified", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: true,
        data: [],
        exitCode: 0,
      });

      await listBeads();

      const args = vi.mocked(execBd).mock.calls[0]?.[0] ?? [];
      expect(args).toContain("--limit");
      expect(args).toContain("500");
    });

    it("should pass sort and reverse flags to bd command", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: true,
        data: [],
        exitCode: 0,
      });

      await listBeads({ sort: "updated", order: "desc" });

      const args = vi.mocked(execBd).mock.calls[0]?.[0] ?? [];
      expect(args).toContain("--sort");
      expect(args).toContain("updated");
      expect(args).toContain("--reverse");
    });

    it("should not pass --reverse when order is asc", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: true,
        data: [],
        exitCode: 0,
      });

      await listBeads({ sort: "created", order: "asc" });

      const args = vi.mocked(execBd).mock.calls[0]?.[0] ?? [];
      expect(args).toContain("--sort");
      expect(args).toContain("created");
      expect(args).not.toContain("--reverse");
    });

    it("should skip client-side sort when bd sort is specified", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: true,
        data: [
          createBead({ id: "hq-001", priority: 3, updated_at: "2026-01-10T12:00:00Z" }),
          createBead({ id: "hq-002", priority: 1, updated_at: "2026-01-12T12:00:00Z" }),
        ],
        exitCode: 0,
      });

      const result = await listBeads({ sort: "updated", order: "desc" });

      expect(result.success).toBe(true);
      // When sort is specified, bd handles sorting — results should maintain bd's order
      expect(result.data?.[0].id).toBe("hq-001");
      expect(result.data?.[1].id).toBe("hq-002");
    });

    it("should filter by rig via assignee prefix", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: true,
        data: [
          createBead({ id: "hq-001", assignee: "proj1/agents/toast" }),
          createBead({ id: "hq-002", assignee: "proj2/agents/alice" }),
          createBead({ id: "hq-003", assignee: "proj1/crew/bob" }),
        ],
        exitCode: 0,
      });

      const result = await listBeads({ rig: "proj1" });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data?.[0].id).toBe("hq-001");
      expect(result.data?.[1].id).toBe("hq-003");
    });

    it("should use rigPath when provided", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: true,
        data: [],
        exitCode: 0,
      });

      await listBeads({ rigPath: "/custom/rig/path" });

      const options = vi.mocked(execBd).mock.calls[0]?.[1];
      expect(options?.cwd).toBe("/custom/rig/path");
    });

    it("should handle bd returning empty data", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: true,
        data: null,
        exitCode: 0,
      });

      const result = await listBeads();

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it("should handle exceptions", async () => {
      vi.mocked(execBd).mockRejectedValue(new Error("Network timeout"));

      const result = await listBeads();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("BEADS_ERROR");
      expect(result.error?.message).toBe("Network timeout");
    });

    it("should propagate bd panic errors instead of returning empty", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: false,
        error: {
          code: "BD_PANIC",
          message: "bd crashed: runtime error: nil pointer dereference",
        },
        exitCode: 2,
      });

      const result = await listBeads();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("BD_PANIC");
      expect(result.error?.message).toContain("bd crashed");
    });

    it("should propagate bd command failures instead of returning empty", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: false,
        error: {
          code: "COMMAND_FAILED",
          message: "some bd error",
        },
        exitCode: 1,
      });

      const result = await listBeads();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("COMMAND_FAILED");
    });

    it("should sort beads by priority and date", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: true,
        data: [
          createBead({ id: "hq-001", priority: 3, updated_at: "2026-01-10T12:00:00Z" }),
          createBead({ id: "hq-002", priority: 1, updated_at: "2026-01-11T12:00:00Z" }),
          createBead({ id: "hq-003", priority: 1, updated_at: "2026-01-12T12:00:00Z" }),
        ],
        exitCode: 0,
      });

      const result = await listBeads();

      expect(result.success).toBe(true);
      // Priority 1 items come first, sorted by date (newest first)
      expect(result.data?.[0].id).toBe("hq-003");
      expect(result.data?.[1].id).toBe("hq-002");
      expect(result.data?.[2].id).toBe("hq-001");
    });
  });

  describe("getBead", () => {
    it("should return bead details for valid town bead (hq-* prefix)", async () => {
      const mockIssue = createBead({
        id: "hq-vts8",
        title: "Town Level Task",
        description: "A town-level task description",
        assignee: "mayor/crew/alice",
      });

      vi.mocked(execBd).mockResolvedValue({
        success: true,
        data: [mockIssue],
        exitCode: 0,
      });

      const result = await getBead("hq-vts8");

      expect(result.success).toBe(true);
      expect(result.data?.id).toBe("hq-vts8");
      expect(result.data?.title).toBe("Town Level Task");
      expect(result.data?.description).toBe("A town-level task description");
      expect(result.data?.source).toBe("town");
      // mayor/ assignees should have null rig
      expect(result.data?.rig).toBeNull();
    });

    it("should return bead details for valid rig bead (adj-* prefix)", async () => {
      // Set up the mock to return the adjutant rig directory
      vi.mocked(listAllBeadsDirs).mockResolvedValue([
        { path: "/tmp/town/adjutant/.beads", workDir: "/tmp/town/adjutant", rig: "adjutant" },
      ]);

      const mockIssue = createBead({
        id: "adj-67tta",
        title: "Adjutant Rig Task",
        description: "A rig-specific task",
        assignee: "adjutant/agents/quartz",
      });

      vi.mocked(execBd).mockResolvedValue({
        success: true,
        data: [mockIssue],
        exitCode: 0,
      });

      const result = await getBead("adj-67tta");

      expect(result.success).toBe(true);
      expect(result.data?.id).toBe("adj-67tta");
      expect(result.data?.title).toBe("Adjutant Rig Task");
      expect(result.data?.rig).toBe("adjutant");
    });

    it("should return error for invalid bead ID format (no prefix)", async () => {
      const result = await getBead("");

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_BEAD_ID");
      expect(result.error?.message).toContain("Invalid bead ID format");
    });

    it("should return error for non-existent bead", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: false,
        error: { code: "BEAD_NOT_FOUND", message: "Bead not found: hq-9999" },
        exitCode: 1,
      });

      const result = await getBead("hq-9999");

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("BEAD_NOT_FOUND");
    });

    it("should correctly map BeadsIssue to BeadDetail (all fields)", async () => {
      const mockIssue: BeadsIssue = {
        id: "hq-full",
        title: "Full Details Test",
        description: "Complete description",
        status: "in_progress",
        priority: 1,
        issue_type: "feature",
        created_at: "2026-01-15T10:00:00Z",
        updated_at: "2026-01-16T12:00:00Z",
        closed_at: null,
        assignee: "proj1/agents/toast",
        labels: ["urgent", "backend"],
        agent_state: "working",
        pinned: true,
        wisp: false,
        dependencies: [
          { issue_id: "hq-full", depends_on_id: "hq-dep1", type: "blocks" },
        ],
      };

      vi.mocked(execBd).mockResolvedValue({
        success: true,
        data: [mockIssue],
        exitCode: 0,
      });

      const result = await getBead("hq-full");

      expect(result.success).toBe(true);
      const detail = result.data!;
      expect(detail.id).toBe("hq-full");
      expect(detail.title).toBe("Full Details Test");
      expect(detail.description).toBe("Complete description");
      expect(detail.status).toBe("in_progress");
      expect(detail.priority).toBe(1);
      expect(detail.type).toBe("feature");
      expect(detail.createdAt).toBe("2026-01-15T10:00:00Z");
      expect(detail.updatedAt).toBe("2026-01-16T12:00:00Z");
      expect(detail.closedAt).toBeNull();
      expect(detail.assignee).toBe("proj1/agents/toast");
      expect(detail.rig).toBe("proj1");
      expect(detail.labels).toEqual(["urgent", "backend"]);
      expect(detail.agentState).toBe("working");
      expect(detail.isPinned).toBe(true);
      expect(detail.isWisp).toBe(false);
      expect(detail.dependencies).toHaveLength(1);
      expect(detail.dependencies[0]).toEqual({
        issueId: "hq-full",
        dependsOnId: "hq-dep1",
        type: "blocks",
      });
    });

    it("should handle missing optional fields gracefully", async () => {
      const minimalIssue: BeadsIssue = {
        id: "hq-min",
        title: "Minimal Bead",
        description: "",
        status: "open",
        priority: 3,
        issue_type: "task",
        created_at: "2026-01-15T10:00:00Z",
        // All optional fields omitted
      };

      vi.mocked(execBd).mockResolvedValue({
        success: true,
        data: [minimalIssue],
        exitCode: 0,
      });

      const result = await getBead("hq-min");

      expect(result.success).toBe(true);
      const detail = result.data!;
      expect(detail.description).toBe("");
      expect(detail.updatedAt).toBeNull();
      expect(detail.closedAt).toBeNull();
      expect(detail.assignee).toBeNull();
      expect(detail.rig).toBeNull();
      expect(detail.labels).toEqual([]);
      expect(detail.agentState).toBeNull();
      expect(detail.isPinned).toBe(false);
      expect(detail.isWisp).toBe(false);
      expect(detail.dependencies).toEqual([]);
    });

    it("should call execBd with correct args (show with --json)", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: true,
        data: [createBead({ id: "hq-test" })],
        exitCode: 0,
      });

      await getBead("hq-test");

      const args = vi.mocked(execBd).mock.calls[0]?.[0] ?? [];
      expect(args).toContain("show");
      expect(args).toContain("hq-test"); // full ID (bd show accepts full IDs)
      expect(args).toContain("--json");
    });

    it("should pass full ID for multi-part IDs", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: true,
        data: [createBead({ id: "hq-cv-hfove" })],
        exitCode: 0,
      });

      await getBead("hq-cv-hfove");

      const args = vi.mocked(execBd).mock.calls[0]?.[0] ?? [];
      // bd show accepts full IDs - no prefix stripping needed
      expect(args).toContain("hq-cv-hfove");
    });

    it("should try town database for unknown prefix and handle not found", async () => {
      // For unknown prefix, getBead tries the town database
      vi.mocked(listAllBeadsDirs).mockResolvedValue([]);

      // Mock execBd to return not found error
      vi.mocked(execBd).mockResolvedValue({
        success: false,
        error: { code: "BEAD_NOT_FOUND", message: "Bead not found: xyz-test" },
        exitCode: 1,
      });

      const result = await getBead("xyz-test");

      // Unknown prefix defaults to town, so it tries town database
      // When bd returns BEAD_NOT_FOUND, we get that error
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("BEAD_NOT_FOUND");
    });

    it("should handle exceptions during getBead", async () => {
      vi.mocked(execBd).mockRejectedValue(new Error("Database connection failed"));

      const result = await getBead("hq-error");

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("GET_BEAD_ERROR");
      expect(result.error?.message).toBe("Database connection failed");
    });
  });

  describe("updateBead", () => {
    it("should update assignee only", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: true,
        data: null,
        exitCode: 0,
      });

      const result = await updateBead("hq-test", { assignee: "adjutant/agents/toast" });

      expect(result.success).toBe(true);
      expect(result.data?.id).toBe("hq-test");
      expect(result.data?.assignee).toBe("adjutant/agents/toast");
      expect(result.data?.status).toBeUndefined();

      // Verify bd command args: should have --assignee but not --status
      const args = vi.mocked(execBd).mock.calls[0]?.[0] ?? [];
      expect(args).toContain("update");
      expect(args).toContain("--assignee");
      expect(args).toContain("adjutant/agents/toast");
      expect(args).not.toContain("--status");
    });

    it("should update status only", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: true,
        data: null,
        exitCode: 0,
      });

      const result = await updateBead("hq-test", { status: "in_progress" });

      expect(result.success).toBe(true);
      expect(result.data?.id).toBe("hq-test");
      expect(result.data?.status).toBe("in_progress");
      expect(result.data?.assignee).toBeUndefined();

      const args = vi.mocked(execBd).mock.calls[0]?.[0] ?? [];
      expect(args).toContain("--status");
      expect(args).toContain("in_progress");
      expect(args).not.toContain("--assignee");
    });

    it("should update both status and assignee", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: true,
        data: null,
        exitCode: 0,
      });

      const result = await updateBead("hq-test", { status: "in_progress", assignee: "proj2/agents/alice" });

      expect(result.success).toBe(true);
      expect(result.data?.id).toBe("hq-test");
      expect(result.data?.status).toBe("in_progress");
      expect(result.data?.assignee).toBe("proj2/agents/alice");

      const args = vi.mocked(execBd).mock.calls[0]?.[0] ?? [];
      expect(args).toContain("--status");
      expect(args).toContain("in_progress");
      expect(args).toContain("--assignee");
      expect(args).toContain("proj2/agents/alice");
    });

    it("should reject when neither status nor assignee provided", async () => {
      const result = await updateBead("hq-test", {});

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_REQUEST");
    });

    it("should reject invalid status", async () => {
      // Type cast to bypass TS to simulate bad input from API
      const result = await updateBead("hq-test", { status: "bogus" as "open" });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_STATUS");
    });

    it("should handle bd command failure", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: false,
        error: { code: "BD_ERROR", message: "bd update failed" },
        exitCode: 1,
      });

      const result = await updateBead("hq-test", { assignee: "toast" });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("BD_ERROR");
    });

    it("should strip prefix for short ID in bd command", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: true,
        data: null,
        exitCode: 0,
      });

      await updateBead("hq-abc123", { assignee: "toast" });

      const args = vi.mocked(execBd).mock.calls[0]?.[0] ?? [];
      // bd update expects short ID: "abc123" not "hq-abc123"
      expect(args[1]).toBe("abc123");
    });
  });
});
