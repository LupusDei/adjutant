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
 */

const RUNWAY_BASE = "https://api.dev.runwayml.com/v1";
const RUNWAY_API_VERSION = "2024-11-06";

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

interface SessionRow {
  id: string;
  status?: string;
  expiresAt?: string;
  sessionKey?: string;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Create a Runway avatar session and poll it to READY.
 * @throws if no API key / avatarId is configured, the create call fails, or it never readies.
 */
export async function createReadyAvatarSession(cfg: RunwayAvatarConfig = {}): Promise<AvatarSession> {
  const apiKey = cfg.apiKey ?? process.env["RUNWAYML_API_SECRET"] ?? "";
  const avatarId = cfg.avatarId ?? process.env["RUNWAY_AVATAR_ID"] ?? "";
  const baseUrl = cfg.baseUrl ?? RUNWAY_BASE;
  const apiVersion = cfg.apiVersion ?? RUNWAY_API_VERSION;
  const doFetch = cfg.fetchImpl ?? fetch;
  const sleep = cfg.sleepFn ?? defaultSleep;
  const pollIntervalMs = cfg.pollIntervalMs ?? 1500;
  const timeoutMs = cfg.timeoutMs ?? 30_000;

  if (!apiKey) throw new Error("RUNWAYML_API_SECRET is not configured");
  if (!avatarId) throw new Error("avatarId is not configured (set RUNWAY_AVATAR_ID)");

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "X-Runway-Version": apiVersion,
    "Content-Type": "application/json",
  };

  // 1. Create
  const createRes = await doFetch(`${baseUrl}/realtime_sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: "gwm1_avatars", avatar: { type: "custom", avatarId } }),
  });
  if (!createRes.ok) {
    const detail = await safeText(createRes);
    throw new Error(`Runway session create failed (HTTP ${createRes.status}): ${detail}`);
  }
  const created = (await createRes.json()) as SessionRow;
  const sessionId = created.id;

  // 2. Poll to READY
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / Math.max(1, pollIntervalMs)));
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const getRes = await doFetch(`${baseUrl}/realtime_sessions/${sessionId}`, { method: "GET", headers });
    if (getRes.ok) {
      const row = (await getRes.json()) as SessionRow;
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

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "<no body>";
  }
}
