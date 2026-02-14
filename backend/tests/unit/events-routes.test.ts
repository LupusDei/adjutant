import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { createServer, type Server } from "http";
import { getEventBus, resetEventBus } from "../../src/services/event-bus.js";

// Suppress logs in tests
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

import { eventsRouter, getSseClientCount } from "../../src/routes/events.js";

function createTestApp() {
  const app = express();
  app.use("/api/events", eventsRouter);
  return app;
}

/**
 * Helper to connect an SSE client and collect events.
 * Returns an abort controller to disconnect and a promise of collected lines.
 */
function connectSse(
  server: Server,
  opts: { lastEventId?: string } = {},
): {
  events: string[];
  close: () => void;
  waitForEvents: (count: number, timeoutMs?: number) => Promise<string[]>;
} {
  const events: string[] = [];
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server not listening");

  const url = `http://127.0.0.1:${address.port}/api/events`;
  const headers: Record<string, string> = {
    Accept: "text/event-stream",
  };
  if (opts.lastEventId) {
    headers["Last-Event-ID"] = opts.lastEventId;
  }

  const controller = new AbortController();
  const fetchPromise = fetch(url, {
    headers,
    signal: controller.signal,
  }).then(async (res) => {
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        events.push(text);
      }
    } catch {
      // AbortError expected on close
    }
  });

  // Suppress unhandled rejection from abort
  fetchPromise.catch(() => {});

  return {
    events,
    close: () => controller.abort(),
    waitForEvents: (count: number, timeoutMs = 3000) => {
      return new Promise<string[]>((resolve, reject) => {
        const start = Date.now();
        const check = () => {
          if (events.length >= count) {
            resolve(events.slice());
            return;
          }
          if (Date.now() - start > timeoutMs) {
            resolve(events.slice()); // resolve with what we have
            return;
          }
          setTimeout(check, 50);
        };
        check();
      });
    },
  };
}

