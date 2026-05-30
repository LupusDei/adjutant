/**
 * useChannelMembers (adj-bqdte) — the per-channel membership data layer.
 *
 * Owns the roster for a SINGLE channel: it loads the current members and
 * exposes an `addMember` mutation that refreshes the roster on success. It is
 * intentionally separate from `useChannels` (the channel-list + unread layer)
 * so the roster panel never re-fetches the whole sidebar, and so a member-fetch
 * failure can never blank the channel list. This is the REST-backed source of
 * truth for the members panel; real-time membership changes are out of scope
 * for this hook (the panel re-fetches on open and after each add).
 */

import { useState, useEffect, useCallback, useRef } from 'react';

import { api } from '../services/api';
import type { ChannelMember } from '../types';

export interface UseChannelMembersResult {
  /** Current channel members, in backend order. */
  members: ChannelMember[];
  isLoading: boolean;
  error: Error | null;
  /**
   * Add an agent to the channel and refresh the roster. Rejects to the caller
   * on failure (the picker surfaces it) without disturbing the current roster.
   */
  addMember: (memberId: string) => Promise<void>;
  /** Re-fetch the roster. */
  refresh: () => Promise<void>;
}

export function useChannelMembers(channelId: string): UseChannelMembersResult {
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Guards against setting state after unmount AND against a stale fetch (for a
  // previous channelId) clobbering the roster of the channel now in view.
  const activeChannelRef = useRef(channelId);
  const mountedRef = useRef(true);

  const load = useCallback(async (id: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.channels.members(id);
      if (!mountedRef.current || activeChannelRef.current !== id) return;
      setMembers(res.members);
      setIsLoading(false);
    } catch (err) {
      if (!mountedRef.current || activeChannelRef.current !== id) return;
      setError(err instanceof Error ? err : new Error(String(err)));
      setIsLoading(false);
    }
  }, []);

  const refresh = useCallback(() => load(channelId), [load, channelId]);

  useEffect(() => {
    mountedRef.current = true;
    activeChannelRef.current = channelId;
    void load(channelId);
    return () => {
      mountedRef.current = false;
    };
  }, [channelId, load]);

  const addMember = useCallback(
    async (memberId: string): Promise<void> => {
      // Let the error propagate to the caller; do NOT swallow it into hook
      // error state, so a failed add never blanks the existing roster.
      await api.channels.addMember(channelId, memberId, 'agent');
      await load(channelId);
    },
    [channelId, load],
  );

  return { members, isLoading, error, addMember, refresh };
}
