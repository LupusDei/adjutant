import { describe, it, expect, vi } from "vitest";
import { createReadyAvatarSession } from "../../src/services/runway-avatar.js";

/**
 * Real Runway response shapes (captured live from api.dev.runwayml.com, 2026-06-27):
 *   POST /v1/realtime_sessions            -> { id }
 *   GET  /v1/realtime_sessions/{id}       -> { id, createdAt, status: "NOT_READY" }
 *   ... then once ready                   -> { id, createdAt, status: "READY", expiresAt, sessionKey: "stk_..." }
 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const CID = "8ac1dce0-cf52-4b72-bd3d-84ecc6a5f6c9";
const noopSleep = () => Promise.resolve();

describe("runway-avatar: createReadyAvatarSession", () => {
  it("should create a session, poll until READY, and return sessionId + sessionKey (happy path)", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: "sess-1" })) // create
      .mockResolvedValueOnce(jsonResponse({ id: "sess-1", status: "NOT_READY" })) // poll 1
      .mockResolvedValueOnce(
        jsonResponse({ id: "sess-1", status: "READY", expiresAt: "2026-06-27T14:47:01.147Z", sessionKey: "stk_abc" }),
      ); // poll 2

    const result = await createReadyAvatarSession({
      apiKey: "key_test",
      avatarId: CID,
      fetchImpl,
      pollIntervalMs: 1,
      timeoutMs: 1000,
      sleepFn: noopSleep,
    });

    expect(result).toEqual({ sessionId: "sess-1", sessionKey: "stk_abc", avatarId: CID, expiresAt: "2026-06-27T14:47:01.147Z" });

    // Create call: correct URL, method, auth, version, and avatar shape.
    const [createUrl, createInit] = fetchImpl.mock.calls[0]!;
    expect(String(createUrl)).toBe("https://api.dev.runwayml.com/v1/realtime_sessions");
    expect(createInit?.method).toBe("POST");
    const headers = createInit?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer key_test");
    expect(headers["X-Runway-Version"]).toBe("2024-11-06");
    expect(JSON.parse(createInit?.body as string)).toEqual({
      model: "gwm1_avatars",
      avatar: { type: "custom", avatarId: CID },
    });
  });

  it("should throw when the create call fails (error path)", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ error: "Invalid API key" }, 401));
    await expect(
      createReadyAvatarSession({ apiKey: "bad", avatarId: CID, fetchImpl, sleepFn: noopSleep }),
    ).rejects.toThrow(/401|create/i);
  });

  it("should throw a timeout when the session never reaches READY (edge case)", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: "sess-2" })) // create
      .mockResolvedValue(jsonResponse({ id: "sess-2", status: "NOT_READY" })); // always not ready

    await expect(
      createReadyAvatarSession({ apiKey: "key_test", avatarId: CID, fetchImpl, pollIntervalMs: 1, timeoutMs: 3, sleepFn: noopSleep }),
    ).rejects.toThrow(/timed out|ready/i);
  });

  it("should throw when no API key is configured (validation)", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      createReadyAvatarSession({ apiKey: "", avatarId: CID, fetchImpl, sleepFn: noopSleep }),
    ).rejects.toThrow(/RUNWAYML_API_SECRET|api key/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("should throw when no avatarId is configured (validation)", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      createReadyAvatarSession({ apiKey: "key_test", avatarId: "", fetchImpl, sleepFn: noopSleep }),
    ).rejects.toThrow(/avatar/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
