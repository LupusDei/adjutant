import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGastownStatus } from "../../../src/hooks/useGastownStatus";
import { api } from "../../../src/services/api";
import type { GastownStatus, PowerState } from "../../../src/types";

// Mock the API module
vi.mock("../../../src/services/api", () => ({
  api: {
    getStatus: vi.fn(),
    power: {
      up: vi.fn(),
      down: vi.fn(),
    },
  },
}));

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockAgentStatus(overrides: Partial<GastownStatus["infrastructure"]["mayor"]> = {}) {
  return {
    name: "test-agent",
    running: true,
    unreadMail: 0,
    state: "idle" as const,
    ...overrides,
  };
}

function createMockGastownStatus(overrides: Partial<GastownStatus> = {}): GastownStatus {
  return {
    powerState: "running",
    town: {
      name: "test-town",
      root: "/path/to/town",
    },
    operator: {
      name: "Test User",
      email: "test@example.com",
      unreadMail: 0,
    },
    infrastructure: {
      mayor: createMockAgentStatus({ name: "mayor" }),
      deacon: createMockAgentStatus({ name: "deacon" }),
      daemon: createMockAgentStatus({ name: "daemon" }),
    },
    rigs: [],
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("useGastownStatus", () => {
  const mockGetStatus = api.getStatus as ReturnType<typeof vi.fn>;
  const mockPowerUp = api.power.up as ReturnType<typeof vi.fn>;
  const mockPowerDown = api.power.down as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ===========================================================================
  // Initial State & Fetching
  // ===========================================================================

  describe("initial state and fetching", () => {
    it("should fetch status immediately on mount", async () => {
      const mockStatus = createMockGastownStatus();
      mockGetStatus.mockResolvedValue(mockStatus);

      const { result } = renderHook(() => useGastownStatus());

      expect(result.current.loading).toBe(true);
      expect(mockGetStatus).toHaveBeenCalledTimes(1);

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.status).toEqual(mockStatus);
      expect(result.current.error).toBeNull();
    });

    it("should start with null status", () => {
      mockGetStatus.mockResolvedValue(createMockGastownStatus());

      const { result } = renderHook(() => useGastownStatus());

      // Before fetch resolves, status should be null
      expect(result.current.status).toBeNull();
    });

    it("should expose power state directly", async () => {
      const mockStatus = createMockGastownStatus({ powerState: "starting" });
      mockGetStatus.mockResolvedValue(mockStatus);

      const { result } = renderHook(() => useGastownStatus());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.powerState).toBe("starting");
    });

    it("should expose isRunning convenience boolean", async () => {
      mockGetStatus.mockResolvedValue(createMockGastownStatus({ powerState: "running" }));

      const { result } = renderHook(() => useGastownStatus());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.isRunning).toBe(true);
    });

    it("should return isRunning as false for non-running states", async () => {
      mockGetStatus.mockResolvedValue(createMockGastownStatus({ powerState: "stopped" }));

      const { result } = renderHook(() => useGastownStatus());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.isRunning).toBe(false);
    });
  });

  // ===========================================================================
  // Polling Behavior
  // ===========================================================================

  describe("polling", () => {
    it("should poll for status at specified interval", async () => {
      const mockStatus = createMockGastownStatus();
      mockGetStatus.mockResolvedValue(mockStatus);

      const pollInterval = 5000; // 5 seconds (status updates need to be faster than mail)
      const { result } = renderHook(() => useGastownStatus({ pollInterval }));

      // Wait for initial fetch
      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.loading).toBe(false);
      expect(mockGetStatus).toHaveBeenCalledTimes(1);

      // Advance to first poll
      await act(async () => {
        vi.advanceTimersByTime(pollInterval);
        await Promise.resolve();
      });

      expect(mockGetStatus).toHaveBeenCalledTimes(2);

      // Advance to second poll
      await act(async () => {
        vi.advanceTimersByTime(pollInterval);
        await Promise.resolve();
      });

      expect(mockGetStatus).toHaveBeenCalledTimes(3);
    });

    it("should use default poll interval of 10 seconds", async () => {
      mockGetStatus.mockResolvedValue(createMockGastownStatus());

      renderHook(() => useGastownStatus());

      await act(async () => {
        await Promise.resolve();
      });
      expect(mockGetStatus).toHaveBeenCalledTimes(1);

      // Advance by less than default (10s)
      vi.advanceTimersByTime(9000);
      expect(mockGetStatus).toHaveBeenCalledTimes(1);

      // Advance past default interval
      await act(async () => {
        vi.advanceTimersByTime(1000);
        await Promise.resolve();
      });

      expect(mockGetStatus).toHaveBeenCalledTimes(2);
    });

    it("should stop polling when enabled is false", async () => {
      mockGetStatus.mockResolvedValue(createMockGastownStatus());

      renderHook(() => useGastownStatus({ enabled: false }));

      expect(mockGetStatus).not.toHaveBeenCalled();

      // Advance timers - should still not fetch
      vi.advanceTimersByTime(60000);
      expect(mockGetStatus).not.toHaveBeenCalled();
    });

    it("should cleanup polling on unmount", async () => {
      mockGetStatus.mockResolvedValue(createMockGastownStatus());

      const { unmount } = renderHook(() => useGastownStatus({ pollInterval: 10000 }));

      await act(async () => {
        await Promise.resolve();
      });
      expect(mockGetStatus).toHaveBeenCalledTimes(1);

      unmount();

      // Advance timers after unmount
      vi.advanceTimersByTime(30000);

      expect(mockGetStatus).toHaveBeenCalledTimes(1);
    });

    it("should update status when poll returns new data", async () => {
      const initialStatus = createMockGastownStatus({ powerState: "stopped" });
      const updatedStatus = createMockGastownStatus({ powerState: "running" });

      mockGetStatus
        .mockResolvedValueOnce(initialStatus)
        .mockResolvedValueOnce(updatedStatus);

      const { result } = renderHook(() => useGastownStatus({ pollInterval: 1000 }));

      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.powerState).toBe("stopped");

      // Advance to poll
      await act(async () => {
        vi.advanceTimersByTime(1000);
        await Promise.resolve();
      });

      expect(result.current.powerState).toBe("running");
    });
  });

  // ===========================================================================
  // Manual Refresh
  // ===========================================================================

  describe("manual refresh", () => {
    it("should allow manual refresh", async () => {
      mockGetStatus.mockResolvedValue(createMockGastownStatus());

      const { result } = renderHook(() => useGastownStatus());

      await act(async () => {
        await Promise.resolve();
      });
      expect(mockGetStatus).toHaveBeenCalledTimes(1);

      await act(async () => {
        await result.current.refresh();
      });

      expect(mockGetStatus).toHaveBeenCalledTimes(2);
    });

    it("should update status on refresh", async () => {
      const initialStatus = createMockGastownStatus({ powerState: "stopped" });
      const refreshedStatus = createMockGastownStatus({ powerState: "starting" });

      mockGetStatus
        .mockResolvedValueOnce(initialStatus)
        .mockResolvedValueOnce(refreshedStatus);

      const { result } = renderHook(() => useGastownStatus());

      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.powerState).toBe("stopped");

      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.powerState).toBe("starting");
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe("error handling", () => {
    it("should handle fetch errors", async () => {
      const error = new Error("Network error");
      mockGetStatus.mockRejectedValue(error);

      const { result } = renderHook(() => useGastownStatus());

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve(); // Extra tick for catch block
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.status).toBeNull();
      expect(result.current.error).toEqual(error);
    });

    it("should clear error on successful fetch", async () => {
      const error = new Error("Temporary error");
      mockGetStatus
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(createMockGastownStatus());

      const { result } = renderHook(() => useGastownStatus({ pollInterval: 1000 }));

      // Wait for first fetch (error)
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.error).toEqual(error);

      // Trigger next poll
      await act(async () => {
        vi.advanceTimersByTime(1000);
        await Promise.resolve();
      });

      expect(result.current.error).toBeNull();
    });

    it("should preserve existing status on fetch error", async () => {
      const validStatus = createMockGastownStatus();
      mockGetStatus
        .mockResolvedValueOnce(validStatus)
        .mockRejectedValueOnce(new Error("Fetch failed"));

      const { result } = renderHook(() => useGastownStatus({ pollInterval: 1000 }));

      // Wait for successful initial fetch
      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.status).toEqual(validStatus);

      // Trigger failed poll
      await act(async () => {
        vi.advanceTimersByTime(1000);
        await Promise.resolve();
        await Promise.resolve();
      });

      // Status should be preserved despite error
      expect(result.current.status).toEqual(validStatus);
      expect(result.current.error).not.toBeNull();
    });

    it("should expose isConnected based on error state", async () => {
      mockGetStatus.mockRejectedValue(new Error("Connection failed"));

      const { result } = renderHook(() => useGastownStatus());

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.isConnected).toBe(false);
    });

    it("should set isConnected to true on successful fetch", async () => {
      mockGetStatus.mockResolvedValue(createMockGastownStatus());

      const { result } = renderHook(() => useGastownStatus());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.isConnected).toBe(true);
    });
  });

  // ===========================================================================
  // Power Operations
  // ===========================================================================

  describe("power up", () => {
    it("should call power up API", async () => {
      mockGetStatus.mockResolvedValue(createMockGastownStatus({ powerState: "stopped" }));
      mockPowerUp.mockResolvedValue({ previousState: "stopped", newState: "starting" });

      const { result } = renderHook(() => useGastownStatus());

      await act(async () => {
        await Promise.resolve();
      });

      await act(async () => {
        await result.current.powerUp();
      });

      expect(mockPowerUp).toHaveBeenCalledTimes(1);
    });

    it("should set poweringUp state during operation", async () => {
      mockGetStatus.mockResolvedValue(createMockGastownStatus({ powerState: "stopped" }));

      let resolvePowerUp: (value: { previousState: PowerState; newState: PowerState }) => void = () => {};
      mockPowerUp.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePowerUp = resolve;
          })
      );

      const { result } = renderHook(() => useGastownStatus());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.poweringUp).toBe(false);

      let powerPromise: Promise<void>;
      act(() => {
        powerPromise = result.current.powerUp();
      });

      expect(result.current.poweringUp).toBe(true);

      await act(async () => {
        resolvePowerUp({ previousState: "stopped", newState: "starting" });
        await powerPromise;
      });

      expect(result.current.poweringUp).toBe(false);
    });

    it("should refresh status after power up", async () => {
      const stoppedStatus = createMockGastownStatus({ powerState: "stopped" });
      const startingStatus = createMockGastownStatus({ powerState: "starting" });

      mockGetStatus
        .mockResolvedValueOnce(stoppedStatus)
        .mockResolvedValueOnce(startingStatus);
      mockPowerUp.mockResolvedValue({ previousState: "stopped", newState: "starting" });

      const { result } = renderHook(() => useGastownStatus());

      await act(async () => {
        await Promise.resolve();
      });
      expect(mockGetStatus).toHaveBeenCalledTimes(1);

      await act(async () => {
        await result.current.powerUp();
      });

      // Should have triggered a refresh
      expect(mockGetStatus).toHaveBeenCalledTimes(2);
      expect(result.current.powerState).toBe("starting");
    });

    it("should handle power up errors", async () => {
      mockGetStatus.mockResolvedValue(createMockGastownStatus({ powerState: "stopped" }));
      const powerError = new Error("Failed to start");
      mockPowerUp.mockRejectedValue(powerError);

      const { result } = renderHook(() => useGastownStatus());

      await act(async () => {
        await Promise.resolve();
      });

      // Catch error inside act() to ensure state updates are flushed
      let caughtError: Error | null = null;
      await act(async () => {
        try {
          await result.current.powerUp();
        } catch (err) {
          caughtError = err as Error;
        }
      });

      expect(caughtError?.message).toBe("Failed to start");
      expect(result.current.powerError).toEqual(powerError);
      expect(result.current.poweringUp).toBe(false);
    });

    it("should clear power error on successful operation", async () => {
      mockGetStatus.mockResolvedValue(createMockGastownStatus({ powerState: "stopped" }));
      const powerError = new Error("First attempt failed");
      mockPowerUp
        .mockRejectedValueOnce(powerError)
        .mockResolvedValueOnce({ previousState: "stopped", newState: "starting" });

      const { result } = renderHook(() => useGastownStatus());

      await act(async () => {
        await Promise.resolve();
      });

      // First power up fails - catch inside act() to ensure state updates are flushed
      await act(async () => {
        try {
          await result.current.powerUp();
        } catch {
          // Expected to throw
        }
      });

      expect(result.current.powerError).toEqual(powerError);

      // Second power up succeeds
      await act(async () => {
        await result.current.powerUp();
      });

      expect(result.current.powerError).toBeNull();
    });
  });

  describe("power down", () => {
    it("should call power down API", async () => {
      mockGetStatus.mockResolvedValue(createMockGastownStatus({ powerState: "running" }));
      mockPowerDown.mockResolvedValue({ previousState: "running", newState: "stopping" });

      const { result } = renderHook(() => useGastownStatus());

      await act(async () => {
        await Promise.resolve();
      });

      await act(async () => {
        await result.current.powerDown();
      });

      expect(mockPowerDown).toHaveBeenCalledTimes(1);
    });

    it("should set poweringDown state during operation", async () => {
      mockGetStatus.mockResolvedValue(createMockGastownStatus({ powerState: "running" }));

      let resolvePowerDown: (value: { previousState: PowerState; newState: PowerState }) => void = () => {};
      mockPowerDown.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePowerDown = resolve;
          })
      );

      const { result } = renderHook(() => useGastownStatus());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.poweringDown).toBe(false);

      let powerPromise: Promise<void>;
      act(() => {
        powerPromise = result.current.powerDown();
      });

      expect(result.current.poweringDown).toBe(true);

      await act(async () => {
        resolvePowerDown({ previousState: "running", newState: "stopping" });
        await powerPromise;
      });

      expect(result.current.poweringDown).toBe(false);
    });

    it("should refresh status after power down", async () => {
      const runningStatus = createMockGastownStatus({ powerState: "running" });
      const stoppingStatus = createMockGastownStatus({ powerState: "stopping" });

      mockGetStatus
        .mockResolvedValueOnce(runningStatus)
        .mockResolvedValueOnce(stoppingStatus);
      mockPowerDown.mockResolvedValue({ previousState: "running", newState: "stopping" });

      const { result } = renderHook(() => useGastownStatus());

      await act(async () => {
        await Promise.resolve();
      });
      expect(mockGetStatus).toHaveBeenCalledTimes(1);

      await act(async () => {
        await result.current.powerDown();
      });

      // Should have triggered a refresh
      expect(mockGetStatus).toHaveBeenCalledTimes(2);
      expect(result.current.powerState).toBe("stopping");
    });

    it("should handle power down errors", async () => {
      mockGetStatus.mockResolvedValue(createMockGastownStatus({ powerState: "running" }));
      const powerError = new Error("Failed to stop");
      mockPowerDown.mockRejectedValue(powerError);

      const { result } = renderHook(() => useGastownStatus());

      await act(async () => {
        await Promise.resolve();
      });

      // Catch error inside act() to ensure state updates are flushed
      let caughtError: Error | null = null;
      await act(async () => {
        try {
          await result.current.powerDown();
        } catch (err) {
          caughtError = err as Error;
        }
      });

      expect(caughtError?.message).toBe("Failed to stop");
      expect(result.current.powerError).toEqual(powerError);
      expect(result.current.poweringDown).toBe(false);
    });
  });

  // ===========================================================================
  // Transitional States
  // ===========================================================================

  describe("transitional states", () => {
    it("should expose isTransitioning for starting state", async () => {
      mockGetStatus.mockResolvedValue(createMockGastownStatus({ powerState: "starting" }));

      const { result } = renderHook(() => useGastownStatus());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.isTransitioning).toBe(true);
    });

    it("should expose isTransitioning for stopping state", async () => {
      mockGetStatus.mockResolvedValue(createMockGastownStatus({ powerState: "stopping" }));

      const { result } = renderHook(() => useGastownStatus());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.isTransitioning).toBe(true);
    });

    it("should not be transitioning when running", async () => {
      mockGetStatus.mockResolvedValue(createMockGastownStatus({ powerState: "running" }));

      const { result } = renderHook(() => useGastownStatus());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.isTransitioning).toBe(false);
    });

    it("should not be transitioning when stopped", async () => {
      mockGetStatus.mockResolvedValue(createMockGastownStatus({ powerState: "stopped" }));

      const { result } = renderHook(() => useGastownStatus());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.isTransitioning).toBe(false);
    });
  });

  // ===========================================================================
  // Last Updated Timestamp
  // ===========================================================================

  describe("last updated", () => {
    it("should expose lastUpdated timestamp", async () => {
      mockGetStatus.mockResolvedValue(createMockGastownStatus());

      const { result } = renderHook(() => useGastownStatus());

      expect(result.current.lastUpdated).toBeNull();

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.lastUpdated).toBeInstanceOf(Date);
    });

    it("should update lastUpdated on each successful fetch", async () => {
      mockGetStatus.mockResolvedValue(createMockGastownStatus());

      const { result } = renderHook(() => useGastownStatus({ pollInterval: 1000 }));

      await act(async () => {
        await Promise.resolve();
      });
      const firstUpdate = result.current.lastUpdated;

      // Advance time and trigger poll
      await act(async () => {
        vi.advanceTimersByTime(1000);
        await Promise.resolve();
      });

      expect(result.current.lastUpdated).not.toEqual(firstUpdate);
    });
  });
});
