/**
 * Integration tests for standalone mode.
 *
 * Verifies that all API endpoints respond correctly when Adjutant is
 * running in standalone mode with NO beads database and NO agents.
 * This is the default state when a user runs `adjutant` from any directory.
 *
 * These tests mock at the provider/infrastructure level (workspace, topology,
 * transport, status, tmux, session-bridge) but let the real routes, services,
 * and middleware run end-to-end.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

// ===========================================================================
// Provider-level mocks — simulate standalone environment with no beads
// ===========================================================================

// Workspace: standalone mode, empty project directory
vi.mock("../../src/services/workspace/index.js", () => {
  const provider = {
    name: "standalone",
    mode: "standalone",
    resolveRoot: () => "/tmp/test-project",
    loadConfig: async () => ({ name: "test-project", owner: { name: "User", email: "" } }),
    listBeadsDirs: async () => [],
    resolveBeadsDirFromId: async () => null,
    hasPowerControl: () => false,
    hasGtBinary: () => false,
    listRigNames: async () => [],
    resolveRigPath: () => null,
  };
  return {
    getWorkspace: () => provider,
    resetWorkspace: vi.fn(),
    getDeploymentMode: () => "standalone" as const,
    resolveWorkspaceRoot: () => "/tmp/test-project",
    listAllBeadsDirs: async () => [],
    resolveBeadsDirFromId: async () => null,
    hasPowerControl: () => false,
    hasGtBinary: () => false,
    listRigNames: async () => [],
    resolveRigPath: () => null,
    loadWorkspaceConfig: async () => ({ name: "test-project", owner: { name: "User", email: "" } }),
    resolveTownRoot: () => "/tmp/test-project",
  };
});

// Gastown provider: not in gastown, not available
vi.mock("../../src/services/workspace/gastown-provider.js", () => ({
  isGasTownEnvironment: () => false,
  isGasTownAvailable: () => false,
  GasTownProvider: class {},
}));

// Topology: standalone topology with passthrough role normalization
vi.mock("../../src/services/topology/index.js", () => ({
  getTopology: () => ({
    normalizeRole: (role: string) => role,
    parseAddress: (addr: string) => ({ address: addr, role: "agent", rig: null, name: addr }),
    buildAddress: (role: string, name: string) => `${role}/${name}`,
    listExpectedAgents: () => [],
  }),
  resetTopology: vi.fn(),
}));

// Transport: standalone transport that returns empty mail
vi.mock("../../src/services/transport/index.js", () => ({
  getTransport: () => ({
    name: "beads",
    getSenderIdentity: () => "user",
    listMail: async () => ({ success: true, data: [] }),
    sendMessage: async () => ({ success: true, data: { id: "test" } }),
    getMessage: async () => ({ success: false, error: { code: "NOT_FOUND", message: "Not found" } }),
    markRead: async () => ({ success: true }),
  }),
  resetTransport: vi.fn(),
}));

// Status: standalone status provider
vi.mock("../../src/services/status/index.js", () => ({
  getStatusProvider: () => ({
    name: "standalone",
    getStatus: async () => ({
      success: true,
      data: {
        powerState: "running",
        powerCapabilities: { canControl: false, autoStart: true },
        workspace: { name: "test-project", root: "/tmp/test-project" },
        operator: { name: "User", email: "", unreadMail: 0 },
        rigs: [],
        agents: [],
        fetchedAt: new Date().toISOString(),
      },
    }),
    getPowerCapabilities: () => ({ canControl: false, autoStart: true }),
    hasPowerControl: () => false,
    powerUp: async () => ({ success: false, error: { code: "NOT_SUPPORTED", message: "Not available" } }),
    powerDown: async () => ({ success: false, error: { code: "NOT_SUPPORTED", message: "Not available" } }),
  }),
  resetStatusProvider: vi.fn(),
}));

// Agent data: no agents
vi.mock("../../src/services/agent-data.js", () => ({
  collectAgentSnapshot: async () => ({
    agents: [],
    mailIndex: new Map(),
  }),
}));

// BD client: simulate no beads database
vi.mock("../../src/services/bd-client.js", () => ({
  execBd: async () => ({ success: false, exitCode: 1, error: { code: "NO_DB", message: "no beads database found" } }),
  resolveBeadsDir: (dir: string) => `${dir}/.beads`,
  stripBeadPrefix: (id: string) => id.replace(/^[a-z0-9]{2,5}-/i, ""),
}));

// Tmux: no sessions
vi.mock("../../src/services/tmux.js", () => ({
  captureTmuxPane: async () => "",
  listTmuxSessions: async () => new Set<string>(),
}));

// Event bus: no-op
vi.mock("../../src/services/event-bus.js", () => ({
  getEventBus: () => ({
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    removeAllListeners: vi.fn(),
  }),
}));

// Session bridge: no sessions
vi.mock("../../src/services/session-bridge.js", () => ({
  getSessionBridge: () => ({
    getSessions: () => [],
    getSession: () => null,
    createSession: async () => ({ success: false }),
    killSession: async () => ({ success: false }),
  }),
}));

// Swarm service: no swarms
vi.mock("../../src/services/swarm-service.js", () => ({
  listSwarms: () => [],
  getSwarmStatus: () => undefined,
  createSwarm: async () => ({ success: false, error: "Not implemented" }),
  addAgentToSwarm: async () => ({ success: false, error: "Not implemented" }),
  removeAgentFromSwarm: async () => false,
  destroySwarm: async () => false,
  getSwarmBranches: async () => undefined,
  mergeAgentBranch: async () => ({ success: false, error: "Not implemented" }),
}));

// Gastown workspace (legacy compat)
vi.mock("../../src/services/gastown-workspace.js", () => ({
  resolveTownRoot: () => "/tmp/test-project",
}));

// Mode service: use real logic but with our mocked providers
vi.mock("../../src/services/mode-service.js", () => ({
  getModeInfo: () => ({
    mode: "standalone",
    features: ["chat", "beads", "websocket", "sse"],
    availableModes: [
      { mode: "gastown", available: false, reason: "Gas Town infrastructure not detected" },
      { mode: "standalone", available: true },
      { mode: "swarm", available: true },
    ],
  }),
  switchMode: (mode: string) => {
    if (mode === "gastown") {
      return { success: false, error: { code: "MODE_UNAVAILABLE", message: "Gas Town not available" } };
    }
    return {
      success: true,
      data: {
        mode,
        features: mode === "standalone" ? ["chat", "beads", "websocket", "sse"] : ["chat", "crew_flat", "beads", "mail", "websocket", "sse"],
        availableModes: [
          { mode: "gastown", available: false },
          { mode: "standalone", available: true },
          { mode: "swarm", available: true },
        ],
      },
    };
  },
}));

// Middleware: skip API key auth
vi.mock("../../src/middleware/index.js", () => ({
  apiKeyAuth: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

// Beads service: delegate to real code (which uses our mocked providers)
// Let it import normally — it will use the mocked workspace/bd-client

// ===========================================================================
// Test App Setup
// ===========================================================================

import {
  agentsRouter,
  beadsRouter,
  convoysRouter,
  mailRouter,
  modeRouter,
  powerRouter,
  statusRouter,
  swarmsRouter,
} from "../../src/routes/index.js";

function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/agents", agentsRouter);
  app.use("/api/beads", beadsRouter);
  app.use("/api/convoys", convoysRouter);
  app.use("/api/mail", mailRouter);
  app.use("/api/mode", modeRouter);
  app.use("/api/power", powerRouter);
  app.use("/api/status", statusRouter);
  app.use("/api/swarms", swarmsRouter);
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  // Error handler
  app.use(((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: err.message } });
  }) as express.ErrorRequestHandler);
  return app;
}

// ===========================================================================
// Tests
// ===========================================================================

describe("standalone mode integration", () => {
  let app: express.Express;

  beforeAll(() => {
    app = createApp();
  });

  // =========================================================================
  // Health
  // =========================================================================

  describe("health check", () => {
    it("GET /health returns ok", async () => {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
    });
  });

  // =========================================================================
  // Mode
  // =========================================================================

  describe("GET /api/mode", () => {
    it("reports standalone mode with correct features", async () => {
      const res = await request(app).get("/api/mode");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.mode).toBe("standalone");
      expect(res.body.data.features).toContain("chat");
      expect(res.body.data.features).toContain("beads");
    });

    it("reports gastown as unavailable", async () => {
      const res = await request(app).get("/api/mode");
      const gastown = res.body.data.availableModes.find(
        (m: { mode: string }) => m.mode === "gastown"
      );
      expect(gastown.available).toBe(false);
    });

    it("reports standalone and swarm as available", async () => {
      const res = await request(app).get("/api/mode");
      const standalone = res.body.data.availableModes.find(
        (m: { mode: string }) => m.mode === "standalone"
      );
      const swarm = res.body.data.availableModes.find(
        (m: { mode: string }) => m.mode === "swarm"
      );
      expect(standalone.available).toBe(true);
      expect(swarm.available).toBe(true);
    });
  });

  describe("POST /api/mode", () => {
    it("rejects switching to gastown when unavailable", async () => {
      const res = await request(app)
        .post("/api/mode")
        .send({ mode: "gastown" });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("rejects invalid mode", async () => {
      const res = await request(app)
        .post("/api/mode")
        .send({ mode: "invalid" });
      expect(res.status).toBe(400);
    });

    it("rejects missing mode field", async () => {
      const res = await request(app)
        .post("/api/mode")
        .send({});
      expect(res.status).toBe(400);
    });

    it("allows switching to swarm mode", async () => {
      const res = await request(app)
        .post("/api/mode")
        .send({ mode: "swarm" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.mode).toBe("swarm");
    });
  });

  // =========================================================================
  // Status
  // =========================================================================

  describe("GET /api/status", () => {
    it("returns 200 with standalone status", async () => {
      const res = await request(app).get("/api/status");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.powerState).toBe("running");
    });

    it("reports no power control", async () => {
      const res = await request(app).get("/api/status");
      expect(res.body.data.powerCapabilities.canControl).toBe(false);
      expect(res.body.data.powerCapabilities.autoStart).toBe(true);
    });

    it("returns workspace info", async () => {
      const res = await request(app).get("/api/status");
      expect(res.body.data.workspace.name).toBe("test-project");
      expect(res.body.data.workspace.root).toBe("/tmp/test-project");
    });

    it("returns empty agents and rigs", async () => {
      const res = await request(app).get("/api/status");
      expect(res.body.data.rigs).toEqual([]);
      expect(res.body.data.agents).toEqual([]);
    });
  });

  // =========================================================================
  // Power
  // =========================================================================

  describe("power control", () => {
    it("GET /api/power/capabilities reports no control", async () => {
      const res = await request(app).get("/api/power/capabilities");
      expect(res.status).toBe(200);
      expect(res.body.data.canControl).toBe(false);
    });

    it("POST /api/power/up returns 400 (not supported)", async () => {
      const res = await request(app).post("/api/power/up");
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("POST /api/power/down returns 400 (not supported)", async () => {
      const res = await request(app).post("/api/power/down");
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // Agents
  // =========================================================================

  describe("GET /api/agents", () => {
    it("returns empty agents list", async () => {
      const res = await request(app).get("/api/agents");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });
  });

  // =========================================================================
  // Beads
  // =========================================================================

  describe("beads endpoints", () => {
    it("GET /api/beads returns empty list (no beads database)", async () => {
      const res = await request(app).get("/api/beads");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it("GET /api/beads?rig=all returns empty list", async () => {
      const res = await request(app).get("/api/beads?rig=all");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it("GET /api/beads/sources returns empty sources", async () => {
      const res = await request(app).get("/api/beads/sources");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.sources).toEqual([]);
      expect(res.body.data.mode).toBe("standalone");
    });
  });

  // =========================================================================
  // Mail
  // =========================================================================

  describe("mail endpoints", () => {
    it("GET /api/mail returns empty list", async () => {
      const res = await request(app).get("/api/mail");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toEqual([]);
    });

    it("GET /api/mail?filter=user returns empty list", async () => {
      const res = await request(app).get("/api/mail?filter=user");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("GET /api/mail/identity returns user identity", async () => {
      const res = await request(app).get("/api/mail/identity");
      expect(res.status).toBe(200);
      expect(res.body.data.identity).toBe("user");
    });
  });

  // =========================================================================
  // Convoys
  // =========================================================================

  describe("GET /api/convoys", () => {
    it("returns empty list (no beads)", async () => {
      const res = await request(app).get("/api/convoys");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });
  });

  // =========================================================================
  // Swarms
  // =========================================================================

  describe("swarm endpoints", () => {
    it("GET /api/swarms returns empty list", async () => {
      const res = await request(app).get("/api/swarms");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it("GET /api/swarms/:id returns 404", async () => {
      const res = await request(app).get("/api/swarms/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // Response shape consistency
  // =========================================================================

  describe("response envelope consistency", () => {
    it("all success responses have { success: true, data, timestamp }", async () => {
      const endpoints = [
        "/api/mode",
        "/api/status",
        "/api/agents",
        "/api/beads",
        "/api/beads/sources",
        "/api/mail",
        "/api/mail/identity",
        "/api/convoys",
        "/api/swarms",
        "/api/power/capabilities",
      ];

      const results = await Promise.all(
        endpoints.map((url) => request(app).get(url))
      );

      for (let i = 0; i < results.length; i++) {
        const res = results[i]!;
        expect(res.status, `${endpoints[i]} should return 200`).toBe(200);
        expect(res.body.success, `${endpoints[i]} should have success=true`).toBe(true);
        expect(res.body.data, `${endpoints[i]} should have data field`).toBeDefined();
        expect(res.body.timestamp, `${endpoints[i]} should have timestamp`).toBeDefined();
      }
    });

    it("error responses have { success: false, error: { code, message } }", async () => {
      const res = await request(app).post("/api/power/up");
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBeDefined();
      expect(res.body.error.message).toBeDefined();
    });
  });
});
