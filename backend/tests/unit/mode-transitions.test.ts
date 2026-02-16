import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before importing
vi.mock("../../src/services/workspace/index.js", () => ({
  getWorkspace: vi.fn(),
  resetWorkspace: vi.fn(),
  getDeploymentMode: vi.fn(),
}));
vi.mock("../../src/services/topology/index.js", () => ({
  resetTopology: vi.fn(),
}));
vi.mock("../../src/services/transport/index.js", () => ({
  resetTransport: vi.fn(),
}));
vi.mock("../../src/services/workspace/gastown-provider.js", () => ({
  isGasTownEnvironment: vi.fn(),
  isGasTownAvailable: vi.fn(),
}));
vi.mock("../../src/services/event-bus.js", () => ({
  getEventBus: vi.fn(() => ({
    emit: vi.fn(),
  })),
}));
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
}));

import { getModeInfo, switchMode } from "../../src/services/mode-service.js";
import { getWorkspace, resetWorkspace, getDeploymentMode } from "../../src/services/workspace/index.js";
import { resetTopology } from "../../src/services/topology/index.js";
import { resetTransport } from "../../src/services/transport/index.js";
import { isGasTownEnvironment, isGasTownAvailable } from "../../src/services/workspace/gastown-provider.js";
import { getEventBus } from "../../src/services/event-bus.js";
import type { DeploymentMode } from "../../src/services/workspace/index.js";

