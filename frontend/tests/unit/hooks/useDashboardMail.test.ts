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
    subject: 'Hello',
    body: 'Hi there',
    read: false,
    timestamp: '2023-01-01T12:00:00Z',
    recipient: 'test',
  },
  {
    id: 'msg2',
    sender: 'Bob',
    subject: 'Meeting',
    body: 'About the meeting',
    read: true,
    timestamp: '2023-01-02T12:00:00Z',
    recipient: 'test',
  },
  {
    id: 'msg3',
    sender: 'Charlie',
    subject: 'Update',
    body: 'Quick update',
    read: false,
    timestamp: '2023-01-03T12:00:00Z',
    recipient: 'test',
  },
  {
    id: 'msg4',
    sender: 'David',
    subject: 'Report',
    body: 'Monthly report',
    read: true,
    timestamp: '2023-01-04T12:00:00Z',
    recipient: 'test',
  },
];

describe('useDashboardMail', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
  });

  it('should fetch unread and recent messages successfully', async () => {
    // Mock the API calls
    (api.mail.list as vi.Mock).mockImplementation((params) => {
      if (params?.unreadOnly) {
        return Promise.resolve({
          items: mockMessages.filter((msg) => !msg.read),
          total: 2,
          limit: 3,
          offset: 0,
        });
      }
      return Promise.resolve({
        items: mockMessages.slice(0, params?.limit || mockMessages.length),
        total: mockMessages.length,
        limit: 3,
        offset: 0,
      });
    });

    const { result } = renderHook(() => useDashboardMail());

    // Initial state
    expect(result.current.loading).toBe(true);
    expect(result.current.unreadMessages).toEqual([]);
    expect(result.current.recentMessages).toEqual([]);
    expect(result.current.error).toBeNull();

    // Wait for the hook to finish fetching
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Assert fetched data
    expect(result.current.unreadMessages).toEqual([mockMessages[0], mockMessages[2]]);
    expect(result.current.recentMessages).toEqual([mockMessages[0], mockMessages[1], mockMessages[2]]);
    expect(result.current.error).toBeNull();
    expect(api.mail.list).toHaveBeenCalledTimes(2);
    expect(api.mail.list).toHaveBeenCalledWith({ unreadOnly: true, limit: 3 });
    expect(api.mail.list).toHaveBeenCalledWith({ limit: 3 });
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'Network error during mail fetch';
    (api.mail.list as vi.Mock).mockRejectedValueOnce(new Error(errorMessage)); // First call fails
    (api.mail.list as vi.Mock).mockResolvedValueOnce({ items: [], total: 0, limit: 3, offset: 0 }); // Second call succeeds to avoid unhandled rejection

    const { result } = renderHook(() => useDashboardMail());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe(errorMessage);
    expect(result.current.unreadMessages).toEqual([]);
    // Depending on when the error occurs, recentMessages might be empty or partially filled.
    // For this test, we expect the unread to fail and recent to be empty from the successful mock.
    expect(result.current.recentMessages).toEqual([]);
  });

  it('should return empty arrays if no messages are found', async () => {
    (api.mail.list as vi.Mock).mockResolvedValue({ items: [], total: 0, limit: 3, offset: 0 });

    const { result } = renderHook(() => useDashboardMail());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.unreadMessages).toEqual([]);
    expect(result.current.recentMessages).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});
