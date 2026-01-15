import { useState, useEffect } from 'react';
import { api } from '../services/api';
import type { Convoy } from '../types';

interface DashboardConvoys {
  recentConvoys: Convoy[];
  loading: boolean;
  error: string | null;
}

/**
 * Custom hook to fetch convoy data for the dashboard.
 */
export function useDashboardConvoys(): DashboardConvoys {
  const [recentConvoys, setRecentConvoys] = useState<Convoy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchConvoys = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await api.convoys.list();
        // For the dashboard, we'll take the 3 most recent convoys.
        // In a real scenario, the backend might offer a more specific endpoint.
        const sortedConvoys = response
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 3);
        setRecentConvoys(sortedConvoys);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch convoys');
      } finally {
        setLoading(false);
      }
    };

    void fetchConvoys();
  }, []);

  return { recentConvoys, loading, error };
}
