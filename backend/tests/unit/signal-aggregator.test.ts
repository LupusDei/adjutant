import { describe, it, expect, vi, beforeEach } from "vitest";

import { SignalAggregator } from "../../src/services/adjutant/signal-aggregator.js";
import type { Signal } from "../../src/services/adjutant/signal-aggregator.js";

describe("SignalAggregator", () => {
  let aggregator: SignalAggregator;

  beforeEach(() => {
    aggregator = new SignalAggregator();
  });

  describe("spawn_failed classification", () => {
    it("should classify agent:spawn_failed as critical", () => {
      const criticalSignals: Signal[] = [];
      aggregator.onCritical((signal) => criticalSignals.push(signal));

      aggregator.ingest("agent:spawn_failed", {
        agentId: "test-agent",
        reason: "no_mcp_connect",
        tmuxSession: "adj-swarm-test-agent",
      });

      expect(criticalSignals).toHaveLength(1);
      expect(criticalSignals[0].event).toBe("agent:spawn_failed");
      expect(criticalSignals[0].urgency).toBe("critical");
    });

    it("should pass correct payload to critical callback", () => {
      const criticalSignals: Signal[] = [];
      aggregator.onCritical((signal) => criticalSignals.push(signal));

      const payload = {
        agentId: "test-agent",
        reason: "no_mcp_connect",
        tmuxSession: "adj-swarm-test-agent",
      };

      aggregator.ingest("agent:spawn_failed", payload);

      expect(criticalSignals).toHaveLength(1);
      expect(criticalSignals[0].data).toEqual(payload);
      expect(criticalSignals[0].urgency).toBe("critical");
      expect(criticalSignals[0].id).toBeTruthy();
      expect(criticalSignals[0].timestamp).toBeInstanceOf(Date);
    });

    it("should NOT buffer spawn_failed in context snapshot", () => {
      aggregator.onCritical(() => {}); // register callback so it fires

      aggregator.ingest("agent:spawn_failed", {
        agentId: "test-agent",
        reason: "no_mcp_connect",
      });

      const snapshot = aggregator.snapshot();
      expect(snapshot["agent:spawn_failed"]).toBeUndefined();
      expect(aggregator.bufferSize()).toBe(0);
    });
  });

  describe("other critical events still work (regression)", () => {
    it("should classify build:failed as critical", () => {
      const criticalSignals: Signal[] = [];
      aggregator.onCritical((signal) => criticalSignals.push(signal));

      aggregator.ingest("build:failed", { branch: "main" });

      expect(criticalSignals).toHaveLength(1);
      expect(criticalSignals[0].urgency).toBe("critical");
    });

    it("should classify mcp:agent_disconnected as critical", () => {
      const criticalSignals: Signal[] = [];
      aggregator.onCritical((signal) => criticalSignals.push(signal));

      aggregator.ingest("mcp:agent_disconnected", { agentId: "some-agent" });

      expect(criticalSignals).toHaveLength(1);
      expect(criticalSignals[0].urgency).toBe("critical");
    });

    it("should classify merge:conflict as critical", () => {
      const criticalSignals: Signal[] = [];
      aggregator.onCritical((signal) => criticalSignals.push(signal));

      aggregator.ingest("merge:conflict", { branch: "feature-x" });

      expect(criticalSignals).toHaveLength(1);
      expect(criticalSignals[0].urgency).toBe("critical");
    });
  });

  describe("context events buffer correctly", () => {
    it("should classify bead:updated as context and buffer it", () => {
      const criticalSignals: Signal[] = [];
      aggregator.onCritical((signal) => criticalSignals.push(signal));

      aggregator.ingest("bead:updated", { id: "adj-001", status: "in_progress" });

      expect(criticalSignals).toHaveLength(0);
      const snapshot = aggregator.snapshot();
      expect(snapshot["bead:updated"]).toHaveLength(1);
      expect(snapshot["bead:updated"][0].urgency).toBe("context");
    });

    it("should classify non-blocked agent:status_changed as context", () => {
      const criticalSignals: Signal[] = [];
      aggregator.onCritical((signal) => criticalSignals.push(signal));

      aggregator.ingest("agent:status_changed", {
        agentId: "test-agent",
        status: "working",
      });

      expect(criticalSignals).toHaveLength(0);
      const snapshot = aggregator.snapshot();
      expect(snapshot["agent:status_changed"]).toHaveLength(1);
      expect(snapshot["agent:status_changed"][0].urgency).toBe("context");
    });
  });
});
