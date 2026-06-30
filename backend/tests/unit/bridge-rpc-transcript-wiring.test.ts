/**
 * Tests for wiring the transcript capture into the Bridge RPC manager (adj-202.6.6).
 *
 * The manager already owns one server-side LiveKit participant per Bridge session (the
 * tool-loop handler). To persist the dialogue we reuse THAT SAME connection: when a
 * transcript capture is configured, the manager hands the attached handler a `wireRoom`
 * callback so the room-owning factory can register the `lk.transcription` text-stream
 * handler, and it tears the capture's session state down on disconnect/close.
 *
 * These tests inject a FAKE handler factory (no real LiveKit) and assert the wiring
 * contract: wireRoom is passed and drives capture.register; endSession fires on
 * disconnect and on close; and with no capture configured, nothing changes (back-compat).
 * The room-owning factory's own LiveKit/credential plumbing is covered separately
 * (resolveRunwayCredentials) and live-smoked by the integrator.
 */

import { describe, it, expect, vi } from "vitest";

import {
  createBridgeRpcManager,
  resolveRunwayCredentials,
  type CreateRpcHandlerFn,
  type CreateRpcHandlerOptions,
  type RpcHandlerLike,
} from "../../src/services/bridge-rpc-handler.js";
import type { BridgeToolResult } from "../../src/services/bridge-tool-bridge.js";
import type { TextStreamRoomLike } from "../../src/services/bridge-transcript-capture.js";

const executeTool = async (): Promise<BridgeToolResult> => ({
  ok: true,
  tool: "list_agents",
  projectId: null,
  data: {},
});

function fakeHandler(): RpcHandlerLike {
  return { close: vi.fn(async () => undefined), connected: true };
}

function fakeCapture() {
  return { register: vi.fn(), endSession: vi.fn() };
}

describe("createBridgeRpcManager — transcript capture wiring (adj-202.6.6)", () => {
  it("should pass a wireRoom callback that drives capture.register with the room + sessionId", async () => {
    const capture = fakeCapture();
    let captured: CreateRpcHandlerOptions | null = null;
    const createHandler: CreateRpcHandlerFn = vi.fn(async (opts) => {
      captured = opts;
      return fakeHandler();
    });
    const manager = createBridgeRpcManager({ executeTool, apiKey: "k", createHandler, transcriptCapture: capture });

    await manager.attach({ sessionId: "sess-tx" });

    expect(captured).not.toBeNull();
    expect(typeof captured!.wireRoom).toBe("function");

    // The factory would invoke wireRoom with its connected room.
    const room = { registerTextStreamHandler: vi.fn() } as unknown as TextStreamRoomLike;
    captured!.wireRoom!(room);
    expect(capture.register).toHaveBeenCalledWith(room, "sess-tx");
  });

  it("should end the capture session when the handler disconnects", async () => {
    const capture = fakeCapture();
    let captured: CreateRpcHandlerOptions | null = null;
    const createHandler: CreateRpcHandlerFn = vi.fn(async (opts) => {
      captured = opts;
      return fakeHandler();
    });
    const manager = createBridgeRpcManager({ executeTool, apiKey: "k", createHandler, transcriptCapture: capture });

    await manager.attach({ sessionId: "sess-dc" });
    captured!.onDisconnected?.();

    expect(capture.endSession).toHaveBeenCalledWith("sess-dc");
  });

  it("should end the capture session on explicit close", async () => {
    const capture = fakeCapture();
    const createHandler: CreateRpcHandlerFn = vi.fn(async () => fakeHandler());
    const manager = createBridgeRpcManager({ executeTool, apiKey: "k", createHandler, transcriptCapture: capture });

    await manager.attach({ sessionId: "sess-cl" });
    await manager.close("sess-cl");

    expect(capture.endSession).toHaveBeenCalledWith("sess-cl");
  });

  it("should NOT set wireRoom when no transcript capture is configured (back-compat)", async () => {
    let captured: CreateRpcHandlerOptions | null = null;
    const createHandler: CreateRpcHandlerFn = vi.fn(async (opts) => {
      captured = opts;
      return fakeHandler();
    });
    const manager = createBridgeRpcManager({ executeTool, apiKey: "k", createHandler });

    await manager.attach({ sessionId: "sess-plain" });

    expect(captured!.wireRoom).toBeUndefined();
  });
});

describe("resolveRunwayCredentials (adj-202.6.6)", () => {
  it("should return pre-fetched credentials without calling fetch", async () => {
    const fetchImpl = vi.fn();
    const creds = { url: "wss://lk", token: "jwt", roomName: "r1" };

    const out = await resolveRunwayCredentials({ credentials: creds }, fetchImpl);

    expect(out).toEqual(creds);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("should POST connect_backend with the api key and parse the credentials", async () => {
    const creds = { url: "wss://lk", token: "jwt", roomName: "sess-1" };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => creds,
      text: async () => "",
    })) as unknown as typeof fetch;

    const out = await resolveRunwayCredentials({ apiKey: "secret", sessionId: "sess-1" }, fetchImpl);

    expect(out).toEqual(creds);
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(call[0])).toContain("/realtime_sessions/sess-1/connect_backend");
    expect(call[1]).toMatchObject({ method: "POST" });
    expect((call[1] as { headers: Record<string, string> }).headers["Authorization"]).toBe("Bearer secret");
  });

  it("should throw when neither credentials nor apiKey+sessionId are provided", async () => {
    await expect(resolveRunwayCredentials({}, vi.fn() as unknown as typeof fetch)).rejects.toThrow();
  });

  it("should throw with the status when connect_backend fails", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({}),
      text: async () => "forbidden",
    })) as unknown as typeof fetch;

    await expect(
      resolveRunwayCredentials({ apiKey: "k", sessionId: "s" }, fetchImpl),
    ).rejects.toThrow(/403/);
  });
});
