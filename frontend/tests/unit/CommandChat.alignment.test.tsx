/**
 * Tests for message alignment-row classification (adj-mw7lc).
 *
 * Regression context: adj-164.2.2 added same-sender grouping, but the
 * virtualized timeline returns <MessageBubble> bare into react-virtuoso's
 * itemContent. Virtuoso wraps each item in a plain (non-flex) div, so a
 * bubble's `align-self: flex-end` (user) / `flex-start` (agent) never resolves
 * — user and agent messages both render left-aligned, distinguished only by
 * background colour. SMS-style chat requires the operator's own messages on the
 * right.
 *
 * The fix wraps each rendered message in a flex-column alignment row whose
 * class comes from `messageRowClass`. These tests pin that classification.
 * (The wrapper's presence in the component is exercised via this helper; an
 * end-to-end DOM assertion is impractical because react-virtuoso renders zero
 * items under jsdom, which has no layout.)
 */

import { describe, it, expect } from 'vitest';

import { messageRowKind, messageRowClass } from '../../src/components/chat/messageRow';
import type { DisplayMessage } from '../../src/hooks/useChatMessages';

function msg(overrides: Partial<DisplayMessage>): DisplayMessage {
  return {
    id: 'm-1',
    sessionId: null,
    agentId: 'swann',
    recipient: null,
    role: 'agent',
    body: 'hello',
    metadata: null,
    deliveryStatus: 'delivered',
    eventType: null,
    threadId: null,
    conversationId: 'dm_test',
    createdAt: '2026-05-17T10:30:00Z',
    updatedAt: '2026-05-17T10:30:00Z',
    ...overrides,
  };
}

describe('messageRowKind (adj-mw7lc)', () => {
  it("classifies the operator's own message as 'user' (right-aligned)", () => {
    expect(messageRowKind(msg({ role: 'user', agentId: 'user' }))).toBe('user');
  });

  it("classifies an agent message as 'agent' (left-aligned)", () => {
    expect(messageRowKind(msg({ role: 'agent', agentId: 'kerrigan' }))).toBe('agent');
  });

  it("classifies system and announcement messages as 'system' (centred)", () => {
    expect(messageRowKind(msg({ role: 'system' }))).toBe('system');
    expect(messageRowKind(msg({ role: 'announcement' }))).toBe('system');
  });
});

describe('messageRowClass (adj-mw7lc)', () => {
  it('builds the base + modifier class for a user row', () => {
    expect(messageRowClass(msg({ role: 'user', agentId: 'user' }))).toBe(
      'chat-msg-row chat-msg-row-user',
    );
  });

  it('builds the base + modifier class for an agent row', () => {
    expect(messageRowClass(msg({ role: 'agent' }))).toBe('chat-msg-row chat-msg-row-agent');
  });

  it('builds the base + modifier class for a system row', () => {
    expect(messageRowClass(msg({ role: 'system' }))).toBe('chat-msg-row chat-msg-row-system');
  });
});
