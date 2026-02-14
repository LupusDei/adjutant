import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing service
vi.mock("../../src/services/bd-client.js", () => ({
  execBd: vi.fn(),
  stripBeadPrefix: vi.fn((id: string) => id.replace(/^[a-z]+-/, "")),
  resolveBeadsDir: vi.fn((dir: string) => `${dir}/.beads`),
}));

vi.mock("../../src/services/workspace/index.js", () => ({
  resolveWorkspaceRoot: vi.fn(() => "/tmp/town"),
}));

import { execBd } from "../../src/services/bd-client.js";
import { listConvoys } from "../../src/services/convoys-service.js";

// =============================================================================
// Test Fixtures
// =============================================================================

interface ConvoyBead {
  id: string;
  title: string;
  status: string;
  priority: number;
  issue_type: string;
  updated_at?: string;
}

interface TrackedDep {
  id: string;
  title: string;
  status: string;
  priority?: number;
  issue_type?: string;
  assignee?: string;
  updated_at?: string;
  dependency_type: string;
}

interface ConvoyDetail {
  id: string;
  title: string;
  status: string;
  priority: number;
  issue_type: string;
  updated_at?: string;
  dependencies?: TrackedDep[];
  dependents?: TrackedDep[];
}

function createConvoyBead(overrides: Partial<ConvoyBead> = {}): ConvoyBead {
  return {
    id: "hq-c001",
    title: "Test Convoy",
    status: "open",
    priority: 2,
    issue_type: "convoy",
    ...overrides,
  };
}

function createTrackedDep(overrides: Partial<TrackedDep> = {}): TrackedDep {
  return {
    id: "hq-t001",
    title: "Tracked Issue",
    status: "open",
    dependency_type: "tracks",
    ...overrides,
  };
}

