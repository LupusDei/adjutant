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

  it("GET /avatar wires two-way mic + camera via the SDK useLocalMedia toggles (adj-202.5.1)", async () => {
    const { app } = makeApp();
    const html = (await request(app).get("/avatar")).text;
    // Live track toggling — NOT the old no-op of re-rendering with a changed audio prop.
    expect(html).toContain("useLocalMedia");
    expect(html).toContain("toggleMic");
    expect(html).toContain("toggleCamera");
    // Camera command/echo over the postMessage bridge.
    expect(html).toContain("bridge:camera");
    // Self-view PiP element is rendered.
    expect(html).toContain("UserVideo");
    // Seed state: mic on, camera off at connect.
    expect(html).toContain("audio: true");
    expect(html).toContain("video: false");
  });

  it("GET /avatar wires screen-share with an iOS-safe feature gate (adj-202.5.2)", async () => {
    const { app } = makeApp();
    const html = (await request(app).get("/avatar")).text;
    expect(html).toContain("toggleScreenShare");
    expect(html).toContain("ScreenShareVideo");
    // Screen-share command/echo over the postMessage bridge.
    expect(html).toContain("bridge:screenshare");
    // getDisplayMedia feature gate — iOS Safari / WKWebView lack it, so the control hides.
    expect(html).toContain("getDisplayMedia");
  });

  it("GET /avatar handles a denied camera/mic permission with friendly guidance, not a raw error (adj-202.5.4)", async () => {
    const { app } = makeApp();
    const html = (await request(app).get("/avatar")).text;
    // Reads the SDK media errors + retry, detects a permission denial, and offers Settings.
    expect(html).toContain("cameraError");
    expect(html).toContain("retryCamera");
    expect(html).toContain("isPermissionError");
    expect(html).toContain("NotAllowedError");
    expect(html).toContain("Enable it in Settings");
    // iOS Settings deep-link bridge (the page cannot open Settings on its own).
    expect(html).toContain("bridgeOpenSettings");
  });

  it("GET /avatar shows a camera-live indicator + a sharing indicator with a Stop control (adj-202.5.5 / .5.6)", async () => {
    const { app } = makeApp();
    const html = (await request(app).get("/avatar")).text;
    expect(html).toContain("Camera live");
    expect(html).toContain("Sharing your screen");
    expect(html).toContain("bridge-sharing");
  });

  it("GET /avatar keeps the WKWebView-safe SERIAL imports (no modulepreload / Promise.all)", async () => {
    const { app } = makeApp();
    const html = (await request(app).get("/avatar")).text;
    // Regression guard (adj-202.10): parallel imports + modulepreload broke WKWebView.
    // Match the actual mechanisms, not the cautionary comment text.
    expect(html).not.toMatch(/rel=["']modulepreload["']/);
    expect(html).not.toMatch(/Promise\.all\s*\(/);
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
