import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock the session bridge before importing the router
const mockBridge = {
  listSessions: vi.fn(),
  getSession: vi.fn(),
  createSession: vi.fn(),
  connectClient: vi.fn(),
  disconnectClient: vi.fn(),
  sendInput: vi.fn(),
  sendInterrupt: vi.fn(),
  sendPermissionResponse: vi.fn(),
  killSession: vi.fn(),
};

vi.mock("../../src/services/session-bridge.js", () => ({
  getSessionBridge: () => mockBridge,
}));

import { sessionsRouter } from "../../src/routes/sessions.js";

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/sessions", sessionsRouter);
  return app;
}

describe("sessions routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createTestApp();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // GET /api/sessions
  // ==========================================================================

  describe("GET /api/sessions", () => {
    it("should return empty array when no sessions", async () => {
      mockBridge.listSessions.mockReturnValue([]);

      const response = await request(app).get("/api/sessions");
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
    });

    it("should return list of sessions", async () => {
      mockBridge.listSessions.mockReturnValue([
        {
          id: "session-1",
          name: "agent-1",
          tmuxSession: "adj-1",
          projectPath: "/project",
          mode: "swarm",
          status: "idle",
          workspaceType: "primary",
          connectedClients: [],
          tmuxPane: "adj-1:0.0",
          pipeActive: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          lastActivity: "2026-01-01T00:00:00.000Z",
        },
      ]);

      const response = await request(app).get("/api/sessions");
      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe("agent-1");
    });
  });

  // ==========================================================================
  // GET /api/sessions/:id
  // ==========================================================================

  describe("GET /api/sessions/:id", () => {
    it("should return session details", async () => {
      mockBridge.getSession.mockReturnValue({
        id: "session-1",
        name: "test",
        status: "working",
      });

      const response = await request(app).get("/api/sessions/session-1");
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe("test");
    });

    it("should return 404 for unknown session", async () => {
      mockBridge.getSession.mockReturnValue(undefined);

      const response = await request(app).get("/api/sessions/unknown");
      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  // ==========================================================================
  // POST /api/sessions
  // ==========================================================================

  describe("POST /api/sessions", () => {
    it("should create a new session", async () => {
      mockBridge.createSession.mockResolvedValue({
        success: true,
        sessionId: "new-session-id",
      });
      mockBridge.getSession.mockReturnValue({
        id: "new-session-id",
        name: "my-agent",
        status: "working",
      });

      const response = await request(app)
        .post("/api/sessions")
        .send({ name: "my-agent", projectPath: "/home/user/project" });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe("my-agent");
    });

    it("should auto-generate name when name is missing", async () => {
      mockBridge.createSession.mockResolvedValue({
        success: true,
        sessionId: "auto-session-id",
      });
      mockBridge.getSession.mockReturnValue({
        id: "auto-session-id",
        name: "tmp-agent",
        status: "working",
      });

      const response = await request(app)
        .post("/api/sessions")
        .send({ projectPath: "/tmp" });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe("tmp-agent");
    });

    it("should return 400 when projectPath is missing", async () => {
      const response = await request(app)
        .post("/api/sessions")
        .send({ name: "agent" });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should return 400 when creation fails", async () => {
      mockBridge.createSession.mockResolvedValue({
        success: false,
        error: "Session limit reached",
      });

      const response = await request(app)
        .post("/api/sessions")
        .send({ name: "agent", projectPath: "/tmp" });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe("Session limit reached");
    });

    it("should accept optional mode and workspaceType", async () => {
      mockBridge.createSession.mockResolvedValue({
        success: true,
        sessionId: "id",
      });
      mockBridge.getSession.mockReturnValue({
        id: "id",
        name: "swarm-worker",
        mode: "swarm",
        workspaceType: "worktree",
      });

      const response = await request(app).post("/api/sessions").send({
        name: "swarm-worker",
        projectPath: "/tmp",
        mode: "swarm",
        workspaceType: "worktree",
      });

      expect(response.status).toBe(201);
      expect(mockBridge.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "swarm",
          workspaceType: "worktree",
        })
      );
    });
  });

  // ==========================================================================
  // POST /api/sessions/:id/connect
  // ==========================================================================

  describe("POST /api/sessions/:id/connect", () => {
    it("should connect a client to a session", async () => {
      mockBridge.connectClient.mockResolvedValue({
        success: true,
        buffer: ["line 1", "line 2"],
      });

      const response = await request(app)
        .post("/api/sessions/session-1/connect")
        .send({ clientId: "client-1", replay: true });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.connected).toBe(true);
      expect(response.body.data.buffer).toEqual(["line 1", "line 2"]);
    });

    it("should return 400 when clientId is missing", async () => {
      const response = await request(app)
        .post("/api/sessions/session-1/connect")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should return 400 when connection fails", async () => {
      mockBridge.connectClient.mockResolvedValue({
        success: false,
        error: "Session is offline",
      });

      const response = await request(app)
        .post("/api/sessions/session-1/connect")
        .send({ clientId: "client-1" });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe("Session is offline");
    });
  });

  // ==========================================================================
  // POST /api/sessions/:id/disconnect
  // ==========================================================================

  describe("POST /api/sessions/:id/disconnect", () => {
    it("should disconnect a client", async () => {
      mockBridge.disconnectClient.mockResolvedValue(undefined);

      const response = await request(app)
        .post("/api/sessions/session-1/disconnect")
        .send({ clientId: "client-1" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.disconnected).toBe(true);
    });

    it("should return 400 when clientId is missing", async () => {
      const response = await request(app)
        .post("/api/sessions/session-1/disconnect")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  // ==========================================================================
  // POST /api/sessions/:id/input
  // ==========================================================================

  describe("POST /api/sessions/:id/input", () => {
    it("should send text input to session", async () => {
      mockBridge.sendInput.mockResolvedValue(true);

      const response = await request(app)
        .post("/api/sessions/session-1/input")
        .send({ text: "Fix the login bug" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.sent).toBe(true);
    });

    it("should return 400 when text is missing", async () => {
      const response = await request(app)
        .post("/api/sessions/session-1/input")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should return 400 when send fails", async () => {
      mockBridge.sendInput.mockResolvedValue(false);

      const response = await request(app)
        .post("/api/sessions/session-1/input")
        .send({ text: "hello" });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  // ==========================================================================
  // POST /api/sessions/:id/interrupt
  // ==========================================================================

  describe("POST /api/sessions/:id/interrupt", () => {
    it("should send interrupt to session", async () => {
      mockBridge.sendInterrupt.mockResolvedValue(true);

      const response = await request(app).post(
        "/api/sessions/session-1/interrupt"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.interrupted).toBe(true);
    });

    it("should return 400 when interrupt fails", async () => {
      mockBridge.sendInterrupt.mockResolvedValue(false);

      const response = await request(app).post(
        "/api/sessions/session-1/interrupt"
      );

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  // ==========================================================================
  // POST /api/sessions/:id/permission
  // ==========================================================================

  describe("POST /api/sessions/:id/permission", () => {
    it("should send approved permission response", async () => {
      mockBridge.sendPermissionResponse.mockResolvedValue(true);

      const response = await request(app)
        .post("/api/sessions/session-1/permission")
        .send({ approved: true });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it("should send denied permission response", async () => {
      mockBridge.sendPermissionResponse.mockResolvedValue(true);

      const response = await request(app)
        .post("/api/sessions/session-1/permission")
        .send({ approved: false });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it("should return 400 when approved field is missing", async () => {
      const response = await request(app)
        .post("/api/sessions/session-1/permission")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should return 400 when permission send fails", async () => {
      mockBridge.sendPermissionResponse.mockResolvedValue(false);

      const response = await request(app)
        .post("/api/sessions/session-1/permission")
        .send({ approved: true });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  // ==========================================================================
  // DELETE /api/sessions/:id
  // ==========================================================================

  describe("DELETE /api/sessions/:id", () => {
    it("should kill a session", async () => {
      mockBridge.killSession.mockResolvedValue(true);

      const response = await request(app).delete("/api/sessions/session-1");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.killed).toBe(true);
    });

    it("should return 404 when session not found", async () => {
      mockBridge.killSession.mockResolvedValue(false);

      const response = await request(app).delete("/api/sessions/unknown");

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });
});
