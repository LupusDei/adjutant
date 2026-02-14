import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { type ReactNode } from "react";
import { CommunicationProvider, useCommunication } from "../../../src/contexts/CommunicationContext";

// =============================================================================
// Helpers
// =============================================================================

function wrapper({ children }: { children: ReactNode }) {
  return <CommunicationProvider>{children}</CommunicationProvider>;
}

// =============================================================================
// Tests
// =============================================================================

describe("CommunicationContext", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("initial state", () => {
    it("should default to real-time priority", () => {
      const { result } = renderHook(() => useCommunication(), { wrapper });
      expect(result.current.priority).toBe("real-time");
    });

    it("should set websocket as initial connection status for real-time", () => {
      const { result } = renderHook(() => useCommunication(), { wrapper });
      expect(result.current.connectionStatus).toBe("websocket");
    });

    it("should load saved priority from localStorage", () => {
      localStorage.setItem("adjutant-comm-priority", "efficient");
      const { result } = renderHook(() => useCommunication(), { wrapper });
      expect(result.current.priority).toBe("efficient");
    });

    it("should ignore invalid localStorage values", () => {
      localStorage.setItem("adjutant-comm-priority", "invalid-value");
      const { result } = renderHook(() => useCommunication(), { wrapper });
      expect(result.current.priority).toBe("real-time");
    });
  });

  describe("setPriority", () => {
    it("should update priority to efficient", async () => {
      const { result } = renderHook(() => useCommunication(), { wrapper });

      await act(async () => {
        result.current.setPriority("efficient");
      });

      expect(result.current.priority).toBe("efficient");
      expect(localStorage.getItem("adjutant-comm-priority")).toBe("efficient");
    });

    it("should update priority to polling-only", async () => {
      const { result } = renderHook(() => useCommunication(), { wrapper });

      await act(async () => {
        result.current.setPriority("polling-only");
      });

      expect(result.current.priority).toBe("polling-only");
      expect(localStorage.getItem("adjutant-comm-priority")).toBe("polling-only");
    });

    it("should update connection status when priority changes", async () => {
      const { result } = renderHook(() => useCommunication(), { wrapper });

      await act(async () => {
        result.current.setPriority("efficient");
      });
      expect(result.current.connectionStatus).toBe("sse");

      await act(async () => {
        result.current.setPriority("polling-only");
      });
      expect(result.current.connectionStatus).toBe("polling");

      await act(async () => {
        result.current.setPriority("real-time");
      });
      expect(result.current.connectionStatus).toBe("websocket");
    });

    it("should persist to localStorage", async () => {
      const { result } = renderHook(() => useCommunication(), { wrapper });

      await act(async () => {
        result.current.setPriority("polling-only");
      });

      expect(localStorage.getItem("adjutant-comm-priority")).toBe("polling-only");
    });
  });

  describe("error handling", () => {
    it("should throw when used outside provider", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(() => {
        renderHook(() => useCommunication());
      }).toThrow("useCommunication must be used within a CommunicationProvider");
      consoleSpy.mockRestore();
    });
  });
});
