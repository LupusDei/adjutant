import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock the service so route tests don't hit Runway.
vi.mock("../../src/services/runway-avatar.js", () => ({
  createReadyAvatarSession: vi.fn(),
}));

import { createReadyAvatarSession } from "../../src/services/runway-avatar.js";
import { createAvatarRouter } from "../../src/routes/avatar.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/avatar", createAvatarRouter());
  return app;
}

describe("avatar routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("POST /avatar/connect returns { sessionId, sessionKey, avatarId } on success", async () => {
    vi.mocked(createReadyAvatarSession).mockResolvedValue({
      sessionId: "sess-1",
      sessionKey: "stk_abc",
      avatarId: "8ac1dce0-cf52-4b72-bd3d-84ecc6a5f6c9",
      expiresAt: "2026-06-27T14:47:01.147Z",
    });
    const res = await request(makeApp()).post("/avatar/connect").send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sessionId: "sess-1", sessionKey: "stk_abc" });
    expect(createReadyAvatarSession).toHaveBeenCalledTimes(1);
  });

  it("POST /avatar/connect forwards a custom avatarId when provided", async () => {
    vi.mocked(createReadyAvatarSession).mockResolvedValue({ sessionId: "s", sessionKey: "k", avatarId: "custom-x" });
    await request(makeApp()).post("/avatar/connect").send({ customAvatarId: "custom-x" });
    expect(createReadyAvatarSession).toHaveBeenCalledWith({ avatarId: "custom-x" });
  });

  it("POST /avatar/connect returns 502 structured error when the session fails", async () => {
    vi.mocked(createReadyAvatarSession).mockRejectedValue(new Error("Runway session create failed (HTTP 401)"));
    const res = await request(makeApp()).post("/avatar/connect").send({});
    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("AVATAR_SESSION_FAILED");
  });

  it("GET /avatar serves the avatar client HTML page", async () => {
    const res = await request(makeApp()).get("/avatar");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.text).toContain("avatars-react");
    expect(res.text).toContain("/avatar/connect");
  });
});
