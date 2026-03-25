import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock dependencies before importing the router
vi.mock("../../src/services/projects-service.js", () => ({
  listProjects: vi.fn(),
  getProject: vi.fn(),
  createProject: vi.fn(),
  activateProject: vi.fn(),
  deleteProject: vi.fn(),
  discoverLocalProjects: vi.fn(),
  checkProjectHealth: vi.fn(),
  enableAutoDevelop: vi.fn(),
  disableAutoDevelop: vi.fn(),
  setVisionContext: vi.fn(),
}));

vi.mock("../../src/services/event-bus.js", () => ({
  getEventBus: vi.fn(() => ({
    emit: vi.fn(),
  })),
}));

vi.mock("../../src/services/files-service.js", () => ({
  listDirectory: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("../../src/services/beads/index.js", () => ({
  getProjectOverview: vi.fn(),
  computeEpicProgress: vi.fn(),
  getRecentlyCompletedEpics: vi.fn(),
}));

vi.mock("../../src/services/agents-service.js", () => ({
  getAgents: vi.fn(),
}));

import { createProjectsRouter } from "../../src/routes/projects.js";
import {
  getProject,
  enableAutoDevelop,
  disableAutoDevelop,
  setVisionContext,
} from "../../src/services/projects-service.js";
import { getEventBus } from "../../src/services/event-bus.js";
import type { MessageStore } from "../../src/services/message-store.js";
import type { ProposalStore } from "../../src/services/proposal-store.js";
import type { AutoDevelopStore } from "../../src/services/auto-develop-store.js";

/** Minimal mock MessageStore for the router factory. */
const mockMessageStore = {
  getUnreadCounts: vi.fn().mockReturnValue([]),
  getUnreadSummaries: vi.fn().mockReturnValue([]),
} as unknown as MessageStore;

const mockProposalStore = {
  getProposals: vi.fn().mockReturnValue([]),
} as unknown as ProposalStore;

const mockAutoDevelopStore = {
  getActiveCycle: vi.fn().mockReturnValue(null),
  getCycleHistory: vi.fn().mockReturnValue([]),
} as unknown as AutoDevelopStore;

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/projects", createProjectsRouter(mockMessageStore, mockProposalStore, mockAutoDevelopStore));
  return app;
}

const mockProject = {
  id: "proj-1",
  name: "test-project",
  path: "/tmp/test-project",
  mode: "swarm" as const,
  sessions: [],
  createdAt: "2026-03-24T00:00:00.000Z",
  active: true,
  autoDevelop: false,
};

const mockProjectWithAutoDevelop = {
  ...mockProject,
  autoDevelop: true,
};

describe("PATCH /api/projects/:id", () => {
  let app: express.Express;
  let mockEmit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    app = createTestApp();
    vi.clearAllMocks();
    mockEmit = vi.fn();
    vi.mocked(getEventBus).mockReturnValue({ emit: mockEmit } as ReturnType<typeof getEventBus>);
  });

  it("should enable auto-develop and emit event when autoDevelop is true", async () => {
    vi.mocked(getProject).mockReturnValue({ success: true, data: mockProject });
    vi.mocked(enableAutoDevelop).mockReturnValue({ success: true, data: mockProjectWithAutoDevelop });

    const response = await request(app)
      .patch("/api/projects/proj-1")
      .send({ autoDevelop: true });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.autoDevelop).toBe(true);
    expect(enableAutoDevelop).toHaveBeenCalledWith("proj-1");
    expect(mockEmit).toHaveBeenCalledWith("project:auto_develop_enabled", {
      projectId: "proj-1",
      projectName: "test-project",
      visionContext: undefined,
    });
  });

  it("should disable auto-develop and emit event when autoDevelop is false", async () => {
    vi.mocked(getProject).mockReturnValue({ success: true, data: mockProjectWithAutoDevelop });
    vi.mocked(disableAutoDevelop).mockReturnValue({ success: true, data: mockProject });

    const response = await request(app)
      .patch("/api/projects/proj-1")
      .send({ autoDevelop: false });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(disableAutoDevelop).toHaveBeenCalledWith("proj-1");
    expect(mockEmit).toHaveBeenCalledWith("project:auto_develop_disabled", {
      projectId: "proj-1",
      projectName: "test-project",
    });
  });

  it("should set vision context when visionContext is provided", async () => {
    const updatedProject = { ...mockProject, visionContext: "Build a chat app" };
    vi.mocked(getProject).mockReturnValue({ success: true, data: mockProject });
    vi.mocked(setVisionContext).mockReturnValue({ success: true, data: updatedProject });

    const response = await request(app)
      .patch("/api/projects/proj-1")
      .send({ visionContext: "Build a chat app" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(setVisionContext).toHaveBeenCalledWith("proj-1", "Build a chat app");
  });

  it("should enable auto-develop with vision context in one request", async () => {
    const updatedProject = { ...mockProjectWithAutoDevelop, visionContext: "Build a chat app" };
    vi.mocked(getProject).mockReturnValue({ success: true, data: mockProject });
    vi.mocked(enableAutoDevelop).mockReturnValue({ success: true, data: mockProjectWithAutoDevelop });
    vi.mocked(setVisionContext).mockReturnValue({ success: true, data: updatedProject });

    const response = await request(app)
      .patch("/api/projects/proj-1")
      .send({ autoDevelop: true, visionContext: "Build a chat app" });

    expect(response.status).toBe(200);
    expect(enableAutoDevelop).toHaveBeenCalledWith("proj-1");
    expect(setVisionContext).toHaveBeenCalledWith("proj-1", "Build a chat app");
    expect(mockEmit).toHaveBeenCalledWith("project:auto_develop_enabled", expect.objectContaining({
      projectId: "proj-1",
      visionContext: "Build a chat app",
    }));
  });

  it("should return 404 when project does not exist", async () => {
    vi.mocked(getProject).mockReturnValue({
      success: false,
      error: { code: "NOT_FOUND", message: "Project 'missing' not found" },
    });

    const response = await request(app)
      .patch("/api/projects/missing")
      .send({ autoDevelop: true });

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  });

  it("should return 400 when no update fields are provided", async () => {
    vi.mocked(getProject).mockReturnValue({ success: true, data: mockProject });

    const response = await request(app)
      .patch("/api/projects/proj-1")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("should return 400 for invalid body (autoDevelop not boolean)", async () => {
    const response = await request(app)
      .patch("/api/projects/proj-1")
      .send({ autoDevelop: "yes" });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("should return 500 when service call fails", async () => {
    vi.mocked(getProject).mockReturnValue({ success: true, data: mockProject });
    vi.mocked(enableAutoDevelop).mockReturnValue({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "DB failure" },
    });

    const response = await request(app)
      .patch("/api/projects/proj-1")
      .send({ autoDevelop: true });

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
  });

  it("should NOT call setVisionContext when enableAutoDevelop fails (adj-122.9.1 regression)", async () => {
    vi.mocked(getProject).mockReturnValue({ success: true, data: mockProject });
    vi.mocked(enableAutoDevelop).mockReturnValue({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Enable failed" },
    });

    const response = await request(app)
      .patch("/api/projects/proj-1")
      .send({ autoDevelop: true, visionContext: "Build a chat app" });

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    // The bug: setVisionContext was called even when enableAutoDevelop failed
    expect(setVisionContext).not.toHaveBeenCalled();
  });

  it("should NOT call setVisionContext when disableAutoDevelop fails (adj-122.9.1 regression)", async () => {
    vi.mocked(getProject).mockReturnValue({ success: true, data: mockProjectWithAutoDevelop });
    vi.mocked(disableAutoDevelop).mockReturnValue({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Disable failed" },
    });

    const response = await request(app)
      .patch("/api/projects/proj-1")
      .send({ autoDevelop: false, visionContext: "Build a chat app" });

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(setVisionContext).not.toHaveBeenCalled();
  });
});

describe("GET /api/projects/:id/auto-develop", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createTestApp();
    vi.clearAllMocks();
  });

  it("should return auto-develop status when enabled", async () => {
    vi.mocked(getProject).mockReturnValue({
      success: true,
      data: {
        ...mockProjectWithAutoDevelop,
        autoDevelopPausedAt: undefined,
        visionContext: "Build a chat app",
      },
    });

    const response = await request(app)
      .get("/api/projects/proj-1/auto-develop");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.enabled).toBe(true);
    expect(response.body.data.visionContext).toBe("Build a chat app");
    expect(response.body.data.proposals).toBeDefined();
    expect(response.body.data.cycleStats).toBeDefined();
  });

  it("should return 404 when project not found", async () => {
    vi.mocked(getProject).mockReturnValue({
      success: false,
      error: { code: "NOT_FOUND", message: "Project not found" },
    });

    const response = await request(app)
      .get("/api/projects/missing/auto-develop");

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  });

  it("should return 400 when auto-develop is not enabled", async () => {
    vi.mocked(getProject).mockReturnValue({
      success: true,
      data: mockProject,  // autoDevelop: false
    });

    const response = await request(app)
      .get("/api/projects/proj-1/auto-develop");

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });
});
