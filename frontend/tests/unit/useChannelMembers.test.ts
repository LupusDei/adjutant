/**
 * useChannelMembers (adj-bqdte) — the per-channel membership data layer.
 *
 * The hook owns the roster for ONE channel: it loads the current members and
 * exposes an `addMember` mutation that optimistically refreshes the roster on
 * success. It is deliberately separate from `useChannels` (which owns the
 * channel-list + unread concern) so the roster panel never re-fetches the whole
 * sidebar, and so a member-fetch failure can never blank the channel list.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { useChannelMembers } from '../../src/hooks/useChannelMembers';
import type { ChannelMember } from '../../src/types';

const { mockMembers, mockAddMember } = vi.hoisted(() => ({
  mockMembers: vi.fn(),
  mockAddMember: vi.fn(),
}));

vi.mock('../../src/services/api', () => {
  const apiObj = {
    channels: {
      members: mockMembers,
      addMember: mockAddMember,
    },
  };
  return { api: apiObj, default: apiObj };
});

function member(
  memberId: string,
  memberKind: ChannelMember['memberKind'] = 'agent',
  role: ChannelMember['role'] = 'member',
): ChannelMember {
  return { memberId, memberKind, role };
}

describe('useChannelMembers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMembers.mockResolvedValue({ members: [], total: 0 });
    mockAddMember.mockResolvedValue(undefined);
  });

  it('should return empty members and loading defaults before the initial fetch resolves', async () => {
    const { result } = renderHook(() => useChannelMembers('c1'));

    // Synchronous initial state: loading, no members yet, no error.
    expect(result.current.isLoading).toBe(true);
    expect(result.current.members).toEqual([]);
    expect(result.current.error).toBeNull();

    await waitFor(() => { expect(result.current.isLoading).toBe(false); });
    expect(mockMembers).toHaveBeenCalledWith('c1');
  });

  it('should populate members after the fetch resolves', async () => {
    mockMembers.mockResolvedValue({
      members: [member('user', 'user', 'owner'), member('raynor')],
      total: 2,
    });

    const { result } = renderHook(() => useChannelMembers('c1'));

    await waitFor(() => { expect(result.current.isLoading).toBe(false); });
    expect(result.current.members.map((m) => m.memberId)).toEqual(['user', 'raynor']);
  });

  it('should add a member and refresh the roster', async () => {
    mockMembers
      .mockResolvedValueOnce({ members: [member('user', 'user', 'owner')], total: 1 })
      .mockResolvedValueOnce({
        members: [member('user', 'user', 'owner'), member('kerrigan')],
        total: 2,
      });

    const { result } = renderHook(() => useChannelMembers('c1'));
    await waitFor(() => { expect(result.current.isLoading).toBe(false); });

    await act(async () => {
      await result.current.addMember('kerrigan');
    });

    expect(mockAddMember).toHaveBeenCalledWith('c1', 'kerrigan', 'agent');
    await waitFor(() => {
      expect(result.current.members.map((m) => m.memberId)).toContain('kerrigan');
    });
  });

  it('should surface an error when the member fetch fails', async () => {
    mockMembers.mockRejectedValue(new Error('roster unavailable'));

    const { result } = renderHook(() => useChannelMembers('c1'));

    await waitFor(() => { expect(result.current.error).not.toBeNull(); });
    expect(result.current.error?.message).toBe('roster unavailable');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.members).toEqual([]);
  });

  it('should propagate an addMember rejection to the caller without blanking the roster', async () => {
    mockMembers.mockResolvedValue({ members: [member('user', 'user', 'owner')], total: 1 });
    mockAddMember.mockRejectedValue(new Error('already a member'));

    const { result } = renderHook(() => useChannelMembers('c1'));
    await waitFor(() => { expect(result.current.isLoading).toBe(false); });

    await expect(
      act(async () => {
        await result.current.addMember('raynor');
      }),
    ).rejects.toThrow('already a member');

    // The roster is untouched; the error is thrown for the UI to surface.
    expect(result.current.members.map((m) => m.memberId)).toEqual(['user']);
  });

  it('should re-fetch when the channelId changes', async () => {
    mockMembers
      .mockResolvedValueOnce({ members: [member('raynor')], total: 1 })
      .mockResolvedValueOnce({ members: [member('kerrigan')], total: 1 });

    const { result, rerender } = renderHook(
      ({ id }) => useChannelMembers(id),
      { initialProps: { id: 'c1' } },
    );

    await waitFor(() => {
      expect(result.current.members.map((m) => m.memberId)).toEqual(['raynor']);
    });

    rerender({ id: 'c2' });

    await waitFor(() => {
      expect(result.current.members.map((m) => m.memberId)).toEqual(['kerrigan']);
    });
    expect(mockMembers).toHaveBeenLastCalledWith('c2');
  });
});
