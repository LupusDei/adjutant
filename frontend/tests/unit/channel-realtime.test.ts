/**
 * Channel real-time delivery (adj-164.5.4).
 *
 * Opening a channel must (a) subscribe the WS client to the channel's
 * room-scoped fan-out, and (b) render incoming channel messages live. The
 * backend `wsBroadcastToConversation` only delivers to clients that explicitly
 * subscribed AND are members — so the subscribe frame is load-bearing, not
 * optional. These tests pin both halves.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { useChannelMessages } from '../../src/hooks/useChannelMessages';
import type { WsChatMessage, ChatWebSocketCallbacks } from '../../src/hooks/useChatWebSocket';
import type { ChatMessage } from '../../src/types';

const { mockListMessages } = vi.hoisted(() => ({ mockListMessages: vi.fn() }));

vi.mock('../../src/services/api', () => {
  const apiObj = {
    conversations: { listMessages: mockListMessages },
    channels: { postMessage: vi.fn() },
  };
  return { api: apiObj, default: apiObj };
});

// Communication priority is what gates WS in the hook.
vi.mock('../../src/contexts/CommunicationContext', () => ({
  useCommunication: () => ({ priority: 'real-time', connectionStatus: 'websocket' }),
}));

// Capture the callbacks + scope the hook passes to useChatWebSocket, and record
// subscribe/unsubscribe calls so we can assert the room-subscription behavior.
let capturedOnMessage: ((m: WsChatMessage) => void) | undefined;
let capturedScope: string | undefined;
const mockSubscribe = vi.fn(() => true);
const mockUnsubscribe = vi.fn(() => true);

vi.mock('../../src/hooks/useChatWebSocket', () => ({
  useChatWebSocket: (
    _enabled: boolean,
    callbacks: ChatWebSocketCallbacks,
    conversationId?: string,
  ) => {
    capturedOnMessage = callbacks.onMessage;
    capturedScope = conversationId;
    return {
      connected: true,
      connectionStatus: 'websocket',
      sendMessage: vi.fn(),
      sendTyping: vi.fn(),
      subscribeConversation: mockSubscribe,
      unsubscribeConversation: mockUnsubscribe,
    };
  },
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

describe('channel real-time delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnMessage = undefined;
    capturedScope = undefined;
    mockListMessages.mockResolvedValue({ items: [], total: 0, hasMore: false });
  });

  it('should subscribe to the channel room when the channel opens and WS is connected', async () => {
    renderHook(() => useChannelMessages('chan-1'));
    await waitFor(() => { expect(mockSubscribe).toHaveBeenCalledWith('chan-1'); });
  });

  it('should pass the channel id as the WS delivery scope', async () => {
    renderHook(() => useChannelMessages('chan-1'));
    await waitFor(() => { expect(capturedScope).toBe('chan-1'); });
  });

  it('should append an incoming channel message live', async () => {
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

  it('should NOT append a message belonging to a different channel', async () => {
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

    // Give state a tick; the message must be dropped.
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.messages.some((m) => m.id === 'other')).toBe(false);
  });

  it('should unsubscribe from the room on unmount', async () => {
    const { unmount } = renderHook(() => useChannelMessages('chan-1'));
    await waitFor(() => { expect(mockSubscribe).toHaveBeenCalled(); });
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalledWith('chan-1');
  });

  it('should load existing channel history on open', async () => {
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
