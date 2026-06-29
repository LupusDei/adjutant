/**
 * Tests for the public /avatar routes (adj-202.2 / adj-202.7.1).
 *
 * adj-202.7.1 cut POST /avatar/connect over to the SAME cost-guarded broker the
 * dashboard uses (was the un-guarded, un-tool-enabled createReadyAvatarSession), so
 * the iOS WKWebView avatar gets the read-only tool loop + the daily credit ceiling.
 * The route must still return the EXACT { sessionId, sessionKey, avatarId, expiresAt }
 * contract the /avatar page consumes, and stay public (mounted before apiKeyAuth).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { createAvatarRouter } from "../../src/routes/avatar.js";
import { BridgeCostCeilingError } from "../../src/services/bridge-session-broker.js";
import type { BridgeSessionCreds } from "../../src/services/bridge-session-broker.js";
import { BRIDGE_RPC_TOOLS } from "../../src/services/bridge-rpc-tools.js";

const CREDS: BridgeSessionCreds = {
  sessionId: "sess-1",
  sessionKey: "stk_abc",
  avatarId: "8ac1dce0-cf52-4b72-bd3d-84ecc6a5f6c9",
  expiresAt: "2026-06-27T14:47:01.147Z",
};

function makeApp(opts: {
  startSession?: ReturnType<typeof vi.fn>;
  attach?: ReturnType<typeof vi.fn>;
  withRpcManager?: boolean;
  getSessionStatus?: ReturnType<typeof vi.fn>;
} = {}) {
  const broker = { startSession: opts.startSession ?? vi.fn().mockResolvedValue(CREDS) };
  const rpcManager = { attach: opts.attach ?? vi.fn().mockResolvedValue(undefined) };
  const getSessionStatus = opts.getSessionStatus;
  const deps = opts.withRpcManager === false ? { broker } : { broker, rpcManager };
  const app = express();
  app.use(express.json());
  app.use(
    "/avatar",
    createAvatarRouter(getSessionStatus ? { ...deps, getSessionStatus } : deps),
  );
  return { app, broker, rpcManager, getSessionStatus };
}

describe("avatar routes: POST /avatar/connect (broker-backed)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the exact { sessionId, sessionKey, avatarId, expiresAt } contract on success", async () => {
    const { app } = makeApp();
    const res = await request(app).post("/avatar/connect").send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual(CREDS);
  });

  it("tool-enables the session: broker gets the read-only RPC tools + a tool-aware persona", async () => {
    const startSession = vi.fn().mockResolvedValue(CREDS);
    const { app } = makeApp({ startSession });
    await request(app).post("/avatar/connect").send({});

    const sessOpts = startSession.mock.calls[0]![0];
    expect(sessOpts.tools).toEqual(BRIDGE_RPC_TOOLS);
    expect(sessOpts.personality).toContain("list_agents");
  });

  it("attaches the server-side tool loop to the new session id", async () => {
    const attach = vi.fn().mockResolvedValue(undefined);
    const { app } = makeApp({ attach });
    await request(app).post("/avatar/connect").send({});
    expect(attach).toHaveBeenCalledWith({ sessionId: CREDS.sessionId });
  });

  it("forwards a custom avatarId to the broker when provided", async () => {
    const startSession = vi.fn().mockResolvedValue(CREDS);
    const { app } = makeApp({ startSession });
    await request(app).post("/avatar/connect").send({ customAvatarId: "custom-x" });
    expect(startSession.mock.calls[0]![0]).toMatchObject({ avatarId: "custom-x" });
  });

  it("maps the daily credit ceiling to a structured 429", async () => {
    const startSession = vi.fn().mockRejectedValue(new BridgeCostCeilingError());
    const { app } = makeApp({ startSession });
    const res = await request(app).post("/avatar/connect").send({});
    expect(res.status).toBe(429);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("DAILY_CREDIT_CEILING_REACHED");
  });

  it("returns a structured 502 when the broker fails to create the session", async () => {
    const startSession = vi.fn().mockRejectedValue(new Error("Runway session create failed (HTTP 401)"));
    const { app } = makeApp({ startSession });
    const res = await request(app).post("/avatar/connect").send({});
    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("AVATAR_SESSION_FAILED");
  });

  it("still opens a session (200) when no rpc manager is wired (graceful degrade)", async () => {
    const { app } = makeApp({ withRpcManager: false });
    const res = await request(app).post("/avatar/connect").send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual(CREDS);
  });

  it("GET /avatar serves the avatar client HTML page", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/avatar");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.text).toContain("avatars-react");
    expect(res.text).toContain("/avatar/connect");
  });
});

describe("avatar routes: warm-session cache (POST /avatar/prepare) — load perf adj-202.10", () => {
  beforeEach(() => vi.clearAllMocks());

  it("prepare warms a session in the background and returns ok", async () => {
    const startSession = vi.fn().mockResolvedValue(CREDS);
    const { app } = makeApp({ startSession });
    const res = await request(app).post("/avatar/prepare").send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(startSession).toHaveBeenCalledTimes(1); // warmed exactly one
  });

  it("connect serves the pre-warmed session without creating a second one (~2s fast path)", async () => {
    const startSession = vi.fn().mockResolvedValue(CREDS);
    const attach = vi.fn().mockResolvedValue(undefined);
    const { app } = makeApp({ startSession, attach });

    await request(app).post("/avatar/prepare").send({});
    await new Promise((r) => setTimeout(r, 10)); // let the background warm settle

    const res = await request(app).post("/avatar/connect").send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual(CREDS);
    // Exactly ONE create total: the warm one. connect reused it (no second provisioning).
    expect(startSession).toHaveBeenCalledTimes(1);
    expect(attach).toHaveBeenCalledTimes(1);
  });

  it("prepare is idempotent: a second prepare while one is fresh does not create another", async () => {
    const startSession = vi.fn().mockResolvedValue(CREDS);
    const { app } = makeApp({ startSession });
    await request(app).post("/avatar/prepare").send({});
    await new Promise((r) => setTimeout(r, 10));
    await request(app).post("/avatar/prepare").send({});
    expect(startSession).toHaveBeenCalledTimes(1);
  });

  it("a custom avatarId bypasses the warm cache and provisions fresh", async () => {
    const startSession = vi.fn().mockResolvedValue(CREDS);
    const { app } = makeApp({ startSession });
    await request(app).post("/avatar/prepare").send({});
    await new Promise((r) => setTimeout(r, 10));
    await request(app).post("/avatar/connect").send({ customAvatarId: "custom-x" });
    // 1 warm + 1 fresh on-demand for the custom avatar = 2 creates.
    expect(startSession).toHaveBeenCalledTimes(2);
    expect(startSession.mock.calls[1]![0]).toMatchObject({ avatarId: "custom-x" });
  });
});

describe("avatar routes: warm-session validate-before-handout (adj-202.10.1 regression)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("discards a warm session that Runway has since FAILED and falls back to on-demand create", async () => {
    // The warm create returns CREDS, but by the time connect runs the session has gone FAILED.
    const FRESH: BridgeSessionCreds = { ...CREDS, sessionId: "sess-fresh", sessionKey: "stk_fresh" };
    const startSession = vi
      .fn()
      .mockResolvedValueOnce(CREDS) // warm provisioning
      .mockResolvedValueOnce(FRESH); // on-demand fallback after the warm is discarded
    const getSessionStatus = vi.fn().mockResolvedValue("FAILED");
    const { app } = makeApp({ startSession, getSessionStatus });

    await request(app).post("/avatar/prepare").send({});
    await new Promise((r) => setTimeout(r, 10)); // let the background warm settle

    const res = await request(app).post("/avatar/connect").send({});
    expect(res.status).toBe(200);
    // The stale (FAILED) warm session must NOT be handed out — a fresh on-demand one is.
    expect(getSessionStatus).toHaveBeenCalledWith(CREDS.sessionId);
    expect(res.body).toEqual(FRESH);
    expect(startSession).toHaveBeenCalledTimes(2); // warm + fallback create
  });

  it("hands out the warm session when it re-validates as READY (still the ~2s fast path)", async () => {
    const startSession = vi.fn().mockResolvedValue(CREDS);
    const getSessionStatus = vi.fn().mockResolvedValue("READY");
    const { app } = makeApp({ startSession, getSessionStatus });

    await request(app).post("/avatar/prepare").send({});
    await new Promise((r) => setTimeout(r, 10));

    const res = await request(app).post("/avatar/connect").send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual(CREDS);
    expect(getSessionStatus).toHaveBeenCalledWith(CREDS.sessionId);
    expect(startSession).toHaveBeenCalledTimes(1); // warm reused, no second create
  });

  it("discards the warm session when the status fetch itself fails (treat as not-ready)", async () => {
    const FRESH: BridgeSessionCreds = { ...CREDS, sessionId: "sess-fresh2" };
    const startSession = vi.fn().mockResolvedValueOnce(CREDS).mockResolvedValueOnce(FRESH);
    const getSessionStatus = vi.fn().mockRejectedValue(new Error("Runway session fetch failed (HTTP 404)"));
    const { app } = makeApp({ startSession, getSessionStatus });

    await request(app).post("/avatar/prepare").send({});
    await new Promise((r) => setTimeout(r, 10));

    const res = await request(app).post("/avatar/connect").send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual(FRESH);
    expect(startSession).toHaveBeenCalledTimes(2);
  });
});
