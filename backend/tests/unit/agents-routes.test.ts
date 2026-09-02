import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock the fleet roster before importing the router.
//
// adj-xugvt: the route used to pass `agents-service.getAgents()` straight
// through — the TMUX-derived listing — so an agent live over MCP with no local
// session (a worktree agent, or the Grok-hosted "Adjudicator") was absent from
// REST while MCP `list_agents` showed it. The route now serves the merged
// roster, so REST and MCP answer with the same fleet.
vi.mock("../../src/services/agent-roster.js", () => ({
  getFleetRoster: vi.fn(),
}));

import { agentsRouter } from "../../src/routes/agents.js";
import { getFleetRoster } from "../../src/services/agent-roster.js";
import type { CrewMember } from "../../src/types/index.js";

/**
 * Creates a test Express app with the agents router mounted.
 */
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/agents", agentsRouter);
  return app;
}

/**
 * Creates a mock CrewMember for testing.
 */
function createMockAgent(overrides: Partial<CrewMember> = {}): CrewMember {
  return {
    id: "proj1/nux",
    name: "nux",
    type: "agent",
    project: "proj1",
    status: "working",
    ...overrides,
  };
}

describe("agents routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createTestApp();
    vi.clearAllMocks();
  });

  describe("GET /api/agents", () => {
    it("should return empty array when no agents", async () => {
      vi.mocked(getFleetRoster).mockResolvedValue([]);

      const response = await request(app).get("/api/agents");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
      expect(response.body.timestamp).toBeDefined();
    });

    it("should return list of agents", async () => {
      const mockAgents = [
        createMockAgent({ id: "user-1", name: "user-1", type: "user", project: null }),
        createMockAgent({ id: "proj1/scout", name: "scout", type: "agent" }),
        createMockAgent({ id: "proj1/nux", name: "nux", type: "agent" }),
      ];

      vi.mocked(getFleetRoster).mockResolvedValue(mockAgents);

      const response = await request(app).get("/api/agents");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(3);
      expect(response.body.data[0].name).toBe("user-1");
      expect(response.body.data[1].type).toBe("agent");
      expect(response.body.data[2].project).toBe("proj1");
    });

    it("should return agents with various statuses", async () => {
      const mockAgents = [
        createMockAgent({ id: "user-1", name: "user-1", status: "working", currentTask: "Managing workspace" }),
        createMockAgent({ id: "proj1/nux", name: "nux", status: "idle" }),
        createMockAgent({ id: "proj1/furiosa", name: "furiosa", status: "blocked" }),
        createMockAgent({ id: "scout", name: "scout", status: "offline" }),
      ];

      vi.mocked(getFleetRoster).mockResolvedValue(mockAgents);

      const response = await request(app).get("/api/agents");

      expect(response.status).toBe(200);
      expect(response.body.data[0].status).toBe("working");
      expect(response.body.data[0].currentTask).toBe("Managing workspace");
      expect(response.body.data[1].status).toBe("idle");
      expect(response.body.data[2].status).toBe("blocked");
      expect(response.body.data[3].status).toBe("offline");
    });

    it("should return 500 when the roster cannot be built at all", async () => {
      vi.mocked(getFleetRoster).mockRejectedValue(new Error("gt agents list command failed"));

      const response = await request(app).get("/api/agents");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("INTERNAL_ERROR");
      expect(response.body.error.message).toBe("gt agents list command failed");
    });

    it("should return 500 with a default message when the failure carries none", async () => {
      vi.mocked(getFleetRoster).mockRejectedValue(new Error(""));

      const response = await request(app).get("/api/agents");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe("Failed to get agents list");
    });

    it("should list an agent that is live over MCP with no local session (adj-xugvt)", async () => {
      // The Adjudicator case: MCP list_agents showed it, REST did not, and the
      // coordinator concluded a real agent did not exist. Both must agree.
      vi.mocked(getFleetRoster).mockResolvedValue([
        { ...createMockAgent({ id: "kerrigan", name: "kerrigan" }), transport: "tmux", injectable: true },
        {
          ...createMockAgent({ id: "Adjudicator", name: "Adjudicator", project: null, status: "idle" }),
          isLive: true,
          transport: "mcp",
          injectable: false,
        },
      ]);

      const response = await request(app).get("/api/agents");

      expect(response.status).toBe(200);
      expect(response.body.data.map((a: CrewMember) => a.name)).toEqual(["kerrigan", "Adjudicator"]);
      // The distinction the old split hid: reachable, but not injectable.
      expect(response.body.data[1].injectable).toBe(false);
      expect(response.body.data[1].transport).toBe("mcp");
    });

    it("should return agents with different types", async () => {
      const mockAgents = [
        createMockAgent({ type: "user" }),
        createMockAgent({ type: "agent" }),
      ];

      vi.mocked(getFleetRoster).mockResolvedValue(mockAgents);

      const response = await request(app).get("/api/agents");

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data.map((a: CrewMember) => a.type)).toEqual([
        "user",
        "agent",
      ]);
    });
  });
});
