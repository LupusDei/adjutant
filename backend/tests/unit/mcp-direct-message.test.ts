/**
 * MCP `direct_message` tool (syl-j8fa.2).
 *
 * `send_message`'s DM branch persists and broadcasts but NEVER injects into the
 * recipient's live session, so an agent messaging another agent gets an id back and
 * nothing arrives. `direct_message` is the additive fix: it calls
 * `deliverDirectMessageAwaited`, which awaits every injection and reports the number
 * that actually landed — 0 meaning nobody received it.
 *
 * These tests wire a REAL MessageStore over an in-memory-ish temp DB so persistence is
 * genuinely exercised, and mock only the session bridge (tmux) and the WS/APNS edges.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";
import type { MessageStore } from "../../src/services/message-store.js";
import type { EventStore } from "../../src/services/event-store.js";
import type { RecipientResolver } from "../../src/services/agent-recipient-resolver.js";

vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

const mockWsBroadcast = vi.fn();
const mockWsBroadcastToConversation = vi.fn();
vi.mock("../../src/services/ws-server.js", () => ({
  wsBroadcast: (...args: unknown[]) => mockWsBroadcast(...args),
  wsBroadcastToConversation: (...args: unknown[]) => mockWsBroadcastToConversation(...args),
}));

const mockSendNotificationToAll = vi.fn().mockResolvedValue({ success: true });
const mockIsAPNsConfigured = vi.fn().mockReturnValue(true);
vi.mock("../../src/services/apns-service.js", () => ({
  sendNotificationToAll: (...args: unknown[]) => mockSendNotificationToAll(...args),
  isAPNsConfigured: (...args: unknown[]) => mockIsAPNsConfigured(...args),
}));

const mockGetAgentBySession = vi.fn();
vi.mock("../../src/services/mcp-server.js", () => ({
  getAgentBySession: (...args: unknown[]) => mockGetAgentBySession(...args),
}));

const mockGetSessionBridge = vi.fn();
vi.mock("../../src/services/session-bridge.js", () => ({
  getSessionBridge: (...args: unknown[]) => mockGetSessionBridge(...args),
}));

// ============================================================================
// Harness
// ============================================================================

let testDir: string;
let db: Database.Database;
let store: MessageStore;

interface ToolResult {
  content: { type: string; text: string }[];
}

interface Registered {
  description: string | undefined;
  schema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, extra: Record<string, unknown>) => Promise<ToolResult>;
}

/**
 * Capture every registered tool, tolerating BOTH `tool(name, schema, cb)` and
 * `tool(name, description, schema, cb)` — the description is what a model reads to
 * decide what a verb means, so this test needs to see it.
 */
async function registerTools(
  eventStore?: unknown,
  opts?: { resolveRecipient?: RecipientResolver },
): Promise<Map<string, Registered>> {
  const { registerMessagingTools } = await import("../../src/services/mcp-tools/messaging.js");
  const tools = new Map<string, Registered>();
  const mockServer = {
    tool: (name: string, ...rest: unknown[]) => {
      const first = rest[0];
      const description = typeof first === "string" ? first : undefined;
      const schema = (typeof first === "string" ? rest[1] : first) as Record<string, unknown>;
      const handler = rest[rest.length - 1] as Registered["handler"];
      tools.set(name, { description, schema, handler });
    },
  } as unknown as Parameters<typeof registerMessagingTools>[0];
  registerMessagingTools(mockServer, store, eventStore as EventStore | undefined, undefined, opts);
  return tools;
}

/** A resolver over a fixed roster, using the real matching rule. */
function resolverOver(...names: string[]): RecipientResolver {
  return async (spoken: string) => {
    const { resolveAgentName } = await import("../../src/services/bridge-agent-resolver.js");
    if (names.length === 0) return { status: "roster-unavailable", candidates: [] };
    const r = resolveAgentName(spoken, names.map((n) => ({ id: n, name: n })));
    return r.matched && r.canonical
      ? { status: "resolved", canonical: r.canonical, candidates: [] }
      : { status: "unknown", candidates: r.candidates };
  };
}

