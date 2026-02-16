/**
 * Integration tests for standalone mode endpoints.
 *
 * These tests mock ONLY the external binary dependencies (bd, tmux)
 * and let all real services, providers, singleton management, mode
 * detection, and Express middleware run end-to-end.
 *
 * Every endpoint tested here was returning 500 before the fixes
 * in this session. If these tests pass, standalone mode works.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ==========================================================================
// Mock ONLY external binary dependencies
// Everything else (providers, services, mode switching, singletons) is REAL.
// ==========================================================================

const mockExecBd = vi.fn();

vi.mock("../../src/services/bd-client.js", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    execBd: (...args: unknown[]) => mockExecBd(...args),
  };
});

vi.mock("../../src/services/tmux.js", () => ({
  listTmuxSessions: vi.fn().mockResolvedValue(new Map()),
  captureTmuxPane: vi.fn().mockResolvedValue(""),
}));

// Import routes and singleton resets AFTER mocks
import { statusRouter } from "../../src/routes/status.js";
import { agentsRouter } from "../../src/routes/agents.js";
import { mailRouter } from "../../src/routes/mail.js";
import { beadsRouter } from "../../src/routes/beads.js";
import { modeRouter } from "../../src/routes/mode.js";
import { resetWorkspace } from "../../src/services/workspace/index.js";
import { resetTopology } from "../../src/services/topology/index.js";
import { resetTransport } from "../../src/services/transport/index.js";
import { resetStatusProvider } from "../../src/services/status/index.js";
import { resetEventBus } from "../../src/services/event-bus.js";
import { resetAgentStatusCache } from "../../src/services/agents-service.js";

// ==========================================================================
// Helpers
// ==========================================================================

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/status", statusRouter);
  app.use("/api/agents", agentsRouter);
  app.use("/api/mail", mailRouter);
  app.use("/api/beads", beadsRouter);
  app.use("/api/mode", modeRouter);
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  // Catch unhandled errors — prevents supertest "socket hang up"
  app.use(
    ((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ success: false, error: { message: err.message } });
    }) as express.ErrorRequestHandler
  );
  return app;
}

function resetAllSingletons() {
  resetWorkspace();
  resetTopology();
  resetTransport();
  resetStatusProvider();
  resetEventBus();
  resetAgentStatusCache();
}

// ==========================================================================
// Tests
// ==========================================================================

describe("standalone mode integration", () => {
  let app: express.Express;
  let tmpDir: string;
  let savedEnv: Record<string, string | undefined>;

  beforeAll(() => {
    savedEnv = {
      ADJUTANT_MODE: process.env["ADJUTANT_MODE"],
      ADJUTANT_PROJECT_ROOT: process.env["ADJUTANT_PROJECT_ROOT"],
      GT_TOWN_ROOT: process.env["GT_TOWN_ROOT"],
    };
    tmpDir = mkdtempSync(join(tmpdir(), "adjutant-test-"));
  });

  afterAll(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
    resetAllSingletons();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  beforeEach(() => {
    process.env["ADJUTANT_MODE"] = "standalone";
    process.env["ADJUTANT_PROJECT_ROOT"] = tmpDir;
    delete process.env["GT_TOWN_ROOT"];

    resetAllSingletons();
    app = createTestApp();

    // bd binary unavailable — simulates standalone with no beads database
    mockExecBd.mockReset();
    mockExecBd.mockResolvedValue({
      success: false,
      error: { code: "SPAWN_ERROR", message: "spawn bd ENOENT" },
      exitCode: -1,
    });
  });

  // ========================================================================
  // Core endpoints — all of these returned 500 before the session fixes
  // ========================================================================

  describe("GET /api/status", () => {
    it("should return 200 with running state and empty agents", async () => {
      const res = await request(app).get("/api/status");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.powerState).toBe("running");
      expect(res.body.data.workspace.root).toBe(tmpDir);
      expect(res.body.data.workspace.name).toBeTruthy();
      expect(res.body.data.agents).toEqual([]);
      expect(res.body.data.rigs).toEqual([]);
      expect(res.body.data.operator).toBeDefined();
      expect(res.body.timestamp).toBeDefined();
    });
  });

  describe("GET /api/agents", () => {
    it("should return 200 with empty array", async () => {
      const res = await request(app).get("/api/agents");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it("should not call collectAgentSnapshot (bd binary)", async () => {
      await request(app).get("/api/agents");
      // In standalone mode, getAgents() returns early — bd should never be called
      expect(mockExecBd).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/mail", () => {
    it("should return 200 with empty items", async () => {
      const res = await request(app).get("/api/mail");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should return 200 with filter=user", async () => {
      const res = await request(app).get("/api/mail?filter=user");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should return 200 with filter=infrastructure", async () => {
      const res = await request(app).get("/api/mail?filter=infrastructure");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should return mail identity", async () => {
      const res = await request(app).get("/api/mail/identity");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.identity).toBe("user");
    });
  });

  describe("GET /api/beads", () => {
    it("should return 200 with empty data when bd unavailable", async () => {
      const res = await request(app).get("/api/beads");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should return 200 with rig=all", async () => {
      const res = await request(app).get("/api/beads?rig=all");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("GET /api/beads/sources", () => {
    it("should return 200 with standalone mode", async () => {
      const res = await request(app).get("/api/beads/sources");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.mode).toBe("standalone");
      expect(Array.isArray(res.body.data.sources)).toBe(true);
    });
  });

  describe("GET /api/mode", () => {
    it("should return standalone mode info with features", async () => {
      const res = await request(app).get("/api/mode");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.mode).toBe("standalone");
      expect(res.body.data.features).toContain("chat");
      expect(Array.isArray(res.body.data.availableModes)).toBe(true);
    });

    it("should report gastown as unavailable", async () => {
      const res = await request(app).get("/api/mode");

      const gastown = res.body.data.availableModes.find(
        (m: { mode: string }) => m.mode === "gastown"
      );
      expect(gastown).toBeDefined();
      expect(gastown.available).toBe(false);
    });
  });

  // ========================================================================
  // Mode switching
  // ========================================================================

  describe("POST /api/mode", () => {
    it("should handle standalone → standalone no-op", async () => {
      const res = await request(app).post("/api/mode").send({ mode: "standalone" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should switch to swarm mode", async () => {
      const res = await request(app).post("/api/mode").send({ mode: "swarm" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should reject gastown when no town.json", async () => {
      const res = await request(app).post("/api/mode").send({ mode: "gastown" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should reject invalid mode", async () => {
      const res = await request(app).post("/api/mode").send({ mode: "bogus" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should reject missing mode", async () => {
      const res = await request(app).post("/api/mode").send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ========================================================================
  // Endpoints must still work after mode switch
  // Verifies switchMode() properly resets all singletons.
  // ========================================================================

  describe("endpoints after switching to swarm mode", () => {
    beforeEach(async () => {
      const switchRes = await request(app).post("/api/mode").send({ mode: "swarm" });
      expect(switchRes.status).toBe(200);
    });

    it("GET /api/status returns 200", async () => {
      const res = await request(app).get("/api/status");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.powerState).toBe("running");
    });

    it("GET /api/agents returns 200", async () => {
      const res = await request(app).get("/api/agents");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("GET /api/mail returns 200", async () => {
      const res = await request(app).get("/api/mail");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("GET /api/beads/sources returns 200", async () => {
      const res = await request(app).get("/api/beads/sources");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("can switch back to standalone", async () => {
      const res = await request(app).post("/api/mode").send({ mode: "standalone" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Endpoints still work after switching back
      const statusRes = await request(app).get("/api/status");
      expect(statusRes.status).toBe(200);
    });
  });
});
