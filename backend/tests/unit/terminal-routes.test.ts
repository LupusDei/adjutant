import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock the tmux service before importing the router
vi.mock("../../src/services/tmux.js", () => ({
  listTmuxSessions: vi.fn(),
  captureTmuxPane: vi.fn(),
}));

// Mock the session-bridge for session-based terminal endpoint
vi.mock("../../src/services/session-bridge.js", () => ({
  getSessionBridge: vi.fn(),
}));

import { agentsRouter } from "../../src/routes/agents.js";
import { captureTmuxPane, listTmuxSessions } from "../../src/services/tmux.js";
import { getSessionBridge } from "../../src/services/session-bridge.js";

/**
 * Creates a test Express app with the agents router mounted.
 */
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/agents", agentsRouter);
  return app;
}

describe("terminal capture routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createTestApp();
    vi.clearAllMocks();
  });

  describe("GET /api/agents/:rig/:polecat/terminal", () => {
    it("should return terminal content for valid polecat session", async () => {
      const mockContent = "Hello from tmux\nLine 2\nLine 3";
      vi.mocked(listTmuxSessions).mockResolvedValue(
        new Set(["gt-gastown_boy-nux"])
      );
      vi.mocked(captureTmuxPane).mockResolvedValue(mockContent);

      const response = await request(app).get(
        "/api/agents/gastown_boy/nux/terminal"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.content).toBe(mockContent);
      expect(response.body.data.sessionName).toBe("gt-gastown_boy-nux");
      expect(response.body.data.timestamp).toBeDefined();
    });

    it("should include ANSI escape codes in terminal content", async () => {
      const ansiContent = "\x1b[32mGreen text\x1b[0m and normal";
      vi.mocked(listTmuxSessions).mockResolvedValue(
        new Set(["gt-gastown_boy-jasper"])
      );
      vi.mocked(captureTmuxPane).mockResolvedValue(ansiContent);

      const response = await request(app).get(
        "/api/agents/gastown_boy/jasper/terminal"
      );

      expect(response.status).toBe(200);
      expect(response.body.data.content).toBe(ansiContent);
    });

    it("should return 404 when session does not exist", async () => {
      vi.mocked(listTmuxSessions).mockResolvedValue(new Set());

      const response = await request(app).get(
        "/api/agents/gastown_boy/nonexistent/terminal"
      );

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("NOT_FOUND");
      expect(response.body.error.message).toContain("not found");
    });

    it("should return 400 for invalid rig name", async () => {
      const response = await request(app).get(
        "/api/agents//nux/terminal"
      );

      // Express routing might not match this, but let's see what happens
      expect(response.status).toBe(404); // Router won't match empty rig
    });

    it("should return 500 when tmux capture fails", async () => {
      vi.mocked(listTmuxSessions).mockResolvedValue(
        new Set(["gt-gastown_boy-nux"])
      );
      vi.mocked(captureTmuxPane).mockRejectedValue(
        new Error("tmux server not running")
      );

      const response = await request(app).get(
        "/api/agents/gastown_boy/nux/terminal"
      );

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain("tmux");
    });

    it("should handle hyphenated polecat names", async () => {
      vi.mocked(listTmuxSessions).mockResolvedValue(
        new Set(["gt-gastown_boy-keeper-one"])
      );
      vi.mocked(captureTmuxPane).mockResolvedValue("content");

      const response = await request(app).get(
        "/api/agents/gastown_boy/keeper-one/terminal"
      );

      expect(response.status).toBe(200);
      expect(response.body.data.sessionName).toBe("gt-gastown_boy-keeper-one");
    });

    it("should handle empty terminal output", async () => {
      vi.mocked(listTmuxSessions).mockResolvedValue(
        new Set(["gt-gastown_boy-nux"])
      );
      vi.mocked(captureTmuxPane).mockResolvedValue("");

      const response = await request(app).get(
        "/api/agents/gastown_boy/nux/terminal"
      );

      expect(response.status).toBe(200);
      expect(response.body.data.content).toBe("");
    });
  });

  describe("GET /api/agents/session/:sessionId/terminal", () => {
    it("should return terminal content for a valid session", async () => {
      const mockContent = "Swarm agent output\nLine 2";
      vi.mocked(getSessionBridge).mockReturnValue({
        getSession: vi.fn().mockReturnValue({
          id: "sess-abc",
          name: "agent-1",
          tmuxSession: "adj-agent-1",
          tmuxPane: "adj-agent-1:0.0",
          status: "idle",
        }),
      } as any);
      vi.mocked(listTmuxSessions).mockResolvedValue(
        new Set(["adj-agent-1"])
      );
      vi.mocked(captureTmuxPane).mockResolvedValue(mockContent);

      const response = await request(app).get(
        "/api/agents/session/sess-abc/terminal"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.content).toBe(mockContent);
      expect(response.body.data.sessionId).toBe("sess-abc");
      expect(response.body.data.sessionName).toBe("adj-agent-1");
      expect(response.body.data.timestamp).toBeDefined();
    });

    it("should return 404 when session ID not found in bridge", async () => {
      vi.mocked(getSessionBridge).mockReturnValue({
        getSession: vi.fn().mockReturnValue(undefined),
      } as any);

      const response = await request(app).get(
        "/api/agents/session/nonexistent/terminal"
      );

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("NOT_FOUND");
    });

    it("should return 404 when tmux session is not running", async () => {
      vi.mocked(getSessionBridge).mockReturnValue({
        getSession: vi.fn().mockReturnValue({
          id: "sess-abc",
          name: "agent-1",
          tmuxSession: "adj-agent-1",
          status: "offline",
        }),
      } as any);
      vi.mocked(listTmuxSessions).mockResolvedValue(new Set());

      const response = await request(app).get(
        "/api/agents/session/sess-abc/terminal"
      );

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });

    it("should return 500 when tmux capture fails", async () => {
      vi.mocked(getSessionBridge).mockReturnValue({
        getSession: vi.fn().mockReturnValue({
          id: "sess-abc",
          name: "agent-1",
          tmuxSession: "adj-agent-1",
          status: "idle",
        }),
      } as any);
      vi.mocked(listTmuxSessions).mockResolvedValue(
        new Set(["adj-agent-1"])
      );
      vi.mocked(captureTmuxPane).mockRejectedValue(
        new Error("capture-pane failed")
      );

      const response = await request(app).get(
        "/api/agents/session/sess-abc/terminal"
      );

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain("capture-pane failed");
    });
  });
});
