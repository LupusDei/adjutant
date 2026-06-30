/**
 * Tests for the Bridge transcript FETCH service (adj-202.6.6).
 *
 * The PROVEN transcript path: Runway bakes a transcript REST API for each avatar
 * conversation. On session end we fetch
 *   GET /v1/avatars/{avatarId}/conversations/{sessionId}
 *     Authorization: Bearer <RUNWAYML_API_SECRET>, X-Runway-Version: 2024-11-06
 *   -> { transcript:[{role:"user"|"assistant", content}], status, startedAt, endedAt, ... }
 * map each turn's role to a {@link TranscriptSpeaker} (user→commander, assistant→avatar) and
 * feed it through the EXISTING {@link BridgeTranscriptPersister} (Rules 4 + 9 — no new store),
 * oldest→newest. This replaces the dead lk.transcription listener path (Runway GWM-1 publishes
 * zero transcription streams — verified live).
 *
 * Behaviour under test (the fetch service's own responsibilities; the persister is tested
 * separately): role→speaker mapping, oldest→newest ordering, retry-until-finalized with a
 * bounded budget, idempotency (a session never double-persists), an in-flight guard against
 * the duplicate onDisconnected+close session-end triggers, and best-effort no-throw so it can
 * never break the live voice session lifecycle.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  createBridgeTranscriptFetch,
  type BridgeTranscriptFetch,
  type RunwayConversation,
} from "../../src/services/bridge-transcript-fetch.js";
import type { TranscriptTurn } from "../../src/services/bridge-transcript-persister.js";

/** A spy persister capturing the exact turns the fetch service feeds it (in call order). */
function spyPersister(): { onSegment: ReturnType<typeof vi.fn>; endSession: ReturnType<typeof vi.fn>; turns: TranscriptTurn[] } {
  const turns: TranscriptTurn[] = [];
  const onSegment = vi.fn((turn: TranscriptTurn) => {
    turns.push(turn);
    return null;
  });
  const endSession = vi.fn();
  return { onSegment, endSession, turns };
}

/** Build a Response-like object for the injected fetch. */
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const ENDED_CONV: RunwayConversation = {
  id: "sess-1",
  status: "ended",
  startedAt: "2026-06-30T19:13:00Z",
  endedAt: "2026-06-30T19:14:00Z",
  transcript: [
    { role: "user", content: "Say three one four one five nine" },
    { role: "assistant", content: "Three one four one five nine." },
  ],
};

let persister: ReturnType<typeof spyPersister>;
const noSleep = async (): Promise<void> => undefined;

beforeEach(() => {
  persister = spyPersister();
});

function makeService(
  fetchImpl: typeof fetch,
  overrides: Partial<Parameters<typeof createBridgeTranscriptFetch>[0]> = {},
): BridgeTranscriptFetch {
  return createBridgeTranscriptFetch({
    persister,
    apiKey: "secret",
    avatarId: "avatar-1",
    baseUrl: "https://api.dev.runwayml.com",
    fetchImpl,
    sleepFn: noSleep,
    retryDelaysMs: [1, 1, 1],
    ...overrides,
  });
}

describe("createBridgeTranscriptFetch — fetch + map + persist", () => {
  it("should call the Runway conversations endpoint with auth + version headers", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(ENDED_CONV)) as unknown as typeof fetch;
    const svc = makeService(fetchImpl);

    await svc.fetchAndPersist("sess-1");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("https://api.dev.runwayml.com/v1/avatars/avatar-1/conversations/sess-1");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer secret");
    expect(headers["X-Runway-Version"]).toBe("2024-11-06");
  });

  it("should map role 'user'→commander and 'assistant'→avatar, oldest→newest, all final", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(ENDED_CONV)) as unknown as typeof fetch;
    const svc = makeService(fetchImpl);

    await svc.fetchAndPersist("sess-1");

    expect(persister.turns).toHaveLength(2);
    expect(persister.turns[0]).toMatchObject({
      sessionId: "sess-1",
      speaker: "commander",
      text: "Say three one four one five nine",
      final: true,
    });
    expect(persister.turns[1]).toMatchObject({
      sessionId: "sess-1",
      speaker: "avatar",
      text: "Three one four one five nine.",
      final: true,
    });
    // Stable, per-session segment ids preserve order + give the persister a dedup key.
    expect(persister.turns[0]!.segmentId).not.toBe(persister.turns[1]!.segmentId);
  });

  it("should skip whitespace-only / empty turn content", async () => {
    const conv: RunwayConversation = {
      status: "ended",
      transcript: [
        { role: "user", content: "  " },
        { role: "assistant", content: "Acknowledged." },
      ],
    };
    const fetchImpl = vi.fn(async () => jsonResponse(conv)) as unknown as typeof fetch;
    const svc = makeService(fetchImpl);

    await svc.fetchAndPersist("sess-1");

    expect(persister.turns).toHaveLength(1);
    expect(persister.turns[0]).toMatchObject({ speaker: "avatar", text: "Acknowledged." });
  });
});

