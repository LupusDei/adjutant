import { useState, useEffect, useCallback, useRef } from "react";

/** Options for the usePolling hook. */
export interface UsePollingOptions {
  /** Polling interval in milliseconds. Default: 60000 */
  interval?: number;
  /** Whether to fetch immediately on mount. Default: true */
  immediate?: boolean;
  /** Whether polling is enabled. Default: true */
  enabled?: boolean;
}

/** Return type for the usePolling hook. */
export interface UsePollingResult<T> {
  /** The fetched data, or null if not yet loaded */
  data: T | null;
  /** Whether a fetch is currently in progress */
  loading: boolean;
  /** Error from the last fetch attempt, or null if successful */
  error: Error | null;
  /** Manually trigger a refresh */
  refresh: () => Promise<void>;
  /** Timestamp of the last successful fetch */
  lastUpdated: Date | null;
}

/**
 * React hook for periodic data fetching with automatic cleanup.
 *
 * @param fetchFn - Async function that fetches the data
 * @param options - Polling configuration options
 * @returns Polling state and controls
 *
 * @example
 * ```tsx
 * const { data, loading, error, refresh } = usePolling(
 *   () => fetch('/api/status').then(r => r.json()),
 *   { interval: 3000 }
 * );
 * ```
 */
export function usePolling<T>(
  fetchFn: () => Promise<T>,
  options: UsePollingOptions = {}
): UsePollingResult<T> {
  const { interval = 60000, immediate = true, enabled = true } = options;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Track if component is mounted to prevent state updates after unmount
  const mountedRef = useRef(true);
  // Guard against overlapping fetches (prevents request storms when fetch > interval)
  const fetchingRef = useRef(false);
  // Store the latest fetchFn to avoid stale closures
  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;

  const executeFetch = useCallback(async () => {
    // mountedRef is modified in the cleanup function, so these checks are valid at runtime
    if (!mountedRef.current) return;
    // Skip if a fetch is already in progress to prevent request pileup
    if (fetchingRef.current) return;

    fetchingRef.current = true;
    setLoading(true);
    try {
      const result = await fetchFnRef.current();
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (mountedRef.current) {
        setData(result);
        setError(null);
        setLastUpdated(new Date());
      }
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      fetchingRef.current = false;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // Initial fetch and polling setup
  useEffect(() => {
    mountedRef.current = true;

    if (!enabled) {
      return () => {
        mountedRef.current = false;
      };
    }

    // Fetch immediately if configured (fire-and-forget)
    if (immediate) {
      void executeFetch();
    }

    // Set up polling interval (fire-and-forget)
    const intervalId = setInterval(() => void executeFetch(), interval);

    // Cleanup on unmount or when dependencies change
    return () => {
      mountedRef.current = false;
      clearInterval(intervalId);
    };
  }, [executeFetch, interval, immediate, enabled]);

  return {
    data,
    loading,
    error,
    refresh: executeFetch,
    lastUpdated,
  };
}
