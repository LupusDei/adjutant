/**
 * Bridge session broker (adj-202.3.4 — "The Bridge" Phase-1).
 *
 * Owns the Runway `gwm1_avatars` realtime-session lifecycle for the conversational Adjutant
 * avatar, layered on the thin {@link RunwayClient} (HTTP) and the pure {@link BridgeCostGuard}
 * (spend ceiling + idle + meter). One service the route layer can drive end-to-end:
 *
 *   startSession()      cost gate → create → record upfront spend → poll to READY → one-shot
 *                       browser creds { sessionId, sessionKey, avatarId, expiresAt }
 *   renewSession()      same path again (Runway sessions can't be extended — a renew is a fresh
 *                       create + re-seed), re-gated and re-charged
 *   isExpiring() /      5-minute TTL awareness so the caller can pre-emptively renew before the
 *   msUntilExpiry()     ~5-min cap
 *   shouldDisconnectIdle() / meterSession() / recordSessionEnd()
 *                       idle auto-disconnect hook + live meter + end-of-session accounting
 *
 * Security (Constitution Rule 4): the Runway API secret lives inside the client and is NEVER
 * part of the creds returned — only `sessionKey` (the short-lived WebRTC cred) flows outward.
 *
 * Cost accounting: Runway charges the upfront credits the moment a session is created, so the
 * broker records them right after a successful create (even if it later times out — conservative,
 * never under-counts). End-of-session streaming spend is recorded separately by
 * {@link recordSessionEnd}, which excludes the already-charged upfront so it is never double-counted.
 *
 * Polling/clock are injectable so the whole lifecycle is unit-testable without real timers.
 */

import {
  RunwayClient,
  type RunwayClientConfig,
  type RealtimeSessionRow,
  type CreateRealtimeSessionInput,
  type RunwayRpcToolDef,
} from "./runway-client.js";
import { BridgeCostGuard } from "./bridge-cost-guard.js";

/** The slice of the Runway client the broker depends on (keeps it mockable). */
export interface RunwaySessionApi {
  createRealtimeSession(input: CreateRealtimeSessionInput): Promise<RealtimeSessionRow>;
  getRealtimeSession(sessionId: string): Promise<RealtimeSessionRow>;
}

/** One-shot, browser-safe credentials for a ready avatar session. Never carries the secret. */
export interface BridgeSessionCreds {
  sessionId: string;
  sessionKey: string;
  avatarId: string;
  /** ISO timestamp of the ~5-min session cap; absent if Runway did not report one. */
  expiresAt?: string;
}

/** Per-call options for {@link BridgeSessionBroker.startSession}. */
export interface StartSessionOptions {
  /** Override the broker's default avatar for this session. */
  avatarId?: string;
  /** Per-session persona / fleet snapshot (forwarded to Runway only when provided). */
  personality?: string;
  /** Opening line the avatar speaks (forwarded only when provided). */
  startScript?: string;
  /** `backend_rpc` tools the avatar may call (forwarded only when non-empty). */
  tools?: RunwayRpcToolDef[];
}

export interface BridgeSessionBrokerConfig {
  /** Injectable Runway client. Defaults to a real {@link RunwayClient}. */
  client?: RunwaySessionApi;
  /** Config used to build the default client when `client` is omitted. */
  clientConfig?: RunwayClientConfig;
  /** Injectable cost guard. Defaults to a fresh {@link BridgeCostGuard} (default ceiling). */
  costGuard?: BridgeCostGuard;
  /** Default avatar UUID. Defaults to process.env.RUNWAY_AVATAR_ID. */
  avatarId?: string;
  /** Poll interval while waiting for READY. */
  pollIntervalMs?: number;
  /** Overall budget before a create is considered timed out. */
  timeoutMs?: number;
  /** How close to `expiresAt` counts as "expiring" (renew lead). Default 30s. */
  renewLeadMs?: number;
  /** Injectable for tests. Defaults to a real timer. */
  sleepFn?: (ms: number) => Promise<void>;
  /** Injectable clock for TTL math. Defaults to Date.now. */
  nowFn?: () => number;
}

const DEFAULT_POLL_INTERVAL_MS = 1500;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RENEW_LEAD_MS = 30_000;

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Thrown by {@link BridgeSessionBroker.startSession} when the daily credit ceiling is reached. */
export class BridgeCostCeilingError extends Error {
  readonly code = "DAILY_CREDIT_CEILING_REACHED";

  constructor(message = "Daily avatar credit ceiling reached — session refused") {
    super(message);
    this.name = "BridgeCostCeilingError";
  }
}

export class BridgeSessionBroker {
  private providedClient: RunwaySessionApi | undefined;
  private readonly clientConfig: RunwayClientConfig;
  private readonly costGuard: BridgeCostGuard;
  private readonly defaultAvatarId: string;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly renewLeadMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(cfg: BridgeSessionBrokerConfig = {}) {
    this.providedClient = cfg.client;
    this.clientConfig = cfg.clientConfig ?? {};
    this.costGuard = cfg.costGuard ?? new BridgeCostGuard();
    this.defaultAvatarId = cfg.avatarId ?? process.env["RUNWAY_AVATAR_ID"] ?? "";
    this.pollIntervalMs = cfg.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.renewLeadMs = cfg.renewLeadMs ?? DEFAULT_RENEW_LEAD_MS;
    this.sleep = cfg.sleepFn ?? defaultSleep;
    this.now = cfg.nowFn ?? Date.now;
  }

