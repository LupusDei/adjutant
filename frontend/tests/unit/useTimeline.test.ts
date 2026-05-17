/**
 * Tests for adj-139.3.4: useTimeline events array cap.
 *
 * Without a cap, every real-time timeline event prepends forever, eventually
 * crashing the overview page from OOM. Cap at MAX_TIMELINE_EVENTS = 1000 with
 * FIFO eviction (drop oldest at the tail).
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import type { IncomingTimelineEvent } from '../../src/contexts/CommunicationContext';
import type { TimelineEvent } from '../../src/services/api';

// Capture subscribers so the test can push real-time events.
const timelineSubscribers = new Set<(e: IncomingTimelineEvent) => void>();

vi.mock('../../src/contexts/CommunicationContext', () => ({
  useCommunication: () => ({
    subscribeTimeline: (cb: (e: IncomingTimelineEvent) => void) => {
      timelineSubscribers.add(cb);
      return () => { timelineSubscribers.delete(cb); };
    },
  }),
}));

vi.mock('../../src/services/api', () => ({
  getTimelineEvents: vi.fn(),
}));

import { useTimeline } from '../../src/hooks/useTimeline';
import { getTimelineEvents } from '../../src/services/api';

const mockFetch = getTimelineEvents as unknown as Mock;

/** Build a realistic TimelineEvent shape (matches backend response). */
function makeEvent(idNum: number, createdAt: string = new Date(Date.now() - idNum * 1000).toISOString()): TimelineEvent {
  return {
    id: `evt-${idNum}`,
    eventType: 'agent_action',
    agentId: 'engineer-c-leaks',
    action: 'report_progress',
    detail: { idx: idNum },
    beadId: null,
    messageId: null,
    createdAt,
  };
}

function makeIncoming(idNum: number, createdAt = new Date(Date.now() - idNum * 1000).toISOString()): IncomingTimelineEvent {
  return {
    id: `evt-${idNum}`,
    eventType: 'agent_action',
    agentId: 'engineer-c-leaks',
    action: 'report_progress',
    detail: { idx: idNum },
    createdAt,
  };
}

describe('useTimeline - cap at 1000 (adj-139.3.4)', () => {
  beforeEach(() => {
    timelineSubscribers.clear();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ events: [], hasMore: false });
  });

  it('should cap the events array at 1000 entries when real-time events arrive', async () => {
    const { result } = renderHook(() => useTimeline());
    await waitFor(() => { expect(result.current.loading).toBe(false); });

    // Push 1500 real-time events.
    await act(async () => {
      for (let i = 0; i < 1500; i++) {
        for (const cb of timelineSubscribers) cb(makeIncoming(i));
      }
    });

    expect(result.current.events.length).toBe(1000);
  });

  it('should evict the oldest events when prepending past the cap (FIFO from tail)', async () => {
    const { result } = renderHook(() => useTimeline());
    await waitFor(() => { expect(result.current.loading).toBe(false); });

    // Push 1001 distinct events. Each subsequent push prepends to front.
    await act(async () => {
      for (let i = 0; i < 1001; i++) {
        for (const cb of timelineSubscribers) cb(makeIncoming(i));
      }
    });

    expect(result.current.events.length).toBe(1000);
    // Most-recent event (id=evt-1000) is at index 0.
    expect(result.current.events[0]?.id).toBe('evt-1000');
    // Event id=evt-0 (oldest pushed) was evicted, so first push survives but evt-0 is gone.
    expect(result.current.events.find((e) => e.id === 'evt-0')).toBeUndefined();
  });

  it('should respect the cap on the initial fetch', async () => {
    // Server returns more than 1000 events (shouldn't happen but test the guard).
    mockFetch.mockResolvedValue({
      events: Array.from({ length: 1500 }, (_, i) => makeEvent(i)),
      hasMore: false,
    });

    const { result } = renderHook(() => useTimeline());

    await waitFor(() => { expect(result.current.loading).toBe(false); });
    expect(result.current.events.length).toBeLessThanOrEqual(1000);
  });

  it('should respect the cap when loadMore appends older events', async () => {
    // Initial fetch returns 800.
    mockFetch.mockResolvedValueOnce({
      events: Array.from({ length: 800 }, (_, i) => makeEvent(i)),
      hasMore: true,
    });
    // loadMore returns 500 older events.
    mockFetch.mockResolvedValueOnce({
      events: Array.from({ length: 500 }, (_, i) => makeEvent(1000 + i)),
      hasMore: false,
    });

    const { result } = renderHook(() => useTimeline());
    await waitFor(() => { expect(result.current.loading).toBe(false); });
    expect(result.current.events.length).toBe(800);

    await act(async () => { await result.current.loadMore(); });

    expect(result.current.events.length).toBeLessThanOrEqual(1000);
  });
});
