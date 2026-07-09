/**
 * Tests for POST /avatar/native-session (adj-207.5.4.2).
 *
 * The session-swap pivot: Runway's connect_backend allows only ONE backend handler per
 * session, and the LIVE avatar session's slot is already held by the Adjutant tool-loop
 * attach — so a 2nd backend handler on it is impossible (400 "already connected"). Instead,
 * on pop-out iOS closes the WKWebView session and starts a FRESH session via this route,
 * whose backend-handler slot is FREE because we deliberately DO NOT attach the tool loop.
 * The native client then connect_backend's into it (getNativeConsumerCreds) and renders the
 * avatar video into an AVSampleBufferDisplayLayer for AVPictureInPictureController.
 *
 * KEY INVARIANTS pinned here:
 *  - Starts a FRESH session (calls broker.startSession) — unlike /native-token.
 *  - Does NOT attach the tool loop (rpcManager.attach NOT called) → the backend-handler
 *    slot stays free for the native client. (v1 trade-off: PiP-mode avatar has no tools.)
 *  - Returns the raw LiveKit join creds from getNativeConsumerCreds.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { createAvatarRouter } from "../../src/routes/avatar.js";
import type { BridgeSessionCreds, NativeConsumerCreds } from "../../src/services/bridge-session-broker.js";

const FUTURE = new Date(Date.now() + 5 * 60 * 1000).toISOString();

const CREDS: BridgeSessionCreds = {
  sessionId: "fresh-1",
  sessionKey: "stk_fresh",
  avatarId: "8ac1dce0-cf52-4b72-bd3d-84ecc6a5f6c9",
  expiresAt: FUTURE,
};

const NATIVE: NativeConsumerCreds = {
  sessionId: "fresh-1",
  roomName: "rt_fresh-1",
  url: "wss://livekit.runwayml.com/rtc",
  token: "lk_backend_handler_token",
  expiresAt: FUTURE,
};

function makeApp(opts: {
  startSession?: ReturnType<typeof vi.fn>;
  getNativeConsumerCreds?: ReturnType<typeof vi.fn>;
  withNative?: boolean;
} = {}) {
  const broker = { startSession: opts.startSession ?? vi.fn().mockResolvedValue(CREDS) };
  const rpcManager = { attach: vi.fn().mockResolvedValue(undefined) };
  const getNativeConsumerCreds =
    opts.getNativeConsumerCreds ?? vi.fn<(sessionId: string) => Promise<NativeConsumerCreds>>().mockResolvedValue(NATIVE);
  const deps = {
    broker,
    rpcManager,
    ...(opts.withNative === false ? {} : { getNativeConsumerCreds }),
  };
  const app = express();
  app.use(express.json());
  app.use("/avatar", createAvatarRouter(deps));
  return { app, broker, rpcManager, getNativeConsumerCreds };
}

describe("avatar routes: POST /avatar/native-session", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts a FRESH session and returns raw LiveKit creds the native client owns", async () => {
    const { app, broker, getNativeConsumerCreds } = makeApp();

    const res = await request(app).post("/avatar/native-session").send({});

    expect(res.status).toBe(200);
    // A fresh session was created (unlike /native-token which reuses the active one).
    expect(broker.startSession).toHaveBeenCalledTimes(1);
    expect(getNativeConsumerCreds).toHaveBeenCalledWith(CREDS.sessionId);
    // Raw LiveKit join creds for the native client (backend handler of the fresh session).
    expect(res.body.sessionId).toBe(NATIVE.sessionId);
    expect(res.body.roomName).toBe(NATIVE.roomName);
    expect(res.body.url).toBe(NATIVE.url);
    expect(res.body.token).toBe(NATIVE.token);
    expect(res.body.avatarId).toBe(CREDS.avatarId);
    expect(res.body.consumer).toBe("native");
    expect(res.body.fresh).toBe(true);
  });

  it("does NOT attach the tool loop — the backend-handler slot stays free for the native client", async () => {
    const { app, rpcManager } = makeApp();

    await request(app).post("/avatar/native-session").send({});

    // The load-bearing invariant of the swap: no tool-loop attach → free connect_backend slot.
    expect(rpcManager.attach).not.toHaveBeenCalled();
  });

  it("needs NO prior /avatar/connect — it creates its own session (not the active-session path)", async () => {
    // Unlike /native-token, this route works with no active session established.
    const { app } = makeApp();
    const res = await request(app).post("/avatar/native-session").send({});
    expect(res.status).toBe(200);
  });

  it("returns 501 when no native-creds provider is wired", async () => {
    const { app, broker } = makeApp({ withNative: false });
    const res = await request(app).post("/avatar/native-session").send({});
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe("NATIVE_SESSION_UNAVAILABLE");
    // Must not burn a session when the feature isn't wired.
    expect(broker.startSession).not.toHaveBeenCalled();
  });

  it("returns 502 with a structured error when the fresh join fails", async () => {
    const getNativeConsumerCreds = vi
      .fn<(sessionId: string) => Promise<NativeConsumerCreds>>()
      .mockRejectedValue(new Error("runway connect_backend failed"));
    const { app } = makeApp({ getNativeConsumerCreds });

    const res = await request(app).post("/avatar/native-session").send({});
    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("NATIVE_SESSION_FAILED");
  });
});
