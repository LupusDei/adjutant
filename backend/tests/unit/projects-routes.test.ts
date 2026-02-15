import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock the projects-service before importing the router
vi.mock("../../src/services/projects-service.js", () => ({
  listProjects: vi.fn(),
  getProject: vi.fn(),
  createProject: vi.fn(),
  activateProject: vi.fn(),
  deleteProject: vi.fn(),
}));

import { projectsRouter } from "../../src/routes/projects.js";
import {
  listProjects,
  getProject,
  createProject,
  activateProject,
  deleteProject,
} from "../../src/services/projects-service.js";
import type { Project, ProjectsServiceResult } from "../../src/services/projects-service.js";

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/projects", projectsRouter);
  return app;
}

function createMockProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "abcd1234",
    name: "test-project",
    path: "/Users/test/code/test-project",
    mode: "standalone",
    sessions: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    active: false,
    ...overrides,
  };
}

describe("projects routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createTestApp();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // GET /api/projects
  // ===========================================================================

  describe("GET /api/projects", () => {
    it("should return list of projects", async () => {
      const projects = [createMockProject(), createMockProject({ id: "p2", name: "other" })];
      vi.mocked(listProjects).mockReturnValue({ success: true, data: projects });

      const response = await request(app).get("/api/projects");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
    });

    it("should return empty list when no projects", async () => {
      vi.mocked(listProjects).mockReturnValue({ success: true, data: [] });

      const response = await request(app).get("/api/projects");

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
    });

    it("should return 500 on service error", async () => {
      vi.mocked(listProjects).mockReturnValue({
        success: false,
        error: { code: "INTERNAL_ERROR", message: "Disk read failed" },
      });

      const response = await request(app).get("/api/projects");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });
  });

  // ===========================================================================
  // GET /api/projects/:id
  // ===========================================================================

  describe("GET /api/projects/:id", () => {
    it("should return single project", async () => {
      const project = createMockProject({ id: "p1" });
      vi.mocked(getProject).mockReturnValue({ success: true, data: project });

      const response = await request(app).get("/api/projects/p1");

      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe("p1");
    });

    it("should return 404 for unknown project", async () => {
      vi.mocked(getProject).mockReturnValue({
        success: false,
        error: { code: "NOT_FOUND", message: "Project 'xyz' not found" },
      });

      const response = await request(app).get("/api/projects/xyz");

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  // ===========================================================================
  // POST /api/projects
  // ===========================================================================

  describe("POST /api/projects", () => {
    it("should create project from path", async () => {
      const project = createMockProject();
      vi.mocked(createProject).mockReturnValue({ success: true, data: project });

      const response = await request(app)
        .post("/api/projects")
        .send({ path: "/Users/test/code/test-project" });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe("test-project");
    });

    it("should create project from clone URL", async () => {
      const project = createMockProject({ gitRemote: "git@github.com:user/repo.git" });
      vi.mocked(createProject).mockReturnValue({ success: true, data: project });

      const response = await request(app)
        .post("/api/projects")
        .send({ cloneUrl: "git@github.com:user/repo.git" });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    it("should create empty project", async () => {
      const project = createMockProject({ name: "new-proj" });
      vi.mocked(createProject).mockReturnValue({ success: true, data: project });

      const response = await request(app)
        .post("/api/projects")
        .send({ name: "new-proj", empty: true });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    it("should return 400 for invalid input", async () => {
      const response = await request(app)
        .post("/api/projects")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should return 400 for validation error from service", async () => {
      vi.mocked(createProject).mockReturnValue({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Path does not exist" },
      });

      const response = await request(app)
        .post("/api/projects")
        .send({ path: "/nonexistent" });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe("Path does not exist");
    });

    it("should return 409 for conflict", async () => {
      vi.mocked(createProject).mockReturnValue({
        success: false,
        error: { code: "CONFLICT", message: "Already registered" },
      });

      const response = await request(app)
        .post("/api/projects")
        .send({ path: "/existing/path" });

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
    });

    it("should return 500 for CLI error", async () => {
      vi.mocked(createProject).mockReturnValue({
        success: false,
        error: { code: "CLI_ERROR", message: "Git clone failed" },
      });

      const response = await request(app)
        .post("/api/projects")
        .send({ cloneUrl: "git@bad.git" });

      expect(response.status).toBe(500);
      expect(response.body.error.message).toBe("Git clone failed");
    });
  });

  // ===========================================================================
  // POST /api/projects/:id/activate
  // ===========================================================================

  describe("POST /api/projects/:id/activate", () => {
    it("should activate project", async () => {
      const project = createMockProject({ id: "p1", active: true });
      vi.mocked(activateProject).mockReturnValue({ success: true, data: project });

      const response = await request(app).post("/api/projects/p1/activate");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.active).toBe(true);
    });

    it("should return 404 for unknown project", async () => {
      vi.mocked(activateProject).mockReturnValue({
        success: false,
        error: { code: "NOT_FOUND", message: "Project 'xyz' not found" },
      });

      const response = await request(app).post("/api/projects/xyz/activate");

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  // ===========================================================================
  // DELETE /api/projects/:id
  // ===========================================================================

  describe("DELETE /api/projects/:id", () => {
    it("should delete project registration", async () => {
      vi.mocked(deleteProject).mockReturnValue({
        success: true,
        data: { id: "p1", deleted: true },
      });

      const response = await request(app).delete("/api/projects/p1");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.deleted).toBe(true);
    });

    it("should return 404 for unknown project", async () => {
      vi.mocked(deleteProject).mockReturnValue({
        success: false,
        error: { code: "NOT_FOUND", message: "Project 'xyz' not found" },
      });

      const response = await request(app).delete("/api/projects/xyz");

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });
});
