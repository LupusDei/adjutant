import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock api module
vi.mock('../../src/services/api', () => ({
  api: {
    overview: { get: vi.fn() },
  },
}));

vi.mock('../../src/services/api-costs', () => ({
  costApi: {
    fetchCostSummary: vi.fn(),
    fetchBurnRate: vi.fn(),
    fetchBudgets: vi.fn(),
    fetchBeadCost: vi.fn(),
    createBudget: vi.fn(),
    deleteBudget: vi.fn(),
  },
}));

import { costApi } from '../../src/services/api-costs';
import { useCostDashboard } from '../../src/hooks/useCostDashboard';
import type { CostSummary, BurnRate, BudgetRecord } from '../../src/services/api-costs';

const mockFetchSummary = vi.mocked(costApi.fetchCostSummary);
const mockFetchBurnRate = vi.mocked(costApi.fetchBurnRate);
const mockFetchBudgets = vi.mocked(costApi.fetchBudgets);

const MOCK_SUMMARY: CostSummary = {
  totalCost: 47.32,
  totalTokens: { input: 100000, output: 50000, cacheRead: 30000, cacheWrite: 10000 },
  sessions: {
    'sess-1': {
      sessionId: 'sess-1',
      projectPath: '/code/adj',
      tokens: { input: 50000, output: 25000, cacheRead: 15000, cacheWrite: 5000 },
      cost: 23.66,
      lastUpdated: '2026-03-09T22:00:00Z',
    },
    'sess-2': {
      sessionId: 'sess-2',
      projectPath: '/code/adj',
      tokens: { input: 50000, output: 25000, cacheRead: 15000, cacheWrite: 5000 },
      cost: 23.66,
      lastUpdated: '2026-03-09T22:00:00Z',
    },
  },
  projects: {},
};

const MOCK_BURN_RATE: BurnRate = {
  rate10m: 3.0,
  rate1h: 18.0,
  trend: 'stable',
};

const MOCK_BUDGETS: BudgetRecord[] = [
  {
    id: 1,
    scope: 'session',
    scopeId: null,
    budgetAmount: 100,
    warningPercent: 80,
    criticalPercent: 95,
    createdAt: '2026-03-09T20:00:00Z',
    updatedAt: '2026-03-09T20:00:00Z',
  },
];

/** Flush all pending microtasks with fake timers active. */
async function flushPromises() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('useCostDashboard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFetchSummary.mockReset();
    mockFetchBurnRate.mockReset();
    mockFetchBudgets.mockReset();
    mockFetchSummary.mockResolvedValue(MOCK_SUMMARY);
    mockFetchBurnRate.mockResolvedValue(MOCK_BURN_RATE);
    mockFetchBudgets.mockResolvedValue(MOCK_BUDGETS);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should fetch cost summary and burn rate on mount', async () => {
    const { result } = renderHook(() => useCostDashboard());

    expect(result.current.loading).toBe(true);

    await flushPromises();

    expect(mockFetchSummary).toHaveBeenCalledOnce();
    expect(mockFetchBurnRate).toHaveBeenCalledOnce();
    expect(mockFetchBudgets).toHaveBeenCalledOnce();
    expect(result.current.loading).toBe(false);
    expect(result.current.summary).toEqual(MOCK_SUMMARY);
    expect(result.current.burnRate).toEqual(MOCK_BURN_RATE);
    expect(result.current.budgets).toEqual(MOCK_BUDGETS);
    expect(result.current.error).toBeNull();
  });

  it('should poll on the configured interval', async () => {
    const { result } = renderHook(() => useCostDashboard({ pollInterval: 5000 }));

    await flushPromises();
    expect(result.current.loading).toBe(false);
    expect(mockFetchSummary).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(mockFetchSummary).toHaveBeenCalledTimes(2);
    expect(mockFetchBurnRate).toHaveBeenCalledTimes(2);
  });

  it('should set error on fetch failure while keeping stale data', async () => {
    const { result } = renderHook(() => useCostDashboard({ pollInterval: 5000 }));

    await flushPromises();
    expect(result.current.summary).toEqual(MOCK_SUMMARY);

    mockFetchSummary.mockRejectedValueOnce(new Error('Network error'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    // Stale data should persist
    expect(result.current.summary).toEqual(MOCK_SUMMARY);
    expect(result.current.error?.message).toBe('Network error');
  });

  it('should expose a manual refresh function', async () => {
    const { result } = renderHook(() => useCostDashboard());

    await flushPromises();
    expect(mockFetchSummary).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh();
    });

    expect(mockFetchSummary).toHaveBeenCalledTimes(2);
  });

  it('should set lastUpdated timestamp after successful fetch', async () => {
    const { result } = renderHook(() => useCostDashboard());

    expect(result.current.lastUpdated).toBeNull();

    await flushPromises();

    expect(result.current.lastUpdated).toBeInstanceOf(Date);
  });

  it('should not fetch when disabled', async () => {
    renderHook(() => useCostDashboard({ enabled: false }));

    await flushPromises();

    expect(mockFetchSummary).not.toHaveBeenCalled();
  });
});
