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

describe("mode-service", () => {
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

  // ===========================================================================
  // getModeInfo
  // ===========================================================================

  describe("getModeInfo", () => {
    it("should return gastown mode info with all features", () => {
      vi.mocked(getDeploymentMode).mockReturnValue("gastown");
      vi.mocked(isGasTownAvailable).mockReturnValue(true);

      const info = getModeInfo();

      expect(info.mode).toBe("gastown");
      expect(info.features).toContain("power_control");
      expect(info.features).toContain("rigs");
      expect(info.features).toContain("websocket");
      expect(info.features).toContain("sse");
    });

    it("should return swarm mode info with swarm features", () => {
      vi.mocked(getDeploymentMode).mockReturnValue("swarm");
      vi.mocked(isGasTownAvailable).mockReturnValue(false);

      const info = getModeInfo();

      expect(info.mode).toBe("swarm");
      expect(info.features).toContain("crew_flat");
      expect(info.features).toContain("mail");
      expect(info.features).not.toContain("power_control");
    });

    it("should mark gastown as available when GT environment detected", () => {
      vi.mocked(getDeploymentMode).mockReturnValue("swarm");
      vi.mocked(isGasTownAvailable).mockReturnValue(true);

      const info = getModeInfo();

      const gtMode = info.availableModes.find((m) => m.mode === "gastown");
      expect(gtMode?.available).toBe(true);
      expect(gtMode?.reason).toBeUndefined();
    });

    it("should mark gastown as unavailable when GT environment not detected", () => {
      vi.mocked(getDeploymentMode).mockReturnValue("swarm");
      vi.mocked(isGasTownAvailable).mockReturnValue(false);

      const info = getModeInfo();

      const gtMode = info.availableModes.find((m) => m.mode === "gastown");
      expect(gtMode?.available).toBe(false);
      expect(gtMode?.reason).toContain("Gas Town infrastructure not detected");
    });

    it("should always mark swarm as available", () => {
      vi.mocked(getDeploymentMode).mockReturnValue("gastown");
      vi.mocked(isGasTownAvailable).mockReturnValue(true);

      const info = getModeInfo();

      const swarm = info.availableModes.find((m) => m.mode === "swarm");
      expect(swarm?.available).toBe(true);
    });
  });

  // ===========================================================================
  // switchMode
  // ===========================================================================

  describe("switchMode", () => {
    it("should no-op when switching to the same mode", () => {
      vi.mocked(getDeploymentMode).mockReturnValue("swarm");
      vi.mocked(isGasTownAvailable).mockReturnValue(false);

      const result = switchMode("swarm");

      expect(result.success).toBe(true);
      expect(result.data?.mode).toBe("swarm");
      // Should not reset providers
      expect(resetWorkspace).not.toHaveBeenCalled();
      expect(resetTopology).not.toHaveBeenCalled();
      expect(resetTransport).not.toHaveBeenCalled();
    });

    it("should switch from gastown to swarm successfully", () => {
      vi.mocked(getDeploymentMode)
        .mockReturnValueOnce("gastown") // initial check
        .mockReturnValue("swarm"); // after switch
      vi.mocked(isGasTownAvailable).mockReturnValue(true);
      vi.mocked(getWorkspace).mockReturnValue({} as ReturnType<typeof getWorkspace>);

      const mockEmit = vi.fn();
      vi.mocked(getEventBus).mockReturnValue({ emit: mockEmit } as unknown as ReturnType<typeof getEventBus>);

      const result = switchMode("swarm");

      expect(result.success).toBe(true);
      expect(process.env["ADJUTANT_MODE"]).toBe("swarm");
      expect(resetWorkspace).toHaveBeenCalled();
      expect(resetTopology).toHaveBeenCalled();
      expect(resetTransport).toHaveBeenCalled();
      expect(getWorkspace).toHaveBeenCalled();
    });

    it("should emit mode:changed event on successful switch", () => {
      vi.mocked(getDeploymentMode)
        .mockReturnValueOnce("gastown")
        .mockReturnValue("swarm");
      vi.mocked(isGasTownAvailable).mockReturnValue(true);
      vi.mocked(getWorkspace).mockReturnValue({} as ReturnType<typeof getWorkspace>);

      const mockEmit = vi.fn();
      vi.mocked(getEventBus).mockReturnValue({ emit: mockEmit } as unknown as ReturnType<typeof getEventBus>);

      switchMode("swarm");

      expect(mockEmit).toHaveBeenCalledWith("mode:changed", expect.objectContaining({
        mode: "swarm",
        features: expect.any(Array),
        reason: expect.stringContaining("gastown"),
      }));
    });

    it("should reject switching to gastown when GT environment not available", () => {
      vi.mocked(getDeploymentMode).mockReturnValue("swarm");
      vi.mocked(isGasTownAvailable).mockReturnValue(false);

      const result = switchMode("gastown");

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("MODE_UNAVAILABLE");
      expect(result.error?.message).toContain("Cannot switch to Gas Town mode");
    });

    it("should allow switching to gastown when GT environment is available", () => {
      vi.mocked(getDeploymentMode)
        .mockReturnValueOnce("swarm")
        .mockReturnValue("gastown");
      vi.mocked(isGasTownAvailable).mockReturnValue(true);
      vi.mocked(getWorkspace).mockReturnValue({} as ReturnType<typeof getWorkspace>);

      const mockEmit = vi.fn();
      vi.mocked(getEventBus).mockReturnValue({ emit: mockEmit } as unknown as ReturnType<typeof getEventBus>);

      const result = switchMode("gastown");

      expect(result.success).toBe(true);
      expect(process.env["ADJUTANT_MODE"]).toBe("gastown");
    });

    it("should reject invalid mode", () => {
      vi.mocked(getDeploymentMode).mockReturnValue("swarm");

      const result = switchMode("invalid" as "gastown");

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_MODE");
    });

    it("should set ADJUTANT_MODE env var on switch", () => {
      vi.mocked(getDeploymentMode)
        .mockReturnValueOnce("gastown")
        .mockReturnValue("swarm");
      vi.mocked(isGasTownAvailable).mockReturnValue(true);
      vi.mocked(getWorkspace).mockReturnValue({} as ReturnType<typeof getWorkspace>);

      const mockEmit = vi.fn();
      vi.mocked(getEventBus).mockReturnValue({ emit: mockEmit } as unknown as ReturnType<typeof getEventBus>);

      switchMode("swarm");

      expect(process.env["ADJUTANT_MODE"]).toBe("swarm");
    });
  });
});
