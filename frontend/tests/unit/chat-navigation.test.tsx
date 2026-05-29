/**
 * DM ↔ Channels navigation (adj-164.5.5).
 *
 * The chat panel container (ChatView) hosts two surfaces: 1:1 DMs and
 * multi-party channels. Switching between them must be state-preserving — the
 * selected agent and the selected channel each survive a round-trip through the
 * other mode, so the operator never loses their place. Scoping is also strict:
 * DM mode renders CommandChat (scoped by agent), channel mode renders
 * ChannelView (scoped by channel id).
 *
 * The heavy children + data hooks are mocked so this is a focused
 * container-behavior test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import type { ChannelSummary } from '../../src/types';

// --- Mock data hooks ---------------------------------------------------------
vi.mock('../../src/hooks/useUnreadCounts', () => ({
  useUnreadCounts: () => ({ counts: {}, totalUnread: 0, markRead: vi.fn() }),
}));

function channel(id: string, title: string): ChannelSummary {
  return {
    id, kind: 'channel', title, archived: false, memberCount: 2,
    createdAt: '2026-05-29T10:00:00Z', updatedAt: '2026-05-29T10:00:00Z',
  };
}

// createChannel resolves with the new channel (real hook contract) so the
// container's `.then(created => setSelectedChannelId(created.id))` is exercised.
const mockCreate = vi.fn(() => Promise.resolve(channel('c3', 'deploys')));
const mockJoin = vi.fn();
vi.mock('../../src/hooks/useChannels', () => ({
  useChannels: () => ({
    channels: [channel('c1', 'general'), channel('c2', 'ops')],
    unread: {},
    isLoading: false,
    error: null,
    createChannel: mockCreate,
    joinChannel: mockJoin,
    refresh: vi.fn(),
  }),
}));

// --- Mock heavy children: render only their scoping props as text ------------
vi.mock('../../src/components/chat/CommandChat', () => ({
  CommandChat: ({ agentId }: { agentId?: string }) => (
    <div data-testid="command-chat">DM:{agentId ?? 'none'}</div>
  ),
}));

vi.mock('../../src/components/chat/ChannelView', () => ({
  ChannelView: ({ channelId, title }: { channelId: string; title: string }) => (
    <div data-testid="channel-view">CHAN:{channelId}:{title}</div>
  ),
}));

vi.mock('../../src/components/chat/ChatAgentSelector', () => ({
  ChatAgentSelector: ({ value, onChange }: { value: string; onChange: (a: string) => void }) => (
    <div>
      <span data-testid="selected-agent">{value || 'none'}</span>
      <button onClick={() => { onChange('raynor'); }}>pick-raynor</button>
    </div>
  ),
}));

import { ChatView } from '../../src/components/chat/ChatView';

describe('ChatView DM ↔ Channels navigation', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('should default to DM mode showing CommandChat', () => {
    render(<ChatView />);
    expect(screen.getByTestId('command-chat')).toBeInTheDocument();
    expect(screen.queryByTestId('channel-view')).not.toBeInTheDocument();
  });

  it('should switch to channels mode and show the channel list', () => {
    render(<ChatView />);
    fireEvent.click(screen.getByRole('tab', { name: /channels/i }));
    expect(screen.getByText(/general/i)).toBeInTheDocument();
    expect(screen.getByText(/ops/i)).toBeInTheDocument();
  });

  it('should render ChannelView scoped to the selected channel', () => {
    render(<ChatView />);
    fireEvent.click(screen.getByRole('tab', { name: /channels/i }));
    fireEvent.click(screen.getByTestId('channel-row-c2'));
    expect(screen.getByTestId('channel-view')).toHaveTextContent('CHAN:c2:ops');
  });

  it('should preserve the selected agent when switching to channels and back', () => {
    render(<ChatView />);
    // Pick an agent in DM mode.
    fireEvent.click(screen.getByRole('button', { name: /pick-raynor/i }));
    expect(screen.getByTestId('command-chat')).toHaveTextContent('DM:raynor');

    // Go to channels, then back to DMs.
    fireEvent.click(screen.getByRole('tab', { name: /channels/i }));
    fireEvent.click(screen.getByRole('tab', { name: /direct/i }));

    // The agent selection survived the round-trip.
    expect(screen.getByTestId('command-chat')).toHaveTextContent('DM:raynor');
  });

  it('should preserve the selected channel when switching to DMs and back', () => {
    render(<ChatView />);
    fireEvent.click(screen.getByRole('tab', { name: /channels/i }));
    fireEvent.click(screen.getByTestId('channel-row-c1'));
    expect(screen.getByTestId('channel-view')).toHaveTextContent('CHAN:c1:general');

    // Round-trip through DMs.
    fireEvent.click(screen.getByRole('tab', { name: /direct/i }));
    fireEvent.click(screen.getByRole('tab', { name: /channels/i }));

    // The channel selection survived.
    expect(screen.getByTestId('channel-view')).toHaveTextContent('CHAN:c1:general');
  });

  it('should create a channel via the list create action', () => {
    render(<ChatView />);
    fireEvent.click(screen.getByRole('tab', { name: /channels/i }));
    fireEvent.click(screen.getByRole('button', { name: /new channel/i }));
    const input = screen.getByPlaceholderText(/channel name/i);
    fireEvent.change(input, { target: { value: 'deploys' } });
    fireEvent.submit(input.closest('form')!);
    expect(mockCreate).toHaveBeenCalledWith('deploys');
  });
});
