/**
 * Regression tests for adj-bgpup — the notification hook must not hammer
 * /api/messages while a live stream is already pushing the same messages.
 *
 * The old hook polled GET /api/messages every 15s in every tab, forever, on
 * top of the WebSocket it already held. That single loop was ~54% of all
 * tunnel traffic and kept a connection slot busy that foreground fetches
 * needed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockMessagesList = vi.fn<() => Promise<{ items: unknown[] }>>();

vi.mock('../../../src/services/api', () => ({
  api: {
    messages: {
      list: () => mockMessagesList(),
    },
  },
}));

/** Handlers registered via the communication context's subscribe(). */
let pushHandlers: ((msg: Record<string, unknown>) => void)[] = [];
let connectionStatus = 'websocket';

vi.mock('../../../src/contexts/CommunicationContext', () => ({
  useCommunicationActions: () => ({
    subscribe: (cb: (msg: Record<string, unknown>) => void) => {
      pushHandlers.push(cb);
      return () => {
        pushHandlers = pushHandlers.filter((h) => h !== cb);
      };
    },
  }),
  useCommunicationStatus: () => ({ connectionStatus }),
}));

vi.mock('../../../src/hooks/useMobileAudio', () => ({
  useMobileAudio: () => ({
    isMobile: false,
    isUnlocked: true,
    unlock: vi.fn(),
    stop: vi.fn(),
  }),
}));

import { useOverseerNotifications } from '../../../src/hooks/useOverseerNotifications';

beforeEach(() => {
  vi.useFakeTimers();
  pushHandlers = [];
  connectionStatus = 'websocket';
  mockMessagesList.mockReset();
  mockMessagesList.mockResolvedValue({ items: [] });
  localStorage.clear();
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({}),
  }) as unknown as typeof fetch;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useOverseerNotifications polling (adj-bgpup)', () => {
  it('should not poll /api/messages while the WebSocket is connected', async () => {
    connectionStatus = 'websocket';

    renderHook(() => useOverseerNotifications());

    // One seed fetch on mount is expected — it primes the seen-ids set.
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockMessagesList).toHaveBeenCalledTimes(1);

    // Five minutes of a connected tab: not one extra request.
    await act(async () => {
      vi.advanceTimersByTime(300_000);
      await Promise.resolve();
    });
    expect(mockMessagesList).toHaveBeenCalledTimes(1);
  });

  it('should fall back to polling when no live stream is connected', async () => {
    connectionStatus = 'polling';

    renderHook(() => useOverseerNotifications());

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockMessagesList).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    expect(mockMessagesList).toHaveBeenCalledTimes(2);
  });

  it('should not poll while the tab is hidden even without a stream', async () => {
    connectionStatus = 'polling';
    const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);

    try {
      renderHook(() => useOverseerNotifications());

      await act(async () => {
        await Promise.resolve();
      });
      expect(mockMessagesList).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(300_000);
        await Promise.resolve();
      });
      expect(mockMessagesList).toHaveBeenCalledTimes(1);
    } finally {
      hiddenSpy.mockRestore();
    }
  });

  it('should subscribe to the push stream for new messages', async () => {
    renderHook(() => useOverseerNotifications());

    await act(async () => {
      await Promise.resolve();
    });

    expect(pushHandlers).toHaveLength(1);
  });

  it('should unsubscribe from the push stream on unmount', async () => {
    const { unmount } = renderHook(() => useOverseerNotifications());

    await act(async () => {
      await Promise.resolve();
    });
    expect(pushHandlers).toHaveLength(1);

    unmount();
    expect(pushHandlers).toHaveLength(0);
  });
});
