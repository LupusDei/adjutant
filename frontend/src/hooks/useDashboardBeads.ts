import { useState, useEffect } from 'react';
import { api } from '../services/api';
import type { BeadInfo } from '../types';

const DASHBOARD_BEAD_LIMIT = 5;

export interface BeadCategory {
  items: BeadInfo[];
  totalCount: number;
}

interface DashboardBeads {
  inProgress: BeadCategory;
  open: BeadCategory;
  closed: BeadCategory;
  loading: boolean;
  error: string | null;
}

/** Priority label for display */
const PRIORITY_LABELS: Record<number, string> = {
  0: 'CRIT',
  1: 'HIGH',
  2: 'MED',
  3: 'LOW',
  4: 'BG',
};

export function priorityLabel(priority: number): string {
  return PRIORITY_LABELS[priority] ?? 'MED';
}

/**
 * Custom hook to fetch beads data for the dashboard.
 * Makes 3 separate API calls with status filters to avoid fetching all beads.
 * Returns max 5 beads per category.
 */
export function useDashboardBeads(): DashboardBeads {
  const [inProgress, setInProgress] = useState<BeadCategory>({ items: [], totalCount: 0 });
  const [open, setOpen] = useState<BeadCategory>({ items: [], totalCount: 0 });
  const [closed, setClosed] = useState<BeadCategory>({ items: [], totalCount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchBeads = async () => {
      setLoading(true);
      setError(null);
      try {
        const [inProgressBeads, openBeads, closedBeads] = await Promise.all([
          api.beads.list({ status: 'in_progress', limit: DASHBOARD_BEAD_LIMIT }),
          api.beads.list({ status: 'open', limit: DASHBOARD_BEAD_LIMIT }),
          api.beads.list({ status: 'closed', limit: DASHBOARD_BEAD_LIMIT }),
        ]);

        setInProgress({ items: inProgressBeads.slice(0, DASHBOARD_BEAD_LIMIT), totalCount: inProgressBeads.length });
        setOpen({ items: openBeads.slice(0, DASHBOARD_BEAD_LIMIT), totalCount: openBeads.length });
        setClosed({ items: closedBeads.slice(0, DASHBOARD_BEAD_LIMIT), totalCount: closedBeads.length });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch beads');
      } finally {
        setLoading(false);
      }
    };

    void fetchBeads();
  }, []);

  return { inProgress, open, closed, loading, error };
}
