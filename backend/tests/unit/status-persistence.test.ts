/**
 * Tests for adj-pyhm4 status persistence: write-through on set_status +
 * boot hydration of the in-memory registry from the persistent snapshot.
 *
 * Real in-memory SQLite with real migrations (adj-067 rule). The MCP server is a
 * capture-only fake (mirrors mcp-status.test.ts) so we can invoke set_status.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";

import { runMigrations } from "../../src/services/database.js";
import { createMessageStore } from "../../src/services/message-store.js";
import {
  createAgentStatusStore,
  type AgentStatusStore,
} from "../../src/services/agent-status-store.js";
import {
  registerStatusTools,
  getAgentStatuses,
  resetAgentStatuses,
  setAgentStatusStore,
  hydrateStatusesFromStore,
} from "../../src/services/mcp-tools/status.js";

// status.ts pulls these in at module load — stub the side-effecting ones.
vi.mock("../../src/services/ws-server.js", () => ({ wsBroadcast: vi.fn() }));
const mockGetAgentBySession = vi.fn();
vi.mock("../../src/services/mcp-server.js", () => ({
  getAgentBySession: (...args: unknown[]) => mockGetAgentBySession(...args),
  getProjectContextBySession: () => undefined,
}));
vi.mock("../../src/services/apns-service.js", () => ({
  isAPNsConfigured: vi.fn(() => false),
  sendNotificationToAll: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/services/session-bridge.js", () => ({
  // Uninitialized bridge → syncToSessionBridge early-returns (no session wiring in test).
  getSessionBridge: () => ({ isInitialized: false }),
}));

interface RegisteredTool {
  name: string;
  handler: (args: Record<string, unknown>, extra: Record<string, unknown>) => Promise<unknown>;
}
function createFakeMcpServer() {
  const tools: RegisteredTool[] = [];
  return {
    tool(
      name: string,
      _desc: string | Record<string, unknown>,
      schemaOrCb: unknown,
      maybeCb?: unknown,
    ) {
      const handler = (typeof _desc === "string" ? maybeCb : schemaOrCb) as RegisteredTool["handler"];
      tools.push({ name, handler });
    },
    getTool: (name: string) => tools.find((t) => t.name === name),
  };
}
function fakeExtra(sessionId = "sess-1") {
  return { sessionId, signal: new AbortController().signal, requestId: "r1", sendNotification: vi.fn(), sendRequest: vi.fn() };
}

let db: Database.Database;
let statusStore: AgentStatusStore;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  statusStore = createAgentStatusStore(db);
  resetAgentStatuses(); // also detaches any prior store
  mockGetAgentBySession.mockReset();
});

afterEach(() => {
  resetAgentStatuses();
  db.close();
});

describe("set_status write-through (adj-pyhm4)", () => {
  it("should persist the snapshot to the store when a store is wired", async () => {
    setAgentStatusStore(statusStore);
    mockGetAgentBySession.mockReturnValue("raynor");
    const server = createFakeMcpServer();
    registerStatusTools(server as never, createMessageStore(db));

    await server.getTool("set_status")!.handler(
      { status: "working", task: "Fixing adj-ibcy6", beadId: "adj-ibcy6" },
      fakeExtra(),
    );

    const row = statusStore.get("raynor");
    expect(row).not.toBeNull();
    expect(row?.status).toBe("working");
    expect(row?.currentTask).toBe("Fixing adj-ibcy6");
    expect(row?.beadId).toBe("adj-ibcy6");
  });

  it("should NOT throw when no store is wired (write-through is optional)", async () => {
    // no setAgentStatusStore call → persistentStore stays null
    mockGetAgentBySession.mockReturnValue("fenix");
    const server = createFakeMcpServer();
    registerStatusTools(server as never, createMessageStore(db));

    await expect(
      server.getTool("set_status")!.handler({ status: "idle" }, fakeExtra()),
    ).resolves.toBeDefined();
    expect(statusStore.get("fenix")).toBeNull();
  });

  it("should update the persisted row across successive transitions", async () => {
    setAgentStatusStore(statusStore);
    mockGetAgentBySession.mockReturnValue("nova");
    const server = createFakeMcpServer();
    registerStatusTools(server as never, createMessageStore(db));
    const setStatus = server.getTool("set_status")!.handler;

    await setStatus({ status: "working", task: "task A" }, fakeExtra());
    await setStatus({ status: "done" }, fakeExtra());

    const row = statusStore.get("nova");
    expect(row?.status).toBe("done");
    // task carries forward (set_status preserves prior task when omitted)
    expect(row?.currentTask).toBe("task A");
  });
});

describe("hydrateStatusesFromStore (adj-pyhm4)", () => {
  it("should populate the in-memory Map from persisted snapshots on boot", () => {
    statusStore.upsert({ agentId: "a", status: "working", currentTask: "t", beadId: "adj-9", projectId: "p", updatedAt: "2026-07-08T21:00:00.000Z" });
    statusStore.upsert({ agentId: "b", status: "blocked", updatedAt: "2026-07-08T21:00:00.000Z" });
    setAgentStatusStore(statusStore);

    const count = hydrateStatusesFromStore();

    expect(count).toBe(2);
    const map = getAgentStatuses();
    expect(map.get("a")?.status).toBe("working");
    expect(map.get("a")?.task).toBe("t");
    expect(map.get("a")?.beadId).toBe("adj-9");
    expect(map.get("b")?.status).toBe("blocked");
  });

  it("should return 0 and no-op when no store is wired", () => {
    // resetAgentStatuses in beforeEach detached the store
    expect(hydrateStatusesFromStore()).toBe(0);
    expect(getAgentStatuses().size).toBe(0);
  });

  it("should skip rows with an unrecognized status value (keeps the Map typed)", () => {
    statusStore.upsert({ agentId: "good", status: "idle", updatedAt: "2026-07-08T21:00:00.000Z" });
    statusStore.upsert({ agentId: "weird", status: "on_fire", updatedAt: "2026-07-08T21:00:00.000Z" });
    setAgentStatusStore(statusStore);

    const count = hydrateStatusesFromStore();

    expect(count).toBe(1);
    expect(getAgentStatuses().has("good")).toBe(true);
    expect(getAgentStatuses().has("weird")).toBe(false);
  });
});
