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

describe("buildBridgeToolDispatch — send_message command tool (adj-202.4.1)", () => {
  it("should NOT register send_message when no sendMessage write path is provided (fail-closed)", () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    const dispatch = buildBridgeToolDispatch({ executeTool });
    expect(dispatch["send_message"]).toBeUndefined();
    expect(Object.keys(dispatch).sort()).toEqual([...BRIDGE_READONLY_TOOLS].sort());
  });

  it("should register send_message when a sendMessage write path IS provided", () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    const sendMessage = vi.fn();
    const dispatch = buildBridgeToolDispatch({ executeTool, sendMessage });
    expect(typeof dispatch["send_message"]).toBe("function");
  });

  it("should map { to, body } to the write path and return the structured ok envelope (no IDs)", async () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    const sendMessage = vi.fn(async () => ({
      messageId: "msg-9",
      conversationId: "dm_x",
      deliveredToSessions: 1,
    }));
    const dispatch = buildBridgeToolDispatch({ executeTool, sendMessage });

    const out = await dispatch["send_message"]!({ to: " kerrigan ", body: "check the auth epic" });

    // Recipient is trimmed; NO projectId/beadId/epicId ever passed.
    expect(sendMessage).toHaveBeenCalledWith({ to: "kerrigan", body: "check the auth epic" });
    expect(out).toMatchObject({ ok: true, tool: "send_message", to: "kerrigan", messageId: "msg-9", deliveredToSessions: 1 });
  });

  it("should reject when 'to' or 'body' is missing — without calling the write path (validation)", async () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    const sendMessage = vi.fn();
    const dispatch = buildBridgeToolDispatch({ executeTool, sendMessage });

    const out = (await dispatch["send_message"]!({ to: "kerrigan" })) as { ok: boolean; error: { code: string } };
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe("INVALID_ARGS");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("should never reject — a write-path throw becomes a structured error envelope", async () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    const sendMessage = vi.fn(async () => {
      throw new Error("store down");
    });
    const dispatch = buildBridgeToolDispatch({ executeTool, sendMessage });

    const out = (await dispatch["send_message"]!({ to: "kerrigan", body: "go" })) as {
      ok: boolean;
      error: { message: string };
    };
    expect(out.ok).toBe(false);
    expect(out.error.message).toContain("store down");
  });
});

describe("buildBridgeToolDispatch — nudge/answer/create command tools (adj-202.4.2/.3/.4)", () => {
  it("registers each command tool only when its write path is provided (fail-closed)", () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    const none = buildBridgeToolDispatch({ executeTool });
    expect(none["nudge_agent"]).toBeUndefined();
    expect(none["answer_question"]).toBeUndefined();
    expect(none["create_bead"]).toBeUndefined();

    const all = buildBridgeToolDispatch({
      executeTool,
      nudgeAgent: vi.fn(),
      answerQuestion: vi.fn(),
      createBead: vi.fn(),
    });
    expect(typeof all["nudge_agent"]).toBe("function");
    expect(typeof all["answer_question"]).toBe("function");
    expect(typeof all["create_bead"]).toBe("function");
  });

  it("nudge_agent maps { agentId, message } to the write path and reports delivery", async () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    const nudgeAgent = vi.fn(async () => ({ agentId: "kerrigan", delivered: true }));
    const dispatch = buildBridgeToolDispatch({ executeTool, nudgeAgent });

    const out = await dispatch["nudge_agent"]!({ agentId: "kerrigan", message: "refocus" });
    expect(nudgeAgent).toHaveBeenCalledWith({ agentId: "kerrigan", message: "refocus" });
    expect(out).toMatchObject({ ok: true, tool: "nudge_agent", agentId: "kerrigan", delivered: true });
  });

  it("nudge_agent rejects when agentId or message is missing (validation)", async () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    const nudgeAgent = vi.fn();
    const dispatch = buildBridgeToolDispatch({ executeTool, nudgeAgent });
    const out = (await dispatch["nudge_agent"]!({ agentId: "kerrigan" })) as { ok: boolean; error: { code: string } };
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe("INVALID_ARGS");
    expect(nudgeAgent).not.toHaveBeenCalled();
  });

  it("answer_question requires questionId AND at least one of answerBody/chosenOption", async () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    const answerQuestion = vi.fn(async () => ({ questionId: "q1", status: "answered" }));
    const dispatch = buildBridgeToolDispatch({ executeTool, answerQuestion });

    const bad = (await dispatch["answer_question"]!({ questionId: "q1" })) as { ok: boolean; error: { code: string } };
    expect(bad.ok).toBe(false);
    expect(bad.error.code).toBe("INVALID_ARGS");
    expect(answerQuestion).not.toHaveBeenCalled();

    const ok = await dispatch["answer_question"]!({ questionId: "q1", chosenOption: "Redis" });
    expect(answerQuestion).toHaveBeenCalledWith({ questionId: "q1", chosenOption: "Redis" });
    expect(ok).toMatchObject({ ok: true, tool: "answer_question", questionId: "q1", status: "answered" });
  });

  it("create_bead requires a title and injects the session's default projectId", async () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    const createBead = vi.fn(async () => ({ beadId: "adj-1", title: "x", projectId: "p1" }));
    const dispatch = buildBridgeToolDispatch({ executeTool, createBead, defaultProjectId: "p1" });

    const bad = (await dispatch["create_bead"]!({})) as { ok: boolean; error: { code: string } };
    expect(bad.ok).toBe(false);
    expect(bad.error.code).toBe("INVALID_ARGS");

    const out = await dispatch["create_bead"]!({ title: "Fix login", type: "bug" });
    expect(createBead).toHaveBeenCalledWith({ title: "Fix login", type: "bug", projectId: "p1" });
    expect(out).toMatchObject({ ok: true, tool: "create_bead", beadId: "adj-1", projectId: "p1" });
  });

  it("create_bead rejects an invalid type without calling the write path", async () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    const createBead = vi.fn();
    const dispatch = buildBridgeToolDispatch({ executeTool, createBead });
    const out = (await dispatch["create_bead"]!({ title: "x", type: "saga" })) as { ok: boolean; error: { code: string } };
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe("INVALID_ARGS");
    expect(createBead).not.toHaveBeenCalled();
  });

  it("a command write-path throw becomes a structured error envelope (never rejects)", async () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    const createBead = vi.fn(async () => {
      throw new Error("bd down");
    });
    const dispatch = buildBridgeToolDispatch({ executeTool, createBead });
    const out = (await dispatch["create_bead"]!({ title: "x" })) as { ok: boolean; error: { message: string } };
    expect(out.ok).toBe(false);
    expect(out.error.message).toContain("bd down");
  });
});

