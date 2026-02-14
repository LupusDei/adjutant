import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSSE } from "../../../src/hooks/useSSE";

// ============================================================================
// Mock EventSource
// ============================================================================

class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  listeners: Record<string, ((event: MessageEvent) => void)[]> = {};
  readyState = 0;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (event: MessageEvent) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(handler);
  }

  close() {
    this.closed = true;
  }

  // Helper to simulate incoming events
  simulateEvent(type: string, data: Record<string, unknown>, lastEventId?: string) {
    const handlers = this.listeners[type] ?? [];
    const event = {
      data: JSON.stringify(data),
      lastEventId: lastEventId ?? "",
    } as MessageEvent;

    for (const handler of handlers) {
      handler(event);
    }
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("useSSE", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates an EventSource connection when enabled", () => {
    renderHook(() =>
      useSSE({
        events: {},
        enabled: true,
      })
    );

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toContain("/api/events");
  });

  it("does not connect when disabled", () => {
    renderHook(() =>
      useSSE({
        events: {},
        enabled: false,
      })
    );

    expect(MockEventSource.instances).toHaveLength(0);
  });

  it("registers listeners for all SSE event types", () => {
    renderHook(() =>
      useSSE({
        events: { mode_changed: vi.fn() },
        enabled: true,
      })
    );

    const es = MockEventSource.instances[0];
    const registeredTypes = Object.keys(es.listeners);

    expect(registeredTypes).toContain("mode_changed");
    expect(registeredTypes).toContain("bead_update");
    expect(registeredTypes).toContain("agent_status");
  });

  it("dispatches events to the correct handler", () => {
    const modeHandler = vi.fn();
    const beadHandler = vi.fn();

    renderHook(() =>
      useSSE({
        events: {
          mode_changed: modeHandler,
          bead_update: beadHandler,
        },
        enabled: true,
      })
    );

    const es = MockEventSource.instances[0];

    es.simulateEvent("mode_changed", { mode: "standalone", features: ["chat"] });
    expect(modeHandler).toHaveBeenCalledWith({ mode: "standalone", features: ["chat"] });
    expect(beadHandler).not.toHaveBeenCalled();

    es.simulateEvent("bead_update", { id: "hq-123", action: "created" });
    expect(beadHandler).toHaveBeenCalledWith({ id: "hq-123", action: "created" });
  });

  it("ignores events without a registered handler", () => {
    renderHook(() =>
      useSSE({
        events: {},
        enabled: true,
      })
    );

    const es = MockEventSource.instances[0];

    // Should not throw
    es.simulateEvent("mode_changed", { mode: "standalone" });
  });

  it("closes EventSource on unmount", () => {
    const { unmount } = renderHook(() =>
      useSSE({
        events: {},
        enabled: true,
      })
    );

    const es = MockEventSource.instances[0];
    expect(es.closed).toBe(false);

    unmount();
    expect(es.closed).toBe(true);
  });

  it("handles malformed JSON gracefully", () => {
    const handler = vi.fn();

    renderHook(() =>
      useSSE({
        events: { mode_changed: handler },
        enabled: true,
      })
    );

    const es = MockEventSource.instances[0];

    // Simulate event with bad JSON
    const handlers = es.listeners["mode_changed"] ?? [];
    for (const h of handlers) {
      h({ data: "not valid json", lastEventId: "" } as MessageEvent);
    }

    // Should not throw, handler should not be called
    expect(handler).not.toHaveBeenCalled();
  });
});
