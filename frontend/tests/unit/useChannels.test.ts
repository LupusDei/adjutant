/**
 * useChannels (adj-164.5.1) — channel list/create/join + per-channel unread.
 *
 * The hook owns the channel-list data layer for the web UI: it fetches the
 * channel roster and the operator's per-channel unread counts, and exposes
 * create/join mutations that optimistically refresh the roster. Real-time
 * subscription/delivery is the ChannelView's concern (adj-164.5.4), not this
 * hook's — this hook is the REST-backed source of truth for the sidebar.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { useChannels } from '../../src/hooks/useChannels';
import type { ChannelSummary } from '../../src/types';

const { mockList, mockCreate, mockJoin, mockUnread } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockCreate: vi.fn(),
  mockJoin: vi.fn(),
  mockUnread: vi.fn(),
}));

vi.mock('../../src/services/api', () => {
  const apiObj = {
    channels: {
      list: mockList,
      create: mockCreate,
      join: mockJoin,
      unread: mockUnread,
    },
  };
  return { api: apiObj, default: apiObj };
});

function channel(id: string, title: string, memberCount = 2): ChannelSummary {
  return {
    id,
    kind: 'channel',
    title,
    archived: false,
    memberCount,
    createdAt: '2026-05-29T10:00:00Z',
    updatedAt: '2026-05-29T10:00:00Z',
  };
}

describe('useChannels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue({ channels: [], total: 0 });
    mockUnread.mockResolvedValue({ counts: [] });
  });

  it('should return empty channels and not-loading defaults after initial fetch', async () => {
    const { result } = renderHook(() => useChannels());

    // Initial synchronous state: loading, no channels yet.
    expect(result.current.isLoading).toBe(true);
    expect(result.current.channels).toEqual([]);
    expect(result.current.error).toBeNull();

    await waitFor(() => { expect(result.current.isLoading).toBe(false); });
    expect(result.current.channels).toEqual([]);
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it('should populate channels and per-channel unread map after fetch', async () => {
    mockList.mockResolvedValue({
      channels: [channel('c1', 'general'), channel('c2', 'random')],
      total: 2,
    });
    mockUnread.mockResolvedValue({
      counts: [{ conversationId: 'c1', unreadCount: 3 }],
    });

    const { result } = renderHook(() => useChannels());

    await waitFor(() => { expect(result.current.isLoading).toBe(false); });
    expect(result.current.channels.map((c) => c.id)).toEqual(['c1', 'c2']);
    // Unread is keyed by channel id; channels with no entry default to 0.
    expect(result.current.unread['c1']).toBe(3);
    expect(result.current.unread['c2'] ?? 0).toBe(0);
  });

  it('should create a channel and refresh the roster', async () => {
    mockCreate.mockResolvedValue(channel('c3', 'ops'));
    // First list call (mount) empty; second (post-create) includes the new one.
    mockList
      .mockResolvedValueOnce({ channels: [], total: 0 })
      .mockResolvedValueOnce({ channels: [channel('c3', 'ops')], total: 1 });

    const { result } = renderHook(() => useChannels());
    await waitFor(() => { expect(result.current.isLoading).toBe(false); });

    let created: ChannelSummary | undefined;
    await act(async () => {
      created = await result.current.createChannel('ops');
    });

    expect(mockCreate).toHaveBeenCalledWith('ops');
    expect(created?.id).toBe('c3');
    await waitFor(() => {
      expect(result.current.channels.map((c) => c.id)).toContain('c3');
    });
  });

  it('should join a channel and refresh the roster', async () => {
    mockJoin.mockResolvedValue(undefined);
    mockList
      .mockResolvedValueOnce({ channels: [channel('c1', 'general')], total: 1 })
      .mockResolvedValueOnce({ channels: [channel('c1', 'general', 3)], total: 1 });

    const { result } = renderHook(() => useChannels());
    await waitFor(() => { expect(result.current.isLoading).toBe(false); });

    await act(async () => {
      await result.current.joinChannel('c1');
    });

    expect(mockJoin).toHaveBeenCalledWith('c1');
    await waitFor(() => {
      expect(result.current.channels[0]?.memberCount).toBe(3);
    });
  });

  it('should surface an error when the channel fetch fails', async () => {
    mockList.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useChannels());

    await waitFor(() => { expect(result.current.error).not.toBeNull(); });
    expect(result.current.error?.message).toBe('network down');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.channels).toEqual([]);
  });

  it('should surface an error when createChannel rejects without corrupting state', async () => {
    mockCreate.mockRejectedValue(new Error('title taken'));

    const { result } = renderHook(() => useChannels());
    await waitFor(() => { expect(result.current.isLoading).toBe(false); });

    await expect(
      act(async () => {
        await result.current.createChannel('dupe');
      }),
    ).rejects.toThrow('title taken');

    // The roster is unchanged; the error is thrown to the caller for UI handling.
    expect(result.current.channels).toEqual([]);
  });
});
