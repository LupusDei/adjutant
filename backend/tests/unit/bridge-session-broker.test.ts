import { describe, it, expect, vi } from "vitest";
import {
  BridgeSessionBroker,
  BridgeCostCeilingError,
  type RunwaySessionApi,
} from "../../src/services/bridge-session-broker.js";
import type { RealtimeSessionRow, CreateRealtimeSessionInput } from "../../src/services/runway-client.js";
import { BridgeCostGuard, computeSessionMeter } from "../../src/services/bridge-cost-guard.js";

/**
 * The broker owns the Runway `gwm1_avatars` session lifecycle on top of the (mockable)
 * runway-client AND the bridge-cost-guard:
 *
 *   startSession: canStartSession() gate FIRST → create → record upfront spend → poll to READY
 *                 → hand back ONE-SHOT browser creds { sessionId, sessionKey, avatarId, expiresAt }.
 *
 * The Runway API secret stays inside the client and is NEVER part of the returned creds. TTL /
 * idle / meter math use injectable clocks so the ~5-min cap and idle cutoff are testable without
 * real timers. Cost-guard is the REAL (pure) BridgeCostGuard — no hand-mocked spend math.
 *
 * Real shapes (api.dev.runwayml.com, 2026-06-27):
 *   create -> { id }
 *   get    -> { id, status:"NOT_READY" } ... -> { id, status:"READY", expiresAt, sessionKey:"stk_..." }
 */
const CID = "8ac1dce0-cf52-4b72-bd3d-84ecc6a5f6c9";
const noopSleep = () => Promise.resolve();
const UPFRONT_CREDITS = computeSessionMeter(0).credits; // 2 (DEFAULT_COST_MODEL)

/** Build a fake RunwaySessionApi that returns a scripted sequence of GET rows. */
function fakeClient(createRow: RealtimeSessionRow, getRows: RealtimeSessionRow[]): RunwaySessionApi & {
  createSpy: ReturnType<typeof vi.fn>;
} {
  let i = 0;
  const createSpy = vi.fn<(input: CreateRealtimeSessionInput) => Promise<RealtimeSessionRow>>(
    async () => createRow,
  );
  return {
    createSpy,
    createRealtimeSession: createSpy,
    getRealtimeSession: async () => getRows[Math.min(i++, getRows.length - 1)]!,
  };
}

const readyOnce = (overrides: Partial<RealtimeSessionRow> = {}) =>
  fakeClient({ id: "sess-1" }, [
    { id: "sess-1", status: "READY", expiresAt: "2026-06-27T14:47:01.147Z", sessionKey: "stk_abc", ...overrides },
  ]);

