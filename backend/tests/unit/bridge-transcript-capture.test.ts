/**
 * Tests for the Bridge transcript capture adapter (adj-202.6.6).
 *
 * This adapter bridges LiveKit transcription text streams (the transport-layer transcript
 * available to our server-side participant via @livekit/rtc-node's text-stream API) to the
 * transport-agnostic {@link BridgeTranscriptPersister}. LiveKit delivers transcription as
 * text streams on the well-known topic `lk.transcription`; the stream's attributes carry the
 * finality flag, a stable segment id, and the transcribed track. The adapter normalizes a
 * stream into a {@link TranscriptTurn} (resolving the speaker) and hands it to the persister.
 *
 * These tests drive the adapter with MOCK readers/participants (no real LiveKit), asserting:
 *  - the `lk.transcription` handler is registered on the room (bound to the session),
 *  - a final stream from the avatar worker normalizes to speaker 'avatar' and persists,
 *  - a stream from the Commander participant normalizes to speaker 'commander',
 *  - finality + segment id are read from attributes (default final when absent),
 *  - a reader/persist throw never escapes the stream callback (the session stays alive),
 *  - endSession delegates to the persister.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  createBridgeTranscriptCapture,
  TRANSCRIPTION_TOPIC,
  type TranscriptTextStreamReader,
  type TextStreamRoomLike,
} from "../../src/services/bridge-transcript-capture.js";
import type { TranscriptTurn } from "../../src/services/bridge-transcript-persister.js";

interface FakePersister {
  onSegment: ReturnType<typeof vi.fn>;
  endSession: ReturnType<typeof vi.fn>;
}

function fakePersister(): FakePersister {
  return { onSegment: vi.fn(() => null), endSession: vi.fn() };
}

/** A fake room that captures the registered text-stream handler so tests can invoke it. */
function fakeRoom(): {
  room: TextStreamRoomLike;
  topics: string[];
  fire: (reader: TranscriptTextStreamReader, p: { identity: string }) => void;
} {
  const topics: string[] = [];
  let handler: ((reader: TranscriptTextStreamReader, p: { identity: string }) => void) | null = null;
  const room: TextStreamRoomLike = {
    registerTextStreamHandler(topic, cb) {
      topics.push(topic);
      handler = cb;
    },
  };
  return {
    room,
    topics,
    fire: (reader, p) => {
      if (handler === null) throw new Error("no handler registered");
      handler(reader, p);
    },
  };
}

function reader(text: string, attributes?: Record<string, string>, streamId = "stream-x"): TranscriptTextStreamReader {
  return {
    info: { streamId, topic: TRANSCRIPTION_TOPIC, ...(attributes !== undefined ? { attributes } : {}) },
    readAll: () => Promise.resolve(text),
  };
}

let persister: FakePersister;

beforeEach(() => {
  persister = fakePersister();
});

describe("createBridgeTranscriptCapture — registration", () => {
  it("should register a handler for the lk.transcription topic on the room", () => {
    const capture = createBridgeTranscriptCapture({ persister });
    const f = fakeRoom();

    capture.register(f.room, "sess-1");

    expect(f.topics).toEqual([TRANSCRIPTION_TOPIC]);
  });
});

