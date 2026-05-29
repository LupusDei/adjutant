/**
 * ChannelList (adj-164.5.2) — presentational channel sidebar.
 *
 * Pure rendering + interaction surface: it takes the roster + unread map from
 * `useChannels` and reports selection / creation back up via callbacks. It owns
 * no data fetching, so it is trivially testable in isolation.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import { ChannelList } from '../../src/components/chat/ChannelList';
import type { ChannelSummary } from '../../src/types';

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

const CHANNELS = [channel('c1', 'general'), channel('c2', 'ops-room')];

describe('ChannelList', () => {
  it('should render every channel title', () => {
    render(
      <ChannelList channels={CHANNELS} unread={{}} selectedId={null} onSelect={vi.fn()} onCreate={vi.fn()} />,
    );
    expect(screen.getByText(/general/i)).toBeInTheDocument();
    expect(screen.getByText(/ops-room/i)).toBeInTheDocument();
  });

  it('should render an unread badge with the count for channels with unread messages', () => {
    render(
      <ChannelList
        channels={CHANNELS}
        unread={{ c1: 5 }}
        selectedId={null}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    const badge = screen.getByTestId('channel-unread-c1');
    expect(badge).toHaveTextContent('5');
    // No badge for a channel with zero unread.
    expect(screen.queryByTestId('channel-unread-c2')).not.toBeInTheDocument();
  });

  it('should invoke onSelect with the channel id when a channel row is clicked', () => {
    const onSelect = vi.fn();
    render(
      <ChannelList channels={CHANNELS} unread={{}} selectedId={null} onSelect={onSelect} onCreate={vi.fn()} />,
    );
    fireEvent.click(screen.getByText(/ops-room/i));
    expect(onSelect).toHaveBeenCalledWith('c2');
  });

  it('should mark the selected channel row as active', () => {
    render(
      <ChannelList channels={CHANNELS} unread={{}} selectedId="c2" onSelect={vi.fn()} onCreate={vi.fn()} />,
    );
    const active = screen.getByTestId('channel-row-c2');
    expect(active).toHaveAttribute('aria-current', 'true');
  });

  it('should call onCreate with the trimmed name when the create form is submitted', () => {
    const onCreate = vi.fn();
    render(
      <ChannelList channels={CHANNELS} unread={{}} selectedId={null} onSelect={vi.fn()} onCreate={onCreate} />,
    );
    // Open the inline create input.
    fireEvent.click(screen.getByRole('button', { name: /new channel/i }));
    const input = screen.getByPlaceholderText(/channel name/i);
    fireEvent.change(input, { target: { value: '  deploys  ' } });
    fireEvent.submit(input.closest('form')!);
    expect(onCreate).toHaveBeenCalledWith('deploys');
  });

  it('should NOT call onCreate when the create form is submitted empty', () => {
    const onCreate = vi.fn();
    render(
      <ChannelList channels={CHANNELS} unread={{}} selectedId={null} onSelect={vi.fn()} onCreate={onCreate} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /new channel/i }));
    const input = screen.getByPlaceholderText(/channel name/i);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(input.closest('form')!);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('should render an empty-state hint when there are no channels', () => {
    render(
      <ChannelList channels={[]} unread={{}} selectedId={null} onSelect={vi.fn()} onCreate={vi.fn()} />,
    );
    expect(screen.getByText(/no channels/i)).toBeInTheDocument();
  });

  it('should show the member count for each channel', () => {
    render(
      <ChannelList
        channels={[channel('c1', 'general', 4)]}
        unread={{}}
        selectedId={null}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    const row = screen.getByTestId('channel-row-c1');
    expect(within(row).getByText(/4/)).toBeInTheDocument();
  });
});