  /**
   * The Runway client, built lazily so a broker used purely for TTL/idle/meter math never
   * requires the secret. Constructing the default client validates `RUNWAYML_API_SECRET`.
   */
  private get client(): RunwaySessionApi {
    if (!this.providedClient) this.providedClient = new RunwayClient(this.clientConfig);
    return this.providedClient;
  }

  /** Credits Runway charges the moment a session is created (from the guard's cost model). */
  private upfrontCredits(): number {
    return this.costGuard.meter(0).credits;
  }

  /**
   * Cost-gate, create a fresh avatar session, record its upfront spend, and poll it to READY.
   *
   * @throws {@link BridgeCostCeilingError} if today's credit ceiling is already reached
   *   (checked FIRST — no session is created when blocked).
   * @throws if no avatarId is configured, the create call fails, the session fails, or it never
   *   reaches READY within the timeout budget.
   */
  async startSession(opts: StartSessionOptions = {}): Promise<BridgeSessionCreds> {
    // 1. Cost gate FIRST — never create a billable session past the ceiling.
    if (!this.costGuard.canStartSession()) {
      throw new BridgeCostCeilingError();
    }

    const avatarId = opts.avatarId ?? this.defaultAvatarId;
    if (!avatarId) throw new Error("avatarId is not configured (set RUNWAY_AVATAR_ID)");

    const input: CreateRealtimeSessionInput = { avatar: { type: "custom", avatarId } };
    if (opts.personality !== undefined) input.personality = opts.personality;
    if (opts.startScript !== undefined) input.startScript = opts.startScript;
    if (opts.tools !== undefined) input.tools = opts.tools;

    // 2. Create — Runway charges the upfront credits here, so record them immediately
    //    (conservative: a later poll timeout/failure still cost real money).
    const created = await this.client.createRealtimeSession(input);
    this.costGuard.recordSpend(this.upfrontCredits());
    const sessionId = created.id;

    // 3. Poll to READY.
    const maxAttempts = Math.max(1, Math.ceil(this.timeoutMs / Math.max(1, this.pollIntervalMs)));
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let row: RealtimeSessionRow | undefined;
      try {
        row = await this.client.getRealtimeSession(sessionId);
      } catch {
        // Transient poll failure — keep trying until the budget is exhausted.
        row = undefined;
      }
      if (row) {
        if ((row.status === "READY" || row.status === "RUNNING") && row.sessionKey) {
          return {
            sessionId,
            sessionKey: row.sessionKey,
            avatarId,
            ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}),
          };
        }
        if (row.status === "FAILED" || row.status === "COMPLETED") {
          throw new Error(`Runway session ${sessionId} ended early with status ${row.status}`);
        }
      }
      await this.sleep(this.pollIntervalMs);
    }
    throw new Error(`Runway session ${sessionId} timed out before reaching READY`);
  }

  /**
   * Mint a fresh session to replace one nearing the cap, re-seeding personality/startScript.
   * Runway sessions cannot be extended in place, so a "renew" is a new gated+charged create.
   */
  async renewSession(opts: StartSessionOptions = {}): Promise<BridgeSessionCreds> {
    return this.startSession(opts);
  }

  /** Milliseconds until the session's cap, or undefined when Runway reported no expiry. */
  msUntilExpiry(creds: Pick<BridgeSessionCreds, "expiresAt">, nowMs: number = this.now()): number | undefined {
    if (!creds.expiresAt) return undefined;
    const expiry = Date.parse(creds.expiresAt);
    if (Number.isNaN(expiry)) return undefined;
    return expiry - nowMs;
  }

  /**
   * True when the session is within the renew-lead window of (or already past) its cap.
   * An unknown expiry is treated as not-expiring — the caller can't act on a value it lacks.
   */
  isExpiring(creds: Pick<BridgeSessionCreds, "expiresAt">, nowMs: number = this.now()): boolean {
    const remaining = this.msUntilExpiry(creds, nowMs);
    if (remaining === undefined) return false;
    return remaining <= this.renewLeadMs;
  }

  /** Idle auto-disconnect hook: whether a session last active at `lastActivityAtMs` is stale. */
  shouldDisconnectIdle(lastActivityAtMs: number): boolean {
    return this.costGuard.shouldDisconnectIdle(lastActivityAtMs);
  }

  /** Live meter (credits + dollars) for a session that has run `elapsedMs`. */
  meterSession(elapsedMs: number): ReturnType<BridgeCostGuard["meter"]> {
    return this.costGuard.meter(elapsedMs);
  }

  /**
   * Record an ended session's streaming spend against the daily tally. The upfront credits were
   * already charged at {@link startSession}, so only the per-block streaming portion is added —
   * never double-counting the upfront.
   */
  recordSessionEnd(elapsedMs: number): void {
    const streamingCredits = this.costGuard.meter(elapsedMs).credits - this.upfrontCredits();
    if (streamingCredits > 0) this.costGuard.recordSpend(streamingCredits);
  }
}
