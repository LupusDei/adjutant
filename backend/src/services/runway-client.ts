/**
 * Runway realtime-sessions HTTP client (adj-202.3.1 — "The Bridge" Phase-1).
 *
 * A THIN, authed wrapper over the two Runway endpoints the avatar flow needs:
 *   POST /v1/realtime_sessions        -> create a `gwm1_avatars` session  -> { id }
 *   GET  /v1/realtime_sessions/{id}   -> poll for readiness               -> { status, sessionKey?, expiresAt? }
 *
 * It owns NO lifecycle/polling logic — that is `bridge-session-broker.ts`'s job. This layer
 * only signs requests (Bearer + X-Runway-Version), shapes the JSON body, and turns non-2xx
 * responses into a typed `RunwayApiError`. The secret `RUNWAYML_API_SECRET` is read here and
 * NEVER leaves the server (NFR — Constitution Rule 4): only `sessionKey` (the short-lived
 * browser cred) ever flows outward, and that happens in the broker/route, not here.
 *
 * Flow + shapes verified live against api.dev.runwayml.com (2026-06-27) — see
 * specs/060-the-bridge-voice-coordinator/research.md.
 */

const RUNWAY_BASE = "https://api.dev.runwayml.com/v1";
const RUNWAY_API_VERSION = "2024-11-06";
const RUNWAY_AVATAR_MODEL = "gwm1_avatars";

export interface RunwayClientConfig {
  /** Runway dev-org secret. Defaults to process.env.RUNWAYML_API_SECRET. */
  apiKey?: string;
  /** API base URL. Defaults to the dev endpoint. */
  baseUrl?: string;
  /** Runway API version header. Defaults to the pinned version. */
  apiVersion?: string;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/** Avatar selector for a realtime session (Runway "custom" character). */
export interface RunwayAvatarSelector {
  type: string;
  avatarId: string;
}

/** One declared parameter of a Runway RPC tool (the shape the model sees). */
export interface RunwayRpcToolParam {
  name: string;
  /** JSON-ish type, e.g. "string" | "number" | "boolean". */
  type: string;
  description: string;
}

/**
 * A `backend_rpc` tool the avatar's model may call mid-conversation. Declared at
 * session-create so the model knows the tool exists; the actual handler runs
 * server-side via `@runwayml/avatars-node-rpc` (see bridge-rpc-handler.ts).
 */
export interface RunwayRpcToolDef {
  type: "backend_rpc";
  name: string;
  description: string;
  parameters: RunwayRpcToolParam[];
  /** How long Runway waits for the handler before giving up on the call. */
  timeoutSeconds: number;
}

/** Input for {@link RunwayClient.createRealtimeSession}. */
export interface CreateRealtimeSessionInput {
  avatar: RunwayAvatarSelector;
  /** Defaults to "gwm1_avatars". */
  model?: string;
  /** Optional per-session system persona, included in the body only when provided. */
  personality?: string;
  /** Optional opening line the avatar speaks, included in the body only when provided. */
  startScript?: string;
  /** Optional `backend_rpc` tools the model may call; included only when non-empty. */
  tools?: RunwayRpcToolDef[];
}

/** A realtime-session row as returned by Runway (fields appear progressively as it readies). */
export interface RealtimeSessionRow {
  id: string;
  status?: string;
  createdAt?: string;
  expiresAt?: string;
  /** "stk_…" — only present once status is READY. */
  sessionKey?: string;
}

/**
 * Raw LiveKit room-join credentials for an EXISTING realtime session (the `/connect_backend`
 * response shape — adj-207.4.5). Unlike `sessionKey` (which the Runway JS SDK consumes), these
 * are the LiveKit primitives a NATIVE LiveKit client uses directly: `room.connect(url, token)`.
 * Runway mints a fresh participant token joining the SAME room, so an additional read-only
 * subscriber can attach WITHOUT creating a second realtime session (no second upfront charge).
 * This is the exact endpoint `@runwayml/avatars-node-rpc` uses to add its hidden RPC participant.
 */
export interface LiveKitConnectCreds {
  /** LiveKit server URL, e.g. "wss://…". */
  url: string;
  /** Room-scoped LiveKit access token for THIS join. */
  token: string;
  /** The LiveKit room name backing the realtime session. */
  roomName: string;
  /** ISO timestamp of the session cap, when Runway reports it. */
  expiresAt?: string;
}

/** Typed error for a non-2xx Runway response. Carries the HTTP status + truncated body. */
export class RunwayApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(operation: string, status: number, detail: string) {
    super(`Runway ${operation} failed (HTTP ${status}): ${detail}`);
    this.name = "RunwayApiError";
    this.status = status;
    this.detail = detail;
  }
}

