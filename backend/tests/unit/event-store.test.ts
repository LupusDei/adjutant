import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";

// Mock wsBroadcast so we can verify WebSocket broadcasts
const mockWsBroadcast = vi.fn();
vi.mock("../../src/services/ws-server.js", () => ({
  wsBroadcast: (...args: unknown[]) => mockWsBroadcast(...args),
}));

let testDir: string;
let db: Database.Database;

function freshTestDir(): string {
  const dir = join(tmpdir(), `adjutant-evtstore-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function setupDb(): Promise<Database.Database> {
  const { createDatabase, runMigrations } = await import("../../src/services/database.js");
  const instance = createDatabase(join(testDir, "test.db"));
  runMigrations(instance);
  return instance;
}

describe("EventStore", () => {
  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();
    mockWsBroadcast.mockReset();
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("insertEvent", () => {
    it("should store and return an event with generated id", async () => {
      const { createEventStore } = await import("../../src/services/event-store.js");
      const store = createEventStore(db);

      const event = store.insertEvent({
        eventType: "status_change",
        agentId: "agent-1",
        action: "Status: working",
        detail: { status: "working", task: "Building feature" },
      });

      expect(event.id).toBeTruthy();
      expect(event.eventType).toBe("status_change");
      expect(event.agentId).toBe("agent-1");
      expect(event.action).toBe("Status: working");
      expect(event.detail).toEqual({ status: "working", task: "Building feature" });
      expect(event.beadId).toBeNull();
      expect(event.messageId).toBeNull();
      expect(event.createdAt).toBeTruthy();
    });

    it("should store optional beadId and messageId", async () => {
      const { createEventStore } = await import("../../src/services/event-store.js");
      const store = createEventStore(db);

      const event = store.insertEvent({
        eventType: "announcement",
        agentId: "agent-1",
        action: "completion: Done",
        detail: { type: "completion" },
        beadId: "adj-42",
        messageId: "msg-abc",
      });

      expect(event.beadId).toBe("adj-42");
      expect(event.messageId).toBe("msg-abc");
    });

    it("should store null detail when not provided", async () => {
      const { createEventStore } = await import("../../src/services/event-store.js");
      const store = createEventStore(db);

      const event = store.insertEvent({
        eventType: "bead_closed",
        agentId: "system",
        action: "Closed bead adj-1",
      });

      expect(event.detail).toBeNull();
    });

    it("should broadcast timeline_event via WebSocket", async () => {
      const { createEventStore } = await import("../../src/services/event-store.js");
      const store = createEventStore(db);

      const event = store.insertEvent({
        eventType: "status_change",
        agentId: "agent-1",
        action: "Status: idle",
      });

      expect(mockWsBroadcast).toHaveBeenCalledTimes(1);
      const broadcast = mockWsBroadcast.mock.calls[0]![0];
      expect(broadcast.type).toBe("timeline_event");
      expect(broadcast.id).toBe(event.id);
      expect(broadcast.eventType).toBe("status_change");
      expect(broadcast.agentId).toBe("agent-1");
      expect(broadcast.action).toBe("Status: idle");
    });
  });

  describe("getEvents", () => {
    it("should return events ordered by created_at descending", async () => {
      const { createEventStore } = await import("../../src/services/event-store.js");
      const store = createEventStore(db);

      store.insertEvent({ eventType: "status_change", agentId: "agent-1", action: "First" });
      store.insertEvent({ eventType: "status_change", agentId: "agent-1", action: "Second" });
      store.insertEvent({ eventType: "status_change", agentId: "agent-1", action: "Third" });

      const events = store.getEvents({});
      expect(events).toHaveLength(3);
      // Newest first
      expect(events[0]!.action).toBe("Third");
      expect(events[2]!.action).toBe("First");
    });

    it("should filter by agentId", async () => {
      const { createEventStore } = await import("../../src/services/event-store.js");
      const store = createEventStore(db);

      store.insertEvent({ eventType: "status_change", agentId: "agent-A", action: "A1" });
      store.insertEvent({ eventType: "status_change", agentId: "agent-B", action: "B1" });
      store.insertEvent({ eventType: "status_change", agentId: "agent-A", action: "A2" });

      const events = store.getEvents({ agentId: "agent-A" });
      expect(events).toHaveLength(2);
      expect(events.every((e) => e.agentId === "agent-A")).toBe(true);
    });

    it("should filter by eventType", async () => {
      const { createEventStore } = await import("../../src/services/event-store.js");
      const store = createEventStore(db);

      store.insertEvent({ eventType: "status_change", agentId: "agent-1", action: "S1" });
      store.insertEvent({ eventType: "announcement", agentId: "agent-1", action: "A1" });
      store.insertEvent({ eventType: "status_change", agentId: "agent-1", action: "S2" });

      const events = store.getEvents({ eventType: "announcement" });
      expect(events).toHaveLength(1);
      expect(events[0]!.eventType).toBe("announcement");
    });

    it("should filter by beadId", async () => {
      const { createEventStore } = await import("../../src/services/event-store.js");
      const store = createEventStore(db);

      store.insertEvent({ eventType: "bead_updated", agentId: "system", action: "Updated adj-1", beadId: "adj-1" });
      store.insertEvent({ eventType: "bead_updated", agentId: "system", action: "Updated adj-2", beadId: "adj-2" });

      const events = store.getEvents({ beadId: "adj-1" });
      expect(events).toHaveLength(1);
      expect(events[0]!.beadId).toBe("adj-1");
    });

    it("should support before cursor for pagination", async () => {
      const { createEventStore } = await import("../../src/services/event-store.js");
      const store = createEventStore(db);

      const e1 = store.insertEvent({ eventType: "status_change", agentId: "agent-1", action: "E1" });
      const e2 = store.insertEvent({ eventType: "status_change", agentId: "agent-1", action: "E2" });
      const e3 = store.insertEvent({ eventType: "status_change", agentId: "agent-1", action: "E3" });

      const events = store.getEvents({ before: e3.createdAt });
      // Should not include e3 (or anything newer)
      const actions = events.map((e) => e.action);
      expect(actions).not.toContain("E3");
    });

    it("should respect limit parameter", async () => {
      const { createEventStore } = await import("../../src/services/event-store.js");
      const store = createEventStore(db);

      for (let i = 0; i < 10; i++) {
        store.insertEvent({ eventType: "status_change", agentId: "agent-1", action: `E${i}` });
      }

      const events = store.getEvents({ limit: 3 });
      expect(events).toHaveLength(3);
    });

    it("should default limit to 50", async () => {
      const { createEventStore } = await import("../../src/services/event-store.js");
      const store = createEventStore(db);

      for (let i = 0; i < 60; i++) {
        store.insertEvent({ eventType: "status_change", agentId: "agent-1", action: `E${i}` });
      }

      const events = store.getEvents({});
      expect(events).toHaveLength(50);
    });
  });

  describe("pruneOldEvents", () => {
    it("should delete events older than N days", async () => {
      const { createEventStore } = await import("../../src/services/event-store.js");
      const store = createEventStore(db);

      // Insert an event normally (will be recent)
      store.insertEvent({ eventType: "status_change", agentId: "agent-1", action: "Recent" });

      // Manually insert an old event
      db.prepare(`
        INSERT INTO events (id, event_type, agent_id, action, created_at)
        VALUES ('old-1', 'status_change', 'agent-1', 'Old event', datetime('now', '-31 days'))
      `).run();

      const deletedCount = store.pruneOldEvents(30);
      expect(deletedCount).toBe(1);

      // Recent event should still exist
      const remaining = store.getEvents({});
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.action).toBe("Recent");
    });

    it("should return 0 when nothing to prune", async () => {
      const { createEventStore } = await import("../../src/services/event-store.js");
      const store = createEventStore(db);

      store.insertEvent({ eventType: "status_change", agentId: "agent-1", action: "Fresh" });

      const deletedCount = store.pruneOldEvents(30);
      expect(deletedCount).toBe(0);
    });
  });
});
