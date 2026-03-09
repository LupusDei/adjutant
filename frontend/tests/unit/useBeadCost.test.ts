import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

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
import { useBeadCost } from '../../src/hooks/useBeadCost';
import type { BeadCostResult } from '../../src/services/api-costs';

const mockFetchBeadCost = vi.mocked(costApi.fetchBeadCost);

const MOCK_BEAD_COST: BeadCostResult = {
  beadId: 'adj-064',
  totalCost: 12.50,
  sessions: [
    {
      sessionId: 'sess-1',
      cost: 12.50,
      tokens: { input: 50000, output: 25000, cacheRead: 10000, cacheWrite: 5000 },
    },
  ],
  tokenBreakdown: { input: 50000, output: 25000, cacheRead: 10000, cacheWrite: 5000 },
};

async function flushPromises() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('useBeadCost', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFetchBeadCost.mockReset();
    mockFetchBeadCost.mockResolvedValue(MOCK_BEAD_COST);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should fetch cost for a bead on mount', async () => {
    const { result } = renderHook(() => useBeadCost('adj-064'));

    await flushPromises();

    expect(mockFetchBeadCost).toHaveBeenCalledWith('adj-064', undefined);
    expect(result.current.cost).toEqual(MOCK_BEAD_COST);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should pass children IDs for epic aggregation', async () => {
    const children = ['adj-064.1', 'adj-064.2'];
    renderHook(() => useBeadCost('adj-064', { children }));

    await flushPromises();

    expect(mockFetchBeadCost).toHaveBeenCalledWith('adj-064', children);
  });

  it('should not fetch when beadId is null', async () => {
    renderHook(() => useBeadCost(null));

    await flushPromises();

    expect(mockFetchBeadCost).not.toHaveBeenCalled();
  });

  it('should not fetch when disabled', async () => {
    renderHook(() => useBeadCost('adj-064', { enabled: false }));

    await flushPromises();

    expect(mockFetchBeadCost).not.toHaveBeenCalled();
  });

  it('should set error on fetch failure', async () => {
    mockFetchBeadCost.mockRejectedValueOnce(new Error('Not found'));

    const { result } = renderHook(() => useBeadCost('adj-064'));

    await flushPromises();

    expect(result.current.cost).toBeNull();
    expect(result.current.error?.message).toBe('Not found');
  });
});
