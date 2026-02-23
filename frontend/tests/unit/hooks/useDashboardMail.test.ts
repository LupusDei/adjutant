import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDashboardMail } from '../../../src/hooks/useDashboardMail';
import { api } from '../../../src/services/api';
import type { Message } from '../../../src/types';

// Mock the API service
vi.mock('../../../src/services/api', () => ({
  api: {
    mail: {
      list: vi.fn(),
    },
  },
}));

const mockMessages: Message[] = [
  {
    id: 'msg1',
    sender: 'Alice',
    from: 'alice@test',
    subject: 'Hello',
    body: 'Hi there',
    read: false,
    timestamp: '2023-01-03T12:00:00Z',
    recipient: 'test',
    threadId: 'thread1',
  },
  {
    id: 'msg2',
    sender: 'Bob',
    from: 'bob@test',
    subject: 'Meeting',
    body: 'About the meeting',
    read: true,
    timestamp: '2023-01-02T12:00:00Z',
    recipient: 'test',
    threadId: 'thread2',
  },
  {
    id: 'msg3',
    sender: 'Charlie',
    from: 'charlie@test',
    subject: 'Update',
    body: 'Quick update',
    read: false,
    timestamp: '2023-01-01T12:00:00Z',
    recipient: 'test',
    threadId: 'thread3',
  },
];

describe('useDashboardMail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch and return mail data successfully', async () => {
    vi.mocked(api.mail.list).mockResolvedValue({
      items: mockMessages,
      total: mockMessages.length,
      limit: 100,
      offset: 0,
    });

    const { result } = renderHook(() => useDashboardMail());

    // Initial state
    expect(result.current.loading).toBe(true);
    expect(result.current.recentMessages).toEqual([]);
    expect(result.current.error).toBeNull();

    // Wait for the hook to finish fetching
    await waitFor(() => { expect(result.current.loading).toBe(false); });

    // Assert fetched data
    expect(result.current.totalCount).toBe(3); // 3 unique threads
    expect(result.current.unreadCount).toBe(2); // msg1 and msg3 are unread
    expect(result.current.recentMessages).toHaveLength(3);
    // Messages sorted by timestamp descending
    expect(result.current.recentMessages[0].id).toBe('msg1');
    expect(result.current.error).toBeNull();
    expect(api.mail.list).toHaveBeenCalledWith({ all: true });
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'Network error during mail fetch';
    vi.mocked(api.mail.list).mockRejectedValue(new Error(errorMessage));

    const { result } = renderHook(() => useDashboardMail());

    await waitFor(() => { expect(result.current.loading).toBe(false); });

    expect(result.current.error).toBe(errorMessage);
    expect(result.current.recentMessages).toEqual([]);
    expect(result.current.totalCount).toBe(0);
    expect(result.current.unreadCount).toBe(0);
  });

  it('should return empty state if no messages are found', async () => {
    vi.mocked(api.mail.list).mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });

    const { result } = renderHook(() => useDashboardMail());

    await waitFor(() => { expect(result.current.loading).toBe(false); });

    expect(result.current.recentMessages).toEqual([]);
    expect(result.current.totalCount).toBe(0);
    expect(result.current.unreadCount).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('should filter out handoff messages from recent messages', async () => {
    const messagesWithHandoff: Message[] = [
      ...mockMessages,
      {
        id: 'msg4',
        sender: 'System',
        from: 'system@test',
        subject: 'HANDOFF: Session transfer',
        body: 'Handoff content',
        read: true,
        timestamp: '2023-01-04T12:00:00Z',
        recipient: 'test',
        threadId: 'thread4',
      },
    ];
    vi.mocked(api.mail.list).mockResolvedValue({
      items: messagesWithHandoff,
      total: 4,
      limit: 100,
      offset: 0,
    });

    const { result } = renderHook(() => useDashboardMail());

    await waitFor(() => { expect(result.current.loading).toBe(false); });

    // Handoff message should be filtered out of recent messages
    expect(result.current.recentMessages).toHaveLength(3);
    expect(result.current.recentMessages.find((m) => m.id === 'msg4')).toBeUndefined();
    // But still counted in totals
    expect(result.current.totalCount).toBe(4);
  });
});
