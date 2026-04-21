/**
 * Tests for adj-163.2: Wake routing — deliver to correct agent.
 *
 * Verifies that the onWake callback in index.ts routes wakes to the
 * correct tmux session based on reason.targetTmuxSession, falls back
 * to the coordinator, and auto-disables schedules on dead sessions
 * or delivery failures.
 */

// Suppress logging
vi.mock("../../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { WakeReason } from "../../../src/services/adjutant/stimulus-engine.js";

// ============================================================================
// adj-163.2.1: WakeReason field propagation from setupRecurringTimer
// ============================================================================

describe("WakeReason — targetAgent fields from recurring schedule", () => {
  it("should include targetAgent in WakeReason when schedule has targetAgent", () => {
    // This test verifies the WakeReason type accepts the new fields
    const reason: WakeReason = {
      type: "recurring",
      reason: "Health check",
      targetAgent: "nova",
      targetTmuxSession: "tmux-nova-123",
      scheduleId: "sched-1",
    };

    expect(reason.targetAgent).toBe("nova");
    expect(reason.targetTmuxSession).toBe("tmux-nova-123");
    expect(reason.scheduleId).toBe("sched-1");
  });

  it("should allow WakeReason without targetAgent fields (backwards compat)", () => {
    const reason: WakeReason = {
      type: "recurring",
      reason: "Health check",
    };

    expect(reason.targetAgent).toBeUndefined();
    expect(reason.targetTmuxSession).toBeUndefined();
    expect(reason.scheduleId).toBeUndefined();
  });

  it("should allow non-recurring WakeReason types without new fields", () => {
    const criticalReason: WakeReason = {
      type: "critical",
      reason: "Build failed",
      signal: {
        id: "sig-1",
        event: "build:failed",
        data: {},
        urgency: "critical",
        timestamp: new Date(),
        count: 1,
      },
    };

    expect(criticalReason.targetAgent).toBeUndefined();
    expect(criticalReason.scheduleId).toBeUndefined();
  });
});

// ============================================================================
// adj-163.2.2 + adj-163.2.3: Wake routing logic
// These test the routing function extracted from index.ts onWake callback.
// ============================================================================

// We import the routing function that will be extracted for testability.
// The actual wiring in index.ts calls this function.
import {
  handleWakeRouting,
  type WakeRoutingDeps,
} from "../../../src/services/adjutant/wake-routing.js";

describe("handleWakeRouting", () => {
  const COORDINATOR_TMUX = "adjutant-coordinator";

  function makeDeps(overrides: Partial<WakeRoutingDeps> = {}): WakeRoutingDeps {
    return {
      coordinatorTmuxSession: COORDINATOR_TMUX,
      findByTmuxSession: vi.fn().mockReturnValue({ id: "session-1" }),
      sendInput: vi.fn().mockResolvedValue(true),
      disableSchedule: vi.fn(),
      buildCoordinatorPrompt: vi.fn().mockReturnValue("SITUATION -- full prompt here"),
      onCoordinatorSuccess: vi.fn(),
      ...overrides,
    };
  }

  // ========================================================================
  // adj-163.2.2: Non-coordinator routing
  // ========================================================================

  describe("non-coordinator wake routing", () => {
    it("should deliver [SCHEDULED REMINDER] to the target agent session", async () => {
      const deps = makeDeps();
      const reason: WakeReason = {
        type: "recurring",
        reason: "Check build status",
        targetAgent: "nova",
        targetTmuxSession: "tmux-nova-123",
        scheduleId: "sched-1",
      };

      await handleWakeRouting(reason, deps);

      expect(deps.findByTmuxSession).toHaveBeenCalledWith("tmux-nova-123");
      expect(deps.sendInput).toHaveBeenCalledWith(
        "session-1",
        "[SCHEDULED REMINDER] Check build status",
      );
    });

    it("should NOT call buildCoordinatorPrompt for non-coordinator wakes", async () => {
      const deps = makeDeps();
      const reason: WakeReason = {
        type: "recurring",
        reason: "Check status",
        targetAgent: "raynor",
        targetTmuxSession: "tmux-raynor-456",
        scheduleId: "sched-2",
      };

      await handleWakeRouting(reason, deps);

      expect(deps.buildCoordinatorPrompt).not.toHaveBeenCalled();
    });

    it("should NOT call onCoordinatorSuccess for non-coordinator wakes", async () => {
      const deps = makeDeps();
      const reason: WakeReason = {
        type: "recurring",
        reason: "Check status",
        targetAgent: "nova",
        targetTmuxSession: "tmux-nova-123",
        scheduleId: "sched-1",
      };

      await handleWakeRouting(reason, deps);

      expect(deps.onCoordinatorSuccess).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // adj-163.2.2: Coordinator backwards compatibility
  // ========================================================================

  describe("coordinator wake routing (backwards compat)", () => {
    it("should deliver full situation prompt to coordinator session", async () => {
      const deps = makeDeps();
      const reason: WakeReason = {
        type: "recurring",
        reason: "Periodic check",
      };
      // No targetTmuxSession — falls back to coordinator

      await handleWakeRouting(reason, deps);

      expect(deps.findByTmuxSession).toHaveBeenCalledWith(COORDINATOR_TMUX);
      expect(deps.buildCoordinatorPrompt).toHaveBeenCalledWith(reason);
      expect(deps.sendInput).toHaveBeenCalledWith("session-1", "SITUATION -- full prompt here");
    });

    it("should call onCoordinatorSuccess after successful coordinator delivery", async () => {
      const deps = makeDeps();
      const reason: WakeReason = {
        type: "recurring",
        reason: "Health check",
      };

      await handleWakeRouting(reason, deps);

      expect(deps.onCoordinatorSuccess).toHaveBeenCalledWith(reason);
    });

    it("should route to coordinator when targetTmuxSession matches coordinator", async () => {
      const deps = makeDeps();
      const reason: WakeReason = {
        type: "recurring",
        reason: "Coordinator schedule",
        targetTmuxSession: COORDINATOR_TMUX,
        scheduleId: "sched-coord",
      };

      await handleWakeRouting(reason, deps);

      expect(deps.buildCoordinatorPrompt).toHaveBeenCalledWith(reason);
      expect(deps.onCoordinatorSuccess).toHaveBeenCalledWith(reason);
    });

    it("should deliver coordinator prompt for critical signal wakes", async () => {
      const deps = makeDeps();
      const reason: WakeReason = {
        type: "critical",
        reason: "Build failed",
        signal: {
          id: "sig-1",
          event: "build:failed",
          data: {},
          urgency: "critical",
          timestamp: new Date(),
          count: 1,
        },
      };

      await handleWakeRouting(reason, deps);

      expect(deps.buildCoordinatorPrompt).toHaveBeenCalledWith(reason);
      expect(deps.sendInput).toHaveBeenCalledWith("session-1", "SITUATION -- full prompt here");
    });

    it("should NOT call onCoordinatorSuccess when coordinator delivery fails", async () => {
      const deps = makeDeps({
        sendInput: vi.fn().mockResolvedValue(false),
      });
      const reason: WakeReason = {
        type: "recurring",
        reason: "Health check",
      };

      await handleWakeRouting(reason, deps);

      expect(deps.onCoordinatorSuccess).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // adj-163.2.3: Auto-disable on dead session
  // ========================================================================

  describe("auto-disable on dead session", () => {
    it("should disable schedule when target session is not found", async () => {
      const deps = makeDeps({
        findByTmuxSession: vi.fn().mockReturnValue(null),
      });
      const reason: WakeReason = {
        type: "recurring",
        reason: "Check build",
        targetTmuxSession: "dead-session-xyz",
        scheduleId: "sched-dead",
      };

      await handleWakeRouting(reason, deps);

      expect(deps.disableSchedule).toHaveBeenCalledWith("sched-dead");
      expect(deps.sendInput).not.toHaveBeenCalled();
    });

    it("should NOT disable schedule for dead session when no scheduleId", async () => {
      const deps = makeDeps({
        findByTmuxSession: vi.fn().mockReturnValue(null),
      });
      const reason: WakeReason = {
        type: "scheduled",
        reason: "One-time check",
        // No scheduleId
      };

      await handleWakeRouting(reason, deps);

      expect(deps.disableSchedule).not.toHaveBeenCalled();
    });

    it("should skip delivery entirely when session is dead", async () => {
      const deps = makeDeps({
        findByTmuxSession: vi.fn().mockReturnValue(null),
      });
      const reason: WakeReason = {
        type: "recurring",
        reason: "Check build",
        targetTmuxSession: "dead-session",
        scheduleId: "sched-1",
      };

      await handleWakeRouting(reason, deps);

      expect(deps.sendInput).not.toHaveBeenCalled();
      expect(deps.buildCoordinatorPrompt).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // adj-163.2.3: Auto-disable on delivery failure
  // ========================================================================

  describe("auto-disable on delivery failure", () => {
    it("should disable schedule when sendInput returns false for non-coordinator", async () => {
      const deps = makeDeps({
        sendInput: vi.fn().mockResolvedValue(false),
      });
      const reason: WakeReason = {
        type: "recurring",
        reason: "Check status",
        targetAgent: "nova",
        targetTmuxSession: "tmux-nova-123",
        scheduleId: "sched-fail",
      };

      await handleWakeRouting(reason, deps);

      expect(deps.disableSchedule).toHaveBeenCalledWith("sched-fail");
    });

    it("should disable schedule when sendInput returns false for coordinator", async () => {
      const deps = makeDeps({
        sendInput: vi.fn().mockResolvedValue(false),
      });
      const reason: WakeReason = {
        type: "recurring",
        reason: "Health check",
        scheduleId: "sched-coord-fail",
        // Falls back to coordinator
      };

      await handleWakeRouting(reason, deps);

      expect(deps.disableSchedule).toHaveBeenCalledWith("sched-coord-fail");
    });

    it("should NOT disable when no scheduleId even if delivery fails", async () => {
      const deps = makeDeps({
        sendInput: vi.fn().mockResolvedValue(false),
      });
      const reason: WakeReason = {
        type: "critical",
        reason: "Build failed",
      };

      await handleWakeRouting(reason, deps);

      expect(deps.disableSchedule).not.toHaveBeenCalled();
    });

    it("should disable schedule when sendInput throws", async () => {
      const deps = makeDeps({
        sendInput: vi.fn().mockRejectedValue(new Error("Tmux error")),
      });
      const reason: WakeReason = {
        type: "recurring",
        reason: "Check status",
        targetAgent: "nova",
        targetTmuxSession: "tmux-nova-123",
        scheduleId: "sched-err",
      };

      await handleWakeRouting(reason, deps);

      expect(deps.disableSchedule).toHaveBeenCalledWith("sched-err");
    });
  });
});
