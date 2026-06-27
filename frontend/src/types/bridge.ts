/**
 * The Bridge (adj-202) — frontend types for the read-only Fleet Briefing.
 *
 * Mirrors the backend contract (`backend/src/routes/bridge.ts` +
 * `bridge-tool-bridge.ts`). The avatar session credentials and the STRUCTURED
 * tool result are the source of truth the avatar's voice only narrates — so the
 * shapes here are kept deliberately faithful to what the server returns.
 */

/** The whitelisted, read-only tools the Bridge exposes to the avatar. */
export const BRIDGE_READONLY_TOOLS = [
  'get_project_state',
  'list_agents',
  'list_questions',
  'list_beads',
  'get_auto_develop_status',
] as const;

export type BridgeToolName = (typeof BRIDGE_READONLY_TOOLS)[number];

/** Short-lived avatar session credentials returned by `POST /api/bridge/session`. */
export interface BridgeSessionCreds {
  sessionId: string;
  /** The short-lived WebRTC credential — the only secret that crosses to the browser. */
  sessionKey: string;
  avatarId: string;
  /** ISO timestamp the session expires (Runway caps at ~5 min). */
  expiresAt?: string;
}

/** Optional overrides for a session create (the server seeds sensible defaults). */
export interface BridgeSessionOptions {
  avatarId?: string;
  personality?: string;
  startScript?: string;
}

/** Request body for `POST /api/bridge/tool`. */
export interface BridgeToolRequest {
  tool: string;
  projectId?: string;
  args?: Record<string, unknown>;
}

/** Success `data` envelope from `POST /api/bridge/tool`. */
export interface BridgeToolResponse {
  tool: string;
  projectId: string | null;
  data: unknown;
}

/**
 * Structured outcome of a `runTool` call. The hook normalizes both the HTTP
 * success envelope and a thrown {@link ApiError} into this discriminated union so
 * the authoritative result panel can render either verbatim.
 */
export type BridgeToolRunResult =
  | { ok: true; tool: string; projectId: string | null; data: unknown }
  | { ok: false; error: { code: string; message: string } };
