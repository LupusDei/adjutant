import { useState, useEffect } from 'react';
import { api } from '../services/api';
import type { Message } from '../types';

interface DashboardMail {
  unreadMessages: Message[];
  recentMessages: Message[];
  loading: boolean;
  error: string | null;
}

/**
 * Custom hook to fetch mail data for the dashboard.
 */
export function useDashboardMail(): DashboardMail {
  const [unreadMessages, setUnreadMessages] = useState<Message[]>([]);
  const [recentMessages, setRecentMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMail = async () => {
      setLoading(true);
      setError(null);
      try {
        // Attempt to fetch unread messages
        const unreadRes = await api.mail.list({ unreadOnly: true, limit: 3 });
        setUnreadMessages(unreadRes.items);

        // Fetch recent messages (if unread are less than 3 or for general recency)
        const recentRes = await api.mail.list({ limit: 3 });
        setRecentMessages(recentRes.items);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch mail');
      } finally {
        setLoading(false);
      }
    };

    void fetchMail();
  }, []);

  return { unreadMessages, recentMessages, loading, error };
}