describe("mode transitions", () => {
  const originalEnv = process.env["ADJUTANT_MODE"];

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env["ADJUTANT_MODE"];
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env["ADJUTANT_MODE"] = originalEnv;
    } else {
      delete process.env["ADJUTANT_MODE"];
    }
  });

  /** Helper to set up mock for a mode transition */
  function setupTransition(from: DeploymentMode, to: DeploymentMode, gtAvailable = true) {
    const mockEmit = vi.fn();
    vi.mocked(getDeploymentMode)
      .mockReturnValueOnce(from) // initial check in switchMode
      .mockReturnValue(to); // after switch, for getModeInfo
    vi.mocked(isGasTownAvailable).mockReturnValue(gtAvailable);
    vi.mocked(getWorkspace).mockReturnValue({} as ReturnType<typeof getWorkspace>);
    vi.mocked(getEventBus).mockReturnValue({ emit: mockEmit } as unknown as ReturnType<typeof getEventBus>);
    return { mockEmit };
  }

  // ===========================================================================
  // Full cycle: all 6 directional transitions
  // ===========================================================================

  describe("all directional transitions", () => {
    const transitions: Array<{ from: DeploymentMode; to: DeploymentMode }> = [
      { from: "gastown", to: "standalone" },
      { from: "gastown", to: "swarm" },
      { from: "standalone", to: "gastown" },
      { from: "standalone", to: "swarm" },
      { from: "swarm", to: "gastown" },
      { from: "swarm", to: "standalone" },
    ];

    for (const { from, to } of transitions) {
      it(`should transition from ${from} to ${to}`, () => {
        setupTransition(from, to);

        const result = switchMode(to);

        expect(result.success).toBe(true);
        expect(result.data?.mode).toBe(to);
        expect(process.env["ADJUTANT_MODE"]).toBe(to);
      });
    }
  });

  // ===========================================================================
  // Provider reset verification (no data loss)
  // ===========================================================================

  describe("provider reset on transition", () => {
    it("should reset all three provider singletons on every transition", () => {
      const transitions: Array<[DeploymentMode, DeploymentMode]> = [
        ["gastown", "standalone"],
        ["standalone", "swarm"],
        ["swarm", "gastown"],
      ];

      for (const [from, to] of transitions) {
        vi.clearAllMocks();
        setupTransition(from, to);

        switchMode(to);

        expect(resetWorkspace).toHaveBeenCalledTimes(1);
        expect(resetTopology).toHaveBeenCalledTimes(1);
        expect(resetTransport).toHaveBeenCalledTimes(1);
      }
    });

    it("should re-initialize workspace after resetting providers", () => {
      setupTransition("standalone", "swarm");

      switchMode("swarm");

      // getWorkspace called AFTER reset to force re-init
      expect(resetWorkspace).toHaveBeenCalled();
      expect(getWorkspace).toHaveBeenCalled();

      // Verify reset happens before re-init
      const resetOrder = vi.mocked(resetWorkspace).mock.invocationCallOrder[0]!;
      const initOrder = vi.mocked(getWorkspace).mock.invocationCallOrder[0]!;
      expect(resetOrder).toBeLessThan(initOrder);
    });
  });

  // ===========================================================================
  // Feature set correctness across transitions
  // ===========================================================================

  describe("feature sets after transitions", () => {
    const expectedFeatures: Record<DeploymentMode, string[]> = {
      gastown: ["power_control", "rigs", "epics", "crew_hierarchy", "mail", "dashboard", "refinery", "witness", "websocket", "sse"],
      standalone: ["chat", "beads", "websocket", "sse"],
      swarm: ["chat", "crew_flat", "beads", "mail", "websocket", "sse"],
    };

    for (const mode of ["gastown", "standalone", "swarm"] as DeploymentMode[]) {
      it(`should have correct features after transitioning to ${mode}`, () => {
        const from = mode === "gastown" ? "standalone" : "gastown";
        setupTransition(from, mode);

        const result = switchMode(mode);

        expect(result.success).toBe(true);
        expect(result.data?.features).toEqual(expectedFeatures[mode]);
      });
    }

    it("should not leak features from previous mode", () => {
      // Transition gastown→standalone: gastown-only features must disappear
      setupTransition("gastown", "standalone");

      const result = switchMode("standalone");

      expect(result.data?.features).not.toContain("power_control");
      expect(result.data?.features).not.toContain("rigs");
      expect(result.data?.features).not.toContain("epics");
      expect(result.data?.features).not.toContain("crew_hierarchy");
      expect(result.data?.features).not.toContain("dashboard");
    });

    it("should gain features when upgrading modes", () => {
      // Transition standalone→swarm: mail and crew_flat should appear
      setupTransition("standalone", "swarm");

      const result = switchMode("swarm");

      expect(result.data?.features).toContain("mail");
      expect(result.data?.features).toContain("crew_flat");
    });
  });

  // ===========================================================================
  // SSE event emission on all transitions
  // ===========================================================================

  describe("mode:changed event emission", () => {
    it("should emit mode:changed with correct payload on every transition", () => {
      const transitions: Array<{ from: DeploymentMode; to: DeploymentMode }> = [
        { from: "gastown", to: "standalone" },
        { from: "standalone", to: "swarm" },
        { from: "swarm", to: "gastown" },
      ];

      for (const { from, to } of transitions) {
        vi.clearAllMocks();
        const { mockEmit } = setupTransition(from, to);

        switchMode(to);

        expect(mockEmit).toHaveBeenCalledWith("mode:changed", expect.objectContaining({
          mode: to,
          features: expect.any(Array),
          reason: expect.stringContaining(from),
        }));
      }
    });

    it("should not emit mode:changed on no-op switch", () => {
      vi.mocked(getDeploymentMode).mockReturnValue("standalone");
      vi.mocked(isGasTownAvailable).mockReturnValue(false);
      const mockEmit = vi.fn();
      vi.mocked(getEventBus).mockReturnValue({ emit: mockEmit } as unknown as ReturnType<typeof getEventBus>);

      switchMode("standalone");

      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Full cycle: round-trip through all 3 modes
  // ===========================================================================

  describe("full round-trip cycle", () => {
    it("should complete gastown → standalone → swarm → gastown cycle", () => {
      // Step 1: gastown → standalone
      vi.clearAllMocks();
      setupTransition("gastown", "standalone");
      let result = switchMode("standalone");
      expect(result.success).toBe(true);
      expect(result.data?.mode).toBe("standalone");

      // Step 2: standalone → swarm
      vi.clearAllMocks();
      setupTransition("standalone", "swarm");
      result = switchMode("swarm");
      expect(result.success).toBe(true);
      expect(result.data?.mode).toBe("swarm");

      // Step 3: swarm → gastown
      vi.clearAllMocks();
      setupTransition("swarm", "gastown");
      result = switchMode("gastown");
      expect(result.success).toBe(true);
      expect(result.data?.mode).toBe("gastown");
    });

    it("should complete standalone → swarm → gastown → standalone cycle", () => {
      vi.clearAllMocks();
      setupTransition("standalone", "swarm");
      let result = switchMode("swarm");
      expect(result.success).toBe(true);

      vi.clearAllMocks();
      setupTransition("swarm", "gastown");
      result = switchMode("gastown");
      expect(result.success).toBe(true);

      vi.clearAllMocks();
      setupTransition("gastown", "standalone");
      result = switchMode("standalone");
      expect(result.success).toBe(true);
      expect(result.data?.mode).toBe("standalone");
    });
  });

  // ===========================================================================
  // Transition availability constraints
  // ===========================================================================

  describe("transition availability", () => {
    it("should always list standalone and swarm as available from any mode", () => {
      for (const mode of ["gastown", "standalone", "swarm"] as DeploymentMode[]) {
        vi.clearAllMocks();
        vi.mocked(getDeploymentMode).mockReturnValue(mode);
        vi.mocked(isGasTownAvailable).mockReturnValue(true);

        const info = getModeInfo();

        const standalone = info.availableModes.find(m => m.mode === "standalone");
        const swarm = info.availableModes.find(m => m.mode === "swarm");
        expect(standalone?.available).toBe(true);
        expect(swarm?.available).toBe(true);
      }
    });

    it("should block gastown transition when GT infrastructure is missing", () => {
      vi.mocked(getDeploymentMode).mockReturnValue("standalone");
      vi.mocked(isGasTownAvailable).mockReturnValue(false);

      const result = switchMode("gastown");

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("MODE_UNAVAILABLE");
      // Providers should NOT have been reset
      expect(resetWorkspace).not.toHaveBeenCalled();
      expect(resetTopology).not.toHaveBeenCalled();
      expect(resetTransport).not.toHaveBeenCalled();
    });

    it("should block gastown transition from swarm when GT infrastructure is missing", () => {
      vi.mocked(getDeploymentMode).mockReturnValue("swarm");
      vi.mocked(isGasTownAvailable).mockReturnValue(false);

      const result = switchMode("gastown");

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("MODE_UNAVAILABLE");
    });

    it("should include reason when gastown is unavailable", () => {
      vi.mocked(getDeploymentMode).mockReturnValue("standalone");
      vi.mocked(isGasTownAvailable).mockReturnValue(false);

      const info = getModeInfo();

      const gtMode = info.availableModes.find(m => m.mode === "gastown");
      expect(gtMode?.available).toBe(false);
      expect(gtMode?.reason).toBeDefined();
      expect(gtMode?.reason).toContain("infrastructure not detected");
    });
  });

  // ===========================================================================
  // Environment variable integrity
  // ===========================================================================

  describe("environment variable management", () => {
    it("should update ADJUTANT_MODE env var on each transition step", () => {
      // Step 1
      setupTransition("gastown", "standalone");
      switchMode("standalone");
      expect(process.env["ADJUTANT_MODE"]).toBe("standalone");

      // Step 2
      vi.clearAllMocks();
      setupTransition("standalone", "swarm");
      switchMode("swarm");
      expect(process.env["ADJUTANT_MODE"]).toBe("swarm");

      // Step 3
      vi.clearAllMocks();
      setupTransition("swarm", "gastown");
      switchMode("gastown");
      expect(process.env["ADJUTANT_MODE"]).toBe("gastown");
    });

    it("should not modify ADJUTANT_MODE on failed transition", () => {
      process.env["ADJUTANT_MODE"] = "standalone";
      vi.mocked(getDeploymentMode).mockReturnValue("standalone");
      vi.mocked(isGasTownAvailable).mockReturnValue(false);

      switchMode("gastown"); // fails - GT not available

      expect(process.env["ADJUTANT_MODE"]).toBe("standalone");
    });

    it("should not modify ADJUTANT_MODE on no-op transition", () => {
      process.env["ADJUTANT_MODE"] = "standalone";
      vi.mocked(getDeploymentMode).mockReturnValue("standalone");
      vi.mocked(isGasTownAvailable).mockReturnValue(false);

      switchMode("standalone"); // no-op

      expect(process.env["ADJUTANT_MODE"]).toBe("standalone");
    });
  });
});