describe("BridgeSessionBroker: startSession", () => {
  it("should gate, create, poll to READY, and return one-shot creds (happy path)", async () => {
    const client = fakeClient({ id: "sess-1" }, [
      { id: "sess-1", status: "NOT_READY" },
      { id: "sess-1", status: "READY", expiresAt: "2026-06-27T14:47:01.147Z", sessionKey: "stk_abc" },
    ]);
    const broker = new BridgeSessionBroker({ client, avatarId: CID, pollIntervalMs: 1, timeoutMs: 1000, sleepFn: noopSleep });

    const creds = await broker.startSession();

    expect(creds).toEqual({
      sessionId: "sess-1",
      sessionKey: "stk_abc",
      avatarId: CID,
      expiresAt: "2026-06-27T14:47:01.147Z",
    });
    expect(client.createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ avatar: { type: "custom", avatarId: CID } }),
    );
  });

  it("should refuse with a structured ceiling error when the daily ceiling is tripped (cost gate)", async () => {
    const client = readyOnce();
    const costGuard = new BridgeCostGuard({ dailyCreditCeiling: UPFRONT_CREDITS });
    costGuard.recordSpend(UPFRONT_CREDITS); // already at the ceiling for today
    const broker = new BridgeSessionBroker({ client, costGuard, avatarId: CID, pollIntervalMs: 1, sleepFn: noopSleep });

    const err = await broker.startSession().catch((e) => e);
    expect(err).toBeInstanceOf(BridgeCostCeilingError);
    expect(err).toMatchObject({ name: "BridgeCostCeilingError", code: "DAILY_CREDIT_CEILING_REACHED" });
    // Gate runs FIRST — no Runway session is created when blocked.
    expect(client.createSpy).not.toHaveBeenCalled();
  });

  it("should record the upfront credit spend against the guard after creating (meter accounting)", async () => {
    const client = readyOnce();
    const costGuard = new BridgeCostGuard({ dailyCreditCeiling: 1000 });
    const broker = new BridgeSessionBroker({ client, costGuard, avatarId: CID, pollIntervalMs: 1, sleepFn: noopSleep });

    expect(costGuard.spentToday()).toBe(0);
    await broker.startSession();
    expect(costGuard.spentToday()).toBe(UPFRONT_CREDITS);
  });

  it("should still record the upfront spend when the session later times out (conservative accounting)", async () => {
    // create succeeds (Runway charges 2 credits up front) but it never readies.
    const client = fakeClient({ id: "sess-x" }, [{ id: "sess-x", status: "NOT_READY" }]);
    const costGuard = new BridgeCostGuard({ dailyCreditCeiling: 1000 });
    const broker = new BridgeSessionBroker({ client, costGuard, avatarId: CID, pollIntervalMs: 1, timeoutMs: 3, sleepFn: noopSleep });

    await expect(broker.startSession()).rejects.toThrow(/timed out|ready/i);
    expect(costGuard.spentToday()).toBe(UPFRONT_CREDITS);
  });

  it("should forward personality/startScript seed to the client when provided (seed path)", async () => {
    const client = readyOnce();
    const broker = new BridgeSessionBroker({ client, avatarId: CID, pollIntervalMs: 1, sleepFn: noopSleep });

    await broker.startSession({
      personality: "You are the Adjutant. Address the user as Commander.",
      startScript: "Commander, fleet status nominal.",
    });

    expect(client.createSpy).toHaveBeenCalledWith({
      avatar: { type: "custom", avatarId: CID },
      personality: "You are the Adjutant. Address the user as Commander.",
      startScript: "Commander, fleet status nominal.",
    });
  });

  it("should NEVER expose the API secret in the returned creds (security)", async () => {
    const client = readyOnce({ sessionKey: "stk_q" });
    const broker = new BridgeSessionBroker({ client, avatarId: CID, pollIntervalMs: 1, sleepFn: noopSleep });

    const creds = await broker.startSession();

    expect(Object.keys(creds).sort()).toEqual(["avatarId", "expiresAt", "sessionId", "sessionKey"]);
    expect(JSON.stringify(creds)).not.toMatch(/secret|apiKey|Bearer/i);
  });

  it("should accept a per-call avatarId override (edge)", async () => {
    const other = "11111111-2222-3333-4444-555555555555";
    const client = fakeClient({ id: "sess-4" }, [{ id: "sess-4", status: "READY", sessionKey: "stk_o" }]);
    const broker = new BridgeSessionBroker({ client, avatarId: CID, pollIntervalMs: 1, sleepFn: noopSleep });

    const creds = await broker.startSession({ avatarId: other });

    expect(creds.avatarId).toBe(other);
    expect(client.createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ avatar: { type: "custom", avatarId: other } }),
    );
  });

  it("should throw when no avatarId is configured (validation) without creating a session", async () => {
    const client = fakeClient({ id: "x" }, [{ id: "x", status: "READY", sessionKey: "stk" }]);
    const broker = new BridgeSessionBroker({ client, avatarId: "", pollIntervalMs: 1, sleepFn: noopSleep });

    await expect(broker.startSession()).rejects.toThrow(/avatar/i);
    expect(client.createSpy).not.toHaveBeenCalled();
  });

  it("should propagate a create failure from the client (error path)", async () => {
    const client: RunwaySessionApi = {
      createRealtimeSession: async () => {
        throw new Error("Runway session create failed (HTTP 429): rate limited");
      },
      getRealtimeSession: async () => ({ id: "x", status: "READY", sessionKey: "stk" }),
    };
    const broker = new BridgeSessionBroker({ client, avatarId: CID, pollIntervalMs: 1, sleepFn: noopSleep });

    await expect(broker.startSession()).rejects.toThrow(/429|create/i);
  });

  it("should throw when the session ends early with a FAILED status (error path)", async () => {
    const client = fakeClient({ id: "sess-6" }, [{ id: "sess-6", status: "FAILED" }]);
    const broker = new BridgeSessionBroker({ client, avatarId: CID, pollIntervalMs: 1, sleepFn: noopSleep });

    await expect(broker.startSession()).rejects.toThrow(/FAILED|ended early/i);
  });
});

