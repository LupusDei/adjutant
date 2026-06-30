/**
 * Tests for the Bridge REST routes (adj-202.3.5).
 *
 * Routes are thin HTTP adapters over the session broker + read-only tool bridge.
 * Both deps are fully mocked; tests assert status codes, response envelopes, Zod
 * validation, the cost-ceiling → 429 mapping, and the tool-error → status mapping
 * (whitelist reject → 403). Auth (apiKeyAuth) is applied at mount time in index.ts,
 * not inside the router, so it is not exercised here.
 *
 * Coverage:
 *   POST /api/bridge/session — success, ceiling-tripped (429), upstream failure (502), validation (400)
 *   POST /api/bridge/tool    — success, whitelist reject (403), validation (400, no delegate),
 *                              project-not-found (404), tool-failed (500)
 */

import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

import { createBridgeRouter } from "../../src/routes/bridge.js";
import { BridgeCostCeilingError } from "../../src/services/bridge-session-broker.js";
import type { BridgeSessionCreds } from "../../src/services/bridge-session-broker.js";
import type { BridgeToolResult } from "../../src/services/bridge-tool-bridge.js";
import { BRIDGE_RPC_TOOLS, BRIDGE_RPC_PERSONALITY } from "../../src/services/bridge-rpc-tools.js";

const CREDS: BridgeSessionCreds = {
  sessionId: "sess-1",
  sessionKey: "stk_abc",
  avatarId: "8ac1dce0-cf52-4b72-bd3d-84ecc6a5f6c9",
  expiresAt: "2026-06-27T14:47:01.147Z",
};

function makeApp(deps: {
  startSession?: ReturnType<typeof vi.fn>;
  executeTool?: ReturnType<typeof vi.fn>;
  attach?: ReturnType<typeof vi.fn>;
  /** Set false to mount WITHOUT the rpc manager (pre-202.7 behaviour). */
  withRpcManager?: boolean;
  /** adj-202.6.4 — optional memory-seed builder (omitted ⇒ unseeded sessions). */
  buildMemorySeed?: (() => string | null) | undefined;
}) {
  const broker = { startSession: deps.startSession ?? vi.fn().mockResolvedValue(CREDS) };
  const toolBridge = {
    executeTool:
      deps.executeTool ??
      vi.fn().mockResolvedValue({ ok: true, tool: "list_agents", projectId: null, data: { agents: [] } }),
  };
  const rpcManager = { attach: deps.attach ?? vi.fn().mockResolvedValue(undefined) };
  const app = express();
  app.use(express.json());
  app.use(
    "/api/bridge",
    createBridgeRouter(
      deps.withRpcManager === false
        ? { broker, toolBridge, buildMemorySeed: deps.buildMemorySeed }
        : { broker, toolBridge, rpcManager, buildMemorySeed: deps.buildMemorySeed },
    ),
  );
  return { app, broker, toolBridge, rpcManager };
}

