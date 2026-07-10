/**
 * Tests for POST /avatar/native-session (adj-207.5.4.2 → adj-207.5.6).
 *
 * Session-swap, corrected to a FRONTEND viewer: the device proved (adj-207.5.4) that a
 * backend handler (`connect_backend`) receives NO video — Runway publishes video only to
 * FRONTEND participants. And `/consume` (the frontend token mint) is SINGLE-USE per session,
 * so the native client cannot be a 2nd viewer on the live WKWebView session. Therefore, on
 * pop-out iOS closes the WKWebView session and starts a FRESH session via this route, then the
 * native client consumes it as the FRONTEND participant (`/consume` → `getFrontendViewerCreds`)
 * and receives the avatar VIDEO for AVPictureInPictureController.
 *
 * KEY INVARIANTS pinned here:
 *  - Starts a FRESH session (calls broker.startSession) — unlike /native-token.
 *  - Mints FRONTEND viewer creds via /consume with the fresh session's sessionKey (NOT
 *    connect_backend, which yields no video).
 *  - Does NOT attach the tool loop (v1 trade-off: PiP-mode avatar has no tools).
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
  getFrontendViewerCreds?: ReturnType<typeof vi.fn>;
  withNative?: boolean;
} = {}) {
  const broker = { startSession: opts.startSession ?? vi.fn().mockResolvedValue(CREDS) };
  const rpcManager = { attach: vi.fn().mockResolvedValue(undefined) };
  const getFrontendViewerCreds =
    opts.getFrontendViewerCreds ??
    vi.fn<(sessionId: string, sessionKey: string) => Promise<NativeConsumerCreds>>().mockResolvedValue(NATIVE);
  const deps = {
    broker,
    rpcManager,
    ...(opts.withNative === false ? {} : { getFrontendViewerCreds }),
  };
  const app = express();
  app.use(express.json());
  app.use("/avatar", createAvatarRouter(deps));
  return { app, broker, rpcManager, getFrontendViewerCreds };
}

describe("avatar routes: POST /avatar/native-session", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts a FRESH session and returns FRONTEND viewer creds (via /consume) the native client owns", async () => {
    const { app, broker, getFrontendViewerCreds } = makeApp();

    const res = await request(app).post("/avatar/native-session").send({});

    expect(res.status).toBe(200);
    // A fresh session was created (unlike /native-token which reuses the active one).
    expect(broker.startSession).toHaveBeenCalledTimes(1);
    // adj-207.5.6: frontend viewer creds are minted via /consume with the fresh session's
    // sessionKey — NOT connect_backend (which yields no video).
    expect(getFrontendViewerCreds).toHaveBeenCalledWith(CREDS.sessionId, CREDS.sessionKey);
    // Raw LiveKit join creds for the native client (backend handler of the fresh session).
    expect(res.body.sessionId).toBe(NATIVE.sessionId);
    expect(res.body.roomName).toBe(NATIVE.roomName);
    expect(res.body.url).toBe(NATIVE.url);
    expect(res.body.token).toBe(NATIVE.token);
    expect(res.body.avatarId).toBe(CREDS.avatarId);
    expect(res.body.consumer).toBe("native");
    expect(res.body.fresh).toBe(true);
  });

  it("does NOT attach the tool loop (v1: PiP-mode avatar has no tools)", async () => {
    const { app, rpcManager } = makeApp();

    await request(app).post("/avatar/native-session").send({});

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
    const getFrontendViewerCreds = vi
      .fn<(sessionId: string, sessionKey: string) => Promise<NativeConsumerCreds>>()
      .mockRejectedValue(new Error("runway consume failed"));
    const { app } = makeApp({ getFrontendViewerCreds });

    const res = await request(app).post("/avatar/native-session").send({});
    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("NATIVE_SESSION_FAILED");
  });
});
