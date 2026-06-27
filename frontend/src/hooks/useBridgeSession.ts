import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

import api from '../services/api';
import type {
  BridgeSessionCreds,
  BridgeSessionOptions,
  BridgeToolRequest,
  BridgeToolRunResult,
} from '../types/bridge';

/**
 * useBridgeSession (adj-202.3.6) — session lifecycle for The Bridge.
 *
 * Owns the avatar session for the read-only Fleet Briefing panel. It manages a
 * connection state machine, a live session timer + credit meter, and a `runTool`
 * helper. Everything user-facing flows from the STRUCTURED result the server
 * returns — the avatar's voice is presentation, the data is the source of truth.
 *
 * Cost meter mirrors the backend cost guard (`bridge-cost-guard.ts`): 2 credits
 * up front per session + 2 credits per 6-second streaming block, with partial
 * blocks rounded UP so the meter never under-reports what Runway will bill.
 *
 * Cost safety (adj-202.3.7.4): a GWM-1 session burns ~$0.20/min, so the hook
 * also enforces a CLIENT-side idle auto-disconnect (reset by `markActivity` and
 * any tool call) and tears the session down at `expiresAt`. The backend guard is
 * the hard ceiling; this is the in-browser belt-and-suspenders.
 *
 * Error clarity (adj-202.3.7.6): `connect` surfaces the structured `errorCode` /
 * `errorStatus` (e.g. a 429 daily-ceiling) so the panel can distinguish "we hit
 * our budget" from "the link broke".
 */

export type BridgeConnectionState = 'idle' | 'connecting' | 'connected' | 'error';

/** Why an active session ended — lets the panel narrate the disconnect. */
export type BridgeEndReason = 'manual' | 'idle' | 'expired';

/** Credit/dollar cost model — kept in lockstep with the backend DEFAULT_COST_MODEL. */
export interface BridgeCostModel {
  upfrontCredits: number;
  creditsPerBlock: number;
  blockSeconds: number;
  dollarsPerCredit: number;
}

export const BRIDGE_COST_MODEL: BridgeCostModel = {
  upfrontCredits: 2,
  creditsPerBlock: 2,
  blockSeconds: 6,
  dollarsPerCredit: 0.01,
};

/**
 * Default client idle timeout — mirrors the backend `DEFAULT_IDLE_TIMEOUT_MS`
 * (2 min). A session quiet this long auto-disconnects to stop credit burn.
 */
export const DEFAULT_IDLE_TIMEOUT_MS = 120_000;

/** A live meter snapshot for an elapsed session. */
export interface BridgeMeter {
  elapsedSeconds: number;
  blocks: number;
  credits: number;
  dollars: number;
}

/** Zeroed meter for the idle/disconnected state (no session ⇒ no spend). */
const ZERO_METER: BridgeMeter = { elapsedSeconds: 0, blocks: 0, credits: 0, dollars: 0 };

/**
 * Pure: compute the credits/dollars for a session that has run `elapsedMs`.
 * Negative elapsed time (clock skew) clamps to zero; partial 6s blocks round UP.
 * Mirrors `computeSessionMeter` in `backend/src/services/bridge-cost-guard.ts`.
 */
export function computeBridgeMeter(
  elapsedMs: number,
  model: BridgeCostModel = BRIDGE_COST_MODEL,
): BridgeMeter {
  const safeElapsedMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const elapsedSeconds = safeElapsedMs / 1000;
  const blocks = model.blockSeconds > 0 ? Math.ceil(elapsedSeconds / model.blockSeconds) : 0;
  const credits = model.upfrontCredits + blocks * model.creditsPerBlock;
  const dollars = credits * model.dollarsPerCredit;
  return { elapsedSeconds, blocks, credits, dollars };
}

export interface UseBridgeSessionOptions {
  /** Idle window before auto-disconnect. <= 0 disables it. Default 120s. */
  idleTimeoutMs?: number;
}

export interface UseBridgeSessionResult {
  state: BridgeConnectionState;
  creds: BridgeSessionCreds | null;
  error: string | null;
  /** Structured error code from the last failed connect (e.g. a ceiling code). */
  errorCode: string | null;
  /** HTTP status from the last failed connect (e.g. 429 for the daily ceiling). */
  errorStatus: number | null;
  /** Why the last active session ended (null until one ends). */
  lastEndReason: BridgeEndReason | null;
  /** Wall-clock milliseconds since the session connected (0 when not connected). */
  elapsedMs: number;
  /** Live credit/dollar meter derived from `elapsedMs`. */
  meter: BridgeMeter;
  connect: (opts?: BridgeSessionOptions) => Promise<void>;
  disconnect: () => void;
  /** Reset the idle countdown — call on user interaction (mic, input, etc.). */
  markActivity: () => void;
  runTool: (
    tool: string,
    projectId?: string,
    args?: Record<string, unknown>,
  ) => Promise<BridgeToolRunResult>;
}

