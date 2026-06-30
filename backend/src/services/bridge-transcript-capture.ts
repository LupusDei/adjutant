/**
 * The Bridge — LiveKit transcription capture adapter (adj-202.6.6).
 *
 * Bridges the TRANSPORT-layer transcript to the persistence layer. Our server-side participant
 * (the avatars-node-rpc tool-loop handler — already a LiveKit participant in every Bridge
 * session) can receive transcription as LiveKit TEXT STREAMS on the well-known topic
 * `lk.transcription`. This adapter registers that text-stream handler on the session's room,
 * normalizes each stream into a {@link TranscriptTurn} (resolving who spoke), and hands it to
 * the transport-agnostic {@link BridgeTranscriptPersister}, which writes finalized turns into
 * the Commander↔coordinator DM (Rules 4 + 9 — no new store).
 *
 * Why an adapter (vs. wiring the room straight to the persister): it isolates the LiveKit
 * stream shape + speaker attribution — the part that needs LIVE verification against Runway's
 * pipeline (does it publish user AND avatar transcripts? on this topic? how is the speaker
 * attributed?) — behind a small, fully unit-tested seam. The {@link resolveSpeaker} default is
 * a documented best-guess (the avatar's worker participant identity is prefixed `worker:`,
 * matching avatars-node-rpc's own RPC caller guard); it is INJECTABLE so the live integrator
 * can tune attribution without touching persistence. Everything here is defensive: a reader or
 * persister fault is swallowed so it can never tear down the live, billable voice session.
 *
 * The minimal reader/room shapes below mirror the slice of `@livekit/rtc-node` we use, so this
 * module and its tests typecheck/run without the native package and with mock streams.
 */

import { logWarn } from "../utils/logger.js";
import type { BridgeTranscriptPersister, TranscriptSpeaker } from "./bridge-transcript-persister.js";

/** LiveKit's well-known topic for transcription text streams. */
export const TRANSCRIPTION_TOPIC = "lk.transcription";

/** LiveKit stream attribute carrying the finalized flag ("true"/"false"). */
const ATTR_FINAL = "lk.transcription_final";
/** LiveKit stream attribute carrying a stable per-utterance segment id. */
const ATTR_SEGMENT_ID = "lk.segment_id";

/** The slice of a LiveKit text-stream reader this adapter reads. */
export interface TranscriptTextStreamReader {
  info: {
    streamId?: string | undefined;
    topic?: string | undefined;
    attributes?: Record<string, string> | undefined;
  };
  /** Resolves to the full text received on the stream. */
  readAll(): Promise<string>;
}

/** The publishing participant, as surfaced by the text-stream handler. */
export interface TranscriptParticipantInfo {
  identity: string;
}

/** The slice of a LiveKit `Room` this adapter needs (register a text-stream handler). */
export interface TextStreamRoomLike {
  registerTextStreamHandler(
    topic: string,
    callback: (reader: TranscriptTextStreamReader, participant: TranscriptParticipantInfo) => void,
  ): void;
}

/** Resolves which side of the conversation a transcription stream represents. */
export type SpeakerResolver = (
  participant: TranscriptParticipantInfo,
  attributes: Record<string, string>,
) => TranscriptSpeaker;

/**
 * A diagnostic snapshot of EVERY transcription stream received — fired before any
 * drop/dedup/finalize filtering hides it. The live-verify seam (adj-202.6.6): on a real
 * Runway session this answers the one question unit tests cannot — does GWM-1 actually
 * publish `lk.transcription` text streams, on which participant identity, with what finality?
 * `textLength` (not the text itself) keeps the diagnostic non-sensitive and log-sized.
 */
export interface ObservedTranscriptStream {
  sessionId: string;
  topic: string;
  identity: string;
  attributes: Record<string, string>;
  /** Resolved speaker per the (default or injected) resolver — so attribution is verifiable live. */
  speaker: TranscriptSpeaker;
  segmentId: string;
  final: boolean;
  /** Length of the trimmed utterance text (0 for the interim/empty streams persistence drops). */
  textLength: number;
}

