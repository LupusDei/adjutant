/**
 * Agents API contract tests.
 *
 * Validates agent endpoint responses match declared Zod schemas.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ============================================================================
// Mocks
// ============================================================================

vi.mock("../../src/services/agents-service.js", () => ({
  getAgents: vi.fn(),
}));

// Mock all other agent route dependencies to prevent import errors
vi.mock("../../src/services/agent-spawner-service.js", () => ({
  spawnAgent: vi.fn(),
}));

vi.mock("../../src/services/session-bridge.js", () => ({
  getSessionBridge: vi.fn().mockReturnValue({
    registry: { findByName: vi.fn().mockReturnValue([]) },
    captureOutput: vi.fn().mockResolvedValue(""),
  }),
}));

vi.mock("../../src/services/lifecycle-manager.js", () => ({
  getLifecycleManager: vi.fn().mockReturnValue({
    registry: { findByName: vi.fn().mockReturnValue([]) },
  }),
}));

vi.mock("../../src/services/callsign-service.js", () => ({
  getCallsignService: vi.fn().mockReturnValue({
    acquireCallsign: vi.fn().mockReturnValue("nux"),
  }),
}));

import { agentsRouter } from "../../src/routes/agents.js";
import { getAgents } from "../../src/services/agents-service.js";
import { AgentListResponseSchema, ApiErrorSchema } from "../../src/types/api-contracts.js";

// ============================================================================
// Fixtures
// ============================================================================

const MOCK_CREW_MEMBER = {
  id: "adjutant/kerrigan",
  name: "kerrigan",
  type: "agent",
  project: "adjutant",
  status: "working" as const,
  currentTask: "Implementing API contract tests",
  unreadMail: 2,
  firstSubject: "Status update request",
  firstFrom: "user",
  branch: "main",
  sessionId: "sess-abc123",
  lastActivity: "2026-03-11T12:00:00.000Z",
  progress: { completed: 3, total: 5 },
  cost: 1.50,
  contextPercent: 42,
};

// ============================================================================
// Tests
// ============================================================================

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/agents", agentsRouter);
  return app;
}

describe("Agents API contracts", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createTestApp();
    vi.clearAllMocks();
  });

  describe("GET /api/agents", () => {
    it("response matches AgentListResponseSchema", async () => {
      vi.mocked(getAgents).mockResolvedValue({ success: true, data: [MOCK_CREW_MEMBER] });

      const res = await request(app).get("/api/agents");

      expect(res.status).toBe(200);
      const parsed = AgentListResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) console.error(parsed.error.issues);
    });

    it("includes all optional CrewMember fields when present", async () => {
      vi.mocked(getAgents).mockResolvedValue({ success: true, data: [MOCK_CREW_MEMBER] });

      const res = await request(app).get("/api/agents");
      const agent = res.body.data[0];

      expect(agent.progress).toEqual({ completed: 3, total: 5 });
      expect(agent.cost).toBe(1.50);
      expect(agent.contextPercent).toBe(42);
      expect(agent.sessionId).toBe("sess-abc123");
    });

    it("returns empty array when no agents", async () => {
      vi.mocked(getAgents).mockResolvedValue({ success: true, data: [] });

      const res = await request(app).get("/api/agents");

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });
});