export class RunwayClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly apiVersion: string;
  private readonly doFetch: typeof fetch;

  constructor(cfg: RunwayClientConfig = {}) {
    this.apiKey = cfg.apiKey ?? process.env["RUNWAYML_API_SECRET"] ?? "";
    this.baseUrl = cfg.baseUrl ?? RUNWAY_BASE;
    this.apiVersion = cfg.apiVersion ?? RUNWAY_API_VERSION;
    this.doFetch = cfg.fetchImpl ?? fetch;

    if (!this.apiKey) throw new Error("RUNWAYML_API_SECRET is not configured");
  }

  /** Create a realtime avatar session. Returns the raw `{ id }` row Runway responds with. */
  async createRealtimeSession(input: CreateRealtimeSessionInput): Promise<RealtimeSessionRow> {
    const body: Record<string, unknown> = {
      model: input.model ?? RUNWAY_AVATAR_MODEL,
      avatar: input.avatar,
    };
    // Only attach seed fields when supplied — keeps the proven base body byte-identical.
    if (input.personality !== undefined) body["personality"] = input.personality;
    if (input.startScript !== undefined) body["startScript"] = input.startScript;
    if (input.tools !== undefined && input.tools.length > 0) body["tools"] = input.tools;

    const res = await this.doFetch(`${this.baseUrl}/realtime_sessions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new RunwayApiError("session create", res.status, await safeText(res));
    return (await res.json()) as RealtimeSessionRow;
  }

  /** Fetch a single realtime session by id (poll target for readiness). */
  async getRealtimeSession(sessionId: string): Promise<RealtimeSessionRow> {
    const res = await this.doFetch(`${this.baseUrl}/realtime_sessions/${sessionId}`, {
      method: "GET",
      headers: this.headers(),
    });
    if (!res.ok) throw new RunwayApiError("session fetch", res.status, await safeText(res));
    return (await res.json()) as RealtimeSessionRow;
  }

  /**
   * Join an EXISTING realtime session's LiveKit room as an additional participant (adj-207.4.5).
   * Returns the raw `{ url, token, roomName }` a native LiveKit client connects with. This does
   * NOT create a new realtime session — it only mints a participant token for the current one, so
   * a native read-only subscriber attaches with no second upfront credit charge. Same endpoint
   * `@runwayml/avatars-node-rpc` uses to add its hidden RPC participant.
   *
   * NOTE: the exact path/response is verified against the node-rpc package's `/connect_backend`
   * contract; confirm live at integration (see adj-207.4.5). The broker/route unit tests inject a
   * fake so their correctness does not depend on this path.
   */
  async connectBackend(sessionId: string): Promise<LiveKitConnectCreds> {
    const res = await this.doFetch(`${this.baseUrl}/realtime_sessions/${sessionId}/connect_backend`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new RunwayApiError("session connect_backend", res.status, await safeText(res));
    return (await res.json()) as LiveKitConnectCreds;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "X-Runway-Version": this.apiVersion,
      "Content-Type": "application/json",
    };
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "<no body>";
  }
}