describe("bridge-routes: POST /api/bridge/session", () => {
  it("should return 200 with one-shot creds on success", async () => {
    const startSession = vi.fn().mockResolvedValue(CREDS);
    const { app } = makeApp({ startSession });

    const res = await request(app).post("/api/bridge/session").send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(CREDS);
    expect(startSession).toHaveBeenCalledTimes(1);
  });

  it("should always tool-enable the session: pass the read-only RPC tools + tool-aware persona", async () => {
    const startSession = vi.fn().mockResolvedValue(CREDS);
    const { app } = makeApp({ startSession });

    await request(app).post("/api/bridge/session").send({});

    const opts = startSession.mock.calls[0]![0];
    expect(opts.tools).toEqual(BRIDGE_RPC_TOOLS);
    // No base persona supplied ⇒ the default tool-aware persona is used verbatim.
    expect(opts.personality).toBe(BRIDGE_RPC_PERSONALITY);
  });

  it("should compose a supplied base personality with the tool guidance, and forward startScript", async () => {
    const startSession = vi.fn().mockResolvedValue(CREDS);
    const { app } = makeApp({ startSession });

    await request(app)
      .post("/api/bridge/session")
      .send({ personality: "You are the Adjutant.", startScript: "Commander, status nominal." });

    const opts = startSession.mock.calls[0]![0];
    expect(opts.personality.startsWith("You are the Adjutant.")).toBe(true);
    expect(opts.personality).toContain("list_agents");
    expect(opts.startScript).toBe("Commander, status nominal.");
  });

  it("should seed the personality with recalled memory when a seed builder is provided (adj-202.6.4)", async () => {
    const startSession = vi.fn().mockResolvedValue(CREDS);
    const buildMemorySeed = vi.fn(() => "WHAT YOU ALREADY KNOW:\n- [operational/deploy] prefers blue-green");
    const { app } = makeApp({ startSession, buildMemorySeed });

    await request(app).post("/api/bridge/session").send({});

    const opts = startSession.mock.calls[0]![0];
    expect(buildMemorySeed).toHaveBeenCalledTimes(1);
    // Tool guidance is still present AND the recalled memory is appended.
    expect(opts.personality).toContain("list_agents");
    expect(opts.personality).toContain("prefers blue-green");
  });

  it("should leave the personality unseeded when the seed builder returns null (blank slate)", async () => {
    const startSession = vi.fn().mockResolvedValue(CREDS);
    const buildMemorySeed = vi.fn(() => null);
    const { app } = makeApp({ startSession, buildMemorySeed });

    await request(app).post("/api/bridge/session").send({});

    const opts = startSession.mock.calls[0]![0];
    expect(opts.personality).toBe(BRIDGE_RPC_PERSONALITY);
  });

  it("should still open a session if the seed builder throws (best-effort seeding)", async () => {
    const startSession = vi.fn().mockResolvedValue(CREDS);
    const buildMemorySeed = vi.fn(() => {
      throw new Error("memory store down");
    });
    const { app } = makeApp({ startSession, buildMemorySeed });

    const res = await request(app).post("/api/bridge/session").send({});

    expect(res.status).toBe(200);
    const opts = startSession.mock.calls[0]![0];
    expect(opts.personality).toBe(BRIDGE_RPC_PERSONALITY);
  });

  it("should attach the server-side tool loop with the session id and selected projectId", async () => {
    const startSession = vi.fn().mockResolvedValue(CREDS);
    const attach = vi.fn().mockResolvedValue(undefined);
    const { app } = makeApp({ startSession, attach });

    await request(app).post("/api/bridge/session").send({ projectId: "proj-uuid" });

    expect(attach).toHaveBeenCalledWith({ sessionId: CREDS.sessionId, projectId: "proj-uuid" });
  });

  it("should attach without a projectId when none is selected (fleet-wide tools still work)", async () => {
    const attach = vi.fn().mockResolvedValue(undefined);
    const { app } = makeApp({ attach });

    await request(app).post("/api/bridge/session").send({});

    expect(attach).toHaveBeenCalledWith({ sessionId: CREDS.sessionId });
  });

  it("should still open a session (200) when no rpc manager is wired (graceful degrade)", async () => {
    const { app } = makeApp({ withRpcManager: false });

    const res = await request(app).post("/api/bridge/session").send({});

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(CREDS);
  });

  it("should return a structured 429 when the daily credit ceiling is tripped", async () => {
    const startSession = vi.fn().mockRejectedValue(new BridgeCostCeilingError());
    const { app } = makeApp({ startSession });

    const res = await request(app).post("/api/bridge/session").send({});

    expect(res.status).toBe(429);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("DAILY_CREDIT_CEILING_REACHED");
  });

  it("should return 502 when the broker fails to create the session (upstream error)", async () => {
    const startSession = vi.fn().mockRejectedValue(new Error("Runway session create failed (HTTP 502): boom"));
    const { app } = makeApp({ startSession });

    const res = await request(app).post("/api/bridge/session").send({});

    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("BRIDGE_SESSION_FAILED");
  });

  it("should return 400 on an invalid body without calling the broker (validation)", async () => {
    const startSession = vi.fn().mockResolvedValue(CREDS);
    const { app } = makeApp({ startSession });

    const res = await request(app).post("/api/bridge/session").send({ avatarId: 123 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(startSession).not.toHaveBeenCalled();
  });
});

describe("bridge-routes: POST /api/bridge/tool", () => {
  it("should return 200 with the structured tool result on success", async () => {
    const result: BridgeToolResult = {
      ok: true,
      tool: "list_agents",
      projectId: null,
      data: { agents: [{ id: "a1" }], count: 1 },
    };
    const executeTool = vi.fn().mockResolvedValue(result);
    const { app } = makeApp({ executeTool });

    const res = await request(app).post("/api/bridge/tool").send({ tool: "list_agents" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ tool: "list_agents", projectId: null, data: { count: 1 } });
    expect(executeTool).toHaveBeenCalledWith({ tool: "list_agents" });
  });

  it("should reject a non-whitelisted tool with 403 TOOL_NOT_ALLOWED", async () => {
    const result: BridgeToolResult = {
      ok: false,
      tool: "create_bead",
      projectId: null,
      error: { code: "TOOL_NOT_ALLOWED", message: "Tool 'create_bead' is not in the read-only Bridge whitelist." },
    };
    const executeTool = vi.fn().mockResolvedValue(result);
    const { app } = makeApp({ executeTool });

    const res = await request(app).post("/api/bridge/tool").send({ tool: "create_bead" });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("TOOL_NOT_ALLOWED");
  });

  it("should return 400 and NOT delegate when the tool name is missing (validation)", async () => {
    const executeTool = vi.fn();
    const { app } = makeApp({ executeTool });

    const res = await request(app).post("/api/bridge/tool").send({ projectId: "p1" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("should map PROJECT_NOT_FOUND to 404", async () => {
    const result: BridgeToolResult = {
      ok: false,
      tool: "list_beads",
      projectId: "missing",
      error: { code: "PROJECT_NOT_FOUND", message: "Project 'missing' not found." },
    };
    const executeTool = vi.fn().mockResolvedValue(result);
    const { app } = makeApp({ executeTool });

    const res = await request(app).post("/api/bridge/tool").send({ tool: "list_beads", projectId: "missing" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PROJECT_NOT_FOUND");
  });

  it("should map a TOOL_FAILED execution error to 500", async () => {
    const result: BridgeToolResult = {
      ok: false,
      tool: "list_beads",
      projectId: "p1",
      error: { code: "TOOL_FAILED", message: "bd exec failed" },
    };
    const executeTool = vi.fn().mockResolvedValue(result);
    const { app } = makeApp({ executeTool });

    const res = await request(app).post("/api/bridge/tool").send({ tool: "list_beads", projectId: "p1" });

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("TOOL_FAILED");
  });
});