describe("buildBridgeToolDispatch — memory write tools (adj-202.6.1)", () => {
  it("registers each memory write tool only when its write path is provided (fail-closed)", () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    const none = buildBridgeToolDispatch({ executeTool });
    expect(none["store_memory"]).toBeUndefined();
    expect(none["reinforce_memory"]).toBeUndefined();
    expect(none["record_correction"]).toBeUndefined();

    const all = buildBridgeToolDispatch({
      executeTool,
      storeMemory: vi.fn(),
      reinforceMemory: vi.fn(),
      recordCorrection: vi.fn(),
    });
    expect(typeof all["store_memory"]).toBe("function");
    expect(typeof all["reinforce_memory"]).toBe("function");
    expect(typeof all["record_correction"]).toBe("function");
  });

  it("store_memory maps { content, category, topic, confidence } to the write path", async () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    const storeMemory = vi.fn(async () => ({ id: 12, category: "operational", topic: "deploy" }));
    const dispatch = buildBridgeToolDispatch({ executeTool, storeMemory });

    const out = await dispatch["store_memory"]!({
      content: "Commander prefers blue-green deploys",
      category: "operational",
      topic: "deploy",
      confidence: 0.9,
    });
    expect(storeMemory).toHaveBeenCalledWith({
      content: "Commander prefers blue-green deploys",
      category: "operational",
      topic: "deploy",
      confidence: 0.9,
    });
    expect(out).toMatchObject({ ok: true, tool: "store_memory", id: 12, topic: "deploy" });
  });

  it("store_memory rejects a missing content/topic or an invalid category (validation)", async () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    const storeMemory = vi.fn();
    const dispatch = buildBridgeToolDispatch({ executeTool, storeMemory });

    const missing = (await dispatch["store_memory"]!({ category: "operational", topic: "x" })) as { ok: boolean; error: { code: string } };
    expect(missing.ok).toBe(false);
    expect(missing.error.code).toBe("INVALID_ARGS");

    const badCat = (await dispatch["store_memory"]!({ content: "c", topic: "t", category: "nope" })) as { ok: boolean; error: { code: string } };
    expect(badCat.ok).toBe(false);
    expect(badCat.error.code).toBe("INVALID_ARGS");
    expect(storeMemory).not.toHaveBeenCalled();
  });

  it("reinforce_memory requires a numeric id and reports the result", async () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    const reinforceMemory = vi.fn(async () => ({ id: 5, reinforced: true, confidence: 0.85, reinforcementCount: 3 }));
    const dispatch = buildBridgeToolDispatch({ executeTool, reinforceMemory });

    const bad = (await dispatch["reinforce_memory"]!({ id: "five" })) as { ok: boolean; error: { code: string } };
    expect(bad.ok).toBe(false);
    expect(bad.error.code).toBe("INVALID_ARGS");
    expect(reinforceMemory).not.toHaveBeenCalled();

    const out = await dispatch["reinforce_memory"]!({ id: 5 });
    expect(reinforceMemory).toHaveBeenCalledWith({ id: 5 });
    expect(out).toMatchObject({ ok: true, tool: "reinforce_memory", id: 5, reinforced: true });
  });

  it("record_correction maps { correctionType, wrongPattern, rightPattern, context } and validates", async () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    const recordCorrection = vi.fn(async () => ({ id: 9, isNew: true }));
    const dispatch = buildBridgeToolDispatch({ executeTool, recordCorrection });

    const bad = (await dispatch["record_correction"]!({ correctionType: "wrong_assumption" })) as { ok: boolean; error: { code: string } };
    expect(bad.ok).toBe(false);
    expect(bad.error.code).toBe("INVALID_ARGS");
    expect(recordCorrection).not.toHaveBeenCalled();

    const out = await dispatch["record_correction"]!({
      correctionType: "wrong_assumption",
      wrongPattern: "deploy to prod on Fridays",
      rightPattern: "never deploy on Fridays",
      context: "outage retro",
    });
    expect(recordCorrection).toHaveBeenCalledWith({
      correctionType: "wrong_assumption",
      wrongPattern: "deploy to prod on Fridays",
      rightPattern: "never deploy on Fridays",
      context: "outage retro",
    });
    expect(out).toMatchObject({ ok: true, tool: "record_correction", id: 9, isNew: true });
  });
});

