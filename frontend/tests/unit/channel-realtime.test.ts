/**
 * Channel real-time delivery (adj-164.5.4 / adj-83hau).
 *
 * Opening a channel must (a) join the channel's room-scoped fan-out and (b)
 * render incoming channel messages live. As of adj-83hau this rides the SHARED
 * CommunicationContext connection (the same pipe DMs use) rather than a separate
 * WS-only socket: the hook calls `subscribeConversation(channelId)` to opt into
 * the backend's `wsBroadcastToConversation` fan-out, and `subscribe()` to
 * receive messages (scoped client-side by conversationId). These tests pin both
 * halves plus teardown.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { useChannelMessages } from '../../src/hooks/useChannelMessages';
import type { IncomingChatMessage } from '../../src/contexts/CommunicationContext';
import type { ChatMessage } from '../../src/types';

const { mockListMessages } = vi.hoisted(() => ({ mockListMessages: vi.fn() }));

vi.mock('../../src/services/api', () => {
  const apiObj = {
    conversations: { listMessages: mockListMessages },
    channels: { postMessage: vi.fn() },
  };
  return { api: apiObj, default: apiObj };
});

// Capture the message callback the hook registers via subscribe(), and record
// the room subscribe/unsubscribe calls so we can assert the room-join behavior.
let capturedOnMessage: ((m: IncomingChatMessage) => void) | undefined;
const mockSubscribeConversation = vi.fn();
const mockUnsubscribeConversation = vi.fn();
const mockUnsub = vi.fn();

vi.mock('../../src/contexts/CommunicationContext', () => ({
  useCommunicationActions: () => ({
    sendMessage: vi.fn(),
    subscribe: (cb: (m: IncomingChatMessage) => void) => {
      capturedOnMessage = cb;
      return mockUnsub;
    },
    subscribeTimeline: vi.fn(() => () => undefined),
    subscribeConversation: mockSubscribeConversation,
    unsubscribeConversation: mockUnsubscribeConversation,
  }),
}));

function serverMsg(id: string, from: string, conversationId: string, body: string): ChatMessage {
  return {
    id,
    sessionId: null,
    agentId: from,
    recipient: conversationId,
    role: 'agent',
    body,
    metadata: null,
    deliveryStatus: 'delivered',
    eventType: null,
    threadId: null,
    conversationId,
    createdAt: '2026-05-29T12:00:00Z',
    updatedAt: '2026-05-29T12:00:00Z',
  };
}

describe('channel real-time delivery (adj-83hau)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnMessage = undefined;
    mockListMessages.mockResolvedValue({ items: [], total: 0, hasMore: false });
  });

  it('joins the channel room (subscribeConversation) when the channel opens', async () => {
    renderHook(() => useChannelMessages('chan-1'));
    await waitFor(() => {
      expect(mockSubscribeConversation).toHaveBeenCalledWith('chan-1');
    });
  });

  it('appends an incoming channel message live', async () => {
    const { result } = renderHook(() => useChannelMessages('chan-1'));
    await waitFor(() => { expect(result.current.isLoading).toBe(false); });

    act(() => {
      capturedOnMessage?.({
        id: 'live-1',
        from: 'raynor',
        to: 'chan-1',
        body: 'sector clear',
        timestamp: '2026-05-29T12:05:00Z',
        conversationId: 'chan-1',
      });
    });

    await waitFor(() => {
      expect(result.current.messages.some((m) => m.id === 'live-1')).toBe(true);
    });
    const live = result.current.messages.find((m) => m.id === 'live-1');
    expect(live?.agentId).toBe('raynor');
    expect(live?.body).toBe('sector clear');
  });

  it('does NOT append a message belonging to a different channel', async () => {
    const { result } = renderHook(() => useChannelMessages('chan-1'));
    await waitFor(() => { expect(result.current.isLoading).toBe(false); });

    act(() => {
      capturedOnMessage?.({
        id: 'other',
        from: 'kerrigan',
        to: 'chan-2',
        body: 'wrong room',
        timestamp: '2026-05-29T12:06:00Z',
        conversationId: 'chan-2',
      });
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.messages.some((m) => m.id === 'other')).toBe(false);
  });

  it('does NOT append the operator\'s own echoed message (already optimistic)', async () => {
    const { result } = renderHook(() => useChannelMessages('chan-1'));
    await waitFor(() => { expect(result.current.isLoading).toBe(false); });

    act(() => {
      capturedOnMessage?.({
        id: 'mine',
        from: 'user',
        to: 'chan-1',
        body: 'echo of my own post',
        timestamp: '2026-05-29T12:07:00Z',
        conversationId: 'chan-1',
      });
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.messages.some((m) => m.id === 'mine')).toBe(false);
  });

  it('leaves the room (unsubscribeConversation) on unmount', async () => {
    const { unmount } = renderHook(() => useChannelMessages('chan-1'));
    await waitFor(() => { expect(mockSubscribeConversation).toHaveBeenCalled(); });
    unmount();
    expect(mockUnsubscribeConversation).toHaveBeenCalledWith('chan-1');
    // The message subscription is also torn down.
    expect(mockUnsub).toHaveBeenCalled();
  });

  it('loads existing channel history on open', async () => {
    mockListMessages.mockResolvedValue({
      items: [serverMsg('h1', 'raynor', 'chan-1', 'earlier')],
      total: 1,
      hasMore: false,
    });
    const { result } = renderHook(() => useChannelMessages('chan-1'));
    await waitFor(() => { expect(result.current.isLoading).toBe(false); });
    expect(result.current.messages.map((m) => m.id)).toContain('h1');
    expect(mockListMessages).toHaveBeenCalledWith('chan-1', {});
  });
});
