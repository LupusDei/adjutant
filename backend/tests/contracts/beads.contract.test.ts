/**
 * Beads API contract tests.
 *
 * Validates that beads endpoint HTTP responses match declared Zod schemas.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ============================================================================
// Mocks
// ============================================================================

vi.mock("../../src/services/beads/index.js", () => ({
  listBeads: vi.fn(),
  listAllBeads: vi.fn(),
  updateBead: vi.fn(),
  getBead: vi.fn(),
  getEpicChildren: vi.fn(),
  listEpicsWithProgress: vi.fn(),
  listBeadSources: vi.fn(),
  listRecentlyClosed: vi.fn(),
  getBeadsGraph: vi.fn(),
  VALID_SORT_FIELDS: ["priority", "created", "updated", "closed", "status", "id", "title", "type", "assignee"],
}));

vi.mock("../../src/services/workspace/index.js", () => ({
  resolveProjectPath: vi.fn().mockReturnValue(undefined),
}));

vi.mock("../../src/services/projects-service.js", () => ({
  listProjects: vi.fn().mockReturnValue({ success: true, data: [] }),
  getProject: vi.fn().mockReturnValue({ success: false }),
}));

import { beadsRouter } from "../../src/routes/beads.js";
import {
  listBeads,
  listAllBeads,
  updateBead,
  getBead,
  getEpicChildren,
  listEpicsWithProgress,
  listBeadSources,
  listRecentlyClosed,
  getBeadsGraph,
} from "../../src/services/beads/index.js";
import {
  BeadListResponseSchema,
  BeadDetailResponseSchema,
  BeadSourcesResponseSchema,
  RecentClosedResponseSchema,
  GraphResponseSchema,
  EpicsWithProgressResponseSchema,
  BeadUpdateResponseSchema,
  ApiErrorSchema,
} from "../../src/types/beads-contracts.js";

// ============================================================================
// Fixtures
// ============================================================================

const MOCK_BEAD_INFO = {
  id: "adj-042",
  title: "Implement auth refresh",
  description: "Token refresh for sessions",
  status: "in_progress",
  priority: 1,
  type: "task",
  assignee: "kerrigan",
  project: "adjutant",
  source: "adj",
  labels: ["auth"],
  createdAt: "2026-03-10T00:00:00.000Z",
  updatedAt: "2026-03-11T10:00:00.000Z",
};

const MOCK_BEAD_DETAIL = {
  ...MOCK_BEAD_INFO,
  closedAt: null,
  agentState: "working",
  dependencies: [
    { issueId: "adj-042", dependsOnId: "adj-041", type: "blocked_by" },
  ],
  isWisp: false,
  isPinned: false,
};

const MOCK_RECENTLY_CLOSED = {
  id: "adj-040",
  title: "Fix login bug",
  assignee: "raynor",
  closedAt: "2026-03-11T09:00:00.000Z",
  type: "bug",
  priority: 0,
  project: "adjutant",
  source: "adj",
};

// ============================================================================
// Test setup
// ============================================================================

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/beads", beadsRouter);
  return app;
}

describe("Beads API contracts", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createTestApp();
    vi.clearAllMocks();
  });

  describe("GET /api/beads", () => {
    it("response matches BeadListResponseSchema", async () => {
      vi.mocked(listBeads).mockResolvedValue({ success: true, data: [MOCK_BEAD_INFO] });

      const res = await request(app).get("/api/beads");

      expect(res.status).toBe(200);
      const parsed = BeadListResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) console.error(parsed.error.issues);
    });

    it("project=all response matches BeadListResponseSchema", async () => {
      vi.mocked(listAllBeads).mockResolvedValue({ success: true, data: [MOCK_BEAD_INFO] });

      const res = await request(app).get("/api/beads").query({ project: "all" });

      expect(res.status).toBe(200);
      const parsed = BeadListResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });

    it("returns empty array on service failure (graceful degradation)", async () => {
      vi.mocked(listBeads).mockResolvedValue({ success: false, error: { code: "ERR", message: "fail" } });

      const res = await request(app).get("/api/beads");

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  describe("GET /api/beads/sources", () => {
    it("response matches BeadSourcesResponseSchema", async () => {
      vi.mocked(listBeadSources).mockResolvedValue({
        success: true,
        data: { sources: [{ name: "adjutant", path: "/code/adjutant", hasBeads: true }], mode: "swarm" },
      });

      const res = await request(app).get("/api/beads/sources");

      expect(res.status).toBe(200);
      const parsed = BeadSourcesResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) console.error(parsed.error.issues);
    });
  });

  describe("GET /api/beads/recent-closed", () => {
    it("response matches RecentClosedResponseSchema", async () => {
      vi.mocked(listRecentlyClosed).mockResolvedValue({ success: true, data: [MOCK_RECENTLY_CLOSED] });

      const res = await request(app).get("/api/beads/recent-closed");

      expect(res.status).toBe(200);
      const parsed = RecentClosedResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) console.error(parsed.error.issues);
    });
  });

  describe("GET /api/beads/graph", () => {
    it("response matches GraphResponseSchema", async () => {
      vi.mocked(getBeadsGraph).mockResolvedValue({
        success: true,
        data: {
          nodes: [{ id: "adj-042", title: "Task", status: "open", type: "task", priority: 1, assignee: null, source: "adj" }],
          edges: [{ issueId: "adj-043", dependsOnId: "adj-042", type: "blocks" }],
        },
      });

      const res = await request(app).get("/api/beads/graph");

      expect(res.status).toBe(200);
      const parsed = GraphResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) console.error(parsed.error.issues);
    });
  });

  describe("GET /api/beads/epics-with-progress", () => {
    it("response matches EpicsWithProgressResponseSchema", async () => {
      vi.mocked(listEpicsWithProgress).mockResolvedValue({
        success: true,
        data: [{
          epic: MOCK_BEAD_INFO,
          children: [MOCK_BEAD_INFO],
          totalCount: 5,
          closedCount: 3,
          progress: 0.6,
        }],
      });

      const res = await request(app).get("/api/beads/epics-with-progress");

      expect(res.status).toBe(200);
      const parsed = EpicsWithProgressResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) console.error(parsed.error.issues);
    });
  });

  describe("GET /api/beads/:id/children", () => {
    it("response matches BeadListResponseSchema", async () => {
      vi.mocked(getEpicChildren).mockResolvedValue({ success: true, data: [MOCK_BEAD_INFO] });

      const res = await request(app).get("/api/beads/adj-042/children");

      expect(res.status).toBe(200);
      const parsed = BeadListResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });
  });

  describe("GET /api/beads/:id", () => {
    it("response matches BeadDetailResponseSchema", async () => {
      vi.mocked(getBead).mockResolvedValue({ success: true, data: MOCK_BEAD_DETAIL });

      const res = await request(app).get("/api/beads/adj-042");

      expect(res.status).toBe(200);
      const parsed = BeadDetailResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) console.error(parsed.error.issues);
    });

    it("includes all BeadDetail fields in response", async () => {
      vi.mocked(getBead).mockResolvedValue({ success: true, data: MOCK_BEAD_DETAIL });

      const res = await request(app).get("/api/beads/adj-042");
      const data = res.body.data;

      expect(data.dependencies).toBeInstanceOf(Array);
      expect(typeof data.isWisp).toBe("boolean");
      expect(typeof data.isPinned).toBe("boolean");
      expect(data).toHaveProperty("closedAt");
      expect(data).toHaveProperty("agentState");
    });

    it("returns error schema on not found", async () => {
      vi.mocked(getBead).mockResolvedValue({ success: false, error: { code: "BEAD_NOT_FOUND", message: "Not found" } });

      const res = await request(app).get("/api/beads/adj-999");

      expect(res.status).toBe(404);
      const parsed = ApiErrorSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });
  });

  describe("PATCH /api/beads/:id", () => {
    it("response matches BeadUpdateResponseSchema", async () => {
      vi.mocked(updateBead).mockResolvedValue({
        success: true,
        data: { id: "adj-042", status: "closed", autoCompleted: ["adj-040"] },
      });

      const res = await request(app).patch("/api/beads/adj-042").send({ status: "closed" });

      expect(res.status).toBe(200);
      const parsed = BeadUpdateResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) console.error(parsed.error.issues);
    });

    it("returns 400 with error schema when no fields provided", async () => {
      const res = await request(app).patch("/api/beads/adj-042").send({});

      expect(res.status).toBe(400);
      const parsed = ApiErrorSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });
  });
});
