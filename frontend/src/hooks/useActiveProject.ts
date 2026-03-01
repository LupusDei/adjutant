import { useState, useEffect } from 'react';

import { api } from '../services/api';

/**
 * Hook that fetches the active project from the projects API.
 * Returns the active project's name (matching bead source names)
 * or null if no project is active.
 *
 * Fetches once on mount and caches the result.
 */
export function useActiveProject(): { activeProject: string | null; loading: boolean } {
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void api.projects.list().then((projects) => {
      if (cancelled) return;
      const active = projects.find((p) => p.active);
      setActiveProject(active ? active.name : null);
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setActiveProject(null);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return { activeProject, loading };
}