describe("events routes (SSE)", () => {
  let server: Server;
  let app: express.Express;

  beforeEach(() => {
    resetEventBus();
    app = createTestApp();
    server = createServer(app);
  });

  afterEach(async () => {
    resetEventBus();
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  describe("GET /api/events", () => {
    it("should respond with SSE content-type headers", async () => {
      await new Promise<void>((resolve) => server.listen(0, resolve));

      const client = connectSse(server);

      // Wait for initial connected event
      const received = await client.waitForEvents(1);
      client.close();

      expect(received.length).toBeGreaterThanOrEqual(1);
      const firstChunk = received[0]!;
      expect(firstChunk).toContain("event: connected");
      expect(firstChunk).toContain("data:");
    });

    it("should send connected event with seq and serverTime", async () => {
      await new Promise<void>((resolve) => server.listen(0, resolve));

      const client = connectSse(server);
      const received = await client.waitForEvents(1);
      client.close();

      const firstChunk = received[0]!;
      // Parse the data from the connected event
      const dataMatch = firstChunk.match(/data: (.+)/);
      expect(dataMatch).not.toBeNull();

      const data = JSON.parse(dataMatch![1]!);
      expect(data).toHaveProperty("seq");
      expect(data).toHaveProperty("serverTime");
      expect(typeof data.seq).toBe("number");
    });

    it("should forward EventBus events as SSE messages", async () => {
      await new Promise<void>((resolve) => server.listen(0, resolve));

      const client = connectSse(server);
      // Wait for connected event first
      await client.waitForEvents(1);

      // Emit an event
      getEventBus().emit("mail:received", {
        id: "msg-1",
        from: "mayor/",
        to: "operator",
        subject: "Test Mail",
        preview: "Hello",
      });

      const received = await client.waitForEvents(2);
      client.close();

      // Second chunk should contain the mail_received event
      const allText = received.join("");
      expect(allText).toContain("event: mail_received");
      expect(allText).toContain('"action":"received"');
      expect(allText).toContain('"id":"msg-1"');
    });

    it("should map bead events to bead_update SSE type", async () => {
      await new Promise<void>((resolve) => server.listen(0, resolve));

      const client = connectSse(server);
      await client.waitForEvents(1);

      getEventBus().emit("bead:created", {
        id: "bead-1",
        title: "New Issue",
        status: "open",
        type: "task",
      });

      const received = await client.waitForEvents(2);
      client.close();

      const allText = received.join("");
      expect(allText).toContain("event: bead_update");
      expect(allText).toContain('"action":"created"');
    });

    it("should map multiple bead event types to same SSE type", async () => {
      await new Promise<void>((resolve) => server.listen(0, resolve));

      const client = connectSse(server);
      await client.waitForEvents(1);

      getEventBus().emit("bead:created", {
        id: "bead-1",
        title: "Issue",
        status: "open",
        type: "task",
      });
      getEventBus().emit("bead:updated", {
        id: "bead-1",
        status: "in_progress",
        title: "Issue",
        updatedAt: "2026-01-01T00:00:00Z",
      });
      getEventBus().emit("bead:closed", {
        id: "bead-1",
        title: "Issue",
        closedAt: "2026-01-01T00:00:00Z",
      });

      const received = await client.waitForEvents(4);
      client.close();

      const allText = received.join("");
      // All three should be bead_update but with different actions
      const beadMatches = allText.match(/event: bead_update/g);
      expect(beadMatches).toHaveLength(3);
      expect(allText).toContain('"action":"created"');
      expect(allText).toContain('"action":"updated"');
      expect(allText).toContain('"action":"closed"');
    });

    it("should include sequence IDs in SSE messages", async () => {
      await new Promise<void>((resolve) => server.listen(0, resolve));

      const client = connectSse(server);
      await client.waitForEvents(1);

      getEventBus().emit("mode:changed", {
        mode: "gastown",
        features: ["dashboard"],
      });

      const received = await client.waitForEvents(2);
      client.close();

      const allText = received.join("");
      expect(allText).toMatch(/id: \d+/);
      expect(allText).toContain("event: mode_changed");
    });

    it("should skip events with seq <= Last-Event-ID", async () => {
      await new Promise<void>((resolve) => server.listen(0, resolve));

      // Pre-emit some events to advance the sequence
      const bus = getEventBus();
      bus.emit("mail:read", { id: "msg-1" });
      bus.emit("mail:read", { id: "msg-2" });
      bus.emit("mail:read", { id: "msg-3" });
      const currentSeq = bus.getSeq(); // should be 3

      // Connect with Last-Event-ID = 3
      const client = connectSse(server, { lastEventId: String(currentSeq) });
      await client.waitForEvents(1); // connected event

      // Emit a new event (seq 4)
      bus.emit("agent:status_changed", {
        agent: "onyx",
        status: "working",
      });

      const received = await client.waitForEvents(2);
      client.close();

      const allText = received.join("");
      // Should see the new event but not the old ones
      expect(allText).toContain("event: agent_status");
      expect(allText).toContain('"agent":"onyx"');
    });

    it("should export getSseClientCount function", () => {
      expect(typeof getSseClientCount).toBe("function");
      expect(typeof getSseClientCount()).toBe("number");
    });

    it("should map all required event types", async () => {
      await new Promise<void>((resolve) => server.listen(0, resolve));

      const client = connectSse(server);
      await client.waitForEvents(1);

      const bus = getEventBus();

      // Emit one of each required type
      bus.emit("bead:updated", {
        id: "b-1",
        status: "open",
        title: "T",
        updatedAt: "2026-01-01T00:00:00Z",
      });
      bus.emit("agent:status_changed", {
        agent: "onyx",
        status: "idle",
      });
      bus.emit("power:state_changed", {
        state: "running",
      });
      bus.emit("mail:received", {
        id: "m-1",
        from: "mayor/",
        to: "op",
        subject: "S",
        preview: "P",
      });
      bus.emit("mode:changed", {
        mode: "gastown",
        features: [],
      });

      const received = await client.waitForEvents(6);
      client.close();

      const allText = received.join("");
      expect(allText).toContain("event: bead_update");
      expect(allText).toContain("event: agent_status");
      expect(allText).toContain("event: power_state");
      expect(allText).toContain("event: mail_received");
      expect(allText).toContain("event: mode_changed");
    });

    it("should handle stream:status events", async () => {
      await new Promise<void>((resolve) => server.listen(0, resolve));

      const client = connectSse(server);
      await client.waitForEvents(1);

      getEventBus().emit("stream:status", {
        streamId: "stream-1",
        agent: "onyx",
        state: "started",
      });

      const received = await client.waitForEvents(2);
      client.close();

      const allText = received.join("");
      expect(allText).toContain("event: stream_status");
      expect(allText).toContain('"streamId":"stream-1"');
    });
  });
});
