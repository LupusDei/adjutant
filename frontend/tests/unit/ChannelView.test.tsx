/**
 * ChannelView (adj-164.5.3) — multi-party room view.
 *
 * The room reuses the DM rendering path: MessageBubble + react-virtuoso +
 * same-sender run grouping (no perf regression vs adj-139). The distinguishing
 * behavior under test here is multi-party attribution — two different agents
 * never share a sender run, and each agent's callsign is shown.
 *
 * The data layer (`useChannelMessages`) is mocked so this stays a focused
 * rendering test; real-time wiring is covered by channel-realtime.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import type { DisplayMessage } from '../../src/hooks/useChatMessages';

let mockMessages: DisplayMessage[] = [];
const mockSend = vi.fn();

vi.mock('../../src/hooks/useChannelMessages', () => ({
  useChannelMessages: () => ({
    messages: mockMessages,
    isLoading: false,
    error: null,
    hasMore: false,
    sendMessage: mockSend,
    loadMore: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Render Virtuoso's items eagerly so jsdom (which has no layout) still mounts
// the bubbles we assert on — same approach the CommandChat virtualized test
// relies on via the real library's fallback.
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent }: { data: DisplayMessage[]; itemContent: (i: number, m: DisplayMessage) => React.ReactNode }) => (
    <div data-testid="virtuoso">{data.map((m, i) => <div key={m.id}>{itemContent(i, m)}</div>)}</div>
  ),
}));

import { ChannelView } from '../../src/components/chat/ChannelView';

function msg(id: string, agentId: string, role: 'user' | 'agent', body: string): DisplayMessage {
  return {
    id,
    sessionId: null,
    agentId,
    recipient: 'c1',
    role,
    body,
    metadata: null,
    deliveryStatus: 'delivered',
    eventType: null,
    threadId: null,
    conversationId: 'c1',
    createdAt: '2026-05-29T12:00:00Z',
    updatedAt: '2026-05-29T12:00:00Z',
  };
}

describe('ChannelView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMessages = [];
  });

  it('should render the channel title in the header', () => {
    render(<ChannelView channelId="c1" title="ops-room" />);
    expect(screen.getByRole('heading', { name: /ops-room/i })).toBeInTheDocument();
  });

  it('should render messages from multiple senders with per-sender attribution', () => {
    mockMessages = [
      msg('m1', 'raynor', 'agent', 'scanning sector'),
      msg('m2', 'kerrigan', 'agent', 'contact at 0300'),
      msg('m3', 'user', 'user', 'hold position'),
    ];
    render(<ChannelView channelId="c1" title="ops-room" />);

    // Both agents are attributed by callsign, and the user is labelled YOU.
    expect(screen.getByText('RAYNOR')).toBeInTheDocument();
    expect(screen.getByText('KERRIGAN')).toBeInTheDocument();
    expect(screen.getByText('YOU')).toBeInTheDocument();
    expect(screen.getByText('scanning sector')).toBeInTheDocument();
    expect(screen.getByText('contact at 0300')).toBeInTheDocument();
  });

  it('should render via the virtualized list (react-virtuoso)', () => {
    mockMessages = [msg('m1', 'raynor', 'agent', 'hi')];
    render(<ChannelView channelId="c1" title="ops-room" />);
    expect(screen.getByTestId('virtuoso')).toBeInTheDocument();
  });

  it('should show an empty-state when the room has no messages', () => {
    mockMessages = [];
    render(<ChannelView channelId="c1" title="ops-room" />);
    expect(screen.getByText(/no messages/i)).toBeInTheDocument();
  });

  it('should NOT group two different agents into the same sender run', () => {
    mockMessages = [
      msg('m1', 'raynor', 'agent', 'first'),
      msg('m2', 'kerrigan', 'agent', 'second'),
    ];
    render(<ChannelView channelId="c1" title="ops-room" />);
    // Distinct agents each render their own callsign header (no run collapse).
    expect(screen.getByText('RAYNOR')).toBeInTheDocument();
    expect(screen.getByText('KERRIGAN')).toBeInTheDocument();
  });

  it('should send a message through the data hook when the form is submitted', async () => {
    mockSend.mockResolvedValue(undefined);
    render(<ChannelView channelId="c1" title="ops-room" />);
    const input = screen.getByPlaceholderText(/message/i);
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(input, { target: { value: 'all units advance' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockSend).toHaveBeenCalledWith('all units advance');
  });
});
