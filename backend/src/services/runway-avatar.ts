/**
 * Runway GWM-1 avatar session harness (adj-202.2.1 — "The Bridge" Phase-0 prototype).
 *
 * Server-side ONLY. Creates a real-time conversational avatar session for a Runway
 * Character and polls it to READY, returning the short-lived `{ sessionId, sessionKey }`
 * the browser SDK (`@runwayml/avatars-react` <AvatarCall>) needs to connect via LiveKit.
 * The secret `RUNWAYML_API_SECRET` NEVER leaves the server (NFR — Constitution Rule 4).
 *
 * Flow verified live against api.dev.runwayml.com (2026-06-27):
 *   POST /v1/realtime_sessions  { model:"gwm1_avatars", avatar:{type:"custom", avatarId} } -> { id }
 *   GET  /v1/realtime_sessions/{id}  -> { status: "NOT_READY" } ... -> { status:"READY", expiresAt, sessionKey }
 * Session TTL ≈ 5 minutes; sessionKey ("stk_…") appears only once status is READY.
 *
 * adj-202.3.1: the two HTTP calls are now delegated to the thin {@link RunwayClient}; this
 * module keeps the create+poll lifecycle that the live `/avatar` prototype route depends on.
 * The Phase-1 broker (`bridge-session-broker.ts`) generalizes this lifecycle.
 */

import { RunwayClient, type RealtimeSessionRow } from "./runway-client.js";

export interface RunwayAvatarConfig {
  /** Runway dev-org secret. Defaults to process.env.RUNWAYML_API_SECRET. */
  apiKey?: string;
  /** Character/avatar UUID. Defaults to process.env.RUNWAY_AVATAR_ID. */
  avatarId?: string;
  baseUrl?: string;
  apiVersion?: string;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests. Defaults to a real timer. */
  sleepFn?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface AvatarSession {
  sessionId: string;
  sessionKey: string;
  avatarId: string;
  expiresAt?: string;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Create a Runway avatar session and poll it to READY.
 * @throws if no API key / avatarId is configured, the create call fails, or it never readies.
 */
export async function createReadyAvatarSession(cfg: RunwayAvatarConfig = {}): Promise<AvatarSession> {
  // Constructing the client validates + holds the secret (throws if the key is missing).
  const client = new RunwayClient({
    ...(cfg.apiKey !== undefined ? { apiKey: cfg.apiKey } : {}),
    ...(cfg.baseUrl !== undefined ? { baseUrl: cfg.baseUrl } : {}),
    ...(cfg.apiVersion !== undefined ? { apiVersion: cfg.apiVersion } : {}),
    ...(cfg.fetchImpl !== undefined ? { fetchImpl: cfg.fetchImpl } : {}),
  });

  const avatarId = cfg.avatarId ?? process.env["RUNWAY_AVATAR_ID"] ?? "";
  const sleep = cfg.sleepFn ?? defaultSleep;
  const pollIntervalMs = cfg.pollIntervalMs ?? 1500;
  const timeoutMs = cfg.timeoutMs ?? 30_000;

  if (!avatarId) throw new Error("avatarId is not configured (set RUNWAY_AVATAR_ID)");

  // 1. Create
  const created = await client.createRealtimeSession({ avatar: { type: "custom", avatarId } });
  const sessionId = created.id;

  // 2. Poll to READY
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / Math.max(1, pollIntervalMs)));
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let row: RealtimeSessionRow | undefined;
    try {
      row = await client.getRealtimeSession(sessionId);
    } catch {
      // Transient poll failure — keep trying until the timeout budget runs out.
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
    await sleep(pollIntervalMs);
  }
  throw new Error(`Runway session ${sessionId} timed out before reaching READY`);
}
