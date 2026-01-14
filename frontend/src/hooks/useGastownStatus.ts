import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../services/api";
import type { GastownStatus, PowerState } from "../types";

// =============================================================================
// Types
// =============================================================================

/** Options for the useGastownStatus hook. */
export interface UseGastownStatusOptions {
  /** Polling interval in milliseconds. Default: 10000 (10 seconds) */
  pollInterval?: number;
  /** Whether status fetching is enabled. Default: true */
  enabled?: boolean;
}

/** Return type for the useGastownStatus hook. */
export interface UseGastownStatusResult {
  /** Full status object, or null if not yet loaded */
  status: GastownStatus | null;
  /** Whether a fetch is currently in progress */
  loading: boolean;
  /** Error from the last fetch attempt, or null if successful */
  error: Error | null;
  /** Current power state (convenience accessor) */
  powerState: PowerState | null;
  /** Whether the system is in the "running" state */
  isRunning: boolean;
  /** Whether the system is connected (no fetch errors) */
  isConnected: boolean;
  /** Whether the system is in a transitional state (starting/stopping) */
  isTransitioning: boolean;
  /** Timestamp of the last successful fetch */
  lastUpdated: Date | null;
  /** Whether a power up operation is in progress */
  poweringUp: boolean;
  /** Whether a power down operation is in progress */
  poweringDown: boolean;
  /** Error from the last power operation, or null if successful */
  powerError: Error | null;
  /** Manually trigger a status refresh */
  refresh: () => Promise<void>;
  /** Trigger power up sequence */
  powerUp: () => Promise<void>;
  /** Trigger power down sequence */
  powerDown: () => Promise<void>;
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * React hook for monitoring Gastown system status with polling and power control.
 *
 * Fetches status immediately on mount and polls at the configured interval.
 * Provides power up/down operations that automatically refresh status after completion.
 *
 * @param options - Configuration options
 * @returns Status state, derived values, and control functions
 *
 * @example
 * ```tsx
 * const { status, isRunning, powerUp, powerDown } = useGastownStatus();
 *
 * return (
 *   <div>
 *     <p>Power: {isRunning ? 'ON' : 'OFF'}</p>
 *     <button onClick={powerUp}>Start</button>
 *     <button onClick={powerDown}>Stop</button>
 *   </div>
 * );
 * ```
 */
export function useGastownStatus(
  options: UseGastownStatusOptions = {}
): UseGastownStatusResult {
  const { pollInterval = 10000, enabled = true } = options;

  // Core state
  const [status, setStatus] = useState<GastownStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Power operation state
  const [poweringUp, setPoweringUp] = useState(false);
  const [poweringDown, setPoweringDown] = useState(false);
  const [powerError, setPowerError] = useState<Error | null>(null);

  // Track mounted state to prevent state updates after unmount
  const mountedRef = useRef<boolean>(true);

  // Fetch status from API
  const fetchStatus = useCallback(async () => {
    if (!mountedRef.current) return;

    setLoading(true);
    try {
      const result = await api.getStatus();
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- async safety
      if (mountedRef.current) {
        setStatus(result);
        setError(null);
        setLastUpdated(new Date());
      }
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- async safety
      if (mountedRef.current) {
        const fetchError = err instanceof Error ? err : new Error(String(err));
        setError(fetchError);
        // Note: We preserve existing status on error (stale-while-revalidate pattern)
      }
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- async safety
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // Manual refresh
  const refresh = useCallback(async () => {
    await fetchStatus();
  }, [fetchStatus]);

  // Power up operation
  const powerUp = useCallback(async () => {
    setPoweringUp(true);
    setPowerError(null);
    try {
      await api.power.up();
      await fetchStatus();
      setPoweringUp(false);
    } catch (err) {
      const opError = err instanceof Error ? err : new Error(String(err));
      setPoweringUp(false);
      setPowerError(opError);
      throw opError;
    }
  }, [fetchStatus]);

  // Power down operation
  const powerDown = useCallback(async () => {
    setPoweringDown(true);
    setPowerError(null);
    try {
      await api.power.down();
      await fetchStatus();
      setPoweringDown(false);
    } catch (err) {
      const opError = err instanceof Error ? err : new Error(String(err));
      setPoweringDown(false);
      setPowerError(opError);
      throw opError;
    }
  }, [fetchStatus]);

  // Initial fetch and polling setup
  useEffect(() => {
    mountedRef.current = true;

    if (!enabled) {
      return () => {
        mountedRef.current = false;
      };
    }

    // Fetch immediately
    void fetchStatus();

    // Set up polling interval
    const intervalId = setInterval(() => void fetchStatus(), pollInterval);

    // Cleanup on unmount
    return () => {
      mountedRef.current = false;
      clearInterval(intervalId);
    };
  }, [fetchStatus, pollInterval, enabled]);

  // Derived values
  const powerState = status?.powerState ?? null;
  const isRunning = powerState === "running";
  const isConnected = error === null;
  const isTransitioning = powerState === "starting" || powerState === "stopping";

  return {
    status,
    loading,
    error,
    powerState,
    isRunning,
    isConnected,
    isTransitioning,
    lastUpdated,
    poweringUp,
    poweringDown,
    powerError,
    refresh,
    powerUp,
    powerDown,
  };
}
