import { useState, useEffect, useCallback } from 'react';

import type { ProjectStyleGuide, SetProjectStyleGuideInput } from '../types';
import api from '../services/api';

/**
 * Data layer for a single project's proposal style guide (brand color, adj-201).
 *
 * Loads the guide on mount scoped by `projectId` (the canonical UUID key),
 * exposes loading/saving/error state, and a `save` mutation that maps onto
 * `PUT /api/projects/:id/style-guide`. An unset guide (both colors `null`) is a
 * valid state, not an error — the editor renders empty inputs for it.
 *
 * On a save failure the previously loaded guide is left intact (no optimistic
 * mutation), so the editor can surface the error without losing the user's
 * last-saved baseline.
 */
export interface UseProjectStyleGuideResult {
  guide: ProjectStyleGuide | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  save: (input: SetProjectStyleGuideInput) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useProjectStyleGuide(
  projectId: string,
): UseProjectStyleGuideResult {
  const [guide, setGuide] = useState<ProjectStyleGuide | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchGuide = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.projects.getStyleGuide(projectId);
      setGuide(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchGuide();
  }, [fetchGuide]);

  const save = useCallback(
    async (input: SetProjectStyleGuideInput) => {
      setSaving(true);
      setError(null);
      try {
        const updated = await api.projects.updateStyleGuide(projectId, input);
        setGuide(updated);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [projectId],
  );

  return { guide, loading, saving, error, save, refresh: fetchGuide };
}