describe("createBridgeTranscriptFetch — retry until finalized", () => {
  it("should poll until the conversation is finalized, then persist", async () => {
    const notReady: RunwayConversation = { status: "running", transcript: [] };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(notReady))
      .mockResolvedValueOnce(jsonResponse(notReady))
      .mockResolvedValueOnce(jsonResponse(ENDED_CONV)) as unknown as typeof fetch;
    const svc = makeService(fetchImpl);

    await svc.fetchAndPersist("sess-1");

    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
    expect(persister.turns).toHaveLength(2);
    expect(svc.hasPersisted("sess-1")).toBe(true);
  });

  it("should treat a non-empty transcript as ready even without an endedAt", async () => {
    const conv: RunwayConversation = {
      status: "running",
      transcript: [{ role: "user", content: "Status report" }],
    };
    const fetchImpl = vi.fn(async () => jsonResponse(conv)) as unknown as typeof fetch;
    const svc = makeService(fetchImpl);

    await svc.fetchAndPersist("sess-1");

    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(persister.turns).toHaveLength(1);
  });

  it("should give up gracefully (no throw, nothing persisted) when never finalized", async () => {
    const notReady: RunwayConversation = { status: "running", transcript: [] };
    const fetchImpl = vi.fn(async () => jsonResponse(notReady)) as unknown as typeof fetch;
    const svc = makeService(fetchImpl);

    await expect(svc.fetchAndPersist("sess-1")).resolves.toBeUndefined();

    // retryDelaysMs:[1,1,1] ⇒ 4 attempts total, then give up.
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(4);
    expect(persister.turns).toHaveLength(0);
    expect(svc.hasPersisted("sess-1")).toBe(false);
  });
});

describe("createBridgeTranscriptFetch — idempotency + best-effort", () => {
  it("should NOT double-persist a session that was already persisted", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(ENDED_CONV)) as unknown as typeof fetch;
    const svc = makeService(fetchImpl);

    await svc.fetchAndPersist("sess-1");
    await svc.fetchAndPersist("sess-1");

    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(persister.turns).toHaveLength(2);
  });

  it("should guard against concurrent (onDisconnected + close) triggers for the same session", async () => {
    let resolveFetch: (r: Response) => void = () => {};
    const gate = new Promise<Response>((r) => {
      resolveFetch = r;
    });
    const fetchImpl = vi.fn(() => gate) as unknown as typeof fetch;
    const svc = makeService(fetchImpl);

    const first = svc.fetchAndPersist("sess-1");
    const second = svc.fetchAndPersist("sess-1"); // fires while first is still in flight

    resolveFetch(jsonResponse(ENDED_CONV));
    await Promise.all([first, second]);

    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(persister.turns).toHaveLength(2);
  });

  it("should never throw when the fetch rejects (network error)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const svc = makeService(fetchImpl);

    await expect(svc.fetchAndPersist("sess-1")).resolves.toBeUndefined();
    expect(persister.turns).toHaveLength(0);
    expect(svc.hasPersisted("sess-1")).toBe(false);
  });

  it("should treat a non-2xx response as not-ready and retry, not throw", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, false, 404))
      .mockResolvedValueOnce(jsonResponse(ENDED_CONV)) as unknown as typeof fetch;
    const svc = makeService(fetchImpl);

    await svc.fetchAndPersist("sess-1");

    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    expect(persister.turns).toHaveLength(2);
  });

  it("should no-op (no fetch) when credentials are not configured", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(ENDED_CONV)) as unknown as typeof fetch;
    const svc = makeService(fetchImpl, { apiKey: "", avatarId: "" });

    await svc.fetchAndPersist("sess-1");

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(persister.turns).toHaveLength(0);
  });

  it("should no-op on a blank sessionId", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(ENDED_CONV)) as unknown as typeof fetch;
    const svc = makeService(fetchImpl);

    await svc.fetchAndPersist("");

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
