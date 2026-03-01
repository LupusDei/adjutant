import { describe, it, expect } from "vitest";

/**
 * Tests for beads/types module.
 * These are primarily compile-time tests: if the file compiles with these
 * imports and type annotations, the types are correctly exported.
 * Runtime assertions verify the values are structurally valid.
 */

// Import all types from the new types module
import type {
  BeadInfo,
  BeadDetail,
  RecentlyClosedBead,
  ListBeadsOptions,
  BeadsServiceResult,
  BeadStatus,
  UpdateBeadOptions,
  EpicWithChildren,
  EpicProgress,
  ProjectBeadsOverview,
  BeadSource,
  BeadsGraphOptions,
  FetchResult,
  BeadsIssue,
  BeadsGraphResponse,
  GraphDependency,
  GraphNode,
} from "../../../src/services/beads/types.js";

import {
  DEFAULT_STATUSES,
  ALL_STATUSES,
} from "../../../src/services/beads/types.js";

describe("beads/types", () => {
  // =========================================================================
  // Runtime constants
  // =========================================================================

  describe("DEFAULT_STATUSES", () => {
    it("should contain active workflow statuses (not closed)", () => {
      expect(DEFAULT_STATUSES).toEqual(["open", "hooked", "in_progress", "blocked"]);
    });

    it("should not include closed", () => {
      expect(DEFAULT_STATUSES).not.toContain("closed");
    });
  });

  describe("ALL_STATUSES", () => {
    it("should contain all valid bead statuses", () => {
      expect(ALL_STATUSES).toEqual(["open", "hooked", "in_progress", "blocked", "closed"]);
    });

    it("should be a superset of DEFAULT_STATUSES", () => {
      for (const status of DEFAULT_STATUSES) {
        expect(ALL_STATUSES).toContain(status);
      }
    });
  });

  // =========================================================================
  // Type-level tests (compile = pass)
  // =========================================================================

  describe("BeadInfo", () => {
    it("should be constructible with all required fields", () => {
      const info: BeadInfo = {
        id: "hq-abc1",
        title: "Test Bead",
        status: "open",
        priority: 1,
        type: "task",
        assignee: null,
        rig: null,
        source: "town",
        labels: [],
        createdAt: "2026-01-01",
        updatedAt: null,
      };
      expect(info.id).toBe("hq-abc1");
      expect(info.labels).toEqual([]);
    });
  });

  describe("BeadDetail", () => {
    it("should extend BeadInfo with detail fields", () => {
      const detail: BeadDetail = {
        id: "hq-xyz9",
        title: "Detailed Bead",
        status: "in_progress",
        priority: 0,
        type: "epic",
        assignee: "proj1",
        rig: "proj1",
        source: "town",
        labels: ["critical"],
        createdAt: "2026-01-01",
        updatedAt: "2026-01-02",
        description: "A detailed description",
        closedAt: null,
        agentState: "working",
        dependencies: [
          { issueId: "hq-xyz9", dependsOnId: "hq-abc1", type: "depends_on" },
        ],
        isWisp: false,
        isPinned: true,
      };
      expect(detail.description).toBe("A detailed description");
      expect(detail.dependencies).toHaveLength(1);
    });
  });

  describe("RecentlyClosedBead", () => {
    it("should have closedAt as required string", () => {
      const closed: RecentlyClosedBead = {
        id: "hq-cls1",
        title: "Closed Bead",
        assignee: "agent-1",
        closedAt: "2026-01-15T10:00:00Z",
        type: "task",
        priority: 2,
        rig: null,
        source: "town",
      };
      expect(closed.closedAt).toBeTruthy();
    });
  });

  describe("ListBeadsOptions", () => {
    it("should allow all optional fields", () => {
      const opts: ListBeadsOptions = {
        rig: "proj1",
        rigPath: "/Users/test/gt",
        status: "open",
        type: "task",
        limit: 50,
        assignee: "agent-1",
        excludePrefixes: ["hq-"],
      };
      expect(opts.rig).toBe("proj1");
    });

    it("should allow empty options", () => {
      const opts: ListBeadsOptions = {};
      expect(opts).toBeDefined();
    });
  });

  describe("BeadsServiceResult", () => {
    it("should support generic success result", () => {
      const result: BeadsServiceResult<string[]> = {
        success: true,
        data: ["hq-001", "hq-002"],
      };
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it("should support error result", () => {
      const result: BeadsServiceResult<never> = {
        success: false,
        error: { code: "NOT_FOUND", message: "Bead not found" },
      };
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NOT_FOUND");
    });
  });

  describe("BeadStatus", () => {
    it("should accept all valid status values", () => {
      const statuses: BeadStatus[] = [
        "open",
        "hooked",
        "in_progress",
        "blocked",
        "closed",
      ];
      expect(statuses).toHaveLength(5);
    });
  });

  describe("UpdateBeadOptions", () => {
    it("should allow status and assignee fields", () => {
      const opts: UpdateBeadOptions = {
        status: "in_progress",
        assignee: "agent-1",
      };
      expect(opts.status).toBe("in_progress");
    });
  });

  describe("EpicWithChildren", () => {
    it("should contain epic, children, and progress info", () => {
      const epicInfo: BeadInfo = {
        id: "hq-ep1",
        title: "Epic",
        status: "open",
        priority: 0,
        type: "epic",
        assignee: null,
        rig: null,
        source: "town",
        labels: [],
        createdAt: "2026-01-01",
        updatedAt: null,
      };
      const ewc: EpicWithChildren = {
        epic: epicInfo,
        children: [],
        totalCount: 5,
        closedCount: 3,
        progress: 60,
      };
      expect(ewc.progress).toBe(60);
    });
  });

  describe("EpicProgress", () => {
    it("should have completion percentage", () => {
      const progress: EpicProgress = {
        id: "hq-ep2",
        title: "Feature Epic",
        status: "in_progress",
        totalChildren: 10,
        closedChildren: 7,
        completionPercent: 70,
        assignee: null,
      };
      expect(progress.completionPercent).toBe(70);
    });
  });

  describe("ProjectBeadsOverview", () => {
    it("should group beads by status category", () => {
      const overview: ProjectBeadsOverview = {
        open: [],
        inProgress: [],
        recentlyClosed: [],
      };
      expect(overview.open).toEqual([]);
    });
  });

  describe("BeadSource", () => {
    it("should describe a bead source directory", () => {
      const source: BeadSource = {
        name: "proj1",
        path: "/Users/test/gt",
        hasBeads: true,
      };
      expect(source.hasBeads).toBe(true);
    });
  });

  describe("BeadsGraphOptions", () => {
    it("should allow all optional filter fields", () => {
      const opts: BeadsGraphOptions = {
        rig: "all",
        status: "default",
        type: "epic",
        epicId: "hq-ep1",
        excludeTown: true,
      };
      expect(opts.excludeTown).toBe(true);
    });
  });

  describe("FetchResult", () => {
    it("should contain beads array and optional error", () => {
      const result: FetchResult = {
        beads: [],
        error: { code: "BD_ERROR", message: "Database not found" },
      };
      expect(result.beads).toEqual([]);
      expect(result.error?.code).toBe("BD_ERROR");
    });

    it("should work without error field", () => {
      const result: FetchResult = {
        beads: [],
      };
      expect(result.error).toBeUndefined();
    });
  });

  // =========================================================================
  // Re-exported types from bd-client
  // =========================================================================

  describe("BeadsIssue (re-export from bd-client)", () => {
    it("should be importable and usable", () => {
      const issue: BeadsIssue = {
        id: "hq-test",
        title: "Test Issue",
        description: "Description",
        status: "open",
        priority: 1,
        issue_type: "task",
        created_at: "2026-01-01",
      };
      expect(issue.id).toBe("hq-test");
    });
  });

  // =========================================================================
  // Re-exported types from types/beads.ts
  // =========================================================================

  describe("Graph types (re-export from types/beads)", () => {
    it("should export BeadsGraphResponse type", () => {
      const response: BeadsGraphResponse = {
        nodes: [],
        edges: [],
      };
      expect(response.nodes).toEqual([]);
    });

    it("should export GraphNode type", () => {
      const node: GraphNode = {
        id: "hq-001",
        title: "Node",
        status: "open",
        type: "task",
        priority: 1,
        assignee: null,
        source: "town",
      };
      expect(node.id).toBe("hq-001");
    });

    it("should export GraphDependency type", () => {
      const dep: GraphDependency = {
        issueId: "hq-002",
        dependsOnId: "hq-001",
        type: "depends_on",
      };
      expect(dep.issueId).toBe("hq-002");
    });
  });
});