describe("buildBridgeToolDispatch — spawn_worker command tool (adj-202.4.5)", () => {
  it("registers spawn_worker only when its write path is provided (fail-closed)", () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    expect(buildBridgeToolDispatch({ executeTool })["spawn_worker"]).toBeUndefined();
    expect(typeof buildBridgeToolDispatch({ executeTool, spawnWorker: vi.fn() })["spawn_worker"]).toBe("function");
  });

  it("requires agentType and task (validation, never spawns on bad args)", async () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    const spawnWorker = vi.fn();
    const dispatch = buildBridgeToolDispatch({ executeTool, spawnWorker });

    const noType = (await dispatch["spawn_worker"]!({ task: "do it" })) as { ok: boolean; error: { code: string } };
    expect(noType.ok).toBe(false);
    expect(noType.error.code).toBe("INVALID_ARGS");

    const noTask = (await dispatch["spawn_worker"]!({ agentType: "engineer" })) as { ok: boolean; error: { code: string } };
    expect(noTask.ok).toBe(false);
    expect(noTask.error.code).toBe("INVALID_ARGS");

    expect(spawnWorker).not.toHaveBeenCalled();
  });

  it("forwards the read-back (needsConfirmation) envelope when confirm is omitted, without spawning", async () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    const spawnWorker = vi.fn(async () => ({
      ok: false,
      needsConfirmation: true,
      summary: "I'll spawn a engineer on adjutant to do it — confirm?",
    }));
    const dispatch = buildBridgeToolDispatch({ executeTool, spawnWorker, defaultProjectId: "p1" });

    const out = (await dispatch["spawn_worker"]!({ agentType: "engineer", task: "do it" })) as {
      ok: boolean;
      tool: string;
      needsConfirmation: boolean;
      summary: string;
    };
    // confirm:false is passed through to the gate (the write path decides).
    expect(spawnWorker).toHaveBeenCalledWith({ agentType: "engineer", task: "do it", confirm: false, project: "p1" });
    expect(out.ok).toBe(false);
    expect(out.tool).toBe("spawn_worker");
    expect(out.needsConfirmation).toBe(true);
    expect(out.summary).toContain("confirm");
  });

  it("passes confirm:true and an explicit project NAME through, returning the spawned agent", async () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    const spawnWorker = vi.fn(async () => ({ ok: true, agentName: "engineer-ab12", sessionId: "s9", project: "bloomfolio" }));
    const dispatch = buildBridgeToolDispatch({ executeTool, spawnWorker, defaultProjectId: "p1" });

    const out = (await dispatch["spawn_worker"]!({
      agentType: "engineer",
      project: "bloomfolio",
      task: "add export",
      confirm: true,
    })) as { ok: boolean; tool: string; agentName: string };

    // An explicit project NAME overrides the session default.
    expect(spawnWorker).toHaveBeenCalledWith({ agentType: "engineer", task: "add export", confirm: true, project: "bloomfolio" });
    expect(out.ok).toBe(true);
    expect(out.tool).toBe("spawn_worker");
    expect(out.agentName).toBe("engineer-ab12");
  });

  it("a spawn write-path throw becomes a structured error envelope (never rejects)", async () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    const spawnWorker = vi.fn(async () => {
      throw new Error("tmux unavailable");
    });
    const dispatch = buildBridgeToolDispatch({ executeTool, spawnWorker });
    const out = (await dispatch["spawn_worker"]!({ agentType: "engineer", task: "x", confirm: true })) as {
      ok: boolean;
      error: { message: string };
    };
    expect(out.ok).toBe(false);
    expect(out.error.message).toContain("tmux unavailable");
  });
});

