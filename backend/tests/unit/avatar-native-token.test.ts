/**
 * Tests for POST /avatar/native-token (adj-207.4.5 / T012).
 *
 * The native iOS LiveKit client (Phase B — adj-207.4.2) drives system PiP by rendering the
 * avatar video track into an AVSampleBufferDisplayLayer. To do that it must join the SAME
 * LiveKit room as the already-connected /avatar session and SUBSCRIBE to the avatar video —
 * WITHOUT spinning up a second Runway realtime session (which would burn a second ~2-credit
 * upfront charge). This route vends the room-scoped LiveKit join creds for the EXISTING,
 * currently-active session; it MUST NOT create a new session (never calls broker.startSession).
 *
 * VERIFY-FIRST finding baked into these tests: the creds returned by POST /avatar/connect are
 * a Runway-JS-SDK `sessionKey` (stk_…), NOT a raw LiveKit token a native Swift LiveKit client
 * can `Room.connect(url, token)` with. So a dedicated route is required — it derives the raw
 * `{ url, token, roomName }` for the same session (via Runway's /connect_backend join, which
 * `@runwayml/avatars-node-rpc` already uses to add a 2nd participant to the same room with no
 * new session).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { createAvatarRouter } from "../../src/routes/avatar.js";
import type { BridgeSessionCreds, NativeConsumerCreds } from "../../src/services/bridge-session-broker.js";

// The avatar session cap is ~5 min out; use a live future stamp so the active-session
// expiry guard (a past `expiresAt` ⇒ "no active session") does not depend on the wall clock.
const FUTURE = new Date(Date.now() + 5 * 60 * 1000).toISOString();

const CREDS: BridgeSessionCreds = {
  sessionId: "sess-1",
  sessionKey: "stk_abc",
  avatarId: "8ac1dce0-cf52-4b72-bd3d-84ecc6a5f6c9",
  expiresAt: FUTURE,
};

const NATIVE: NativeConsumerCreds = {
  sessionId: "sess-1",
  roomName: "rt_sess-1",
  url: "wss://livekit.runwayml.com/rtc",
  token: "lk_participant_token_xyz",
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
  return { app, broker, getNativeConsumerCreds };
}

/** Establish an active session by hitting the same connect path iOS uses. */
async function connect(app: express.Express) {
  const res = await request(app).post("/avatar/connect").send({});
  expect(res.status).toBe(200);
}

describe("avatar routes: POST /avatar/native-token", () => {
  beforeEach(() => vi.clearAllMocks());

  it("vends room-scoped LiveKit creds for the EXISTING active session (subscribe-only native consumer)", async () => {
    const { app, getNativeConsumerCreds } = makeApp();
    await connect(app);

    const res = await request(app).post("/avatar/native-token").send({});
    expect(res.status).toBe(200);
    // Room-scoped to the SAME session — same room, raw LiveKit join creds.
    expect(res.body.sessionId).toBe(CREDS.sessionId);
    expect(res.body.roomName).toBe(NATIVE.roomName);
    expect(res.body.url).toBe(NATIVE.url);
    expect(res.body.token).toBe(NATIVE.token);
    expect(res.body.avatarId).toBe(CREDS.avatarId);
    // Read-only native consumer contract.
    expect(res.body.consumer).toBe("native");
    expect(res.body.subscribeOnly).toBe(true);
    // Derived from the active session's id.
    expect(getNativeConsumerCreds).toHaveBeenCalledWith(CREDS.sessionId);
  });

  it("does NOT create a second Runway session — never calls broker.startSession (no double credit burn)", async () => {
    const startSession = vi.fn().mockResolvedValue(CREDS);
    const { app, broker } = makeApp({ startSession });
    await connect(app);
    // Let connect's background keep-warm provisioning settle, then zero the spy so we measure
    // ONLY what the native-token request itself does.
    await new Promise((r) => setTimeout(r, 20));
    broker.startSession.mockClear();

    await request(app).post("/avatar/native-token").send({});
    // The native-token request creates NO Runway session — it reuses the existing one.
    expect(broker.startSession).not.toHaveBeenCalled();
  });

  it("rejects with 409 NO_ACTIVE_AVATAR_SESSION when no session is active", async () => {
    const { app, getNativeConsumerCreds } = makeApp();
    const res = await request(app).post("/avatar/native-token").send({});
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("NO_ACTIVE_AVATAR_SESSION");
    expect(getNativeConsumerCreds).not.toHaveBeenCalled();
  });

  it("rejects with 409 when a supplied sessionId does not match the active session", async () => {
    const { app, getNativeConsumerCreds } = makeApp();
    await connect(app);

    const res = await request(app).post("/avatar/native-token").send({ sessionId: "some-other-session" });
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("NO_ACTIVE_AVATAR_SESSION");
    // Must not mint creds for an arbitrary (non-active) session id.
    expect(getNativeConsumerCreds).not.toHaveBeenCalled();
  });

  it("accepts a supplied sessionId that matches the active session", async () => {
    const { app, getNativeConsumerCreds } = makeApp();
    await connect(app);

    const res = await request(app).post("/avatar/native-token").send({ sessionId: CREDS.sessionId });
    expect(res.status).toBe(200);
    expect(getNativeConsumerCreds).toHaveBeenCalledWith(CREDS.sessionId);
  });

  it("rejects a non-string sessionId with a 400 validation error", async () => {
    const { app } = makeApp();
    await connect(app);
    const res = await request(app).post("/avatar/native-token").send({ sessionId: 123 });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 502 with a structured error when deriving native creds fails", async () => {
    const getNativeConsumerCreds = vi
      .fn<(sessionId: string) => Promise<NativeConsumerCreds>>()
      .mockRejectedValue(new Error("runway connect_backend failed"));
    const { app } = makeApp({ getNativeConsumerCreds });
    await connect(app);

    const res = await request(app).post("/avatar/native-token").send({});
    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("NATIVE_TOKEN_FAILED");
  });

  it("returns 501 when no native-creds provider is wired", async () => {
    const { app } = makeApp({ withNative: false });
    await connect(app);
    const res = await request(app).post("/avatar/native-token").send({});
    expect(res.status).toBe(501);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("NATIVE_TOKEN_UNAVAILABLE");
  });
});
