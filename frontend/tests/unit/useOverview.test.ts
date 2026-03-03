import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import type { GlobalOverview } from '../../src/types/overview';

// Mock api module
vi.mock('../../src/services/api', () => ({
  api: {
    overview: {
      get: vi.fn(),
    },
  },
}));

import { api } from '../../src/services/api';
import { useOverview } from '../../src/hooks/useProjectOverview';

const mockGet = vi.mocked(api.overview.get);

const MOCK_OVERVIEW: GlobalOverview = {
  projects: [
    { id: 'proj-1', name: 'Adjutant', path: '/code/adjutant', active: true },
  ],
  beads: {
    open: [
      { id: 'adj-001', title: 'Task 1', type: 'task', status: 'open', priority: 1, assignee: null, createdAt: '2026-03-01T00:00:00Z', updatedAt: null },
    ],
    inProgress: [
      { id: 'adj-002', title: 'Task 2', type: 'task', status: 'in_progress', priority: 1, assignee: 'agent-1', createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-02T00:00:00Z' },
    ],
    recentlyClosed: [],
  },
  epics: {
    inProgress: [
      { id: 'adj-e01', title: 'Epic 1', status: 'in_progress', totalChildren: 5, closedChildren: 2, completionPercent: 40 },
    ],
    recentlyCompleted: [],
  },
  agents: [
    { id: 'agent-1', name: 'stetmann', status: 'working', currentBead: 'adj-002', unreadCount: 3, sessionId: 'sess-1' },
  ],
  unreadMessages: [
    { agentId: 'agent-1', unreadCount: 3, latestBody: 'Hello there' },
  ],
};

/** Flush all pending microtasks (resolved promises) with fake timers active. */
async function flushPromises() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('useOverview', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGet.mockReset();
    mockGet.mockResolvedValue(MOCK_OVERVIEW);
    Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should fetch global overview on mount', async () => {
    const { result } = renderHook(() => useOverview());

    // Initially loading
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await flushPromises();

    expect(mockGet).toHaveBeenCalledOnce();
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual(MOCK_OVERVIEW);
    expect(result.current.error).toBeNull();
  });

  it('should not have noProject property (global overview always works)', async () => {
    const { result } = renderHook(() => useOverview());

    expect(result.current).not.toHaveProperty('noProject');
  });

  it('should poll on the configured interval', async () => {
    const { result } = renderHook(() => useOverview(5000));

    // Wait for initial fetch
    await flushPromises();
    expect(result.current.loading).toBe(false);
    expect(mockGet).toHaveBeenCalledTimes(1);

    // Advance past one poll interval
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('should set error on fetch failure while keeping stale data', async () => {
    const { result } = renderHook(() => useOverview(5000));

    // Wait for initial successful fetch
    await flushPromises();
    expect(result.current.data).toEqual(MOCK_OVERVIEW);

    // Make next fetch fail
    mockGet.mockRejectedValueOnce(new Error('Network error'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    // Stale data should still be present
    expect(result.current.data).toEqual(MOCK_OVERVIEW);
    expect(result.current.error?.message).toBe('Network error');
  });

  it('should expose a manual refresh function', async () => {
    const { result } = renderHook(() => useOverview());

    await flushPromises();
    expect(mockGet).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh();
    });

    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('should set lastUpdated timestamp after successful fetch', async () => {
    const { result } = renderHook(() => useOverview());

    expect(result.current.lastUpdated).toBeNull();

    await flushPromises();

    expect(result.current.lastUpdated).toBeInstanceOf(Date);
  });
});
