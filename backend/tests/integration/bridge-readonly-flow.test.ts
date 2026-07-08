/**
 * Integration smoke — read-only Fleet Briefing flow (adj-202.3.8 / T027).
 *
 * Exercises the Bridge end-to-end IN-PROCESS: the REAL bridge router mounted on an express
 * app, wired to the REAL session broker (real cost guard, fake Runway client — NO live Runway)
 * and the REAL read-only tool bridge (real whitelist + envelope; the lowest service-layer
 * boundaries are mocked with REAL data shapes per Constitution Rule 1).
 *
 * The flow proven here is the briefing's spine:
 *   POST /api/bridge/session            → managed session create → one-shot creds (no secret)
 *   POST /api/bridge/tool get_project_state → AUTHORITATIVE structured shape (grounding source
 *                                              of truth: project-scoped vs fleet-wide split)
 *   POST /api/bridge/tool create_bead   → whitelist reject (403, fail-closed)
 *   POST /api/bridge/session (ceiling)  → structured 429, NO Runway session created
 *
 * The LIVE avatar render/audio smoke stays MANUAL (documented in
 * specs/060-the-bridge-voice-coordinator/research.md) — this test never calls Runway.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---- Mock the lowest service-layer boundaries the tool bridge delegates to ----
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

const mockGetConnectedAgents = vi.fn();
vi.mock("../../src/services/mcp-server.js", () => ({
  getConnectedAgents: (...args: unknown[]) => mockGetConnectedAgents(...args),
}));

const mockGetProject = vi.fn();
vi.mock("../../src/services/projects-service.js", () => ({
  getProject: (...args: unknown[]) => mockGetProject(...args),
}));

const mockExecBd = vi.fn();
const mockResolveBeadsDir = vi.fn();
vi.mock("../../src/services/bd-client.js", () => ({
  execBd: (...args: unknown[]) => mockExecBd(...args),
  resolveBeadsDir: (...args: unknown[]) => mockResolveBeadsDir(...args),
}));

const mockGetAgents = vi.fn();
vi.mock("../../src/services/agents-service.js", () => ({
  getAgents: (...args: unknown[]) => mockGetAgents(...args),
}));

const mockBuildAutoDevelopStatus = vi.fn();
vi.mock("../../src/services/auto-develop-status.js", () => ({
  buildAutoDevelopStatus: (...args: unknown[]) => mockBuildAutoDevelopStatus(...args),
}));

// ---- Import after mocks are set up ----
import { createBridgeRouter } from "../../src/routes/bridge.js";
import {
  BridgeSessionBroker,
  type RunwaySessionApi,
} from "../../src/services/bridge-session-broker.js";
import { BridgeCostGuard, computeSessionMeter } from "../../src/services/bridge-cost-guard.js";
import { createBridgeToolBridge, type BridgeToolDeps } from "../../src/services/bridge-tool-bridge.js";
import type { ProposalStore } from "../../src/services/proposal-store.js";
import type { RealtimeSessionRow } from "../../src/services/runway-client.js";

// ============================================================================
// Fixtures (REAL data shapes)
// ============================================================================

const PROJECT_ID = "0e578d15-1111-2222-3333-444455556666";
const AVATAR_ID = "8ac1dce0-cf52-4b72-bd3d-84ecc6a5f6c9";
const PROJECT = {
  id: PROJECT_ID,
  name: "adjutant",
  path: "/Users/x/code/adjutant",
  autoDevelop: true,
  autoDevelopPausedAt: null,
  visionContext: null,
  autoDevelopProductOwner: null,
};

// Real `bd list --json` shape — 1 open + 1 closed ⇒ openBeads = 1 (project-scoped).
const REAL_BD_LIST_OUTPUT = [
  {
    id: "adj-202.3",
    title: "Phase 1: Fleet Briefing MVP",
    description: "Read-only briefing flow.",
    status: "open",
    priority: 1,
    issue_type: "epic",
    owner: "lupusdei108@gmail.com",
    created_at: "2026-06-27T14:10:19Z",
    updated_at: "2026-06-27T14:10:19Z",
    dependencies: [],
    dependency_count: 0,
    dependent_count: 1,
    comment_count: 0,
  },
  {
    id: "adj-202.3.5",
    title: "routes/bridge.ts (TDD)",
    description: "Bridge HTTP surface.",
    status: "closed",
    priority: 1,
    issue_type: "task",
    owner: "lupusdei108@gmail.com",
    created_at: "2026-06-27T14:10:30Z",
    updated_at: "2026-06-27T18:00:00Z",
    closed_at: "2026-06-27T18:00:00Z",
    dependencies: [],
    dependency_count: 0,
    dependent_count: 1,
    comment_count: 0,
  },
];

// Real READY session row (sessionKey "stk_…" appears only once READY).
const READY_ROW: RealtimeSessionRow = {
  id: "sess-int-1",
  status: "READY",
  expiresAt: "2026-06-27T15:05:00.000Z",
  sessionKey: "stk_integration",
};

/** Minimal tool-bridge deps; only messageStore is touched by get_project_state. */
function makeToolDeps(): BridgeToolDeps {
  return {
    messageStore: {
      getMessages: vi.fn().mockReturnValue([{ id: "m1" }, { id: "m2" }, { id: "m3" }]),
      getUnreadCounts: vi.fn().mockReturnValue([{ agentId: "x", count: 4 }]),
    } as unknown as BridgeToolDeps["messageStore"],
    proposalStore: {} as ProposalStore,
    autoDevelopStore: undefined,
    questionService: { listQuestions: vi.fn().mockReturnValue([]) },
  };
}

