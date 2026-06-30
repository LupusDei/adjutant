/**
 * The Bridge — transcript persister (adj-202.6.6: persistent conversation + default history).
 *
 * The Commander's corrected intent for Phase 4: the Bridge (embodied coordinator) is a
 * PERSISTENT CHAT with the coordinator that has DEFAULT, viewable history — the same
 * conversation whether you speak it by voice or type it. The memory loop (6.1–6.4) learned
 * from sessions; THIS module makes the dialogue itself first-class chat history.
 *
 * It takes FINALIZED transcription turns of a Bridge voice session (the Commander's speech
 * and the avatar's responses) and persists each as a message into the SAME conversation the
 * Commander already has with the adjutant coordinator: the deterministic `user`↔`adjutant`
 * DM. It reuses the REAL {@link ConversationStore} + {@link MessageStore} (Constitution
 * Rules 4 + 9) — there is NO new store and NO second messaging system. Once persisted, the
 * dashboard / iOS Chat show the Bridge conversation by default and `read_messages` recalls
 * it, exactly like text chat with the coordinator.
 *
 * Dedup / finalize: interim (non-final) segments are buffered and updated in place, never
 * persisted, so partial words don't spam the thread; only a FINALIZED segment writes a
 * message, and a re-delivered finalized segment id is ignored. Whitespace-only utterances
 * are dropped. State is per-session so concurrent Bridge sessions don't cross-contaminate;
 * {@link BridgeTranscriptPersister.endSession} frees a session's buffers (dropping any
 * still-interim utterance — only completed ones survive).
 */

import type { ConversationStore } from "./conversation-store.js";
import type { Message, MessageStore } from "./message-store.js";
import { logError } from "../utils/logger.js";

/** Who spoke a transcription turn. Resolved upstream (in the capture adapter) from LiveKit. */
export type TranscriptSpeaker = "commander" | "avatar";

/** A single transcription turn handed to the persister. */
export interface TranscriptTurn {
  /** The Bridge voice session this turn belongs to (scopes interim/dedup state). */
  sessionId: string;
  /** Resolved speaker: the Commander (user audio) or the avatar (coordinator persona). */
  speaker: TranscriptSpeaker;
  /** The turn's text. For interim turns this is a partial; for final, the full utterance. */
  text: string;
  /** Stable id correlating interim updates to their finalized utterance (dedup key). */
  segmentId: string;
  /** True once the utterance is complete. Only finalized turns are persisted. */
  final: boolean;
}

/** A persisted turn, handed to the optional broadcast hook for live fan-out. */
export interface PersistedTranscriptTurn {
  message: Message;
  /** Sender id ("user" for the Commander, the coordinator id for the avatar). */
  from: string;
  /** Recipient id (the coordinator id for the Commander, "user" for the avatar). */
  to: string;
  speaker: TranscriptSpeaker;
}

export interface BridgeTranscriptPersisterDeps {
  /** Real conversation store — used to ensure the DM row/members exist (lists by default). */
  conversationStore: Pick<ConversationStore, "getOrCreateDm">;
  /** Real message store — the single persistence path (no new store). */
  messageStore: Pick<MessageStore, "insertMessage">;
  /** Optional real-time fan-out fired once per persisted turn (e.g. wsBroadcast adapter). */
  broadcast?: ((turn: PersistedTranscriptTurn) => void) | undefined;
  /** The Commander's member id. Defaults to "user" (the canonical user member). */
  commanderId?: string | undefined;
  /** The coordinator's member id. Defaults to "adjutant-coordinator" (the avatar IS the coordinator). */
  coordinatorId?: string | undefined;
}

export interface BridgeTranscriptPersister {
  /**
   * Ingest one transcription turn. Returns the persisted {@link Message} when the turn was a
   * fresh finalized utterance, or `null` when it was buffered (interim), empty, or a dedup.
   * Never throws — a store failure is logged and yields `null` so the live voice loop is safe.
   */
  onSegment(turn: TranscriptTurn): Message | null;
  /** Forget a session's interim/dedup state (called on session end). Drops unfinished turns. */
  endSession(sessionId: string): void;
}

/** Per-session interim text (by segment id) and the set of already-persisted segment ids. */
interface SessionState {
  interim: Map<string, string>;
  persisted: Set<string>;
}

/** Metadata marker so these messages are recognizable as Bridge voice turns. */
const BRIDGE_VOICE_SOURCE = "bridge-voice";

export function createBridgeTranscriptPersister(
  deps: BridgeTranscriptPersisterDeps,
): BridgeTranscriptPersister {
  const commanderId = deps.commanderId ?? "user";
  const coordinatorId = deps.coordinatorId ?? "adjutant-coordinator";

  const sessions = new Map<string, SessionState>();
  // The DM id is deterministic; resolve the conversation ROW once (lazily) so it (and its
  // membership) exist for list/recall surfaces even before any text DM was exchanged.
  let conversationId: string | null = null;

  function ensureConversationId(): string {
    if (conversationId === null) {
      conversationId = deps.conversationStore.getOrCreateDm(commanderId, coordinatorId).id;
    }
    return conversationId;
  }

  function stateFor(sessionId: string): SessionState {
    let s = sessions.get(sessionId);
    if (s === undefined) {
      s = { interim: new Map(), persisted: new Set() };
      sessions.set(sessionId, s);
    }
    return s;
  }

  function persist(turn: TranscriptTurn, text: string): Message | null {
    const isCommander = turn.speaker === "commander";
    const from = isCommander ? commanderId : coordinatorId;
    const to = isCommander ? coordinatorId : commanderId;
    try {
      const message = deps.messageStore.insertMessage({
        agentId: from,
        recipient: to,
        role: isCommander ? "user" : "agent",
        body: text,
        conversationId: ensureConversationId(),
        metadata: { source: BRIDGE_VOICE_SOURCE, sessionId: turn.sessionId, speaker: turn.speaker },
      });
      deps.broadcast?.({ message, from, to, speaker: turn.speaker });
      return message;
    } catch (err) {
      // The voice loop must never break on a persistence hiccup — log and move on.
      logError("bridge transcript persist failed", {
        sessionId: turn.sessionId,
        speaker: turn.speaker,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  return {
    onSegment(turn: TranscriptTurn): Message | null {
      const state = stateFor(turn.sessionId);
      const trimmed = turn.text.trim();

      if (!turn.final) {
        // Buffer the latest partial; never persist interim text (no partial-word spam).
        if (trimmed.length > 0) state.interim.set(turn.segmentId, trimmed);
        return null;
      }

      // Finalized: dedup re-delivery of the same segment id.
      if (state.persisted.has(turn.segmentId)) return null;

      // Prefer the final text; fall back to the last buffered interim if final came empty.
      const text = trimmed.length > 0 ? trimmed : (state.interim.get(turn.segmentId) ?? "");
      state.interim.delete(turn.segmentId);
      if (text.length === 0) return null;

      state.persisted.add(turn.segmentId);
      return persist(turn, text);
    },

    endSession(sessionId: string): void {
      sessions.delete(sessionId);
    },
  };
}