describe("BridgeSessionBroker: TTL awareness (5-min cap)", () => {
  const creds = {
    sessionId: "s",
    sessionKey: "stk",
    avatarId: CID,
    expiresAt: "2026-06-27T15:05:00.000Z",
  };
  const expiryMs = Date.parse(creds.expiresAt);

  it("should compute ms until expiry from the injectable clock (happy path)", () => {
    const broker = new BridgeSessionBroker({ avatarId: CID, nowFn: () => expiryMs - 120_000 });
    expect(broker.msUntilExpiry(creds)).toBe(120_000);
  });

  it("should report not-expiring when comfortably before the renew lead (edge)", () => {
    const broker = new BridgeSessionBroker({ avatarId: CID, renewLeadMs: 30_000, nowFn: () => expiryMs - 120_000 });
    expect(broker.isExpiring(creds)).toBe(false);
  });

  it("should report expiring once within the renew lead window (edge)", () => {
    const broker = new BridgeSessionBroker({ avatarId: CID, renewLeadMs: 30_000, nowFn: () => expiryMs - 20_000 });
    expect(broker.isExpiring(creds)).toBe(true);
  });

  it("should report expiring once past expiry (edge)", () => {
    const broker = new BridgeSessionBroker({ avatarId: CID, renewLeadMs: 30_000, nowFn: () => expiryMs + 5_000 });
    expect(broker.isExpiring(creds)).toBe(true);
  });

  it("should treat creds without expiresAt as unknown — not expiring (edge)", () => {
    const broker = new BridgeSessionBroker({ avatarId: CID });
    const noExpiry = { sessionId: "s", sessionKey: "stk", avatarId: CID };
    expect(broker.msUntilExpiry(noExpiry)).toBeUndefined();
    expect(broker.isExpiring(noExpiry)).toBe(false);
  });
});

describe("BridgeSessionBroker: renewSession", () => {
  it("should mint a fresh session and re-charge the upfront credits (re-seed path)", async () => {
    const client = fakeClient({ id: "sess-new" }, [
      { id: "sess-new", status: "READY", expiresAt: "2026-06-27T15:10:00.000Z", sessionKey: "stk_new" },
    ]);
    const costGuard = new BridgeCostGuard({ dailyCreditCeiling: 1000 });
    const broker = new BridgeSessionBroker({ client, costGuard, avatarId: CID, pollIntervalMs: 1, sleepFn: noopSleep });

    const renewed = await broker.renewSession();

    expect(renewed).toEqual({
      sessionId: "sess-new",
      sessionKey: "stk_new",
      avatarId: CID,
      expiresAt: "2026-06-27T15:10:00.000Z",
    });
    expect(client.createSpy).toHaveBeenCalledTimes(1);
    expect(costGuard.spentToday()).toBe(UPFRONT_CREDITS);
  });

  it("should refuse to renew once the ceiling is tripped (cost gate)", async () => {
    const client = readyOnce();
    const costGuard = new BridgeCostGuard({ dailyCreditCeiling: UPFRONT_CREDITS });
    costGuard.recordSpend(UPFRONT_CREDITS);
    const broker = new BridgeSessionBroker({ client, costGuard, avatarId: CID, pollIntervalMs: 1, sleepFn: noopSleep });

    await expect(broker.renewSession()).rejects.toBeInstanceOf(BridgeCostCeilingError);
    expect(client.createSpy).not.toHaveBeenCalled();
  });
});