/** A fake Runway client that creates and immediately reports READY (no network). */
function fakeReadyClient(): RunwaySessionApi & { createSpy: ReturnType<typeof vi.fn> } {
  const createSpy = vi.fn(async () => ({ id: READY_ROW.id }) as RealtimeSessionRow);
  return {
    createSpy,
    createRealtimeSession: createSpy,
    getRealtimeSession: async () => READY_ROW,
    connectBackend: async (sessionId: string) => ({ url: "wss://lk", token: "t", roomName: `rt_${sessionId}` }),
  };
}

function mountApp(broker: BridgeSessionBroker) {
  const app = express();
  app.use(express.json());
  app.use("/api/bridge", createBridgeRouter({ broker, toolBridge: createBridgeToolBridge(makeToolDeps()) }));
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveBeadsDir.mockReturnValue("/Users/x/code/adjutant/.beads");
  mockGetProject.mockReturnValue({ success: true, data: PROJECT });
  mockExecBd.mockResolvedValue({ success: true, exitCode: 0, data: REAL_BD_LIST_OUTPUT });
  mockGetConnectedAgents.mockReturnValue([
    { agentId: "adjutant/Raynor", sessionId: "s1", connectedAt: new Date(), projectContext: { projectId: PROJECT_ID } },
    { agentId: "other/Kerrigan", sessionId: "s2", connectedAt: new Date(), projectContext: { projectId: "other-uuid" } },
  ]);
});

describe("Bridge read-only flow (integration, in-process)", () => {
  it("opens a session then returns the authoritative project-state shape", async () => {
    const client = fakeReadyClient();
    const broker = new BridgeSessionBroker({
      client,
      costGuard: new BridgeCostGuard({ dailyCreditCeiling: 1000 }),
      avatarId: AVATAR_ID,
      pollIntervalMs: 1,
      sleepFn: () => Promise.resolve(),
    });
    const app = mountApp(broker);

    // 1. Open a managed avatar session (in-process create → READY).
    const sessionRes = await request(app).post("/api/bridge/session").send({});
    expect(sessionRes.status).toBe(200);
    expect(sessionRes.body.success).toBe(true);
    expect(sessionRes.body.data).toEqual({
      sessionId: READY_ROW.id,
      sessionKey: READY_ROW.sessionKey,
      avatarId: AVATAR_ID,
      expiresAt: READY_ROW.expiresAt,
    });
    // Secret never leaves the server — only the short-lived sessionKey is returned.
    expect(JSON.stringify(sessionRes.body.data)).not.toMatch(/secret|apiKey|Bearer|RUNWAYML/i);
    expect(client.createSpy).toHaveBeenCalledTimes(1);

    // 2. Ask for the fleet/project state — the authoritative result the voice narrates.
    const toolRes = await request(app)
      .post("/api/bridge/tool")
      .send({ tool: "get_project_state", projectId: PROJECT_ID });

    expect(toolRes.status).toBe(200);
    expect(toolRes.body.success).toBe(true);
    expect(toolRes.body.data.tool).toBe("get_project_state");
    expect(toolRes.body.data.projectId).toBe(PROJECT_ID);

    const data = toolRes.body.data.data;
    // Grounding contract: project-scoped vs fleet-wide are explicitly separated.
    expect(data.projectId).toBe(PROJECT_ID);
    expect(data.project).toEqual({ connectedAgents: 1, openBeads: 1 });
    expect(data.fleet.recentMessages).toBe(3);
    expect(data.fleet.unreadCounts).toHaveLength(1);
    // No flat fleet-wide field leaks at the top level.
    expect(data.connectedAgents).toBeUndefined();
    expect(data.recentMessages).toBeUndefined();
  });

  it("rejects a non-whitelisted tool with 403 (fail-closed)", async () => {
    const broker = new BridgeSessionBroker({
      client: fakeReadyClient(),
      costGuard: new BridgeCostGuard({ dailyCreditCeiling: 1000 }),
      avatarId: AVATAR_ID,
      pollIntervalMs: 1,
      sleepFn: () => Promise.resolve(),
    });
    const app = mountApp(broker);

    const res = await request(app).post("/api/bridge/tool").send({ tool: "create_bead", projectId: PROJECT_ID });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("TOOL_NOT_ALLOWED");
    // Fail-closed: a write tool never reaches the service layer.
    expect(mockExecBd).not.toHaveBeenCalled();
  });

  it("returns a structured 429 and creates NO Runway session when the daily ceiling is tripped", async () => {
    const upfront = computeSessionMeter(0).credits;
    const costGuard = new BridgeCostGuard({ dailyCreditCeiling: upfront });
    costGuard.recordSpend(upfront); // already at the ceiling for today
    const client = fakeReadyClient();
    const broker = new BridgeSessionBroker({
      client,
      costGuard,
      avatarId: AVATAR_ID,
      pollIntervalMs: 1,
      sleepFn: () => Promise.resolve(),
    });
    const app = mountApp(broker);

    const res = await request(app).post("/api/bridge/session").send({});

    expect(res.status).toBe(429);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("DAILY_CREDIT_CEILING_REACHED");
    // Cost gate runs FIRST — no billable Runway session is created when blocked.
    expect(client.createSpy).not.toHaveBeenCalled();
  });
});