/**
 * Default speaker attribution: the avatar's worker participant publishes with an identity
 * prefixed `worker:` (the same prefix avatars-node-rpc trusts for RPC callers), so a stream
 * from such a participant is the AVATAR's speech; anything else (the Commander's browser/iOS
 * participant) is the COMMANDER. This is the documented best-guess to verify/tune live.
 */
export const defaultResolveSpeaker: SpeakerResolver = (participant) =>
  participant.identity.startsWith("worker:") ? "avatar" : "commander";

export interface BridgeTranscriptCaptureDeps {
  persister: Pick<BridgeTranscriptPersister, "onSegment" | "endSession">;
  /** Override speaker attribution (live tuning). Defaults to {@link defaultResolveSpeaker}. */
  resolveSpeaker?: SpeakerResolver | undefined;
  /**
   * Optional diagnostic sink fired once per RECEIVED stream (before drop/dedup). Purely
   * observational — its return value and any throw are ignored, so it can never affect capture
   * or the live voice session. Wired to a log line so a single live smoke proves whether (and
   * how) Runway publishes transcription. See {@link ObservedTranscriptStream}.
   */
  onStreamObserved?: ((observed: ObservedTranscriptStream) => void) | undefined;
}

export interface BridgeTranscriptCapture {
  /** Wire the `lk.transcription` text-stream handler on a session's room (bound to sessionId). */
  register(room: TextStreamRoomLike, sessionId: string): void;
  /** Forget a session's persister state on session end. */
  endSession(sessionId: string): void;
}

export function createBridgeTranscriptCapture(deps: BridgeTranscriptCaptureDeps): BridgeTranscriptCapture {
  const resolveSpeaker = deps.resolveSpeaker ?? defaultResolveSpeaker;

  /** Read one transcription stream, normalize it, and feed the persister. Never throws. */
  async function process(
    reader: TranscriptTextStreamReader,
    participant: TranscriptParticipantInfo,
    sessionId: string,
  ): Promise<void> {
    try {
      const attributes = reader.info.attributes ?? {};
      const text = (await reader.readAll()).trim();

      // Default to final when the attribute is absent: a one-shot stream with no finality flag
      // is a complete utterance, so we persist it rather than silently drop the turn.
      const finalAttr = attributes[ATTR_FINAL];
      const final = finalAttr === undefined ? true : finalAttr === "true";
      const segmentId = attributes[ATTR_SEGMENT_ID] ?? reader.info.streamId ?? `${sessionId}:${Date.now()}`;
      const speaker = resolveSpeaker(participant, attributes);

      // Diagnostic FIRST, before any drop/dedup hides the stream — so a live smoke can see even
      // the interim/empty utterances persistence intentionally discards. Never affects capture.
      if (deps.onStreamObserved) {
        try {
          deps.onStreamObserved({
            sessionId,
            topic: reader.info.topic ?? TRANSCRIPTION_TOPIC,
            identity: participant.identity,
            attributes,
            speaker,
            segmentId,
            final,
            textLength: text.length,
          });
        } catch {
          // An observer fault must never break the live voice session.
        }
      }

      if (text.length === 0) return;

      deps.persister.onSegment({ sessionId, speaker, text, segmentId, final });
    } catch (err) {
      // A transcription fault must never break the live voice session.
      logWarn("bridge transcript capture failed", {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    register(room: TextStreamRoomLike, sessionId: string): void {
      room.registerTextStreamHandler(TRANSCRIPTION_TOPIC, (reader, participant) => {
        // Fire-and-forget: the handler is sync, the read is async; never await in the callback.
        void process(reader, participant, sessionId);
      });
    },

    endSession(sessionId: string): void {
      deps.persister.endSession(sessionId);
    },
  };
}
