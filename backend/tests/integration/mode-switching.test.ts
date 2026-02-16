/**
 * Integration tests for mode switching.
 *
 * Verifies that switching between standalone, gastown, and swarm modes
 * correctly swaps providers and that endpoints respond appropriately
 * after a mode transition.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

// ===========================================================================
// Shared mutable state to simulate mode switching
// ===========================================================================

let currentMode: "standalone" | "gastown" | "swarm" = "standalone";
let gasTownAvailable = false;

// Workspace provider that respects current mode
vi.mock("../../src/services/workspace/index.js", () => {
  return {
    getWorkspace: () => ({
      name: currentMode,
      mode: currentMode,
      resolveRoot: () => "/tmp/test-project",
      loadConfig: async () => ({ name: "test-project" }),
      listBeadsDirs: async () => [],
      resolveBeadsDirFromId: async () => null,
      hasPowerControl: () => currentMode === "gastown",
      hasGtBinary: () => currentMode === "gastown",
      listRigNames: async () => [],
      resolveRigPath: () => null,
    }),
    resetWorkspace: vi.fn(),
    getDeploymentMode: () => currentMode,
    resolveWorkspaceRoot: () => "/tmp/test-project",
    listAllBeadsDirs: async () => [],
    resolveBeadsDirFromId: async () => null,
    hasPowerControl: () => currentMode === "gastown",
    hasGtBinary: () => currentMode === "gastown",
    listRigNames: async () => [],
    resolveRigPath: () => null,
    loadWorkspaceConfig: async () => ({ name: "test-project", owner: { name: "User", email: "" } }),
    resolveTownRoot: () => "/tmp/test-project",
  };
});

vi.mock("../../src/services/workspace/gastown-provider.js", () => ({
  isGasTownEnvironment: () => currentMode === "gastown",
  isGasTownAvailable: () => gasTownAvailable,
  GasTownProvider: class {},
}));

vi.mock("../../src/services/topology/index.js", () => ({
  getTopology: () => ({
    normalizeRole: (role: string) => role,
    parseAddress: (addr: string) => ({ address: addr, role: "agent", rig: null, name: addr }),
    buildAddress: (role: string, name: string) => `${role}/${name}`,
    listExpectedAgents: () => [],
  }),
  resetTopology: vi.fn(),
}));

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

vi.mock("../../src/services/status/index.js", () => ({
  getStatusProvider: () => ({
    name: currentMode,
    getStatus: async () => ({
      success: true,
      data: {
        powerState: "running",
        powerCapabilities: {
          canControl: currentMode === "gastown",
          autoStart: currentMode !== "gastown",
        },
        workspace: { name: "test-project", root: "/tmp/test-project" },
        operator: { name: "User", email: "", unreadMail: 0 },
        rigs: [],
        agents: [],
        fetchedAt: new Date().toISOString(),
      },
    }),
    getPowerCapabilities: () => ({
      canControl: currentMode === "gastown",
      autoStart: currentMode !== "gastown",
    }),
    hasPowerControl: () => currentMode === "gastown",
    powerUp: async () => {
      if (currentMode !== "gastown") {
        return { success: false, error: { code: "NOT_SUPPORTED", message: "Not available" } };
      }
      return { success: true, data: { powerState: "running", message: "Started" } };
    },
    powerDown: async () => {
      if (currentMode !== "gastown") {
        return { success: false, error: { code: "NOT_SUPPORTED", message: "Not available" } };
      }
      return { success: true, data: { powerState: "stopped", message: "Stopped" } };
    },
  }),
  resetStatusProvider: vi.fn(),
}));

vi.mock("../../src/services/agent-data.js", () => ({
  collectAgentSnapshot: async () => ({ agents: [], mailIndex: new Map() }),
}));

vi.mock("../../src/services/bd-client.js", () => ({
  execBd: async () => ({ success: false, exitCode: 1, error: { code: "NO_DB", message: "no beads database" } }),
  resolveBeadsDir: (dir: string) => `${dir}/.beads`,
  stripBeadPrefix: (id: string) => id.replace(/^[a-z0-9]{2,5}-/i, ""),
}));

vi.mock("../../src/services/tmux.js", () => ({
  captureTmuxPane: async () => "",
  listTmuxSessions: async () => new Set<string>(),
}));

vi.mock("../../src/services/event-bus.js", () => ({
  getEventBus: () => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn(), removeAllListeners: vi.fn() }),
}));

vi.mock("../../src/services/session-bridge.js", () => ({
  getSessionBridge: () => ({
    getSessions: () => [],
    getSession: () => null,
    createSession: async () => ({ success: false }),
    killSession: async () => ({ success: false }),
  }),
}));

vi.mock("../../src/services/swarm-service.js", () => ({
  listSwarms: () => [],
  getSwarmStatus: () => undefined,
  createSwarm: async () => ({ success: false, error: "Not available" }),
  addAgentToSwarm: async () => ({ success: false, error: "Not available" }),
  removeAgentFromSwarm: async () => false,
  destroySwarm: async () => false,
  getSwarmBranches: async () => undefined,
  mergeAgentBranch: async () => ({ success: false }),
}));

vi.mock("../../src/services/gastown-workspace.js", () => ({
  resolveTownRoot: () => "/tmp/test-project",
}));

vi.mock("../../src/services/mode-service.js", () => ({
  getModeInfo: () => ({
    mode: currentMode,
    features: currentMode === "standalone" ? ["chat", "beads"] : currentMode === "gastown" ? ["power_control", "rigs", "epics", "mail"] : ["chat", "crew_flat", "beads", "mail"],
    availableModes: [
      { mode: "gastown", available: gasTownAvailable },
      { mode: "standalone", available: true },
      { mode: "swarm", available: true },
    ],
  }),
  switchMode: (mode: string) => {
    if (mode === "gastown" && !gasTownAvailable) {
      return { success: false, error: { code: "MODE_UNAVAILABLE", message: "Gas Town not available" } };
    }
    currentMode = mode as "standalone" | "gastown" | "swarm";
    return {
      success: true,
      data: {
        mode: currentMode,
        features: currentMode === "standalone" ? ["chat", "beads"] : currentMode === "gastown" ? ["power_control", "rigs"] : ["chat", "crew_flat"],
        availableModes: [
          { mode: "gastown", available: gasTownAvailable },
          { mode: "standalone", available: true },
          { mode: "swarm", available: true },
        ],
      },
    };
  },
}));

vi.mock("../../src/middleware/index.js", () => ({
  apiKeyAuth: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

// ===========================================================================
// Test App
// ===========================================================================

import {
  agentsRouter,
  modeRouter,
  powerRouter,
  statusRouter,
} from "../../src/routes/index.js";

function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/agents", agentsRouter);
  app.use("/api/mode", modeRouter);
  app.use("/api/power", powerRouter);
  app.use("/api/status", statusRouter);
  app.use(((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: err.message } });
  }) as express.ErrorRequestHandler);
  return app;
}

// ===========================================================================
// Tests
// ===========================================================================

describe("mode switching integration", () => {
  let app: express.Express;

  beforeEach(() => {
    currentMode = "standalone";
    gasTownAvailable = false;
    app = createApp();
  });

  afterEach(() => {
    currentMode = "standalone";
    gasTownAvailable = false;
  });

  describe("standalone → swarm transition", () => {
    it("starts in standalone mode", async () => {
      const res = await request(app).get("/api/mode");
      expect(res.body.data.mode).toBe("standalone");
    });

    it("can switch to swarm mode", async () => {
      const res = await request(app)
        .post("/api/mode")
        .send({ mode: "swarm" });
      expect(res.status).toBe(200);
      expect(res.body.data.mode).toBe("swarm");
    });

    it("mode endpoint reflects swarm after switch", async () => {
      await request(app).post("/api/mode").send({ mode: "swarm" });
      const res = await request(app).get("/api/mode");
      expect(res.body.data.mode).toBe("swarm");
    });
  });

  describe("gastown availability", () => {
    it("cannot switch to gastown when unavailable", async () => {
      gasTownAvailable = false;
      const res = await request(app)
        .post("/api/mode")
        .send({ mode: "gastown" });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("can switch to gastown when available", async () => {
      gasTownAvailable = true;
      const res = await request(app)
        .post("/api/mode")
        .send({ mode: "gastown" });
      expect(res.status).toBe(200);
      expect(res.body.data.mode).toBe("gastown");
    });

    it("gastown mode enables power control", async () => {
      gasTownAvailable = true;
      await request(app).post("/api/mode").send({ mode: "gastown" });

      const res = await request(app).get("/api/power/capabilities");
      expect(res.body.data.canControl).toBe(true);
    });
  });

  describe("power control varies by mode", () => {
    it("standalone mode rejects power up", async () => {
      const res = await request(app).post("/api/power/up");
      expect(res.status).toBe(400);
    });

    it("standalone mode rejects power down", async () => {
      const res = await request(app).post("/api/power/down");
      expect(res.status).toBe(400);
    });

    it("standalone status shows autoStart=true", async () => {
      const res = await request(app).get("/api/status");
      expect(res.body.data.powerCapabilities.autoStart).toBe(true);
      expect(res.body.data.powerCapabilities.canControl).toBe(false);
    });
  });

  describe("agents endpoint across modes", () => {
    it("returns empty in standalone mode", async () => {
      const res = await request(app).get("/api/agents");
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it("returns empty in swarm mode (no agents running)", async () => {
      await request(app).post("/api/mode").send({ mode: "swarm" });
      const res = await request(app).get("/api/agents");
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  describe("round-trip mode switching", () => {
    it("standalone → swarm → standalone preserves functionality", async () => {
      // Start standalone
      let res = await request(app).get("/api/mode");
      expect(res.body.data.mode).toBe("standalone");

      // Switch to swarm
      await request(app).post("/api/mode").send({ mode: "swarm" });
      res = await request(app).get("/api/mode");
      expect(res.body.data.mode).toBe("swarm");

      // Switch back to standalone
      await request(app).post("/api/mode").send({ mode: "standalone" });
      res = await request(app).get("/api/mode");
      expect(res.body.data.mode).toBe("standalone");

      // Verify endpoints still work
      res = await request(app).get("/api/status");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