describe("BridgeSessionBroker: idle + meter accounting", () => {
  it("should delegate idle detection to the cost guard (idle hook)", () => {
    let clock = 1_000_000;
    const costGuard = new BridgeCostGuard({ idleTimeoutMs: 120_000, nowFn: () => clock });
    const broker = new BridgeSessionBroker({ costGuard, avatarId: CID });

    const lastActivity = clock;
    expect(broker.shouldDisconnectIdle(lastActivity)).toBe(false);
    clock += 119_000;
    expect(broker.shouldDisconnectIdle(lastActivity)).toBe(false);
    clock += 2_000; // now 121s idle, past the 120s timeout
    expect(broker.shouldDisconnectIdle(lastActivity)).toBe(true);
  });

  it("should expose a live session meter matching the cost model (meter accounting)", () => {
    const broker = new BridgeSessionBroker({ avatarId: CID });
    expect(broker.meterSession(60_000)).toEqual(computeSessionMeter(60_000));
  });

  it("should record only the streaming spend at session end, not the already-charged upfront (no double-count)", async () => {
    const client = readyOnce();
    const costGuard = new BridgeCostGuard({ dailyCreditCeiling: 1000 });
    const broker = new BridgeSessionBroker({ client, costGuard, avatarId: CID, pollIntervalMs: 1, sleepFn: noopSleep });

    await broker.startSession(); // records UPFRONT
    broker.recordSessionEnd(60_000); // 60s session

    // Total must equal the full metered cost of a 60s session — upfront counted exactly once.
    expect(costGuard.spentToday()).toBe(computeSessionMeter(60_000).credits);
  });
});

describe("BridgeSessionBroker: getSessionStatus (warm-session re-validation, adj-202.10.1)", () => {
  it("should return the current Runway status for a session id (happy path)", async () => {
    const client = fakeClient({ id: "sess-1" }, [{ id: "sess-1", status: "READY", sessionKey: "stk_abc" }]);
    const broker = new BridgeSessionBroker({ client, avatarId: CID });
    expect(await broker.getSessionStatus("sess-1")).toBe("READY");
  });

  it("should surface a FAILED status so a stale warm session can be discarded", async () => {
    const client = fakeClient({ id: "sess-1" }, [{ id: "sess-1", status: "FAILED" }]);
    const broker = new BridgeSessionBroker({ client, avatarId: CID });
    expect(await broker.getSessionStatus("sess-1")).toBe("FAILED");
  });

  it("should reject when the underlying status lookup fails (caller treats as not-ready)", async () => {
    const client: RunwaySessionApi = {
      createRealtimeSession: vi.fn(),
      getRealtimeSession: vi.fn().mockRejectedValue(new Error("Runway session fetch failed (HTTP 404)")),
    };
    const broker = new BridgeSessionBroker({ client, avatarId: CID });
    await expect(broker.getSessionStatus("sess-gone")).rejects.toThrow(/HTTP 404/);
  });

  it("should return undefined when Runway reports no status field (edge case)", async () => {
    const client = fakeClient({ id: "sess-1" }, [{ id: "sess-1" }]);
    const broker = new BridgeSessionBroker({ client, avatarId: CID });
    expect(await broker.getSessionStatus("sess-1")).toBeUndefined();
  });
});
