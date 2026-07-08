import { describe, it, expect, vi } from "vitest";
import { RunwayClient, RunwayApiError } from "../../src/services/runway-client.js";

/**
 * Real Runway response shapes (captured live from api.dev.runwayml.com, 2026-06-27):
 *   POST /v1/realtime_sessions            -> { id }
 *   GET  /v1/realtime_sessions/{id}       -> { id, createdAt, status: "NOT_READY" }
 *   ... then once ready                   -> { id, createdAt, status: "READY", expiresAt, sessionKey: "stk_..." }
 *
 * runway-client.ts is a THIN authed HTTP wrapper. It does no polling/lifecycle logic
 * (that lives in bridge-session-broker.ts) — it just signs and shapes the two HTTP calls.
 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const CID = "8ac1dce0-cf52-4b72-bd3d-84ecc6a5f6c9";

describe("RunwayClient: construction", () => {
  it("should throw when no API key is configured (missing-key edge)", () => {
    expect(() => new RunwayClient({ apiKey: "" })).toThrow(/RUNWAYML_API_SECRET|api key/i);
  });

  it("should read the API key from process.env.RUNWAYML_API_SECRET when not passed", () => {
    const prev = process.env["RUNWAYML_API_SECRET"];
    process.env["RUNWAYML_API_SECRET"] = "key_from_env";
    try {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ id: "sess-env" }));
      const client = new RunwayClient({ fetchImpl });
      // Construction must not throw when env supplies the key.
      expect(client).toBeInstanceOf(RunwayClient);
    } finally {
      if (prev === undefined) delete process.env["RUNWAYML_API_SECRET"];
      else process.env["RUNWAYML_API_SECRET"] = prev;
    }
  });
});

describe("RunwayClient: createRealtimeSession", () => {
  it("should POST the signed create call with the proven base body and return the row (happy path)", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ id: "sess-1" }));
    const client = new RunwayClient({ apiKey: "key_test", fetchImpl });

    const row = await client.createRealtimeSession({ avatar: { type: "custom", avatarId: CID } });

    expect(row).toEqual({ id: "sess-1" });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://api.dev.runwayml.com/v1/realtime_sessions");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer key_test");
    expect(headers["X-Runway-Version"]).toBe("2024-11-06");
    expect(headers["Content-Type"]).toBe("application/json");
    // Proven base body — NO extra keys when no personality/startScript is supplied.
    expect(JSON.parse(init?.body as string)).toEqual({
      model: "gwm1_avatars",
      avatar: { type: "custom", avatarId: CID },
    });
  });

  it("should include personality/startScript in the body only when supplied (seed path)", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ id: "sess-seed" }));
    const client = new RunwayClient({ apiKey: "key_test", fetchImpl });

    await client.createRealtimeSession({
      avatar: { type: "custom", avatarId: CID },
      personality: "You are the Adjutant. Address the user as Commander.",
      startScript: "Commander, fleet status nominal.",
    });

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(JSON.parse(init?.body as string)).toEqual({
      model: "gwm1_avatars",
      avatar: { type: "custom", avatarId: CID },
      personality: "You are the Adjutant. Address the user as Commander.",
      startScript: "Commander, fleet status nominal.",
    });
  });

  it("should throw RunwayApiError carrying the status when the API rejects (401 error path)", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ error: "Invalid API key" }, 401));
    const client = new RunwayClient({ apiKey: "bad", fetchImpl });

    await expect(client.createRealtimeSession({ avatar: { type: "custom", avatarId: CID } })).rejects.toMatchObject({
      name: "RunwayApiError",
      status: 401,
    });
  });

  it("should throw RunwayApiError on a 429 rate-limit response (error path)", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ error: "Too many requests" }, 429));
    const client = new RunwayClient({ apiKey: "key_test", fetchImpl });

    const err = await client.createRealtimeSession({ avatar: { type: "custom", avatarId: CID } }).catch((e) => e);
    expect(err).toBeInstanceOf(RunwayApiError);
    expect((err as RunwayApiError).status).toBe(429);
    expect((err as RunwayApiError).message).toMatch(/429/);
  });

  it("should throw RunwayApiError on a 5xx server error (error path)", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ error: "boom" }, 503));
    const client = new RunwayClient({ apiKey: "key_test", fetchImpl });

    await expect(client.createRealtimeSession({ avatar: { type: "custom", avatarId: CID } })).rejects.toMatchObject({
      status: 503,
    });
  });
});

describe("RunwayClient: getRealtimeSession", () => {
  it("should GET the session by id with auth headers and return the NOT_READY row (happy path)", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: "sess-1", createdAt: "2026-06-27T14:42:01.147Z", status: "NOT_READY" }));
    const client = new RunwayClient({ apiKey: "key_test", fetchImpl });

    const row = await client.getRealtimeSession("sess-1");

    expect(row).toEqual({ id: "sess-1", createdAt: "2026-06-27T14:42:01.147Z", status: "NOT_READY" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://api.dev.runwayml.com/v1/realtime_sessions/sess-1");
    expect(init?.method).toBe("GET");
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer key_test");
    expect(headers["X-Runway-Version"]).toBe("2024-11-06");
  });

  it("should return the READY row including sessionKey + expiresAt (happy path, ready)", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        id: "sess-1",
        status: "READY",
        expiresAt: "2026-06-27T14:47:01.147Z",
        sessionKey: "stk_abc",
      }),
    );
    const client = new RunwayClient({ apiKey: "key_test", fetchImpl });

    const row = await client.getRealtimeSession("sess-1");
    expect(row.status).toBe("READY");
    expect(row.sessionKey).toBe("stk_abc");
    expect(row.expiresAt).toBe("2026-06-27T14:47:01.147Z");
  });

  it("should throw RunwayApiError when the GET fails (error path)", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ error: "not found" }, 404));
    const client = new RunwayClient({ apiKey: "key_test", fetchImpl });

    await expect(client.getRealtimeSession("nope")).rejects.toMatchObject({ status: 404 });
  });
});

describe("RunwayClient: configurability", () => {
  it("should honor a custom baseUrl and apiVersion (edge / override)", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ id: "sess-x" }));
    const client = new RunwayClient({
      apiKey: "key_test",
      baseUrl: "https://api.runwayml.com/v1",
      apiVersion: "2099-01-01",
      fetchImpl,
    });

    await client.createRealtimeSession({ avatar: { type: "custom", avatarId: CID } });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://api.runwayml.com/v1/realtime_sessions");
    expect((init?.headers as Record<string, string>)["X-Runway-Version"]).toBe("2099-01-01");
  });
});

describe("RunwayClient: connectBackend (adj-207.4.5)", () => {
  it("should POST the signed /connect_backend join for an EXISTING session and return LiveKit creds", async () => {
    const creds = { url: "wss://livekit.runwayml.com/rtc", token: "lk_tok_abc", roomName: "rt_sess-1" };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(creds));
    const client = new RunwayClient({ apiKey: "key_test", fetchImpl });

    const out = await client.connectBackend("sess-1");
    expect(out).toEqual(creds);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://api.dev.runwayml.com/v1/realtime_sessions/sess-1/connect_backend");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer key_test");
    expect(headers["X-Runway-Version"]).toBe("2024-11-06");
  });

  it("should throw a typed RunwayApiError on a non-2xx response (error path)", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ error: "nope" }, 404));
    const client = new RunwayClient({ apiKey: "key_test", fetchImpl });
    await expect(client.connectBackend("gone")).rejects.toBeInstanceOf(RunwayApiError);
  });
});
