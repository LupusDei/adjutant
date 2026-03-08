import { describe, it, expect, vi, beforeEach } from "vitest";
import { getEventBus, resetEventBus, type EventName } from "../../src/services/event-bus.js";

// Suppress EventBus initialization log
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

describe("EventBus", () => {
  beforeEach(() => {
    resetEventBus();
  });

  describe("singleton", () => {
    it("should return the same instance on subsequent calls", () => {
      const bus1 = getEventBus();
      const bus2 = getEventBus();
      expect(bus1).toBe(bus2);
    });

    it("should return a new instance after reset", () => {
      const bus1 = getEventBus();
      resetEventBus();
      const bus2 = getEventBus();
      expect(bus1).not.toBe(bus2);
    });
  });

  describe("emit and on", () => {
    it("should deliver typed events to specific listeners", () => {
      const bus = getEventBus();
      const handler = vi.fn();

      bus.on("mail:received", handler);
      bus.emit("mail:received", {
        id: "msg-1",
        from: "mayor/",
        to: "operator",
        subject: "Test",
        preview: "Hello",
      });

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ id: "msg-1", subject: "Test" }),
        1, // seq
      );
    });

    it("should not deliver events to wrong listener", () => {
      const bus = getEventBus();
      const handler = vi.fn();

      bus.on("mode:changed", handler);
      bus.emit("mail:received", {
        id: "msg-1",
        from: "mayor/",
        to: "operator",
        subject: "Test",
        preview: "Hello",
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it("should support multiple listeners on same event", () => {
      const bus = getEventBus();
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      bus.on("bead:created", handler1);
      bus.on("bead:created", handler2);
      bus.emit("bead:created", {
        id: "bead-1",
        title: "Test",
        status: "open",
        type: "task",
      });

      expect(handler1).toHaveBeenCalledOnce();
      expect(handler2).toHaveBeenCalledOnce();
    });
  });

  describe("onAny (wildcard)", () => {
    it("should receive all events with event name", () => {
      const bus = getEventBus();
      const handler = vi.fn();

      bus.onAny(handler);
      bus.emit("mail:received", {
        id: "msg-1",
        from: "mayor/",
        to: "operator",
        subject: "Test",
        preview: "Hello",
      });
      bus.emit("mode:changed", {
        mode: "swarm",
        features: ["dashboard"],
      });

      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenNthCalledWith(
        1,
        "mail:received",
        expect.objectContaining({ id: "msg-1" }),
        1,
      );
      expect(handler).toHaveBeenNthCalledWith(
        2,
        "mode:changed",
        expect.objectContaining({ mode: "swarm" }),
        2,
      );
    });
  });

  describe("sequence numbers", () => {
    it("should start at 0", () => {
      const bus = getEventBus();
      expect(bus.getSeq()).toBe(0);
    });

    it("should increment monotonically with each emit", () => {
      const bus = getEventBus();

      bus.emit("mail:read", { id: "msg-1" });
      expect(bus.getSeq()).toBe(1);

      bus.emit("mail:read", { id: "msg-2" });
      expect(bus.getSeq()).toBe(2);

      bus.emit("mail:read", { id: "msg-3" });
      expect(bus.getSeq()).toBe(3);
    });

    it("should pass correct seq to handlers", () => {
      const bus = getEventBus();
      const handler = vi.fn();

      bus.on("mail:read", handler);
      bus.emit("mail:read", { id: "msg-1" });
      bus.emit("mail:read", { id: "msg-2" });

      expect(handler).toHaveBeenNthCalledWith(1, expect.anything(), 1);
      expect(handler).toHaveBeenNthCalledWith(2, expect.anything(), 2);
    });
  });

  describe("off (unsubscribe)", () => {
    it("should stop delivering events after off", () => {
      const bus = getEventBus();
      const handler = vi.fn();

      bus.on("power:state_changed", handler);
      bus.emit("power:state_changed", { state: "running" });
      expect(handler).toHaveBeenCalledOnce();

      bus.off("power:state_changed", handler);
      bus.emit("power:state_changed", { state: "stopped" });
      expect(handler).toHaveBeenCalledOnce(); // still 1
    });

    it("should stop delivering wildcard events after offAny", () => {
      const bus = getEventBus();
      const handler = vi.fn();

      bus.onAny(handler);
      bus.emit("mail:read", { id: "msg-1" });
      expect(handler).toHaveBeenCalledOnce();

      bus.offAny(handler);
      bus.emit("mail:read", { id: "msg-2" });
      expect(handler).toHaveBeenCalledOnce(); // still 1
    });
  });

  describe("listenerCounts", () => {
    it("should report wildcard listeners", () => {
      const bus = getEventBus();
      const handler = vi.fn();

      bus.onAny(handler);
      const counts = bus.listenerCounts();
      expect(counts["*"]).toBe(1);
    });

    it("should report specific event listeners", () => {
      const bus = getEventBus();

      bus.on("mail:received", vi.fn());
      bus.on("mail:received", vi.fn());
      bus.on("bead:created", vi.fn());

      const counts = bus.listenerCounts();
      expect(counts["mail:received"]).toBe(2);
      expect(counts["bead:created"]).toBe(1);
    });

    it("should omit events with zero listeners", () => {
      const bus = getEventBus();
      const counts = bus.listenerCounts();

      // Only "*" key should be present (with 0)
      const nonWildcardKeys = Object.keys(counts).filter((k) => k !== "*");
      expect(nonWildcardKeys).toHaveLength(0);
    });
  });

  describe("bead:assigned event", () => {
    it("should emit and receive bead:assigned events", () => {
      const bus = getEventBus();
      const handler = vi.fn();

      bus.on("bead:assigned", handler);
      bus.emit("bead:assigned", {
        beadId: "adj-052.1.3",
        agentId: "engineer-1",
        assignedBy: "work-assigner",
      });

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        {
          beadId: "adj-052.1.3",
          agentId: "engineer-1",
          assignedBy: "work-assigner",
        },
        1, // seq
      );
    });

    it("should include bead:assigned in wildcard subscription", () => {
      const bus = getEventBus();
      const handler = vi.fn();

      bus.onAny(handler);
      bus.emit("bead:assigned", {
        beadId: "adj-052.1.4",
        agentId: "engineer-2",
        assignedBy: "work-rebalancer",
      });

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        "bead:assigned",
        {
          beadId: "adj-052.1.4",
          agentId: "engineer-2",
          assignedBy: "work-rebalancer",
        },
        1, // seq
      );
    });

    it("should include bead:assigned in listener counts", () => {
      const bus = getEventBus();

      bus.on("bead:assigned", vi.fn());
      const counts = bus.listenerCounts();

      expect(counts["bead:assigned"]).toBe(1);
    });
  });

  describe("correction:detected event", () => {
    it("should emit and receive correction:detected events", () => {
      const bus = getEventBus();
      const handler = vi.fn();

      bus.on("correction:detected", handler);
      bus.emit("correction:detected", {
        messageId: "msg-123",
        from: "user",
        pattern: "no, actually",
        body: "No, actually you should use SQLite here",
      });

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        {
          messageId: "msg-123",
          from: "user",
          pattern: "no, actually",
          body: "No, actually you should use SQLite here",
        },
        1, // seq
      );
    });

    it("should include correction:detected in wildcard subscription", () => {
      const bus = getEventBus();
      const handler = vi.fn();

      bus.onAny(handler);
      bus.emit("correction:detected", {
        messageId: "msg-456",
        from: "user",
        pattern: "that's wrong",
        body: "That's wrong, use a mutex instead",
      });

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        "correction:detected",
        {
          messageId: "msg-456",
          from: "user",
          pattern: "that's wrong",
          body: "That's wrong, use a mutex instead",
        },
        1, // seq
      );
    });

    it("should include correction:detected in listener counts", () => {
      const bus = getEventBus();

      bus.on("correction:detected", vi.fn());
      const counts = bus.listenerCounts();

      expect(counts["correction:detected"]).toBe(1);
    });
  });

  describe("learning:created event", () => {
    it("should emit and receive learning:created events", () => {
      const bus = getEventBus();
      const handler = vi.fn();

      bus.on("learning:created", handler);
      bus.emit("learning:created", {
        learningId: 42,
        category: "correction",
        topic: "database",
        sourceType: "user_correction",
      });

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        {
          learningId: 42,
          category: "correction",
          topic: "database",
          sourceType: "user_correction",
        },
        1, // seq
      );
    });

    it("should include learning:created in wildcard subscription", () => {
      const bus = getEventBus();
      const handler = vi.fn();

      bus.onAny(handler);
      bus.emit("learning:created", {
        learningId: 7,
        category: "preference",
        topic: "architecture",
        sourceType: "bead_outcome",
      });

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        "learning:created",
        {
          learningId: 7,
          category: "preference",
          topic: "architecture",
          sourceType: "bead_outcome",
        },
        1, // seq
      );
    });

    it("should include learning:created in listener counts", () => {
      const bus = getEventBus();

      bus.on("learning:created", vi.fn());
      const counts = bus.listenerCounts();

      expect(counts["learning:created"]).toBe(1);
    });
  });

  describe("all event types", () => {
    it("should handle bead:updated event", () => {
      const bus = getEventBus();
      const handler = vi.fn();

      bus.on("bead:updated", handler);
      bus.emit("bead:updated", {
        id: "bead-1",
        status: "in_progress",
        title: "Fix bug",
        updatedAt: "2026-01-01T00:00:00Z",
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ id: "bead-1", status: "in_progress" }),
        1,
      );
    });

    it("should handle bead:closed event", () => {
      const bus = getEventBus();
      const handler = vi.fn();

      bus.on("bead:closed", handler);
      bus.emit("bead:closed", {
        id: "bead-1",
        title: "Done",
        closedAt: "2026-01-01T00:00:00Z",
      });

      expect(handler).toHaveBeenCalledOnce();
    });

    it("should handle agent:status_changed event", () => {
      const bus = getEventBus();
      const handler = vi.fn();

      bus.on("agent:status_changed", handler);
      bus.emit("agent:status_changed", {
        agent: "onyx",
        status: "working",
        activity: "implementing SSE",
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ agent: "onyx", status: "working" }),
        1,
      );
    });

    it("should handle stream:status event", () => {
      const bus = getEventBus();
      const handler = vi.fn();

      bus.on("stream:status", handler);
      bus.emit("stream:status", {
        streamId: "stream-1",
        agent: "onyx",
        state: "started",
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ streamId: "stream-1", state: "started" }),
        1,
      );
    });
  });
});