function bridgeWith(sessions: { id: string; status?: string }[], sendInput: ReturnType<typeof vi.fn>) {
  return {
    registry: { findByName: vi.fn(() => sessions) },
    inputRouter: {},
    sendInput,
  };
}

function parse(result: { content: { type: string; text: string }[] }): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

beforeEach(async () => {
  testDir = join(tmpdir(), `adjutant-direct-msg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  const { createDatabase, runMigrations } = await import("../../src/services/database.js");
  db = createDatabase(join(testDir, "test.db"));
  runMigrations(db);
  const { createMessageStore } = await import("../../src/services/message-store.js");
  store = createMessageStore(db);

  vi.clearAllMocks();
  mockIsAPNsConfigured.mockReturnValue(true);
  mockGetAgentBySession.mockReturnValue("syl");
  // Default: no live session for the recipient.
  mockGetSessionBridge.mockReturnValue(bridgeWith([], vi.fn()));
});

afterEach(() => {
  db.close();
  rmSync(testDir, { recursive: true, force: true });
});

// ============================================================================

describe("direct_message MCP tool", () => {
  it("is registered alongside the existing messaging tools", async () => {
    const tools = await registerTools();
    expect([...tools.keys()]).toEqual(
      expect.arrayContaining(["send_message", "read_messages", "list_threads", "mark_read", "direct_message"]),
    );
  });

  // The description is the tool's contract with the model. A verb whose failure mode
  // is undocumented gets narrated as success.
  it("documents that it injects into the live session and that zero means nobody received it", async () => {
    const tools = await registerTools();
    const description = tools.get("direct_message")!.description;

    expect(description).toBeTruthy();
    const lowered = description!.toLowerCase();
    expect(lowered).toContain("live session");
    expect(lowered).toContain("deliveredtosessions");
    expect(lowered).toMatch(/\b0\b|zero/);
    expect(lowered).toContain("send_message"); // points at the right verb for the user
    // A field the model is not told how to read is a field it will not read. The
    // description must explain what sessionsFound separates, not merely name it.
    expect(lowered).toContain("sessionsfound");
    // syl-j8fa.7: a rejected name and a zero delivery are different outcomes, and the
    // model has to know which one it is looking at.
    expect(lowered).toContain("rejected");
  });

  it("injects into a live recipient session and reports the count it actually reached", async () => {
    const sendInput = vi.fn().mockResolvedValue(true);
    mockGetSessionBridge.mockReturnValue(bridgeWith([{ id: "sess-A" }], sendInput));

    const tools = await registerTools();
    const result = await tools.get("direct_message")!.handler(
      { to: "kerrigan", body: "the gate is red on main" },
      { sessionId: "mcp-1" },
    );
    const data = parse(result);

    expect(data["deliveredToSessions"]).toBe(1);
    expect(sendInput).toHaveBeenCalledTimes(1);
    expect(sendInput.mock.calls[0]![0]).toBe("sess-A");
    expect(String(sendInput.mock.calls[0]![1])).toContain("the gate is red on main");

    // Persisted, so the exchange is visible and a reply has somewhere to land.
    const stored = store.getMessage(String(data["messageId"]));
    expect(stored).not.toBeNull();
    expect(stored!.body).toBe("the gate is red on main");
    expect(stored!.recipient).toBe("kerrigan");
    expect(stored!.agentId).toBe("syl");
    expect(stored!.conversationId).toBe(data["conversationId"]);
  });

  // THE test. A registry hit is not an arrival.
  it("reports 0 and leaves the message undelivered when a session exists but the injection fails", async () => {
    const sendInput = vi.fn().mockResolvedValue(false);
    mockGetSessionBridge.mockReturnValue(bridgeWith([{ id: "sess-A" }], sendInput));

    const tools = await registerTools();
    const result = await tools.get("direct_message")!.handler(
      { to: "kerrigan", body: "did this land?" },
      { sessionId: "mcp-1" },
    );
    const data = parse(result);

    expect(sendInput).toHaveBeenCalledTimes(1); // it really tried
    expect(data["deliveredToSessions"]).toBe(0);

    const stored = store.getMessage(String(data["messageId"]));
    expect(stored).not.toBeNull(); // still persisted — never silently dropped
    expect(stored!.deliveryStatus).toBe("pending"); // but NOT marked delivered
  });

  it("returns with a 0 count when the recipient has no live session, and still persists", async () => {
    const tools = await registerTools();
    const result = await tools.get("direct_message")!.handler(
      { to: "ghost", body: "anyone home" },
      { sessionId: "mcp-1" },
    );
    const data = parse(result);

    expect(data["deliveredToSessions"]).toBe(0);
    expect(data["error"]).toBeUndefined();
    expect(store.getMessage(String(data["messageId"]))!.body).toBe("anyone home");
  });

  it("returns the full envelope: messageId, timestamp, conversationId, deliveredToSessions, sessionsFound", async () => {
    const sendInput = vi.fn().mockResolvedValue(true);
    mockGetSessionBridge.mockReturnValue(bridgeWith([{ id: "sess-A" }], sendInput));

    const tools = await registerTools();
    const data = parse(
      await tools.get("direct_message")!.handler({ to: "kerrigan", body: "hi" }, { sessionId: "mcp-1" }),
    );

    expect(Object.keys(data).sort()).toEqual(
      ["conversationId", "deliveredToSessions", "messageId", "sessionsFound", "timestamp"].sort(),
    );
    expect(typeof data["messageId"]).toBe("string");
    expect(typeof data["timestamp"]).toBe("string");
    expect(String(data["conversationId"])).toMatch(/^dm_/);
    expect(data["sessionsFound"]).toBe(1);
  });

  // ==========================================================================
  // The two zero-delivery causes must be tellable apart FROM THE PAYLOAD, since
  // that payload is all Syl has when she decides what to tell the Commander:
  // "there is no agent called that" vs "that agent is not responding".
  // ==========================================================================

  it("distinguishes 'nobody by that name' from 'they are there and it failed' in the payload", async () => {
    // (a) no session in the registry for that name.
    let tools = await registerTools();
    const absent = parse(
      await tools.get("direct_message")!.handler({ to: "ghost", body: "go" }, { sessionId: "mcp-1" }),
    );

    // (b) sessions exist, every injection fails.
    const sendInput = vi.fn().mockResolvedValue(false);
    mockGetSessionBridge.mockReturnValue(bridgeWith([{ id: "sess-A" }, { id: "sess-B" }], sendInput));
    tools = await registerTools();
    const failed = parse(
      await tools.get("direct_message")!.handler({ to: "kerrigan", body: "go" }, { sessionId: "mcp-1" }),
    );

    // Both delivered nothing, and both are ordinary results with a real id.
    expect(absent["deliveredToSessions"]).toBe(0);
    expect(failed["deliveredToSessions"]).toBe(0);
    expect(absent["error"]).toBeUndefined();
    expect(failed["error"]).toBeUndefined();

    // On deliveredToSessions alone these two payloads are identical. sessionsFound is
    // the only thing separating them — that is the point of this assertion.
    expect(absent["sessionsFound"]).toBe(0);
    expect(failed["sessionsFound"]).toBe(2);
  });

  it("stores threadId and metadata when supplied", async () => {
    const tools = await registerTools();
    const data = parse(
      await tools.get("direct_message")!.handler(
        { to: "kerrigan", body: "with extras", threadId: "t-7", metadata: { epic: "syl-j8fa" } },
        { sessionId: "mcp-1" },
      ),
    );

    const stored = store.getMessage(String(data["messageId"]))!;
    expect(stored.threadId).toBe("t-7");
    expect(stored.metadata).toEqual({ epic: "syl-j8fa" });
  });

  // ==========================================================================
  // Recipient scope: agent names only.
  // ==========================================================================

  it("rejects to:'user' and names send_message in the error", async () => {
    const sendInput = vi.fn().mockResolvedValue(true);
    mockGetSessionBridge.mockReturnValue(bridgeWith([{ id: "sess-A" }], sendInput));

    const tools = await registerTools();
    const data = parse(
      await tools.get("direct_message")!.handler({ to: "user", body: "hello Commander" }, { sessionId: "mcp-1" }),
    );

    expect(String(data["error"])).toContain("send_message");
    expect(data["messageId"]).toBeUndefined();
    // Nothing persisted, nothing injected, no push.
    expect(store.getMessages({ limit: 50 })).toHaveLength(0);
    expect(sendInput).not.toHaveBeenCalled();
    expect(mockWsBroadcast).not.toHaveBeenCalled();
    expect(mockSendNotificationToAll).not.toHaveBeenCalled();
  });

  it("rejects the legacy to:'mayor/' alias the same way", async () => {
    const tools = await registerTools();
    const data = parse(
      await tools.get("direct_message")!.handler({ to: "mayor/", body: "hello Commander" }, { sessionId: "mcp-1" }),
    );

    expect(String(data["error"])).toContain("send_message");
    expect(data["messageId"]).toBeUndefined();
    expect(store.getMessages({ limit: 50 })).toHaveLength(0);
  });

  it("never pushes APNS, even with APNs configured (that is send_message's direction)", async () => {
    const sendInput = vi.fn().mockResolvedValue(true);
    mockGetSessionBridge.mockReturnValue(bridgeWith([{ id: "sess-A" }], sendInput));

    const tools = await registerTools();
    await tools.get("direct_message")!.handler({ to: "kerrigan", body: "agent to agent" }, { sessionId: "mcp-1" });

    expect(mockSendNotificationToAll).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Identity comes from the handshake, never from an argument.
  // ==========================================================================

  it("takes the sender from the session handshake and ignores a client-supplied identity", async () => {
    mockGetAgentBySession.mockReturnValue("server-resolved-agent");

    const tools = await registerTools();
    const data = parse(
      await tools.get("direct_message")!.handler(
        // A client trying to spoof: both an argument and _meta claim someone else.
        { to: "kerrigan", body: "who sent this", from: "impersonator" },
        { sessionId: "mcp-1", _meta: { agentId: "impersonator" } },
      ),
    );

    expect(mockGetAgentBySession).toHaveBeenCalledWith("mcp-1");
    expect(store.getMessage(String(data["messageId"]))!.agentId).toBe("server-resolved-agent");
  });

  it("does not accept a sender argument in its schema at all", async () => {
    const tools = await registerTools();
    const schema = tools.get("direct_message")!.schema;
    expect(Object.keys(schema).sort()).toEqual(["body", "metadata", "threadId", "to"]);
  });

  it("returns an Unknown session error when the handshake resolves nobody", async () => {
    mockGetAgentBySession.mockReturnValue(undefined);

    const tools = await registerTools();
    const data = parse(
      await tools.get("direct_message")!.handler({ to: "kerrigan", body: "orphan" }, { sessionId: "nope" }),
    );

    expect(data["error"]).toBe("Unknown session");
    expect(store.getMessages({ limit: 50 })).toHaveLength(0);
  });

  it("emits a message_sent timeline event when an event store is wired", async () => {
    const eventStore = { insertEvent: vi.fn() };
    const tools = await registerTools(eventStore);
    await tools.get("direct_message")!.handler({ to: "kerrigan", body: "logged" }, { sessionId: "mcp-1" });

    expect(eventStore.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "message_sent", agentId: "syl" }),
    );
  });
});

// ============================================================================
// Recipient validation (syl-j8fa.7).
//
// An unresolvable name used to persist a message to a phantom recipient and come
// back as deliveredToSessions 0 — indistinguishable from a real agent who is not
// running. Routing `to` through the SAME resolver the Bridge path uses makes an
// unknown name fail as itself.
//
// THE TRAP, and it is the reason this is not simply "validate the name": a
// REGISTERED agent with no live session must remain a SUCCESS with
// deliveredToSessions 0. The reply path depends on a message being persisted for
// an agent who is not running yet, so a stricter door here would quietly close the
// door the next task needs open.
// ============================================================================

describe("direct_message recipient validation", () => {
  it("delivers as before when the name is an exact registered agent", async () => {
    const sendInput = vi.fn().mockResolvedValue(true);
    mockGetSessionBridge.mockReturnValue(bridgeWith([{ id: "sess-A" }], sendInput));

    const tools = await registerTools(undefined, { resolveRecipient: resolverOver("kerrigan", "raynor") });
    const data = parse(
      await tools.get("direct_message")!.handler({ to: "kerrigan", body: "go" }, { sessionId: "mcp-1" }),
    );

    expect(data["error"]).toBeUndefined();
    expect(data["deliveredToSessions"]).toBe(1);
    expect(store.getMessage(String(data["messageId"]))!.recipient).toBe("kerrigan");
  });

  it("delivers to the CANONICAL name when the caller uses a resolvable variant", async () => {
    const sendInput = vi.fn().mockResolvedValue(true);
    const findByName = vi.fn(() => [{ id: "sess-A" }]);
    mockGetSessionBridge.mockReturnValue({ registry: { findByName }, inputRouter: {}, sendInput });

    const tools = await registerTools(undefined, { resolveRecipient: resolverOver("fenix", "kerrigan") });
    const data = parse(
      await tools.get("direct_message")!.handler({ to: "Phoenix", body: "go" }, { sessionId: "mcp-1" }),
    );

    // Persisted under the canonical name, and the session lookup used it too —
    // otherwise the message lands in a conversation nobody is reading.
    expect(store.getMessage(String(data["messageId"]))!.recipient).toBe("fenix");
    expect(findByName).toHaveBeenCalledWith("fenix");
  });

  it("rejects a name that matches nothing, persisting NOTHING", async () => {
    const sendInput = vi.fn().mockResolvedValue(true);
    mockGetSessionBridge.mockReturnValue(bridgeWith([{ id: "sess-A" }], sendInput));

    const tools = await registerTools(undefined, { resolveRecipient: resolverOver("kerrigan", "raynor") });
    const data = parse(
      await tools.get("direct_message")!.handler({ to: "nobody-at-all", body: "go" }, { sessionId: "mcp-1" }),
    );

    expect(String(data["error"])).toContain("nobody-at-all");
    expect(data["messageId"]).toBeUndefined();
    expect(data["deliveredToSessions"]).toBeUndefined();
    expect(store.getMessages({ limit: 50 })).toHaveLength(0);
    expect(sendInput).not.toHaveBeenCalled();
    expect(mockWsBroadcast).not.toHaveBeenCalled();
  });

  it("rejects an ambiguous near-miss and names the candidates it could have meant", async () => {
    const tools = await registerTools(undefined, { resolveRecipient: resolverOver("alpha", "alphb") });
    const data = parse(
      await tools.get("direct_message")!.handler({ to: "alphc", body: "go" }, { sessionId: "mcp-1" }),
    );

    const error = String(data["error"]);
    expect(error).toContain("alphc");
    expect(error).toContain("alpha");
    expect(error).toContain("alphb");
    expect(store.getMessages({ limit: 50 })).toHaveLength(0);
  });

  // THE TRAP.
  it("still SUCCEEDS for a registered agent with no live session — the reply path needs this", async () => {
    // Registered on the roster, but the session registry has nothing for them.
    mockGetSessionBridge.mockReturnValue(bridgeWith([], vi.fn()));

    const tools = await registerTools(undefined, { resolveRecipient: resolverOver("kerrigan", "raynor") });
    const data = parse(
      await tools.get("direct_message")!.handler({ to: "kerrigan", body: "for when you wake up" }, { sessionId: "mcp-1" }),
    );

    expect(data["error"]).toBeUndefined();
    expect(data["deliveredToSessions"]).toBe(0);
    expect(data["sessionsFound"]).toBe(0);
    // Persisted, so the exchange exists and a reply has somewhere to land.
    const stored = store.getMessage(String(data["messageId"]));
    expect(stored).not.toBeNull();
    expect(stored!.body).toBe("for when you wake up");
    expect(stored!.recipient).toBe("kerrigan");
  });

  // "I could not read the roster" is not "that name is wrong". Blaming the sender for
  // an outage is the same class of false report this epic exists to close.
  it("delivers anyway when the roster cannot be read, rather than blaming the name", async () => {
    const sendInput = vi.fn().mockResolvedValue(true);
    mockGetSessionBridge.mockReturnValue(bridgeWith([{ id: "sess-A" }], sendInput));

    const tools = await registerTools(undefined, {
      resolveRecipient: async () => ({ status: "roster-unavailable", candidates: [] }),
    });
    const data = parse(
      await tools.get("direct_message")!.handler({ to: "kerrigan", body: "go" }, { sessionId: "mcp-1" }),
    );

    expect(data["error"]).toBeUndefined();
    expect(data["deliveredToSessions"]).toBe(1);
    expect(store.getMessage(String(data["messageId"]))!.recipient).toBe("kerrigan");
  });

  it("resolves nothing and delivers as before when no resolver is wired at all", async () => {
    const sendInput = vi.fn().mockResolvedValue(true);
    mockGetSessionBridge.mockReturnValue(bridgeWith([{ id: "sess-A" }], sendInput));

    const tools = await registerTools(); // no opts
    const data = parse(
      await tools.get("direct_message")!.handler({ to: "whoever", body: "go" }, { sessionId: "mcp-1" }),
    );

    expect(data["error"]).toBeUndefined();
    expect(data["deliveredToSessions"]).toBe(1);
  });

  it("rejects to:'user' BEFORE attempting resolution", async () => {
    const resolveRecipient = vi.fn(resolverOver("kerrigan"));
    const tools = await registerTools(undefined, { resolveRecipient });
    const data = parse(
      await tools.get("direct_message")!.handler({ to: "user", body: "hi" }, { sessionId: "mcp-1" }),
    );

    expect(String(data["error"])).toContain("send_message");
    // "user" is not an agent name and must never be looked up as one.
    expect(resolveRecipient).not.toHaveBeenCalled();
  });

  it("rejects an unknown session BEFORE attempting resolution", async () => {
    mockGetAgentBySession.mockReturnValue(undefined);
    const resolveRecipient = vi.fn(resolverOver("kerrigan"));
    const tools = await registerTools(undefined, { resolveRecipient });
    const data = parse(
      await tools.get("direct_message")!.handler({ to: "kerrigan", body: "go" }, { sessionId: "nope" }),
    );

    expect(data["error"]).toBe("Unknown session");
    expect(resolveRecipient).not.toHaveBeenCalled();
  });
});

// ============================================================================
// send_message must be untouched (this change is purely additive).
// ============================================================================

describe("send_message is unchanged by direct_message", () => {
  it("still does NOT inject into the recipient's live session on the DM path", async () => {
    const sendInput = vi.fn().mockResolvedValue(true);
    mockGetSessionBridge.mockReturnValue(bridgeWith([{ id: "sess-A" }], sendInput));

    const tools = await registerTools();
    const data = parse(
      await tools.get("send_message")!.handler({ to: "kerrigan", body: "old behaviour" }, { sessionId: "mcp-1" }),
    );

    expect(sendInput).not.toHaveBeenCalled();
    // And its envelope is still the two-field one — no deliveredToSessions was added.
    expect(Object.keys(data).sort()).toEqual(["messageId", "timestamp"]);
    expect(store.getMessage(String(data["messageId"]))!.body).toBe("old behaviour");
  });

  it("still pushes APNS for to:'user'", async () => {
    const tools = await registerTools();
    await tools.get("send_message")!.handler({ to: "user", body: "for the Commander" }, { sessionId: "mcp-1" });
    expect(mockSendNotificationToAll).toHaveBeenCalledTimes(1);
  });
});