describe("createBridgeTranscriptCapture — normalization + speaker resolution", () => {
  it("should normalize an avatar-worker stream to speaker 'avatar' and persist it (default final)", async () => {
    const capture = createBridgeTranscriptCapture({ persister });
    const f = fakeRoom();
    capture.register(f.room, "sess-1");

    f.fire(reader("All agents nominal."), { identity: "worker:avatar-123" });
    await vi.waitFor(() => { expect(persister.onSegment).toHaveBeenCalledTimes(1); });

    const turn = persister.onSegment.mock.calls[0]![0] as TranscriptTurn;
    expect(turn).toMatchObject({
      sessionId: "sess-1",
      speaker: "avatar",
      text: "All agents nominal.",
      final: true,
    });
  });

  it("should normalize a non-worker (Commander) stream to speaker 'commander'", async () => {
    const capture = createBridgeTranscriptCapture({ persister });
    const f = fakeRoom();
    capture.register(f.room, "sess-1");

    f.fire(reader("Status report."), { identity: "user-device-42" });
    await vi.waitFor(() => { expect(persister.onSegment).toHaveBeenCalledTimes(1); });

    expect((persister.onSegment.mock.calls[0]![0] as TranscriptTurn).speaker).toBe("commander");
  });

  it("should read finality + segment id from stream attributes", async () => {
    const capture = createBridgeTranscriptCapture({ persister });
    const f = fakeRoom();
    capture.register(f.room, "sess-1");

    f.fire(
      reader("partial", { "lk.transcription_final": "false", "lk.segment_id": "seg-77" }),
      { identity: "worker:a" },
    );
    await vi.waitFor(() => { expect(persister.onSegment).toHaveBeenCalledTimes(1); });

    const turn = persister.onSegment.mock.calls[0]![0] as TranscriptTurn;
    expect(turn.final).toBe(false);
    expect(turn.segmentId).toBe("seg-77");
  });

  it("should fall back to the stream id for the segment id when no attribute is present", async () => {
    const capture = createBridgeTranscriptCapture({ persister });
    const f = fakeRoom();
    capture.register(f.room, "sess-1");

    f.fire(reader("hello", undefined, "stream-abc"), { identity: "worker:a" });
    await vi.waitFor(() => { expect(persister.onSegment).toHaveBeenCalledTimes(1); });

    expect((persister.onSegment.mock.calls[0]![0] as TranscriptTurn).segmentId).toBe("stream-abc");
  });

  it("should drop a whitespace-only stream without calling the persister", async () => {
    const capture = createBridgeTranscriptCapture({ persister });
    const f = fakeRoom();
    capture.register(f.room, "sess-1");

    f.fire(reader("   "), { identity: "worker:a" });
    // Give the async read a tick; persister must remain untouched.
    await new Promise((r) => setTimeout(r, 10));
    expect(persister.onSegment).not.toHaveBeenCalled();
  });

  it("should honor a custom speaker resolver", async () => {
    const capture = createBridgeTranscriptCapture({
      persister,
      resolveSpeaker: () => "commander",
    });
    const f = fakeRoom();
    capture.register(f.room, "sess-1");

    f.fire(reader("anything"), { identity: "worker:avatar-1" });
    await vi.waitFor(() => { expect(persister.onSegment).toHaveBeenCalledTimes(1); });
    expect((persister.onSegment.mock.calls[0]![0] as TranscriptTurn).speaker).toBe("commander");
  });
});

describe("createBridgeTranscriptCapture — resilience", () => {
  it("should not let a reader error escape the stream callback", async () => {
    const capture = createBridgeTranscriptCapture({ persister });
    const f = fakeRoom();
    capture.register(f.room, "sess-1");

    const boom: TranscriptTextStreamReader = {
      info: { streamId: "s" },
      readAll: () => Promise.reject(new Error("stream blew up")),
    };

    expect(() => { f.fire(boom, { identity: "worker:a" }); }).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
    expect(persister.onSegment).not.toHaveBeenCalled();
  });

  it("should not let a persister throw escape the stream callback", async () => {
    persister.onSegment.mockImplementation(() => {
      throw new Error("persist failed");
    });
    const capture = createBridgeTranscriptCapture({ persister });
    const f = fakeRoom();
    capture.register(f.room, "sess-1");

    expect(() => { f.fire(reader("hi"), { identity: "worker:a" }); }).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
  });
});

describe("createBridgeTranscriptCapture — endSession", () => {
  it("should delegate endSession to the persister", () => {
    const capture = createBridgeTranscriptCapture({ persister });
    capture.endSession("sess-9");
    expect(persister.endSession).toHaveBeenCalledWith("sess-9");
  });
});
