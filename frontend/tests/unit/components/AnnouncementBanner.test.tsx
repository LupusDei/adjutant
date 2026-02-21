import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import React from 'react';
import { AnnouncementBanner } from '../../../src/components/chat/AnnouncementBanner';

// Mock CommunicationContext
const mockSubscribe = vi.fn(() => vi.fn());
vi.mock('../../../src/contexts/CommunicationContext', () => ({
  useCommunication: () => ({
    subscribe: mockSubscribe,
    connectionStatus: 'websocket',
    priority: 'real-time',
    setPriority: vi.fn(),
    sendMessage: vi.fn(),
  }),
}));

describe('AnnouncementBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should render nothing when there are no announcements', () => {
    const { container } = render(<AnnouncementBanner />);
    expect(container.querySelector('.announcement-banner')).toBeNull();
  });

  it('should display an announcement when one arrives via WebSocket', () => {
    let subscriberCallback: ((msg: any) => void) | undefined;
    mockSubscribe.mockImplementation((cb: any) => {
      subscriberCallback = cb;
      return vi.fn();
    });

    render(<AnnouncementBanner />);

    act(() => {
      subscriberCallback!({
        id: 'ann-1',
        from: 'system',
        to: 'all',
        body: 'Build completed successfully',
        timestamp: '2026-02-21T10:00:00Z',
        metadata: {
          type: 'announcement',
          announcementType: 'completion',
        },
      });
    });

    expect(screen.getByText('Build completed successfully')).toBeTruthy();
  });

  it('should show announcement type label', () => {
    let subscriberCallback: ((msg: any) => void) | undefined;
    mockSubscribe.mockImplementation((cb: any) => {
      subscriberCallback = cb;
      return vi.fn();
    });

    render(<AnnouncementBanner />);

    act(() => {
      subscriberCallback!({
        id: 'ann-2',
        from: 'system',
        to: 'all',
        body: 'Need input on API design',
        timestamp: '2026-02-21T10:00:00Z',
        metadata: {
          type: 'announcement',
          announcementType: 'question',
        },
      });
    });

    expect(screen.getByText('QUESTION')).toBeTruthy();
  });

  it('should auto-dismiss after 10 seconds', () => {
    let subscriberCallback: ((msg: any) => void) | undefined;
    mockSubscribe.mockImplementation((cb: any) => {
      subscriberCallback = cb;
      return vi.fn();
    });

    render(<AnnouncementBanner />);

    act(() => {
      subscriberCallback!({
        id: 'ann-3',
        from: 'system',
        to: 'all',
        body: 'Auto dismiss me',
        timestamp: '2026-02-21T10:00:00Z',
        metadata: {
          type: 'announcement',
          announcementType: 'completion',
        },
      });
    });

    expect(screen.getByText('Auto dismiss me')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(screen.queryByText('Auto dismiss me')).toBeNull();
  });

  it('should dismiss on click', async () => {
    vi.useRealTimers(); // userEvent needs real timers
    let subscriberCallback: ((msg: any) => void) | undefined;
    mockSubscribe.mockImplementation((cb: any) => {
      subscriberCallback = cb;
      return vi.fn();
    });

    render(<AnnouncementBanner />);

    act(() => {
      subscriberCallback!({
        id: 'ann-4',
        from: 'system',
        to: 'all',
        body: 'Click to dismiss',
        timestamp: '2026-02-21T10:00:00Z',
        metadata: {
          type: 'announcement',
          announcementType: 'blocker',
        },
      });
    });

    const banner = screen.getByText('Click to dismiss');
    expect(banner).toBeTruthy();

    const user = userEvent.setup();
    const dismissBtn = screen.getByRole('button', { name: /dismiss/i });
    await user.click(dismissBtn);

    expect(screen.queryByText('Click to dismiss')).toBeNull();
  });

  it('should ignore non-announcement messages', () => {
    let subscriberCallback: ((msg: any) => void) | undefined;
    mockSubscribe.mockImplementation((cb: any) => {
      subscriberCallback = cb;
      return vi.fn();
    });

    const { container } = render(<AnnouncementBanner />);

    act(() => {
      subscriberCallback!({
        id: 'msg-1',
        from: 'agent-1',
        to: 'user',
        body: 'Regular message',
        timestamp: '2026-02-21T10:00:00Z',
      });
    });

    expect(container.querySelector('.announcement-banner')).toBeNull();
  });
});
