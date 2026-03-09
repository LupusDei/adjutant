/**
 * Hook for fetching and polling cost dashboard data.
 * Provides summary, burn rate, and budget information with auto-refresh.
 */
import { useState, useEffect, useCallback, useRef } from 'react';

import { costApi } from '../services/api-costs';
import type { CostSummary, BurnRate, BudgetRecord } from '../services/api-costs';

export interface UseCostDashboardOptions {
  /** Polling interval in milliseconds. Default: 15000 */
  pollInterval?: number;
  /** Whether to enable fetching. Default: true */
  enabled?: boolean;
}

export interface UseCostDashboardResult {
  /** Full cost summary from the backend. */
  summary: CostSummary | null;
  /** Current burn rate data. */
  burnRate: BurnRate | null;
  /** All budgets with their status. */
  budgets: BudgetRecord[];
  /** Whether the initial fetch is in progress. */
  loading: boolean;
  /** Error from the last fetch attempt. */
  error: Error | null;
  /** Timestamp of the last successful fetch. */
  lastUpdated: Date | null;
  /** Manually trigger a refresh. */
  refresh: () => Promise<void>;
}

/**
 * React hook for cost dashboard data with automatic polling.
 *
 * @example
 * ```tsx
 * const { summary, burnRate, budgets, loading } = useCostDashboard();
 * ```
 */
export function useCostDashboard(
  options: UseCostDashboardOptions = {}
): UseCostDashboardResult {
  const { pollInterval = 15000, enabled = true } = options;

  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [burnRate, setBurnRate] = useState<BurnRate | null>(null);
  const [budgets, setBudgets] = useState<BudgetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const mountedRef = useRef(true);
  const fetchingRef = useRef(false);

  const executeFetch = useCallback(async () => {
    if (!mountedRef.current || fetchingRef.current) return;

    fetchingRef.current = true;
    // Only show loading on initial fetch (no data yet)
    if (!summary) {
      setLoading(true);
    }

    try {
      const [summaryResult, burnRateResult, budgetsResult] = await Promise.all([
        costApi.fetchCostSummary(),
        costApi.fetchBurnRate(),
        costApi.fetchBudgets(),
      ]);

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- async safety
      if (mountedRef.current) {
        setSummary(summaryResult);
        setBurnRate(burnRateResult);
        setBudgets(budgetsResult);
        setError(null);
        setLastUpdated(new Date());
      }
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- async safety
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      fetchingRef.current = false;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- async safety
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- summary ref used only for loading flag
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    if (!enabled) {
      setLoading(false);
      return () => {
        mountedRef.current = false;
      };
    }

    void executeFetch();

    const intervalId = setInterval(() => {
      void executeFetch();
    }, pollInterval);

    return () => {
      mountedRef.current = false;
      clearInterval(intervalId);
    };
  }, [executeFetch, pollInterval, enabled]);

  return {
    summary,
    burnRate,
    budgets,
    loading,
    error,
    lastUpdated,
    refresh: executeFetch,
  };
}