describe("buildBridgeToolDispatch — onActivity sink (adj-202.6.2 auto-learn)", () => {
  it("fires onActivity for a READ tool with the envelope's ok flag", async () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, { count: 0 }));
    const onActivity = vi.fn();
    const dispatch = buildBridgeToolDispatch({ executeTool, onActivity });

    await dispatch["list_agents"]!({});
    expect(onActivity).toHaveBeenCalledWith("list_agents", true);
  });

  it("fires onActivity for a WRITE tool (send_message) reflecting success", async () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    const sendMessage = vi.fn(async () => ({ messageId: "m1", conversationId: "dm", deliveredToSessions: 1 }));
    const onActivity = vi.fn();
    const dispatch = buildBridgeToolDispatch({ executeTool, sendMessage, onActivity });

    await dispatch["send_message"]!({ to: "kerrigan", body: "go" });
    expect(onActivity).toHaveBeenCalledWith("send_message", true);
  });

  it("fires onActivity with ok=false for an invalid-args write call (attempt still counts)", async () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    const createBead = vi.fn();
    const onActivity = vi.fn();
    const dispatch = buildBridgeToolDispatch({ executeTool, createBead, onActivity });

    await dispatch["create_bead"]!({}); // missing title → INVALID_ARGS
    expect(onActivity).toHaveBeenCalledWith("create_bead", false);
  });

  it("fires onActivity with ok=false when a read tool throws (defensive)", async () => {
    const executeTool = vi.fn(async () => {
      throw new Error("boom");
    });
    const onActivity = vi.fn();
    const dispatch = buildBridgeToolDispatch({ executeTool, onActivity });

    await dispatch["list_agents"]!({});
    expect(onActivity).toHaveBeenCalledWith("list_agents", false);
  });
});

describe("createBridgeRpcManager", () => {
  function fakeHandler(): RpcHandlerLike {
    return { close: vi.fn(async () => {}), connected: true };
  }

  it("records per-session activity and finalizes the session on disconnect (adj-202.6.2)", async () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    const recordActivity = vi.fn();
    const finalizeSession = vi.fn();
    let captured: Parameters<CreateRpcHandlerFn>[0] | null = null;
    const createHandler: CreateRpcHandlerFn = vi.fn(async (opts) => {
      captured = opts;
      return fakeHandler();
    });
    const manager = createBridgeRpcManager({ executeTool, apiKey: "k", createHandler, recordActivity, finalizeSession });

    await manager.attach({ sessionId: "sess-learn" });
    await captured!.tools["list_agents"]!({});
    expect(recordActivity).toHaveBeenCalledWith("sess-learn", "list_agents", true);

    // The SDK reports the session ended → the collector should finalize it.
    captured!.onDisconnected?.();
    expect(finalizeSession).toHaveBeenCalledWith("sess-learn");
  });

  it("finalizes the session on an explicit close() too", async () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    const finalizeSession = vi.fn();
    const createHandler: CreateRpcHandlerFn = vi.fn(async () => fakeHandler());
    const manager = createBridgeRpcManager({ executeTool, apiKey: "k", createHandler, finalizeSession });

    await manager.attach({ sessionId: "sess-close" });
    await manager.close("sess-close");
    expect(finalizeSession).toHaveBeenCalledWith("sess-close");
  });

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

  it("should wire the send_message command tool into the attached handler when configured", async () => {
    const executeTool = vi.fn(async () => okResult("list_agents", null, {}));
    const sendMessage = vi.fn(async () => ({ messageId: "m1", conversationId: "dm_y", deliveredToSessions: 0 }));
    let captured: Parameters<CreateRpcHandlerFn>[0] | null = null;
    const createHandler: CreateRpcHandlerFn = vi.fn(async (opts) => {
      captured = opts;
      return fakeHandler();
    });
    const manager = createBridgeRpcManager({ executeTool, apiKey: "k", createHandler, sendMessage });

    await manager.attach({ sessionId: "sess-cmd" });
    expect(Object.keys(captured!.tools).sort()).toEqual([...BRIDGE_READONLY_TOOLS, "send_message"].sort());

    await captured!.tools["send_message"]!({ to: "kerrigan", body: "go" });
    expect(sendMessage).toHaveBeenCalledWith({ to: "kerrigan", body: "go" });
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
