import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { ModeProvider, useModeContext } from "../../../src/contexts/ModeContext";
import type { ReactNode } from "react";

// ============================================================================
// Mocks
// ============================================================================

// Mock useSSE to avoid actual EventSource connections
vi.mock("../../../src/hooks/useSSE", () => ({
  useSSE: vi.fn(),
}));

// Track fetch calls
const mockFetch = vi.fn();

function createModeResponse(
  mode: "gastown" | "standalone" | "swarm",
  features: string[],
  availableModes?: Array<{ mode: string; available: boolean; reason?: string }>
) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        success: true,
        data: {
          mode,
          features,
          availableModes: availableModes ?? [
            { mode: "gastown", available: true },
            { mode: "standalone", available: true },
            { mode: "swarm", available: true },
          ],
        },
      }),
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return <ModeProvider>{children}</ModeProvider>;
}

// ============================================================================
// Tests
// ============================================================================

describe("ModeContext", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("initial fetch", () => {
    it("fetches mode from /api/mode on mount", async () => {
      mockFetch.mockResolvedValueOnce(
        createModeResponse("gastown", ["dashboard", "mail", "epics", "crew_hierarchy"])
      );

      const { result } = renderHook(() => useModeContext(), { wrapper });

      // Initially loading
      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.mode).toBe("gastown");
      expect(result.current.features).toContain("dashboard");
      expect(result.current.isGasTown).toBe(true);
    });

    it("sets standalone mode with correct features", async () => {
      mockFetch.mockResolvedValueOnce(
        createModeResponse("standalone", ["chat", "beads", "websocket", "sse"])
      );

      const { result } = renderHook(() => useModeContext(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.mode).toBe("standalone");
      expect(result.current.isGasTown).toBe(false);
      expect(result.current.hasPowerControl).toBe(false);
      expect(result.current.hasFeature("chat")).toBe(true);
      expect(result.current.hasFeature("dashboard")).toBe(false);
    });

    it("falls back to gastown on fetch error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const { result } = renderHook(() => useModeContext(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.mode).toBe("gastown");
      expect(result.current.error).toBe("Network error");
    });

    it("falls back to gastown when /api/mode returns non-ok", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const { result } = renderHook(() => useModeContext(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.mode).toBe("gastown");
      expect(result.current.features).toContain("power_control");
    });
  });

  describe("hasFeature", () => {
    it("returns true for features in the current mode", async () => {
      mockFetch.mockResolvedValueOnce(
        createModeResponse("swarm", ["chat", "crew_flat", "beads", "mail"])
      );

      const { result } = renderHook(() => useModeContext(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.hasFeature("crew_flat")).toBe(true);
      expect(result.current.hasFeature("mail")).toBe(true);
      expect(result.current.hasFeature("epics")).toBe(false);
      expect(result.current.hasFeature("power_control")).toBe(false);
    });
  });

  describe("switchMode", () => {
    it("switches mode via POST and updates state", async () => {
      // Initial fetch
      mockFetch.mockResolvedValueOnce(
        createModeResponse("gastown", ["dashboard", "mail", "power_control"])
      );

      const { result } = renderHook(() => useModeContext(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Mock the POST for switch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            data: {
              mode: "standalone",
              features: ["chat", "beads"],
              availableModes: [
                { mode: "gastown", available: true },
                { mode: "standalone", available: true },
                { mode: "swarm", available: true },
              ],
            },
          }),
      });

      let success: boolean;
      await act(async () => {
        success = await result.current.switchMode("standalone");
      });

      expect(success!).toBe(true);
      expect(result.current.mode).toBe("standalone");
      expect(result.current.features).toEqual(["chat", "beads"]);
    });

    it("returns false and sets error on failed switch", async () => {
      mockFetch.mockResolvedValueOnce(
        createModeResponse("standalone", ["chat", "beads"])
      );

      const { result } = renderHook(() => useModeContext(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            success: false,
            error: { message: "Gas Town infrastructure not detected" },
          }),
      });

      let success: boolean;
      await act(async () => {
        success = await result.current.switchMode("gastown");
      });

      expect(success!).toBe(false);
      expect(result.current.error).toBe("Gas Town infrastructure not detected");
      // Mode should remain unchanged
      expect(result.current.mode).toBe("standalone");
    });
  });

  describe("context requirement", () => {
    it("throws when used outside ModeProvider", () => {
      // Suppress console.error for expected error
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() => {
        renderHook(() => useModeContext());
      }).toThrow("useModeContext must be used within a ModeProvider");

      spy.mockRestore();
    });
  });
});
