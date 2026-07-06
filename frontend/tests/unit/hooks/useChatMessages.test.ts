/**
 * useChatMessages — conversation-scoped behavior (adj-164.2).
 *
 * The hook scopes a 1:1 chat strictly by its conversation id:
 *   - resolve the deterministic DM conversation for an agentId via getDm
 *   - fetch ONLY that conversation's messages via conversations.listMessages
 *   - apply incoming WS messages ONLY when their conversationId matches
 *
 * The legacy agent/recipient widening (api.messages.list({agentId}) + WS
 * agentId scoping) is retired — it was the root cause of wrong-thread bleed.
 * These tests assert the new contract AND keep coverage of the still-valid
 * behaviors (optimistic send, dedup, lifecycle, self-echo guard, pagination).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useChatMessages, DEFAULT_COORDINATOR_AGENT_ID } from '../../../src/hooks/useChatMessages';

// Mock the api module — conversation contract + send/markRead.
vi.mock('../../../src/services/api', () => {
  const apiObj = {
    conversations: {
      getDm: vi.fn(),
      listMessages: vi.fn(),
    },
    messages: {
      send: vi.fn(),
      markRead: vi.fn(),
    },
  };
  return { api: apiObj, default: apiObj };
});

// Mock CommunicationContext. The callback param is typed so per-test
// `mockImplementation((cb) => …)` overrides type-check cleanly.
const mockSubscribe = vi.fn((_cb: (msg: unknown) => void) => vi.fn());
vi.mock('../../../src/contexts/CommunicationContext', () => ({
  useCommunicationActions: () => ({
    subscribe: mockSubscribe,
    subscribeTimeline: vi.fn(() => () => {}),
    sendMessage: vi.fn(),
  }),
}));

import { api } from '../../../src/services/api';
import type { ChatMessage, Conversation, PaginatedResponse } from '../../../src/types';

// Deterministic DM ids per agent — the mock getDm maps agentId → conversation.
const DM_ID: Record<string, string> = {
  'agent-1': 'dm_agent1',
  'agent-2': 'dm_agent2',
  // adj-ropat: the no-agent default view resolves to the coordinator DM.
  [DEFAULT_COORDINATOR_AGENT_ID]: 'dm_coordinator',
};

function dmFor(agentId: string): Conversation {
  return {
    id: DM_ID[agentId] ?? `dm_${agentId}`,
    kind: 'dm',
    title: null,
    archived: false,
    createdAt: '2026-02-21T09:00:00Z',
    updatedAt: '2026-02-21T09:00:00Z',
  };
}

function makeChatMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  const agentId = overrides.agentId ?? 'agent-1';
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: null,
    agentId,
    recipient: 'user',
    role: 'agent',
    body: 'Hello from agent',
    metadata: null,
    deliveryStatus: 'delivered',
    eventType: null,
    threadId: null,
    conversationId: DM_ID[agentId] ?? `dm_${agentId}`,
    createdAt: '2026-02-21T10:00:00Z',
    updatedAt: '2026-02-21T10:00:00Z',
    ...overrides,
  };
}

function mockListResponse(items: ChatMessage[], hasMore = false): PaginatedResponse<ChatMessage> {
  return { items, total: items.length, hasMore };
}

const getDm = () => vi.mocked(api.conversations.getDm);
const listMessages = () => vi.mocked(api.conversations.listMessages);

beforeEach(() => {
  vi.clearAllMocks();
  // Default: getDm resolves the deterministic DM for the requested agent.
  getDm().mockImplementation((agentId: string) => Promise.resolve(dmFor(agentId)));
  // Default: no messages.
  listMessages().mockResolvedValue(mockListResponse([]));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useChatMessages', () => {
  describe('initial fetch', () => {
    it('should resolve the DM and fetch its messages on mount', async () => {
      const msg = makeChatMessage({ agentId: 'agent-1' });
      listMessages().mockResolvedValue(mockListResponse([msg]));

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(getDm()).toHaveBeenCalledWith('agent-1');
      expect(listMessages()).toHaveBeenCalledWith('dm_agent1', expect.anything());
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0]!.id).toBe(msg.id);
    });

    it('should start in loading state', () => {
      const { result } = renderHook(() => useChatMessages('agent-1'));
      expect(result.current.isLoading).toBe(true);
    });

    it('should set error on fetch failure', async () => {
      listMessages().mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBeTruthy();
      expect(result.current.error!.message).toBe('Network error');
    });

    it('should set error when DM resolution fails', async () => {
      getDm().mockRejectedValueOnce(new Error('resolve failed'));

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
      });
      expect(result.current.error!.message).toContain('resolve failed');
    });

    it('should refetch when agentId changes', async () => {
      const msg1 = makeChatMessage({ agentId: 'agent-1', body: 'From 1' });
      const msg2 = makeChatMessage({ agentId: 'agent-2', body: 'From 2' });

      listMessages().mockImplementation((conversationId: string) =>
        Promise.resolve(
          mockListResponse(conversationId === 'dm_agent1' ? [msg1] : [msg2]),
        ),
      );

      const { result, rerender } = renderHook(
        ({ agentId }) => useChatMessages(agentId),
        { initialProps: { agentId: 'agent-1' } }
      );

      await waitFor(() => {
        expect(result.current.messages).toHaveLength(1);
      });

      rerender({ agentId: 'agent-2' });

      await waitFor(() => {
        expect(result.current.messages[0]?.body).toBe('From 2');
      });

      expect(getDm()).toHaveBeenCalledWith('agent-1');
      expect(getDm()).toHaveBeenCalledWith('agent-2');
    });
  });

  describe('WebSocket real-time messages (conversation-scoped)', () => {
    it('should append new messages from WebSocket subscription', async () => {
      const existingMsg = makeChatMessage({ id: 'msg-1', body: 'Old' });
      listMessages().mockResolvedValue(mockListResponse([existingMsg]));

      let subscriberCallback: ((msg: unknown) => void) | undefined;
      mockSubscribe.mockImplementation((cb: unknown) => {
        subscriberCallback = cb as (msg: unknown) => void;
        return vi.fn();
      });

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.messages).toHaveLength(1);
      });

      expect(subscriberCallback).toBeDefined();
      act(() => {
        subscriberCallback!({
          id: 'msg-2',
          from: 'agent-1',
          to: 'user',
          body: 'New WS message',
          timestamp: '2026-02-21T10:05:00Z',
          conversationId: 'dm_agent1',
        });
      });

      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[1]!.body).toBe('New WS message');
    });

    it('should carry attachments from an inbound WebSocket message (adj-203.4.5)', async () => {
      listMessages().mockResolvedValue(mockListResponse([]));

      let subscriberCallback: ((msg: unknown) => void) | undefined;
      mockSubscribe.mockImplementation((cb: unknown) => {
        subscriberCallback = cb as (msg: unknown) => void;
        return vi.fn();
      });

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const attachment = {
        id: 'att-1',
        kind: 'image',
        filename: 'shot.png',
        mimeType: 'image/png',
        sizeBytes: 100,
      };

      act(() => {
        subscriberCallback!({
          id: 'msg-att',
          from: 'agent-1',
          to: 'user',
          body: 'here is a screenshot',
          timestamp: '2026-02-21T10:06:00Z',
          conversationId: 'dm_agent1',
          attachments: [attachment],
        });
      });

      // The live screenshot must render immediately — no manual refetch/reload.
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0]!.attachments).toEqual([attachment]);
    });

    it('should deduplicate messages by ID', async () => {
      const msg = makeChatMessage({ id: 'msg-dup', body: 'Original' });
      listMessages().mockResolvedValue(mockListResponse([msg]));

      let subscriberCallback: ((msg: unknown) => void) | undefined;
      mockSubscribe.mockImplementation((cb: unknown) => {
        subscriberCallback = cb as (msg: unknown) => void;
        return vi.fn();
      });

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.messages).toHaveLength(1);
      });

      act(() => {
        subscriberCallback!({
          id: 'msg-dup',
          from: 'agent-1',
          to: 'user',
          body: 'Original',
          timestamp: '2026-02-21T10:00:00Z',
          conversationId: 'dm_agent1',
        });
      });

      expect(result.current.messages).toHaveLength(1);
    });

    it('should drop WS messages for a different conversation (bleed regression)', async () => {
      listMessages().mockResolvedValue(mockListResponse([]));

      let subscriberCallback: ((msg: unknown) => void) | undefined;
      mockSubscribe.mockImplementation((cb: unknown) => {
        subscriberCallback = cb as (msg: unknown) => void;
        return vi.fn();
      });

      // Hook scoped to agent-1's DM (dm_agent1).
      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // A message for a DIFFERENT conversation must never appear here.
      act(() => {
        subscriberCallback!({
          id: 'msg-wrong-conv',
          from: 'agent-2',
          to: 'user',
          body: 'From another conversation',
          timestamp: '2026-02-21T10:05:00Z',
          conversationId: 'dm_agent2',
        });
      });

      expect(result.current.messages).toHaveLength(0);

      // A message for THIS conversation is accepted.
      act(() => {
        subscriberCallback!({
          id: 'msg-right-conv',
          from: 'agent-1',
          to: 'user',
          body: 'In this conversation',
          timestamp: '2026-02-21T10:06:00Z',
          conversationId: 'dm_agent1',
        });
      });

      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0]!.body).toBe('In this conversation');
    });

    it('should drop WS messages with no conversationId', async () => {
      listMessages().mockResolvedValue(mockListResponse([]));

      let subscriberCallback: ((msg: unknown) => void) | undefined;
      mockSubscribe.mockImplementation((cb: unknown) => {
        subscriberCallback = cb as (msg: unknown) => void;
        return vi.fn();
      });

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        subscriberCallback!({
          id: 'msg-no-conv',
          from: 'agent-1',
          to: 'user',
          body: 'Unscoped',
          timestamp: '2026-02-21T10:05:00Z',
        });
      });

      expect(result.current.messages).toHaveLength(0);
    });

    it('should scope WS delivery to the coordinator DM when no agentId is set', async () => {
      // adj-ropat: the default (no-agent) view now resolves to the coordinator
      // DM, so WS messages on that conversation are delivered — and messages
      // on an unrelated conversation are still dropped.
      let subscriberCallback: ((msg: unknown) => void) | undefined;
      mockSubscribe.mockImplementation((cb: unknown) => {
        subscriberCallback = cb as (msg: unknown) => void;
        return vi.fn();
      });

      const { result } = renderHook(() => useChatMessages());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // A message on a different conversation is dropped.
      act(() => {
        subscriberCallback!({
          id: 'msg-other',
          from: 'agent-1',
          to: 'user',
          body: 'From agent 1',
          timestamp: '2026-02-21T10:05:00Z',
          conversationId: 'dm_agent1',
        });
      });
      expect(result.current.messages).toHaveLength(0);

      // A message on the coordinator DM is delivered.
      act(() => {
        subscriberCallback!({
          id: 'msg-coord',
          from: DEFAULT_COORDINATOR_AGENT_ID,
          to: 'user',
          body: 'From coordinator',
          timestamp: '2026-02-21T10:06:00Z',
          conversationId: 'dm_coordinator',
        });
      });
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0]!.body).toBe('From coordinator');
    });
  });

  describe('default view (no agentId) → coordinator DM (adj-ropat)', () => {
    it('should resolve the coordinator DM when no agentId is provided', async () => {
      const { result } = renderHook(() => useChatMessages());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Resolves a real DM with the coordinator — never the empty user↔user view.
      expect(getDm()).toHaveBeenCalledWith(DEFAULT_COORDINATOR_AGENT_ID);
      expect(result.current.conversationId).toBe('dm_coordinator');
    });

    it('should load the coordinator DM history when no agentId is provided', async () => {
      const coordMsg = makeChatMessage({
        agentId: DEFAULT_COORDINATOR_AGENT_ID,
        conversationId: 'dm_coordinator',
        body: 'Coordinator history',
      });
      listMessages().mockImplementation((conversationId: string) =>
        Promise.resolve(
          mockListResponse(conversationId === 'dm_coordinator' ? [coordMsg] : []),
        ),
      );

      const { result } = renderHook(() => useChatMessages());

      await waitFor(() => {
        expect(result.current.messages).toHaveLength(1);
      });
      expect(result.current.messages[0]!.body).toBe('Coordinator history');
      expect(listMessages()).toHaveBeenCalledWith('dm_coordinator', expect.anything());
    });

    it('should route a send to the coordinator DM when no agentId is provided', async () => {
      vi.mocked(api.messages.send).mockResolvedValue({
        messageId: 'srv-coord-1',
        timestamp: '2026-02-21T10:07:00Z',
      });

      const { result } = renderHook(() => useChatMessages());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.sendMessage('Hello coordinator');
      });

      // The send targets the coordinator, NOT the dead user↔user default.
      expect(api.messages.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: DEFAULT_COORDINATOR_AGENT_ID, body: 'Hello coordinator' }),
      );
      const sent = result.current.messages.find((m) => m.body === 'Hello coordinator');
      expect(sent).toBeDefined();
      expect(sent!.recipient).toBe(DEFAULT_COORDINATOR_AGENT_ID);
    });
  });

  describe('addOptimistic', () => {
    it('should add an optimistic message without HTTP send', async () => {
      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        result.current.addOptimistic('WS message', 'client-123');
      });

      expect(result.current.messages).toHaveLength(1);
      const msg = result.current.messages[0]!;
      expect(msg.body).toBe('WS message');
      expect(msg.clientId).toBe('client-123');
      expect(msg.optimisticStatus).toBe('sending');
      expect(msg.role).toBe('user');

      expect(api.messages.send).not.toHaveBeenCalled();
    });

    it('should be confirmable via confirmDelivery', async () => {
      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        result.current.addOptimistic('WS message', 'client-456');
      });

      act(() => {
        result.current.confirmDelivery('client-456', 'server-id-789');
      });

      expect(result.current.messages[0]!.id).toBe('server-id-789');
      expect(result.current.messages[0]!.optimisticStatus).toBe('delivered');
    });
  });

  describe('sendMessage (optimistic UI)', () => {
    it('should add optimistic message immediately before API call resolves', async () => {
      let resolveApiSend: ((v: unknown) => void) | undefined;
      vi.mocked(api.messages.send).mockImplementation(
        () => new Promise((resolve) => { resolveApiSend = resolve; })
      );

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      let sendPromise: Promise<void>;
      act(() => {
        sendPromise = result.current.sendMessage('Hello, agent!');
      });

      expect(result.current.messages).toHaveLength(1);
      const optimistic = result.current.messages[0]!;
      expect(optimistic.body).toBe('Hello, agent!');
      expect(optimistic.optimisticStatus).toBe('sending');
      expect(optimistic.role).toBe('user');
      expect(optimistic.id).toMatch(/^optimistic-/);
      // Optimistic message is tagged with the open conversation.
      expect(optimistic.conversationId).toBe('dm_agent1');

      await act(async () => {
        resolveApiSend!({ messageId: 'server-msg-1', timestamp: '2026-02-21T11:00:00Z' });
        await sendPromise!;
      });

      expect(result.current.messages[0]!.id).toBe('server-msg-1');
      expect(result.current.messages[0]!.optimisticStatus).toBe('delivered');
    });

    it('should mark optimistic message as failed on API error', async () => {
      vi.mocked(api.messages.send).mockRejectedValue(new Error('Send failed'));

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        try {
          await result.current.sendMessage('Will fail');
        } catch {
          // Expected
        }
      });

      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0]!.optimisticStatus).toBe('failed');
      expect(result.current.messages[0]!.body).toBe('Will fail');
    });

    it('should call API with correct params', async () => {
      vi.mocked(api.messages.send).mockResolvedValue({
        messageId: 'new-msg',
        timestamp: '2026-02-21T11:00:00Z',
      });

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.sendMessage('Hello, agent!');
      });

      expect(api.messages.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'agent-1',
          body: 'Hello, agent!',
        })
      );
    });

    it('should send with threadId when provided', async () => {
      vi.mocked(api.messages.send).mockResolvedValue({
        messageId: 'new-msg',
        timestamp: '2026-02-21T11:00:00Z',
      });

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.sendMessage('Threaded reply', { threadId: 'thread-123' });
      });

      expect(api.messages.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'agent-1',
          body: 'Threaded reply',
          threadId: 'thread-123',
        })
      );
    });
  });

  describe('confirmDelivery', () => {
    it('should update optimistic message with server ID and delivered status', async () => {
      let resolveApiSend: ((v: unknown) => void) | undefined;
      vi.mocked(api.messages.send).mockImplementation(
        () => new Promise((resolve) => { resolveApiSend = resolve; })
      );

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        void result.current.sendMessage('Hello');
      });

      const clientId = result.current.messages[0]!.clientId!;
      expect(clientId).toBeDefined();

      act(() => {
        result.current.confirmDelivery(clientId, 'server-id-42');
      });

      expect(result.current.messages[0]!.id).toBe('server-id-42');
      expect(result.current.messages[0]!.optimisticStatus).toBe('delivered');

      resolveApiSend!({ messageId: 'server-id-42', timestamp: '2026-02-21T11:00:00Z' });
    });
  });

  describe('markFailed', () => {
    it('should mark an optimistic message as failed by clientId', async () => {
      let resolveApiSend: ((v: unknown) => void) | undefined;
      vi.mocked(api.messages.send).mockImplementation(
        () => new Promise((resolve) => { resolveApiSend = resolve; })
      );

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        void result.current.sendMessage('Will fail');
      });

      const clientId = result.current.messages[0]!.clientId!;

      act(() => {
        result.current.markFailed(clientId);
      });

      expect(result.current.messages[0]!.optimisticStatus).toBe('failed');

      resolveApiSend!({ messageId: 'whatever', timestamp: '2026-02-21T11:00:00Z' });
    });
  });

  describe('markRead', () => {
    it('should call API to mark message as read', async () => {
      vi.mocked(api.messages.markRead).mockResolvedValue(undefined);

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.markRead('msg-123');
      });

      expect(api.messages.markRead).toHaveBeenCalledWith('msg-123');
    });
  });

  describe('pagination (loadMore)', () => {
    it('should load older messages with before cursor scoped to the conversation', async () => {
      const initialMsg = makeChatMessage({
        id: 'msg-recent',
        createdAt: '2026-02-21T10:05:00Z',
        body: 'Recent',
      });
      const olderMsg = makeChatMessage({
        id: 'msg-old',
        createdAt: '2026-02-21T09:00:00Z',
        body: 'Older',
      });

      listMessages()
        .mockResolvedValueOnce(mockListResponse([initialMsg], true))
        .mockResolvedValueOnce(mockListResponse([olderMsg], false));

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.messages).toHaveLength(1);
      });

      expect(result.current.hasMore).toBe(true);

      await act(async () => {
        await result.current.loadMore();
      });

      expect(listMessages()).toHaveBeenLastCalledWith(
        'dm_agent1',
        expect.objectContaining({ beforeId: 'msg-recent' }),
      );

      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[0]!.id).toBe('msg-old');
    });
  });

  describe('no agentId', () => {
    it('should resolve and fetch the coordinator DM when no agentId provided (adj-ropat)', async () => {
      const { result } = renderHook(() => useChatMessages());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // No explicit agent → the default view maps to the coordinator DM, a
      // real conversation that is resolved and fetched (never the empty
      // user↔user surface that swallowed sends pre-fix).
      expect(getDm()).toHaveBeenCalledWith(DEFAULT_COORDINATOR_AGENT_ID);
      expect(listMessages()).toHaveBeenCalledWith('dm_coordinator', expect.anything());
      expect(result.current.conversationId).toBe('dm_coordinator');
    });
  });

  describe('acceptance criteria', () => {
    it('scopes by conversation, never widening by agentId', async () => {
      renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(listMessages()).toHaveBeenCalled();
      });
      // The conversation endpoint is used; the agent-widened list path is gone.
      expect(listMessages()).toHaveBeenCalledWith('dm_agent1', expect.anything());
    });

    it('shows only the open conversation when switching (bleed regression)', async () => {
      const msg1 = makeChatMessage({ agentId: 'agent-1', body: 'Agent 1 msg' });
      const msg2 = makeChatMessage({ agentId: 'agent-2', body: 'Agent 2 msg' });

      listMessages().mockImplementation((conversationId: string) =>
        Promise.resolve(
          mockListResponse(conversationId === 'dm_agent1' ? [msg1] : [msg2]),
        ),
      );

      const { result, rerender } = renderHook(
        ({ agentId }) => useChatMessages(agentId),
        { initialProps: { agentId: 'agent-1' } }
      );

      await waitFor(() => {
        expect(result.current.messages[0]?.body).toBe('Agent 1 msg');
      });

      rerender({ agentId: 'agent-2' });

      await waitFor(() => {
        expect(result.current.messages[0]?.body).toBe('Agent 2 msg');
      });

      // agent-1's message must never bleed into agent-2's view.
      expect(result.current.messages.map((m) => m.body)).not.toContain('Agent 1 msg');
    });

    it('preserves optimistic messages when server refetch completes', async () => {
      const serverMsg = makeChatMessage({ id: 'server-1', body: 'From server' });
      listMessages().mockResolvedValue(mockListResponse([serverMsg]));

      let resolveApiSend: ((v: unknown) => void) | undefined;
      vi.mocked(api.messages.send).mockImplementation(
        () => new Promise((resolve) => { resolveApiSend = resolve; })
      );

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.messages).toHaveLength(1);
      });

      act(() => {
        void result.current.sendMessage('Optimistic msg');
      });

      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[1]!.optimisticStatus).toBe('sending');

      await act(async () => {
        resolveApiSend!({ messageId: 'server-2', timestamp: '2026-02-21T11:00:00Z' });
      });

      expect(result.current.messages[1]!.optimisticStatus).toBe('delivered');
      expect(result.current.messages[1]!.id).toBe('server-2');
    });
  });

  describe('edge cases: agent switch state reset', () => {
    it('should clear messages when agentId changes', async () => {
      const msg1 = makeChatMessage({ agentId: 'agent-1', body: 'From 1' });
      const msg2 = makeChatMessage({ agentId: 'agent-2', body: 'From 2' });

      let resolveSecondFetch: ((v: PaginatedResponse<ChatMessage>) => void) | undefined;
      listMessages().mockImplementation((conversationId: string) => {
        if (conversationId === 'dm_agent1') return Promise.resolve(mockListResponse([msg1]));
        return new Promise((resolve) => { resolveSecondFetch = resolve; });
      });

      const { result, rerender } = renderHook(
        ({ agentId }) => useChatMessages(agentId),
        { initialProps: { agentId: 'agent-1' } }
      );

      await waitFor(() => {
        expect(result.current.messages).toHaveLength(1);
      });

      rerender({ agentId: 'agent-2' });

      // Stale agent-1 messages must be cleared immediately on switch.
      await waitFor(() => {
        expect(result.current.messages).toHaveLength(0);
      });

      await act(async () => {
        resolveSecondFetch!(mockListResponse([msg2]));
      });

      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0]!.body).toBe('From 2');
    });

    it('should reset hasMore when agentId changes', async () => {
      listMessages().mockImplementation((conversationId: string) =>
        Promise.resolve(
          mockListResponse([makeChatMessage()], conversationId === 'dm_agent1'),
        ),
      );

      const { result, rerender } = renderHook(
        ({ agentId }) => useChatMessages(agentId),
        { initialProps: { agentId: 'agent-1' } }
      );

      await waitFor(() => {
        expect(result.current.hasMore).toBe(true);
      });

      rerender({ agentId: 'agent-2' });

      await waitFor(() => {
        expect(result.current.hasMore).toBe(false);
      });
    });
  });

  describe('edge cases: optimistic + WS deduplication', () => {
    it('should not duplicate user-sent messages from WS broadcast (adj-106)', async () => {
      listMessages().mockResolvedValue(mockListResponse([]));
      vi.mocked(api.messages.send).mockResolvedValue({
        messageId: 'server-msg-1',
        timestamp: '2026-02-21T11:00:00Z',
      });

      let subscriberCallback: ((msg: unknown) => void) | undefined;
      mockSubscribe.mockImplementation((cb: unknown) => {
        subscriberCallback = cb as (msg: unknown) => void;
        return vi.fn();
      });

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.sendMessage('Hello agent');
      });

      expect(result.current.messages).toHaveLength(1);

      // Backend echoes the user's own message via WS — must be dropped.
      act(() => {
        subscriberCallback!({
          id: 'server-msg-1',
          from: 'user',
          to: 'agent-1',
          body: 'Hello agent',
          timestamp: '2026-02-21T11:00:00Z',
          conversationId: 'dm_agent1',
        });
      });

      expect(result.current.messages).toHaveLength(1);
    });
  });

  describe('edge cases: pagination order', () => {
    it('should prepend older messages before existing messages', async () => {
      const recentMsg = makeChatMessage({
        id: 'msg-recent',
        createdAt: '2026-02-21T10:05:00Z',
        body: 'Recent',
      });
      const olderMsg1 = makeChatMessage({
        id: 'msg-old-1',
        createdAt: '2026-02-21T09:00:00Z',
        body: 'Older 1',
      });
      const olderMsg2 = makeChatMessage({
        id: 'msg-old-2',
        createdAt: '2026-02-21T08:00:00Z',
        body: 'Older 2',
      });

      listMessages()
        .mockResolvedValueOnce(mockListResponse([recentMsg], true))
        .mockResolvedValueOnce(mockListResponse([olderMsg1, olderMsg2], false));

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.messages).toHaveLength(1);
      });

      await act(async () => {
        await result.current.loadMore();
      });

      expect(result.current.messages).toHaveLength(3);
      expect(result.current.messages[0]!.id).toBe('msg-old-1');
      expect(result.current.messages[1]!.id).toBe('msg-old-2');
      expect(result.current.messages[2]!.id).toBe('msg-recent');
    });

    it('should set hasMore:false when no more messages exist after loadMore', async () => {
      const recentMsg = makeChatMessage({
        id: 'msg-r',
        createdAt: '2026-02-21T10:05:00Z',
        body: 'Recent',
      });

      listMessages()
        .mockResolvedValueOnce(mockListResponse([recentMsg], true))
        .mockResolvedValueOnce(mockListResponse([], false));

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.hasMore).toBe(true);
      });

      await act(async () => {
        await result.current.loadMore();
      });

      expect(result.current.hasMore).toBe(false);
    });
  });

  describe('edge cases: WS subscription lifecycle', () => {
    it('should unsubscribe from WS on unmount', async () => {
      const mockUnsubscribe = vi.fn();
      mockSubscribe.mockImplementation(() => mockUnsubscribe);
      listMessages().mockResolvedValue(mockListResponse([]));

      const { unmount } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(mockSubscribe).toHaveBeenCalled();
      });

      unmount();

      expect(mockUnsubscribe).toHaveBeenCalled();
    });

    it('should not throw when a message arrives after unmount', async () => {
      let subscriberCallback: ((msg: unknown) => void) | undefined;
      mockSubscribe.mockImplementation((cb: unknown) => {
        subscriberCallback = cb as (msg: unknown) => void;
        return vi.fn();
      });
      listMessages().mockResolvedValue(mockListResponse([]));

      const { result, unmount } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      unmount();

      expect(() => {
        subscriberCallback?.({
          id: 'post-unmount',
          from: 'agent-1',
          to: 'user',
          body: 'Ghost message',
          timestamp: '2026-02-21T12:00:00Z',
          conversationId: 'dm_agent1',
        });
      }).not.toThrow();
    });
  });

  describe('edge cases: loadMore guard', () => {
    it('should not fetch when hasMore is false', async () => {
      listMessages().mockResolvedValue(mockListResponse([makeChatMessage()], false));

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const callCountBefore = listMessages().mock.calls.length;

      await act(async () => {
        await result.current.loadMore();
      });

      expect(listMessages().mock.calls.length).toBe(callCountBefore);
    });

    it('should not fetch when messages array is empty', async () => {
      listMessages().mockResolvedValue(mockListResponse([], true));

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const callCountBefore = listMessages().mock.calls.length;

      await act(async () => {
        await result.current.loadMore();
      });

      expect(listMessages().mock.calls.length).toBe(callCountBefore);
    });
  });

  describe('mutation: user self-echo guard', () => {
    it('should drop WS messages from user to prevent self-echo duplicates', async () => {
      listMessages().mockResolvedValue(mockListResponse([]));

      let subscriberCallback: ((msg: unknown) => void) | undefined;
      mockSubscribe.mockImplementation((cb: unknown) => {
        subscriberCallback = cb as (msg: unknown) => void;
        return vi.fn();
      });

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        subscriberCallback!({
          id: 'new-unique-user-msg',
          from: 'user',
          to: 'agent-1',
          body: 'User echo from backend broadcast',
          timestamp: '2026-02-21T10:00:00Z',
          conversationId: 'dm_agent1',
        });
      });

      expect(result.current.messages).toHaveLength(0);
    });
  });

  describe('mutation: WS message construction', () => {
    it('should set role to agent for incoming WS messages', async () => {
      listMessages().mockResolvedValue(mockListResponse([]));

      let subscriberCallback: ((msg: unknown) => void) | undefined;
      mockSubscribe.mockImplementation((cb: unknown) => {
        subscriberCallback = cb as (msg: unknown) => void;
        return vi.fn();
      });

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        subscriberCallback!({
          id: 'msg-ws-role',
          from: 'agent-1',
          to: 'user',
          body: 'Agent message',
          timestamp: '2026-02-21T10:00:00Z',
          conversationId: 'dm_agent1',
        });
      });

      expect(result.current.messages[0]!.role).toBe('agent');
    });

    it('should set deliveryStatus to delivered for incoming WS messages', async () => {
      listMessages().mockResolvedValue(mockListResponse([]));

      let subscriberCallback: ((msg: unknown) => void) | undefined;
      mockSubscribe.mockImplementation((cb: unknown) => {
        subscriberCallback = cb as (msg: unknown) => void;
        return vi.fn();
      });

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        subscriberCallback!({
          id: 'msg-ws-status',
          from: 'agent-1',
          to: 'user',
          body: 'Delivered message',
          timestamp: '2026-02-21T10:00:00Z',
          conversationId: 'dm_agent1',
        });
      });

      expect(result.current.messages[0]!.deliveryStatus).toBe('delivered');
    });

    it('should carry the open conversationId onto the constructed WS message', async () => {
      listMessages().mockResolvedValue(mockListResponse([]));

      let subscriberCallback: ((msg: unknown) => void) | undefined;
      mockSubscribe.mockImplementation((cb: unknown) => {
        subscriberCallback = cb as (msg: unknown) => void;
        return vi.fn();
      });

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        subscriberCallback!({
          id: 'msg-ws-conv',
          from: 'agent-1',
          to: 'user',
          body: 'Scoped message',
          timestamp: '2026-02-21T10:00:00Z',
          conversationId: 'dm_agent1',
        });
      });

      expect(result.current.messages[0]!.conversationId).toBe('dm_agent1');
    });
  });

  describe('mutation: optimistic message recipient', () => {
    it('should set optimistic message recipient to the agentId', async () => {
      vi.mocked(api.messages.send).mockResolvedValue({
        messageId: 'new-msg',
        timestamp: '2026-02-21T11:00:00Z',
      });

      const { result } = renderHook(() => useChatMessages('agent-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.sendMessage('Hello, agent!');
      });

      expect(result.current.messages[0]!.recipient).toBe('agent-1');
    });
  });
});
