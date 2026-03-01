import { useState, useEffect } from 'react';
import { api } from '../services/api';
import type { AgentType, CrewMemberStatus } from '../types';

/** Crew member info for dashboard display */
export interface DashboardCrewMember {
  name: string;
  type: AgentType;
  status: CrewMemberStatus;
  rig: string | null;
  currentTask?: string | undefined;
}

interface DashboardCrew {
  /** Total crew count */
  totalCrew: number;
  /** Active (working + idle) count */
  activeCrew: number;
  /** 3 most recent agents sorted by status priority */
  recentCrew: DashboardCrewMember[];
  /** Alerts for blocked/stuck agents */
  crewAlerts: string[];
  loading: boolean;
  error: string | null;
}

/**
 * Custom hook to fetch crew data for the dashboard.
 */
/** Agent types to show in the dashboard crew section */
const DASHBOARD_AGENT_TYPES: AgentType[] = ['user', 'agent'];

/** Status priority for sorting (lower = more important) */
const STATUS_PRIORITY: Record<CrewMemberStatus, number> = {
  working: 0,
  blocked: 1,
  stuck: 2,
  idle: 3,
  offline: 4,
};

export function useDashboardCrew(): DashboardCrew {
  const [totalCrew, setTotalCrew] = useState(0);
  const [activeCrew, setActiveCrew] = useState(0);
  const [recentCrew, setRecentCrew] = useState<DashboardCrewMember[]>([]);
  const [crewAlerts, setCrewAlerts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCrewData = async () => {
      setLoading(true);
      setError(null);
      try {
        const crewMembers = await api.agents.list();

        // Filter to relevant agent types
        const dashboardAgents = crewMembers.filter((m) =>
          DASHBOARD_AGENT_TYPES.includes(m.type)
        );
        setTotalCrew(dashboardAgents.length);

        // Count active (working + idle)
        const active = dashboardAgents.filter((m) => m.status === 'working' || m.status === 'idle').length;
        setActiveCrew(active);

        // Get 3 most recent agents sorted by status priority
        const recent = dashboardAgents
          .sort((a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status])
          .slice(0, 3)
          .map((m) => ({ name: m.name, type: m.type, status: m.status, rig: m.rig, currentTask: m.currentTask }));
        setRecentCrew(recent);

        // Generate alerts for blocked/stuck agents
        const alerts: string[] = [];
        for (const m of dashboardAgents) {
          if (m.status === 'stuck') {
            alerts.push(`${m.name} is STUCK`);
          } else if (m.status === 'blocked') {
            alerts.push(`${m.name} is blocked`);
          }
        }
        setCrewAlerts(alerts);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch crew data');
      } finally {
        setLoading(false);
      }
    };

    void fetchCrewData();
  }, []);

  return { totalCrew, activeCrew, recentCrew, crewAlerts, loading, error };
}
