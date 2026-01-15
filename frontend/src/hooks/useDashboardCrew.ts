import { useState, useEffect } from 'react';
import { api } from '../services/api';
import type { CrewMember } from '../types';

interface DashboardCrew {
  totalCrew: number;
  activeCrew: number;
  crewAlerts: string[]; // Placeholder for actual alerts
  loading: boolean;
  error: string | null;
}

/**
 * Custom hook to fetch crew data for the dashboard.
 */
export function useDashboardCrew(): DashboardCrew {
  const [totalCrew, setTotalCrew] = useState(0);
  const [activeCrew, setActiveCrew] = useState(0);
  const [crewAlerts, setCrewAlerts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCrewData = async () => {
      setLoading(true);
      setError(null);
      try {
        const crewMembers = await api.agents.list();
        setTotalCrew(crewMembers.length);
        const active = crewMembers.filter((m) => m.status === 'active').length;
        setActiveCrew(active);
        setCrewAlerts([]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch crew data');
      } finally {
        setLoading(false);
      }
    };

    void fetchCrewData();
  }, []);

  return { totalCrew, activeCrew, crewAlerts, loading, error };
}