function createConvoyDetail(overrides: Partial<ConvoyDetail> = {}): ConvoyDetail {
  return {
    id: "hq-c001",
    title: "Test Convoy",
    status: "open",
    priority: 2,
    issue_type: "convoy",
    dependencies: [],
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("convoys-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listConvoys", () => {
    it("should return empty array when no convoys exist", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: true,
        data: [],
        exitCode: 0,
      });

      const result = await listConvoys();

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it("should return convoys with progress tracking", async () => {
      // First call: list convoys
      vi.mocked(execBd)
        .mockResolvedValueOnce({
          success: true,
          data: [createConvoyBead({ id: "hq-c001", title: "Feature X" })],
          exitCode: 0,
        })
        // Second call: show convoy details
        .mockResolvedValueOnce({
          success: true,
          data: [
            createConvoyDetail({
              id: "hq-c001",
              title: "Feature X",
              dependencies: [
                createTrackedDep({ id: "hq-t001", status: "closed" }),
                createTrackedDep({ id: "hq-t002", status: "open" }),
                createTrackedDep({ id: "hq-t003", status: "in_progress" }),
              ],
            }),
          ],
          exitCode: 0,
        });

      const result = await listConvoys();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0].id).toBe("hq-c001");
      expect(result.data?.[0].title).toBe("Feature X");
      expect(result.data?.[0].progress.completed).toBe(1);
      expect(result.data?.[0].progress.total).toBe(3);
      expect(result.data?.[0].trackedIssues).toHaveLength(3);
    });

    it("should filter dependencies to only 'tracks' type", async () => {
      vi.mocked(execBd)
        .mockResolvedValueOnce({
          success: true,
          data: [createConvoyBead()],
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          success: true,
          data: [
            createConvoyDetail({
              dependencies: [
                createTrackedDep({ id: "hq-t001", dependency_type: "tracks" }),
                createTrackedDep({ id: "hq-b001", dependency_type: "blocks" }),
                createTrackedDep({ id: "hq-d001", dependency_type: "depends_on" }),
              ],
            }),
          ],
          exitCode: 0,
        });

      const result = await listConvoys();

      expect(result.success).toBe(true);
      expect(result.data?.[0].trackedIssues).toHaveLength(1);
      expect(result.data?.[0].trackedIssues[0].id).toBe("hq-t001");
    });

    it("should include children via parent-child dependents", async () => {
      vi.mocked(execBd)
        .mockResolvedValueOnce({
          success: true,
          data: [createConvoyBead()],
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          success: true,
          data: [
            {
              ...createConvoyDetail(),
              dependencies: [],
              dependents: [
                createTrackedDep({ id: "hq-child1", status: "closed", dependency_type: "parent-child" }),
                createTrackedDep({ id: "hq-child2", status: "open", dependency_type: "parent-child" }),
                createTrackedDep({ id: "hq-blocker", status: "open", dependency_type: "blocks" }),
              ],
            },
          ],
          exitCode: 0,
        });

      const result = await listConvoys();

      expect(result.success).toBe(true);
      expect(result.data?.[0].trackedIssues).toHaveLength(2);
      expect(result.data?.[0].trackedIssues.map(i => i.id)).toContain("hq-child1");
      expect(result.data?.[0].trackedIssues.map(i => i.id)).toContain("hq-child2");
      expect(result.data?.[0].progress.completed).toBe(1);
      expect(result.data?.[0].progress.total).toBe(2);
    });

    it("should combine tracks dependencies and parent-child dependents", async () => {
      vi.mocked(execBd)
        .mockResolvedValueOnce({
          success: true,
          data: [createConvoyBead()],
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          success: true,
          data: [
            {
              ...createConvoyDetail(),
              dependencies: [
                createTrackedDep({ id: "hq-tracked1", status: "closed", dependency_type: "tracks" }),
              ],
              dependents: [
                createTrackedDep({ id: "hq-child1", status: "open", dependency_type: "parent-child" }),
              ],
            },
          ],
          exitCode: 0,
        });

      const result = await listConvoys();

      expect(result.success).toBe(true);
      expect(result.data?.[0].trackedIssues).toHaveLength(2);
      expect(result.data?.[0].progress.completed).toBe(1);
      expect(result.data?.[0].progress.total).toBe(2);
    });

    it("should determine rig from most common assignee", async () => {
      vi.mocked(execBd)
        .mockResolvedValueOnce({
          success: true,
          data: [createConvoyBead()],
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          success: true,
          data: [
            createConvoyDetail({
              dependencies: [
                createTrackedDep({ assignee: "gastown_boy/polecats/toast" }),
                createTrackedDep({ assignee: "gastown_boy/crew/alice" }),
                createTrackedDep({ assignee: "gastown/polecats/carl" }),
              ],
            }),
          ],
          exitCode: 0,
        });

      const result = await listConvoys();

      expect(result.success).toBe(true);
      expect(result.data?.[0].rig).toBe("gastown_boy");
    });

    it("should return null rig when no assignees have rig info", async () => {
      vi.mocked(execBd)
        .mockResolvedValueOnce({
          success: true,
          data: [createConvoyBead()],
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          success: true,
          data: [
            createConvoyDetail({
              dependencies: [
                createTrackedDep({ assignee: undefined }),
                createTrackedDep({ assignee: "mayor/" }),
              ],
            }),
          ],
          exitCode: 0,
        });

      const result = await listConvoys();

      expect(result.success).toBe(true);
      expect(result.data?.[0].rig).toBeNull();
    });

    it("should include optional issue metadata", async () => {
      vi.mocked(execBd)
        .mockResolvedValueOnce({
          success: true,
          data: [createConvoyBead()],
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          success: true,
          data: [
            createConvoyDetail({
              dependencies: [
                createTrackedDep({
                  id: "hq-t001",
                  title: "Fix login bug",
                  status: "in_progress",
                  issue_type: "bug",
                  priority: 1,
                  assignee: "gastown_boy/crew/alice",
                  updated_at: "2026-01-15T10:00:00Z",
                }),
              ],
            }),
          ],
          exitCode: 0,
        });

      const result = await listConvoys();

      expect(result.success).toBe(true);
      const issue = result.data?.[0].trackedIssues[0];
      expect(issue?.issueType).toBe("bug");
      expect(issue?.priority).toBe(1);
      expect(issue?.assignee).toBe("gastown_boy/crew/alice");
      expect(issue?.updatedAt).toBe("2026-01-15T10:00:00Z");
    });

    it("should handle multiple convoys", async () => {
      vi.mocked(execBd)
        .mockResolvedValueOnce({
          success: true,
          data: [
            createConvoyBead({ id: "hq-c001", title: "Convoy A" }),
            createConvoyBead({ id: "hq-c002", title: "Convoy B" }),
          ],
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          success: true,
          data: [
            createConvoyDetail({ id: "hq-c001", title: "Convoy A" }),
            createConvoyDetail({ id: "hq-c002", title: "Convoy B" }),
          ],
          exitCode: 0,
        });

      const result = await listConvoys();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data?.[0].title).toBe("Convoy A");
      expect(result.data?.[1].title).toBe("Convoy B");
    });

    it("should handle convoy with no detail data gracefully", async () => {
      vi.mocked(execBd)
        .mockResolvedValueOnce({
          success: true,
          data: [createConvoyBead({ id: "hq-c001" })],
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          success: false,
          error: { code: "NOT_FOUND", message: "Details not found" },
          exitCode: 1,
        });

      const result = await listConvoys();

      expect(result.success).toBe(true);
      expect(result.data?.[0].trackedIssues).toEqual([]);
      expect(result.data?.[0].progress.total).toBe(0);
    });

    it("should handle exceptions", async () => {
      vi.mocked(execBd).mockRejectedValue(new Error("Database locked"));

      const result = await listConvoys();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("CONVOYS_ERROR");
      expect(result.error?.message).toBe("Database locked");
    });
  });
});
