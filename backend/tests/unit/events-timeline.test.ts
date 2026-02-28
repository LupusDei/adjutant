import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";

// Mock wsBroadcast
const mockWsBroadcast = vi.fn();
vi.mock("../../src/services/ws-server.js", () => ({
  wsBroadcast: (...args: unknown[]) => mockWsBroadcast(...args),
}));

// Mock logger
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

let testDir: string;
let db: Database.Database;

function freshTestDir(): string {
  const dir = join(tmpdir(), `adjutant-evttimeline-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function setupDb(): Promise<Database.Database> {
  const { createDatabase, runMigrations } = await import("../../src/services/database.js");
  const instance = createDatabase(join(testDir, "test.db"));
  runMigrations(instance);
  return instance;
}

describe("GET /api/events/timeline", () => {
  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();
    mockWsBroadcast.mockReset();
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should return events as JSON", async () => {
    const { createEventStore } = await import("../../src/services/event-store.js");
    const { createEventsRouter } = await import("../../src/routes/events.js");
    const express = (await import("express")).default;

    const eventStore = createEventStore(db);
    eventStore.insertEvent({ eventType: "status_change", agentId: "agent-1", action: "Status: working" });

    const app = express();
    app.use(express.json());
    app.use("/api/events", createEventsRouter(eventStore));

    const { default: request } = await import("supertest");
    const res = await request(app).get("/api/events/timeline");

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].eventType).toBe("status_change");
    expect(res.body.events[0].agentId).toBe("agent-1");
    expect(res.body.hasMore).toBe(false);
  });

  it("should filter by agentId", async () => {
    const { createEventStore } = await import("../../src/services/event-store.js");
    const { createEventsRouter } = await import("../../src/routes/events.js");
    const express = (await import("express")).default;

    const eventStore = createEventStore(db);
    eventStore.insertEvent({ eventType: "status_change", agentId: "agent-A", action: "A1" });
    eventStore.insertEvent({ eventType: "status_change", agentId: "agent-B", action: "B1" });

    const app = express();
    app.use(express.json());
    app.use("/api/events", createEventsRouter(eventStore));

    const { default: request } = await import("supertest");
    const res = await request(app).get("/api/events/timeline?agentId=agent-A");

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].agentId).toBe("agent-A");
  });

  it("should filter by eventType", async () => {
    const { createEventStore } = await import("../../src/services/event-store.js");
    const { createEventsRouter } = await import("../../src/routes/events.js");
    const express = (await import("express")).default;

    const eventStore = createEventStore(db);
    eventStore.insertEvent({ eventType: "status_change", agentId: "agent-1", action: "S1" });
    eventStore.insertEvent({ eventType: "announcement", agentId: "agent-1", action: "A1" });

    const app = express();
    app.use(express.json());
    app.use("/api/events", createEventsRouter(eventStore));

    const { default: request } = await import("supertest");
    const res = await request(app).get("/api/events/timeline?eventType=announcement");

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].eventType).toBe("announcement");
  });

  it("should filter by beadId", async () => {
    const { createEventStore } = await import("../../src/services/event-store.js");
    const { createEventsRouter } = await import("../../src/routes/events.js");
    const express = (await import("express")).default;

    const eventStore = createEventStore(db);
    eventStore.insertEvent({ eventType: "bead_updated", agentId: "system", action: "U1", beadId: "adj-1" });
    eventStore.insertEvent({ eventType: "bead_updated", agentId: "system", action: "U2", beadId: "adj-2" });

    const app = express();
    app.use(express.json());
    app.use("/api/events", createEventsRouter(eventStore));

    const { default: request } = await import("supertest");
    const res = await request(app).get("/api/events/timeline?beadId=adj-1");

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].beadId).toBe("adj-1");
  });

  it("should respect limit and return hasMore", async () => {
    const { createEventStore } = await import("../../src/services/event-store.js");
    const { createEventsRouter } = await import("../../src/routes/events.js");
    const express = (await import("express")).default;

    const eventStore = createEventStore(db);
    for (let i = 0; i < 5; i++) {
      eventStore.insertEvent({ eventType: "status_change", agentId: "agent-1", action: `E${i}` });
    }

    const app = express();
    app.use(express.json());
    app.use("/api/events", createEventsRouter(eventStore));

    const { default: request } = await import("supertest");
    const res = await request(app).get("/api/events/timeline?limit=3");

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(3);
    expect(res.body.hasMore).toBe(true);
  });

  it("should return 400 for invalid eventType", async () => {
    const { createEventStore } = await import("../../src/services/event-store.js");
    const { createEventsRouter } = await import("../../src/routes/events.js");
    const express = (await import("express")).default;

    const eventStore = createEventStore(db);

    const app = express();
    app.use(express.json());
    app.use("/api/events", createEventsRouter(eventStore));

    const { default: request } = await import("supertest");
    const res = await request(app).get("/api/events/timeline?eventType=invalid_type");

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("should return 503 when no event store is available", async () => {
    const { createEventsRouter } = await import("../../src/routes/events.js");
    const express = (await import("express")).default;

    const app = express();
    app.use(express.json());
    // Pass no eventStore
    app.use("/api/events", createEventsRouter());

    const { default: request } = await import("supertest");
    const res = await request(app).get("/api/events/timeline");

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });
});
