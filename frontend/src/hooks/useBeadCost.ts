/**
 * Hook for fetching cost data for a specific bead (or epic with children).
 * Caches results to avoid redundant fetches.
 */
import { useState, useEffect, useRef, useCallback } from 'react';

import { costApi } from '../services/api-costs';
import type { BeadCostResult } from '../services/api-costs';

export interface UseBeadCostOptions {
  /** Whether to enable fetching. Default: true */
  enabled?: boolean;
  /** Child bead IDs for epic aggregation. */
  children?: string[];
}

export interface UseBeadCostResult {
  /** The cost data, or null if not yet loaded. */
  cost: BeadCostResult | null;
  /** Whether a fetch is in progress. */
  loading: boolean;
  /** Error from the last fetch, or null. */
  error: Error | null;
  /** Manually trigger a refresh. */
  refresh: () => Promise<void>;
}

/**
 * Fetch the cost for a bead, optionally aggregating with children (for epics).
 *
 * @example
 * ```tsx
 * const { cost, loading } = useBeadCost('adj-064', { children: ['adj-064.1', 'adj-064.2'] });
 * ```
 */
export function useBeadCost(
  beadId: string | null,
  options: UseBeadCostOptions = {}
): UseBeadCostResult {
  const { enabled = true, children } = options;

  const [cost, setCost] = useState<BeadCostResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  const executeFetch = useCallback(async () => {
    if (!beadId || !mountedRef.current) return;

    setLoading(true);
    try {
      const result = await costApi.fetchBeadCost(beadId, children);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- async safety
      if (mountedRef.current) {
        setCost(result);
        setError(null);
      }
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- async safety
      if (mountedRef.current) {
        // 404 is expected for beads with no cost data
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- async safety
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [beadId, children]);

  useEffect(() => {
    mountedRef.current = true;

    if (!enabled || !beadId) {
      return () => { mountedRef.current = false; };
    }

    void executeFetch();

    return () => {
      mountedRef.current = false;
    };
  }, [executeFetch, enabled, beadId]);

  return { cost, loading, error, refresh: executeFetch };
}
