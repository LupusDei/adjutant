/**
 * Tests for the Bridge RPC handler (adj-202.7).
 *
 * The server-side tool loop. When the avatar invokes a `backend_rpc` tool mid-
 * conversation, Runway routes the call (over LiveKit) to a handler running in OUR
 * authed backend. That handler dispatches the call to the SAME read-only
 * `toolBridge.executeTool` the dashboard buttons use, then returns the STRUCTURED
 * result so the avatar narrates real fleet data instead of stalling on "querying…".
 *
 * Because the handler runs server-side it has direct, authed access to the tool
 * bridge — no API key crosses to the browser, no postMessage hop. These tests
 * exercise the dispatch mapping (arg + projectId mapping, ok/error envelopes,
 * never-throw guarantee) and the handler lifecycle manager, with a FAKE
 * createRpcHandler so no LiveKit/Runway connection is required.
 */

import { describe, it, expect, vi } from "vitest";

import type {
  BridgeToolName,
  BridgeToolRequest,
  BridgeToolResult,
} from "../../src/services/bridge-tool-bridge.js";
import { BRIDGE_READONLY_TOOLS } from "../../src/services/bridge-tool-bridge.js";
import {
  buildBridgeToolDispatch,
  createBridgeRpcManager,
  type CreateRpcHandlerFn,
  type RpcHandlerLike,
} from "../../src/services/bridge-rpc-handler.js";

function okResult(tool: BridgeToolName, projectId: string | null, data: unknown): BridgeToolResult {
  return { ok: true, tool, projectId, data };
}

describe("buildBridgeToolDispatch", () => {
  it("should expose one handler per read-only whitelist tool", () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    const dispatch = buildBridgeToolDispatch({ executeTool });
    expect(Object.keys(dispatch).sort()).toEqual([...BRIDGE_READONLY_TOOLS].sort());
  });

  it("should map args to a tool request and return the structured ok envelope (happy path)", async () => {
    const data = { agents: [{ id: "a1" }], count: 1 };
    const executeTool = vi.fn(async (_req: BridgeToolRequest) => okResult("list_agents", null, data));
    const dispatch = buildBridgeToolDispatch({ executeTool });

    const out = await dispatch["list_agents"]!({ status: "active" });

    expect(executeTool).toHaveBeenCalledWith({ tool: "list_agents", args: { status: "active" } });
    expect(out).toEqual({ ok: true, tool: "list_agents", projectId: null, data });
  });

  it("should inject the default projectId for project-scoped calls", async () => {
    const executeTool = vi.fn(async (_req: BridgeToolRequest) =>
      okResult("list_beads", "proj-uuid", { beads: [], count: 0 }),
    );
    const dispatch = buildBridgeToolDispatch({ executeTool, defaultProjectId: "proj-uuid" });

    await dispatch["list_beads"]!({ status: "open" });

    expect(executeTool).toHaveBeenCalledWith({
      tool: "list_beads",
      args: { status: "open" },
      projectId: "proj-uuid",
    });
  });

  it("should NOT set projectId when no default is configured", async () => {
    const executeTool = vi.fn(async (_req: BridgeToolRequest) => okResult("list_agents", null, {}));
    const dispatch = buildBridgeToolDispatch({ executeTool });

    await dispatch["list_agents"]!({});

    const req = executeTool.mock.calls[0]![0];
    expect(req).not.toHaveProperty("projectId");
  });

  it("should return a structured error envelope (not throw) when the tool rejects (error path)", async () => {
    const errResult: BridgeToolResult = {
      ok: false,
      tool: "get_project_state",
      projectId: null,
      error: { code: "PROJECT_REQUIRED", message: "This tool requires a target projectId." },
    };
    const executeTool = vi.fn(async () => errResult);
    const dispatch = buildBridgeToolDispatch({ executeTool });

    const out = await dispatch["get_project_state"]!({});

    expect(out).toEqual({
      ok: false,
      tool: "get_project_state",
      projectId: null,
      error: { code: "PROJECT_REQUIRED", message: "This tool requires a target projectId." },
    });
  });

  it("should never reject — an unexpected throw becomes a structured error envelope (defensive)", async () => {
    const executeTool = vi.fn(async () => {
      throw new Error("kaboom");
    });
    const dispatch = buildBridgeToolDispatch({ executeTool });

    const out = (await dispatch["list_agents"]!({})) as { ok: boolean; error: { code: string; message: string } };
    expect(out.ok).toBe(false);
    expect(out.error.message).toContain("kaboom");
  });

  it("should fire the onResult sink with the underlying tool result (for dashboard surfacing)", async () => {
    const data = { count: 2 };
    const result = okResult("list_questions", null, data);
    const executeTool = vi.fn(async () => result);
    const onResult = vi.fn();
    const dispatch = buildBridgeToolDispatch({ executeTool, onResult });

    await dispatch["list_questions"]!({ urgency: "blocking" });

    expect(onResult).toHaveBeenCalledWith(result);
  });
});

