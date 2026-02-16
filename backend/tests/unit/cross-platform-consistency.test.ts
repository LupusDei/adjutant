/**
 * Cross-platform consistency tests (Phase 5.3).
 *
 * Verifies that the backend mode API contract matches what both iOS and Frontend
 * clients expect. Both clients derive their tab visibility and feature sets from
 * the same GET /api/mode response, so the backend response structure is the
 * source of truth.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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
import {
  getWorkspace,
  getDeploymentMode,
} from "../../src/services/workspace/index.js";
import { isGasTownEnvironment, isGasTownAvailable } from "../../src/services/workspace/gastown-provider.js";
import { getEventBus } from "../../src/services/event-bus.js";
import type { DeploymentMode } from "../../src/services/workspace/index.js";

// =============================================================================
// Tab visibility rules (must match iOS DeploymentMode.visibleTabs and
// Frontend useVisibleTabs)
// =============================================================================

const EXPECTED_VISIBLE_TABS: Record<DeploymentMode, string[]> = {
  gastown: [
    "dashboard",
    "mail",
    "chat",
    "epics",
    "crew",
    "beads",
    "settings",
  ],
  standalone: ["chat", "beads", "settings"],
  swarm: ["chat", "crew", "beads", "settings"],
};

// =============================================================================
// Feature maps (must match backend MODE_FEATURES)
// =============================================================================

const EXPECTED_FEATURES: Record<DeploymentMode, string[]> = {
  gastown: [
    "power_control",
    "rigs",
    "epics",
    "crew_hierarchy",
    "mail",
    "dashboard",
    "refinery",
    "witness",
    "websocket",
    "sse",
  ],
  standalone: ["chat", "beads", "websocket", "sse"],
  swarm: ["chat", "crew_flat", "beads", "mail", "websocket", "sse"],
};

describe("cross-platform consistency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Tab visibility consistency
  // ===========================================================================

  describe("tab visibility rules match across platforms", () => {
    it.each(["gastown", "standalone", "swarm"] as DeploymentMode[])(
      "should return correct features for %s mode (iOS and Frontend derive tabs from these)",
      (mode) => {
        vi.mocked(getDeploymentMode).mockReturnValue(mode);
        vi.mocked(isGasTownAvailable).mockReturnValue(mode === "gastown");

        const info = getModeInfo();

        expect(info.mode).toBe(mode);
        expect(info.features).toEqual(EXPECTED_FEATURES[mode]);
      }
    );

    it("gastown mode should include features that map to all 7 tabs", () => {
      vi.mocked(getDeploymentMode).mockReturnValue("gastown");
      vi.mocked(isGasTownAvailable).mockReturnValue(true);

      const info = getModeInfo();

      // These features determine tab visibility on both platforms
      expect(info.features).toContain("dashboard"); // → dashboard tab
      expect(info.features).toContain("mail"); // → mail tab
      expect(info.features).toContain("epics"); // → epics tab
      expect(info.features).toContain("crew_hierarchy"); // → crew tab
    });

    it("standalone mode should NOT include dashboard, mail, epics, or crew features", () => {
      vi.mocked(getDeploymentMode).mockReturnValue("standalone");
      vi.mocked(isGasTownAvailable).mockReturnValue(false);

      const info = getModeInfo();

      expect(info.features).not.toContain("dashboard");
      expect(info.features).not.toContain("mail");
      expect(info.features).not.toContain("epics");
      expect(info.features).not.toContain("crew_hierarchy");
      expect(info.features).not.toContain("crew_flat");
    });

    it("swarm mode should include crew_flat but NOT dashboard or epics", () => {
      vi.mocked(getDeploymentMode).mockReturnValue("swarm");
      vi.mocked(isGasTownAvailable).mockReturnValue(false);

      const info = getModeInfo();

      expect(info.features).toContain("crew_flat");
      expect(info.features).toContain("mail");
      expect(info.features).not.toContain("dashboard");
      expect(info.features).not.toContain("epics");
      expect(info.features).not.toContain("crew_hierarchy");
    });
  });

  // ===========================================================================
  // SSE mode_changed event contract
  // ===========================================================================

  describe("mode_changed SSE event contract", () => {
    it("should emit mode_changed event with mode and features on switch", () => {
      vi.mocked(getDeploymentMode)
        .mockReturnValueOnce("gastown")
        .mockReturnValue("standalone");
      vi.mocked(isGasTownAvailable).mockReturnValue(true);
      vi.mocked(getWorkspace).mockReturnValue(
        {} as ReturnType<typeof getWorkspace>
      );

      const mockEmit = vi.fn();
      vi.mocked(getEventBus).mockReturnValue({
        emit: mockEmit,
      } as unknown as ReturnType<typeof getEventBus>);

      switchMode("standalone");

      expect(mockEmit).toHaveBeenCalledWith("mode:changed", {
        mode: "standalone",
        features: EXPECTED_FEATURES["standalone"],
        reason: expect.stringContaining("gastown"),
      });
    });

    it("mode_changed event should contain the same features as getModeInfo", () => {
      vi.mocked(getDeploymentMode)
        .mockReturnValueOnce("standalone")
        .mockReturnValue("swarm");
      vi.mocked(isGasTownAvailable).mockReturnValue(false);
      vi.mocked(getWorkspace).mockReturnValue(
        {} as ReturnType<typeof getWorkspace>
      );

      const mockEmit = vi.fn();
      vi.mocked(getEventBus).mockReturnValue({
        emit: mockEmit,
      } as unknown as ReturnType<typeof getEventBus>);

      const result = switchMode("swarm");

      // The SSE event features should match the returned mode info features
      const emittedEvent = mockEmit.mock.calls[0]?.[1];
      expect(emittedEvent.features).toEqual(result.data?.features);
    });

    it("should NOT emit mode_changed when switching to the same mode", () => {
      vi.mocked(getDeploymentMode).mockReturnValue("standalone");
      vi.mocked(isGasTownAvailable).mockReturnValue(false);

      const mockEmit = vi.fn();
      vi.mocked(getEventBus).mockReturnValue({
        emit: mockEmit,
      } as unknown as ReturnType<typeof getEventBus>);

      switchMode("standalone");

      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Mode API response structure
  // ===========================================================================

  describe("mode API response matches client expectations", () => {
    it("response should have mode, features, and availableModes fields", () => {
      vi.mocked(getDeploymentMode).mockReturnValue("gastown");
      vi.mocked(isGasTownAvailable).mockReturnValue(true);

      const info = getModeInfo();

      // Both iOS ModeInfo and Frontend ModeApiResponse expect these fields
      expect(info).toHaveProperty("mode");
      expect(info).toHaveProperty("features");
      expect(info).toHaveProperty("availableModes");
      expect(typeof info.mode).toBe("string");
      expect(Array.isArray(info.features)).toBe(true);
      expect(Array.isArray(info.availableModes)).toBe(true);
    });

    it("availableModes should have mode, available, and optional reason fields", () => {
      vi.mocked(getDeploymentMode).mockReturnValue("standalone");
      vi.mocked(isGasTownAvailable).mockReturnValue(false);

      const info = getModeInfo();

      for (const available of info.availableModes) {
        expect(available).toHaveProperty("mode");
        expect(available).toHaveProperty("available");
        expect(typeof available.mode).toBe("string");
        expect(typeof available.available).toBe("boolean");
        if (!available.available) {
          expect(typeof available.reason).toBe("string");
        }
      }
    });

    it("availableModes should always include all three modes", () => {
      vi.mocked(getDeploymentMode).mockReturnValue("standalone");
      vi.mocked(isGasTownAvailable).mockReturnValue(false);

      const info = getModeInfo();

      const modes = info.availableModes.map((m) => m.mode);
      expect(modes).toContain("gastown");
      expect(modes).toContain("standalone");
      expect(modes).toContain("swarm");
    });
  });

  // ===========================================================================
  // Mode value consistency (same string values across platforms)
  // ===========================================================================

  describe("mode identifier consistency", () => {
    it('should use "gastown" (not "gas_town" or "GT") as the mode identifier', () => {
      vi.mocked(getDeploymentMode).mockReturnValue("gastown");
      vi.mocked(isGasTownAvailable).mockReturnValue(true);

      const info = getModeInfo();
      expect(info.mode).toBe("gastown");
    });

    it('should use "standalone" (not "single_agent" or "single") as the mode identifier', () => {
      vi.mocked(getDeploymentMode).mockReturnValue("standalone");
      vi.mocked(isGasTownAvailable).mockReturnValue(false);

      const info = getModeInfo();
      expect(info.mode).toBe("standalone");
    });

    it('should use "swarm" as the mode identifier', () => {
      vi.mocked(getDeploymentMode).mockReturnValue("swarm");
      vi.mocked(isGasTownAvailable).mockReturnValue(false);

      const info = getModeInfo();
      expect(info.mode).toBe("swarm");
    });
  });
});
