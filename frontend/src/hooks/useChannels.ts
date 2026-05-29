/**
 * useChannels (adj-164.5.1) — the channel-list data layer for the web UI.
 *
 * Fetches the channel roster and the operator's per-channel unread counts in
 * parallel, and exposes create/join mutations that refresh the roster on
 * success. This hook is intentionally REST-only: real-time message delivery
 * inside a room is owned by `ChannelView` + `useChatWebSocket` (adj-164.5.4),
 * keeping a clean separation between "which rooms exist / how many unread" and
 * "the live transcript of the open room".
 */

import { useState, useEffect, useCallback, useRef } from 'react';

import { api } from '../services/api';
import type { ChannelSummary } from '../types';

export interface UseChannelsResult {
  /** All channels, newest first (backend ordering). */
  channels: ChannelSummary[];
  /** Per-channel unread counts keyed by channel id. Missing key ⇒ 0. */
  unread: Record<string, number>;
  isLoading: boolean;
  error: Error | null;
  /** Create a channel and refresh the roster. Resolves with the new channel. */
  createChannel: (title: string) => Promise<ChannelSummary>;
  /** Join a channel as the operator and refresh the roster. */
  joinChannel: (channelId: string) => Promise<void>;
  /** Re-fetch the roster and unread counts. */
  refresh: () => Promise<void>;
}

export function useChannels(): UseChannelsResult {
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);

  // Fetch roster + unread together. Unread failure is non-fatal — the roster is
  // the load-bearing data; an empty unread map simply renders no badges rather
  // than blocking the whole sidebar on a secondary endpoint.
  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [listRes, unreadRes] = await Promise.all([
        api.channels.list(),
        api.channels.unread().catch(() => ({ counts: [] })),
      ]);
      if (!mountedRef.current) return;
      setChannels(listRes.channels);
      const map: Record<string, number> = {};
      for (const c of unreadRes.counts) {
        map[c.conversationId] = c.unreadCount;
      }
      setUnread(map);
      setIsLoading(false);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  const createChannel = useCallback(
    async (title: string): Promise<ChannelSummary> => {
      // Let the error propagate to the caller (the create form handles it);
      // do NOT swallow it into hook error state, so a failed create never
      // blanks the existing roster.
      const created = await api.channels.create(title);
      await refresh();
      return created;
    },
    [refresh],
  );

  const joinChannel = useCallback(
    async (channelId: string): Promise<void> => {
      await api.channels.join(channelId);
      await refresh();
    },
    [refresh],
  );

  return { channels, unread, isLoading, error, createChannel, joinChannel, refresh };
}