describe("createBridgeRpcManager", () => {
  function fakeHandler(): RpcHandlerLike {
    return { close: vi.fn(async () => {}), connected: true };
  }

  it("should attach a handler with the session id, api key, and the whitelist tool map", async () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    let captured: Parameters<CreateRpcHandlerFn>[0] | null = null;
    const createHandler: CreateRpcHandlerFn = vi.fn(async (opts) => {
      captured = opts;
      return fakeHandler();
    });
    const manager = createBridgeRpcManager({ executeTool, apiKey: "key_test", createHandler });

    await manager.attach({ sessionId: "sess-1" });

    expect(createHandler).toHaveBeenCalledTimes(1);
    expect(captured!.apiKey).toBe("key_test");
    expect(captured!.sessionId).toBe("sess-1");
    expect(Object.keys(captured!.tools).sort()).toEqual([...BRIDGE_READONLY_TOOLS].sort());
    expect(manager.has("sess-1")).toBe(true);
  });

  it("should pass the default projectId through to the dispatch (project-scoped calls)", async () => {
    const executeTool = vi.fn(async () => okResult("list_beads", "p1", {}));
    let captured: Parameters<CreateRpcHandlerFn>[0] | null = null;
    const createHandler: CreateRpcHandlerFn = vi.fn(async (opts) => {
      captured = opts;
      return fakeHandler();
    });
    const manager = createBridgeRpcManager({ executeTool, apiKey: "key_test", createHandler });

    await manager.attach({ sessionId: "sess-2", projectId: "p1" });
    await captured!.tools["list_beads"]!({ status: "open" });

    expect(executeTool).toHaveBeenCalledWith({ tool: "list_beads", args: { status: "open" }, projectId: "p1" });
  });

  it("should close and forget a session via close(), and close all via closeAll()", async () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    const handlers: RpcHandlerLike[] = [];
    const createHandler: CreateRpcHandlerFn = vi.fn(async () => {
      const h = fakeHandler();
      handlers.push(h);
      return h;
    });
    const manager = createBridgeRpcManager({ executeTool, apiKey: "k", createHandler });

    await manager.attach({ sessionId: "s1" });
    await manager.attach({ sessionId: "s2" });
    expect(manager.has("s1")).toBe(true);

    await manager.close("s1");
    expect(handlers[0]!.close).toHaveBeenCalled();
    expect(manager.has("s1")).toBe(false);
    expect(manager.has("s2")).toBe(true);

    await manager.closeAll();
    expect(handlers[1]!.close).toHaveBeenCalled();
    expect(manager.has("s2")).toBe(false);
  });

  it("should not throw if attaching the handler fails — the avatar still talks, tools just go dark", async () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    const createHandler: CreateRpcHandlerFn = vi.fn(async () => {
      throw new Error("livekit unreachable");
    });
    const manager = createBridgeRpcManager({ executeTool, apiKey: "k", createHandler });

    await expect(manager.attach({ sessionId: "s-fail" })).resolves.toBeUndefined();
    expect(manager.has("s-fail")).toBe(false);
  });
});
