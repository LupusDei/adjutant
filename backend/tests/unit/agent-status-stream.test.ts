import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer } from "http";
import express from "express";
import WebSocket from "ws";
import type { Server } from "http";

// Mock the event bus
const handlers = new Map<string, Function[]>();
const mockOn = vi.fn((event: string, handler: Function) => {
  if (!handlers.has(event)) handlers.set(event, []);
  handlers.get(event)!.push(handler);
});
const mockOff = vi.fn((event: string, handler: Function) => {
  const arr = handlers.get(event);
  if (arr) {
    const idx = arr.indexOf(handler);
    if (idx >= 0) arr.splice(idx, 1);
  }
});

vi.mock("../../src/services/event-bus.js", () => ({
  getEventBus: () => ({
    on: mockOn,
    off: mockOff,
  }),
}));

// We need to reimport for each test since there's a module-level singleton
let initAgentStatusStream: typeof import("../../src/services/agent-status-stream.js").initAgentStatusStream;
let closeAgentStatusStream: typeof import("../../src/services/agent-status-stream.js").closeAgentStatusStream;

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Open timeout")), 3000);
    ws.on("open", () => {
      clearTimeout(timeout);
      resolve();
    });
    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function waitForMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Message timeout")), 3000);
    ws.once("message", (data) => {
      clearTimeout(timeout);
      resolve(JSON.parse(data.toString()));
    });
  });
}

describe("agent status stream", () => {
  let server: Server;
  let port: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    handlers.clear();

    // Reset the module singleton
    vi.resetModules();
    const mod = await import("../../src/services/agent-status-stream.js");
    initAgentStatusStream = mod.initAgentStatusStream;
    closeAgentStatusStream = mod.closeAgentStatusStream;

    const app = express();
    server = createServer(app);

    // Wire up upgrade handler — same as index.ts does for noServer WSSes
    const agentWss = initAgentStatusStream(server);
    server.on("upgrade", (req, socket, head) => {
      const pathname = req.url?.split("?")[0];
      if (pathname === "/api/agents/stream") {
        agentWss.handleUpgrade(req, socket, head, (ws) => agentWss.emit("connection", ws, req));
      } else {
        socket.destroy();
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterEach(async () => {
    closeAgentStatusStream();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("should accept WebSocket connections on /api/agents/stream", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/api/agents/stream`);
    await waitForOpen(ws);

    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("should subscribe to agent:status_changed events on connection", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/api/agents/stream`);
    await waitForOpen(ws);

    // Wait a tick for the connection handler to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(mockOn).toHaveBeenCalledWith(
      "agent:status_changed",
      expect.any(Function)
    );

    ws.close();
  });

  it("should forward agent:status_changed events to connected clients", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/api/agents/stream`);
    await waitForOpen(ws);
    await new Promise((r) => setTimeout(r, 50));

    // Get the registered handler
    const statusHandlers = handlers.get("agent:status_changed");
    expect(statusHandlers).toBeDefined();
    expect(statusHandlers!.length).toBeGreaterThan(0);

    // Simulate an event
    const msgPromise = waitForMessage(ws);
    statusHandlers![0]!({ agent: "agent-1", status: "working", activity: "coding" });
    const msg = (await msgPromise) as Record<string, unknown>;

    expect(msg.type).toBe("status_change");
    expect(msg.agent).toBe("agent-1");
    expect(msg.to).toBe("working");
    expect(msg.timestamp).toBeDefined();

    ws.close();
  });

  it("should unsubscribe from events when client disconnects", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/api/agents/stream`);
    await waitForOpen(ws);
    await new Promise((r) => setTimeout(r, 50));

    ws.close();
    // Wait for the close handler to fire
    await new Promise((r) => setTimeout(r, 200));

    expect(mockOff).toHaveBeenCalledWith(
      "agent:status_changed",
      expect.any(Function)
    );
  });

  it("should handle multiple clients independently", async () => {
    initAgentStatusStream(server);

    const ws1 = new WebSocket(`ws://localhost:${port}/api/agents/stream`);
    const ws2 = new WebSocket(`ws://localhost:${port}/api/agents/stream`);

    await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);
    await new Promise((r) => setTimeout(r, 50));

    // Both should have subscribed
    const statusHandlers = handlers.get("agent:status_changed");
    expect(statusHandlers).toHaveLength(2);

    ws1.close();
    ws2.close();
  });
});
