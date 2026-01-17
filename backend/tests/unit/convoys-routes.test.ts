import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock the convoys-service before importing the router
vi.mock("../../src/services/convoys-service.js", () => ({
  listConvoys: vi.fn(),
}));

import { convoysRouter } from "../../src/routes/convoys.js";
import { listConvoys } from "../../src/services/convoys-service.js";
import type { Convoy, TrackedIssue } from "../../src/types/convoys.js";

/**
 * Creates a test Express app with the convoys router mounted.
 */
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/convoys", convoysRouter);
  return app;
}

/**
 * Creates a mock tracked issue for testing.
 */
function createMockTrackedIssue(overrides: Partial<TrackedIssue> = {}): TrackedIssue {
  return {
    id: "hq-t001",
    title: "Test Issue",
    status: "open",
    ...overrides,
  };
}

/**
 * Creates a mock convoy for testing.
 */
function createMockConvoy(overrides: Partial<Convoy> = {}): Convoy {
  return {
    id: "hq-c001",
    title: "Test Convoy",
    status: "open",
    rig: "gastown_boy",
    progress: {
      completed: 2,
      total: 5,
    },
    trackedIssues: [
      createMockTrackedIssue({ id: "hq-t001", status: "closed" }),
      createMockTrackedIssue({ id: "hq-t002", status: "closed" }),
      createMockTrackedIssue({ id: "hq-t003", status: "open" }),
      createMockTrackedIssue({ id: "hq-t004", status: "in_progress" }),
      createMockTrackedIssue({ id: "hq-t005", status: "open" }),
    ],
    ...overrides,
  };
}

describe("convoys routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createTestApp();
    vi.clearAllMocks();
  });

  describe("GET /api/convoys", () => {
    it("should return empty array when no convoys", async () => {
      vi.mocked(listConvoys).mockResolvedValue({
        success: true,
        data: [],
      });

      const response = await request(app).get("/api/convoys");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
    });

    it("should return list of convoys", async () => {
      const mockConvoys = [
        createMockConvoy({ id: "hq-c001", title: "Feature A" }),
        createMockConvoy({ id: "hq-c002", title: "Feature B" }),
      ];

      vi.mocked(listConvoys).mockResolvedValue({
        success: true,
        data: mockConvoys,
      });

      const response = await request(app).get("/api/convoys");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0].title).toBe("Feature A");
      expect(response.body.data[1].title).toBe("Feature B");
    });

    it("should include convoy progress", async () => {
      const mockConvoys = [
        createMockConvoy({
          progress: { completed: 3, total: 10 },
        }),
      ];

      vi.mocked(listConvoys).mockResolvedValue({
        success: true,
        data: mockConvoys,
      });

      const response = await request(app).get("/api/convoys");

      expect(response.status).toBe(200);
      expect(response.body.data[0].progress.completed).toBe(3);
      expect(response.body.data[0].progress.total).toBe(10);
    });

    it("should include tracked issues", async () => {
      const mockConvoys = [
        createMockConvoy({
          trackedIssues: [
            createMockTrackedIssue({ id: "hq-t001", title: "Fix login", status: "closed" }),
            createMockTrackedIssue({ id: "hq-t002", title: "Add tests", status: "open" }),
          ],
        }),
      ];

      vi.mocked(listConvoys).mockResolvedValue({
        success: true,
        data: mockConvoys,
      });

      const response = await request(app).get("/api/convoys");

      expect(response.status).toBe(200);
      expect(response.body.data[0].trackedIssues).toHaveLength(2);
      expect(response.body.data[0].trackedIssues[0].title).toBe("Fix login");
      expect(response.body.data[0].trackedIssues[1].status).toBe("open");
    });

    it("should include convoy rig information", async () => {
      const mockConvoys = [
        createMockConvoy({ rig: "gastown_boy" }),
        createMockConvoy({ rig: null }), // Town-level convoy
      ];

      vi.mocked(listConvoys).mockResolvedValue({
        success: true,
        data: mockConvoys,
      });

      const response = await request(app).get("/api/convoys");

      expect(response.status).toBe(200);
      expect(response.body.data[0].rig).toBe("gastown_boy");
      expect(response.body.data[1].rig).toBeNull();
    });

    it("should return 500 on service error", async () => {
      vi.mocked(listConvoys).mockResolvedValue({
        success: false,
        error: { code: "CONVOYS_ERROR", message: "Failed to fetch convoys" },
      });

      const response = await request(app).get("/api/convoys");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("INTERNAL_ERROR");
      expect(response.body.error.message).toBe("Failed to fetch convoys");
    });

    it("should return 500 with default message on unknown error", async () => {
      vi.mocked(listConvoys).mockResolvedValue({
        success: false,
        error: undefined,
      });

      const response = await request(app).get("/api/convoys");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe("Failed to list convoys");
    });
  });
});
