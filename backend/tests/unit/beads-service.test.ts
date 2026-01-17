import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing service
vi.mock("../../src/services/bd-client.js", () => ({
  execBd: vi.fn(),
  resolveBeadsDir: vi.fn((dir: string) => `${dir}/.beads`),
}));

vi.mock("../../src/services/gastown-workspace.js", () => ({
  resolveTownRoot: vi.fn(() => "/tmp/town"),
  listAllBeadsDirs: vi.fn(() => Promise.resolve([])),
}));

import { execBd, type BeadsIssue } from "../../src/services/bd-client.js";
import { listBeads } from "../../src/services/beads-service.js";

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

    it("should pass limit to bd command", async () => {
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

    it("should filter by rig via assignee prefix", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: true,
        data: [
          createBead({ id: "hq-001", assignee: "gastown_boy/polecats/toast" }),
          createBead({ id: "hq-002", assignee: "gastown/crew/alice" }),
          createBead({ id: "hq-003", assignee: "gastown_boy/crew/bob" }),
        ],
        exitCode: 0,
      });

      const result = await listBeads({ rig: "gastown_boy" });

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
});
