/**
 * The Bridge — transcript FETCH service (adj-202.6.6: the PROVEN transcript path).
 *
 * Runway GWM-1 publishes ZERO LiveKit `lk.transcription` text streams (verified live across
 * many sessions, incl. a deliberate spoken "314159" session with both worker: + user:
 * participants in the room), so the transport-layer listener path cannot work and has been
 * retired. The transcript IS available, though — Runway bakes a transcript REST API for every
 * avatar conversation:
 *
 *   GET {baseUrl}/v1/avatars/{avatarId}/conversations/{sessionId}
 *     Authorization: Bearer <RUNWAYML_API_SECRET>
 *     X-Runway-Version: 2024-11-06
 *   -> 200 { id, name, avatar, transcript:[{role:"user"|"assistant", content}],
 *            recordingUrl, status, startedAt, endedAt, duration, ... }
 *
 * (`sessionId === conversationId`; proven live against conv 76b11cd6.) On session end this
 * service fetches that conversation, maps each turn's role to a {@link TranscriptSpeaker}
 * (`user`→commander, `assistant`→avatar) and feeds it, oldest→newest, through the EXISTING
 * {@link BridgeTranscriptPersister}, which writes the turns into the SAME `user`↔`adjutant` DM
 * the Commander already has — making the Bridge a persistent chat with default, viewable
 * history. It reuses the broker's Runway credentials (Constitution Rule 4) and the persister +
 * conversation/message stores (Rules 4 + 9) — NO new store, NO new provider/key.
 *
 * Robustness (this runs in the live, billable voice-session lifecycle):
 *  - retry-until-finalized: the transcript may not be finalized the instant the socket drops,
 *    so we poll the endpoint with a bounded backoff until the conversation looks finalized
 *    (`endedAt` set, an ended status, OR a non-empty transcript), then give up gracefully.
 *  - idempotency: a session persists AT MOST once. A `done` set skips a re-triggered session;
 *    an `inFlight` set guards against the duplicate `onDisconnected` + `close` session-end
 *    triggers firing concurrently for the same session.
 *  - best-effort: nothing here ever throws into the session lifecycle — a fetch/parse failure
 *    is logged and swallowed (and, having not been marked `done`, may be retried by a later
 *    trigger).
 */

import { logInfo, logWarn, logError } from "../utils/logger.js";
import type { BridgeTranscriptPersister, TranscriptSpeaker } from "./bridge-transcript-persister.js";

const RUNWAY_API_VERSION = "2024-11-06";
const DEFAULT_BASE_URL = "https://api.dev.runwayml.com";
/** Backoff between fetch attempts (ms). length + 1 = max attempts (~15s total here). */
const DEFAULT_RETRY_DELAYS_MS = [1000, 2000, 3000, 4000, 5000];

/** A single transcript turn as returned by Runway's conversations endpoint. */
export interface RunwayConversationTurn {
  /** "user" (the Commander's speech) or "assistant" (the avatar). */
  role: string;
  content: string;
}

/** The slice of Runway's conversation document this service reads. */
export interface RunwayConversation {
  id?: string;
  status?: string;
  startedAt?: string;
  endedAt?: string;
  transcript?: RunwayConversationTurn[];
  recordingUrl?: string;
}

export interface BridgeTranscriptFetchDeps {
  /** The EXISTING persister — the single persistence path (no new store). */
  persister: Pick<BridgeTranscriptPersister, "onSegment" | "endSession">;
  /** Runway secret. Defaults to RUNWAYML_API_SECRET (the same secret the broker uses). */
  apiKey?: string | undefined;
  /** Runway avatar id. Defaults to RUNWAY_AVATAR_ID (the same id the broker uses). */
  avatarId?: string | undefined;
  /** API base URL. Defaults to the dev endpoint (matches runway-client). */
  baseUrl?: string | undefined;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch | undefined;
  /** Injectable sleep. Defaults to a real timer. */
  sleepFn?: ((ms: number) => Promise<void>) | undefined;
  /** Backoff between attempts (ms). length + 1 = max attempts. Defaults to ~15s of retries. */
  retryDelaysMs?: number[] | undefined;
}

