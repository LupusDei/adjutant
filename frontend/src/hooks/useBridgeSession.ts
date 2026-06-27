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
 */

export type BridgeConnectionState = 'idle' | 'connecting' | 'connected' | 'error';

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

export interface UseBridgeSessionResult {
  state: BridgeConnectionState;
  creds: BridgeSessionCreds | null;
  error: string | null;
  /** Wall-clock milliseconds since the session connected (0 when not connected). */
  elapsedMs: number;
  /** Live credit/dollar meter derived from `elapsedMs`. */
  meter: BridgeMeter;
  connect: (opts?: BridgeSessionOptions) => Promise<void>;
  disconnect: () => void;
  runTool: (
    tool: string,
    projectId?: string,
    args?: Record<string, unknown>,
  ) => Promise<BridgeToolRunResult>;
}

/** How often the live timer ticks while connected. */
const TICK_MS = 1_000;

export function useBridgeSession(): UseBridgeSessionResult {
  const [state, setState] = useState<BridgeConnectionState>('idle');
  const [creds, setCreds] = useState<BridgeSessionCreds | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  // The wall-clock origin of the active session, and the live tick interval.
  const startedAtRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = useCallback(() => {
    if (tickRef.current !== null) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    startedAtRef.current = null;
  }, []);

  // Always tear the interval down on unmount so a backgrounded panel can't leak it.
  useEffect(() => stopTimer, [stopTimer]);

  const connect = useCallback(
    async (opts?: BridgeSessionOptions) => {
      // Re-connecting from any state: clear the old timer + error first.
      stopTimer();
      setError(null);
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
      } catch (err) {
        stopTimer();
        setCreds(null);
        setState('error');
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [stopTimer],
  );

  const disconnect = useCallback(() => {
    stopTimer();
    setCreds(null);
    setError(null);
    setElapsedMs(0);
    setState('idle');
  }, [stopTimer]);

  const runTool = useCallback(
    async (
      tool: string,
      projectId?: string,
      args?: Record<string, unknown>,
    ): Promise<BridgeToolRunResult> => {
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
        const code =
          err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
            ? err.code
            : 'TOOL_ERROR';
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: { code, message } };
      }
    },
    [],
  );

  const meter = useMemo<BridgeMeter>(
    () => (state === 'connected' ? computeBridgeMeter(elapsedMs) : ZERO_METER),
    [state, elapsedMs],
  );

  return { state, creds, error, elapsedMs, meter, connect, disconnect, runTool };
}
