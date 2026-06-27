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
} = {}) {
  const broker = { startSession: opts.startSession ?? vi.fn().mockResolvedValue(CREDS) };
  const rpcManager = { attach: opts.attach ?? vi.fn().mockResolvedValue(undefined) };
  const app = express();
  app.use(express.json());
  app.use(
    "/avatar",
    createAvatarRouter(opts.withRpcManager === false ? { broker } : { broker, rpcManager }),
  );
  return { app, broker, rpcManager };
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