export interface BridgeTranscriptFetch {
  /**
   * Fetch the session's transcript from Runway and persist its turns into the coordinator DM.
   * Best-effort and idempotent: never throws, and a session persists at most once. Safe to call
   * from BOTH the `onDisconnected` and `close` session-end paths.
   */
  fetchAndPersist(sessionId: string): Promise<void>;
  /** Whether a session's transcript was already persisted (idempotency introspection/tests). */
  hasPersisted(sessionId: string): boolean;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A status string that signals the conversation has ended (case-insensitive, substring). */
function isEndedStatus(status: string | undefined): boolean {
  return typeof status === "string" && /ended|complete|completed|finished|done/i.test(status);
}

/**
 * Is the conversation finalized enough to persist? It is when Runway marks it ended
 * (`endedAt` set or an ended status) OR when it already carries transcript turns — content is
 * present, so there is nothing left to wait for. An empty, not-yet-ended conversation is still
 * being finalized; keep polling.
 */
function isFinalized(conv: RunwayConversation): boolean {
  const hasTurns = Array.isArray(conv.transcript) && conv.transcript.length > 0;
  return hasTurns || Boolean(conv.endedAt) || isEndedStatus(conv.status);
}

export function createBridgeTranscriptFetch(deps: BridgeTranscriptFetchDeps): BridgeTranscriptFetch {
  const apiKey = deps.apiKey ?? process.env["RUNWAYML_API_SECRET"] ?? "";
  const avatarId = deps.avatarId ?? process.env["RUNWAY_AVATAR_ID"] ?? "";
  const baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL;
  const doFetch = deps.fetchImpl ?? fetch;
  const sleep = deps.sleepFn ?? defaultSleep;
  const retryDelays = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;

  /** Sessions whose transcript has been persisted — never re-fetched. */
  const done = new Set<string>();
  /** Sessions whose fetch is currently running — guards the duplicate end triggers. */
  const inFlight = new Set<string>();

  /** Fetch the conversation once. Returns null on any error / non-2xx (caller retries). */
  async function fetchConversation(sessionId: string): Promise<RunwayConversation | null> {
    try {
      const url = `${baseUrl}/v1/avatars/${avatarId}/conversations/${sessionId}`;
      const res = await doFetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "X-Runway-Version": RUNWAY_API_VERSION,
        },
      });
      if (!res.ok) return null;
      return (await res.json()) as RunwayConversation;
    } catch {
      // A transient fetch/parse fault is just "not ready yet" — let the retry loop decide.
      return null;
    }
  }

  /** Feed every non-empty turn through the persister, oldest→newest, all finalized. */
  function persistTurns(sessionId: string, conv: RunwayConversation): number {
    const turns = conv.transcript ?? [];
    let persisted = 0;
    turns.forEach((turn, index) => {
      const content = typeof turn.content === "string" ? turn.content : "";
      if (content.trim().length === 0) return;
      const speaker: TranscriptSpeaker = turn.role === "user" ? "commander" : "avatar";
      deps.persister.onSegment({
        sessionId,
        speaker,
        text: content,
        // Stable, per-session, ordered key so the persister can dedup a re-fed turn.
        segmentId: `${sessionId}:${index}`,
        final: true,
      });
      persisted += 1;
    });
    return persisted;
  }

  return {
    hasPersisted: (sessionId: string): boolean => done.has(sessionId),

    async fetchAndPersist(sessionId: string): Promise<void> {
      // Idempotency + in-flight guards (synchronous, before any await — no race with a second
      // concurrent trigger for the same session).
      if (!sessionId || done.has(sessionId) || inFlight.has(sessionId)) return;
      if (!apiKey || !avatarId) {
        logWarn("bridge transcript fetch skipped — Runway creds not configured", { sessionId });
        return;
      }
      inFlight.add(sessionId);
      try {
        const maxAttempts = retryDelays.length + 1;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const conv = await fetchConversation(sessionId);
          if (conv && isFinalized(conv)) {
            const count = persistTurns(sessionId, conv);
            done.add(sessionId);
            // Free the persister's per-session state (no interim buffers on this path, but keep
            // it tidy). Safe: the `done` guard prevents any re-fetch of this session.
            deps.persister.endSession(sessionId);
            logInfo("bridge transcript fetched + persisted", { sessionId, turns: count });
            return;
          }
          // Not finalized yet — wait out the backoff and try again (no sleep after the last try).
          if (attempt < retryDelays.length) await sleep(retryDelays[attempt]!);
        }
        // Bounded budget exhausted — give up gracefully (NOT marked done, so a later end trigger
        // could still recover it). Never throws into the session lifecycle.
        logWarn("bridge transcript fetch gave up — conversation not finalized in time", { sessionId });
      } catch (err) {
        logError("bridge transcript fetch failed", {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        inFlight.delete(sessionId);
      }
    },
  };
}