/** How often the live timer ticks while connected. */
const TICK_MS = 1_000;

/** Read a string `code` off an unknown thrown value (ApiError or plain object). */
function readErrorCode(err: unknown): string | null {
  if (err && typeof err === 'object' && 'code' in err && typeof err.code === 'string') {
    return err.code;
  }
  return null;
}

/** Read a numeric `status` off an unknown thrown value (ApiError). */
function readErrorStatus(err: unknown): number | null {
  if (err && typeof err === 'object' && 'status' in err && typeof err.status === 'number') {
    return err.status;
  }
  return null;
}

export function useBridgeSession(options: UseBridgeSessionOptions = {}): UseBridgeSessionResult {
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;

  const [state, setState] = useState<BridgeConnectionState>('idle');
  const [creds, setCreds] = useState<BridgeSessionCreds | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [lastEndReason, setLastEndReason] = useState<BridgeEndReason | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  // The wall-clock origin of the active session + the live tick interval.
  const startedAtRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Cost-safety timers: idle auto-disconnect + hard expiry teardown.
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (tickRef.current !== null) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (expiryTimerRef.current !== null) {
      clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }
    startedAtRef.current = null;
  }, []);

  // Tear everything down on unmount so a backgrounded panel can't leak timers.
  useEffect(() => clearTimers, [clearTimers]);

  // End the session locally. `endSession` is the single teardown path so manual,
  // idle, and expiry disconnects behave identically (only the reason differs).
  const endSession = useCallback(
    (reason: BridgeEndReason) => {
      clearTimers();
      setCreds(null);
      setError(null);
      setElapsedMs(0);
      setLastEndReason(reason);
      setState('idle');
    },
    [clearTimers],
  );

  const scheduleIdle = useCallback(() => {
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (idleTimeoutMs <= 0) return;
    idleTimerRef.current = setTimeout(() => {
      endSession('idle');
    }, idleTimeoutMs);
  }, [idleTimeoutMs, endSession]);

  const markActivity = useCallback(() => {
    // Only meaningful while a session is live; cheap no-op otherwise.
    if (startedAtRef.current === null) return;
    scheduleIdle();
  }, [scheduleIdle]);

  const disconnect = useCallback(() => {
    endSession('manual');
  }, [endSession]);

  const connect = useCallback(
    async (opts?: BridgeSessionOptions) => {
      // Re-connecting from any state: clear timers + stale error/end metadata.
      clearTimers();
      setError(null);
      setErrorCode(null);
      setErrorStatus(null);
      setLastEndReason(null);
      setElapsedMs(0);
      setState('connecting');
      try {
        const next = await api.bridge.startSession(opts);
        setCreds(next);
        setState('connected');

        const startedAt = Date.now();
        startedAtRef.current = startedAt;
        setElapsedMs(0);
        tickRef.current = setInterval(() => {
          const origin = startedAtRef.current;
          if (origin === null) return;
          setElapsedMs(Date.now() - origin);
        }, TICK_MS);

        // Cost safety: arm idle auto-disconnect + a hard teardown at expiry.
        scheduleIdle();
        if (next.expiresAt) {
          const msUntilExpiry = Math.max(0, Date.parse(next.expiresAt) - Date.now());
          if (Number.isFinite(msUntilExpiry)) {
            expiryTimerRef.current = setTimeout(() => {
              endSession('expired');
            }, msUntilExpiry);
          }
        }
      } catch (err) {
        clearTimers();
        setCreds(null);
        setState('error');
        setError(err instanceof Error ? err.message : String(err));
        setErrorCode(readErrorCode(err));
        setErrorStatus(readErrorStatus(err));
      }
    },
    [clearTimers, scheduleIdle, endSession],
  );

  const runTool = useCallback(
    async (
      tool: string,
      projectId?: string,
      args?: Record<string, unknown>,
    ): Promise<BridgeToolRunResult> => {
      // A tool call is interaction — keep the idle countdown fresh.
      markActivity();
      // Build the request with only the keys actually supplied
      // (exactOptionalPropertyTypes — undefined values are not assignable).
      const req: BridgeToolRequest = { tool };
      if (projectId !== undefined) req.projectId = projectId;
      if (args !== undefined) req.args = args;
      try {
        const res = await api.bridge.runTool(req);
        return { ok: true, tool: res.tool, projectId: res.projectId, data: res.data };
      } catch (err) {
        // ApiError carries a structured `code`; fall back to a generic code otherwise.
        const code = readErrorCode(err) ?? 'TOOL_ERROR';
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: { code, message } };
      }
    },
    [markActivity],
  );

  const meter = useMemo<BridgeMeter>(
    () => (state === 'connected' ? computeBridgeMeter(elapsedMs) : ZERO_METER),
    [state, elapsedMs],
  );

  return {
    state,
    creds,
    error,
    errorCode,
    errorStatus,
    lastEndReason,
    elapsedMs,
    meter,
    connect,
    disconnect,
    markActivity,
    runTool,
  };
}
