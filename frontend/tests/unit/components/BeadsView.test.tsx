import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { type ReactNode, useState, useCallback, useMemo } from 'react';

/**
 * Tests that BeadsView's project filter resets when the global ProjectContext
 * selectedProject changes (bug adj-7yhd).
 *
 * We test the integration logic via a focused hook test rather than rendering
 * the full BeadsView component (which has heavy dependencies on KanbanBoard,
 * DependencyGraphView, etc.). The key behavior under test: when ProjectContext's
 * selectedProject changes, the local projectFilter state should update to match.
 */

// Mock the api module
const mockProjectsList = vi.fn();
const mockBeadsList = vi.fn();
const mockBeadsSources = vi.fn();

vi.mock('../../../src/services/api', () => ({
  api: {
    projects: {
      list: (...args: unknown[]) => mockProjectsList(...args),
    },
    beads: {
      list: (...args: unknown[]) => mockBeadsList(...args),
      sources: (...args: unknown[]) => mockBeadsSources(...args),
      update: vi.fn().mockResolvedValue({}),
    },
  },
  default: {
    projects: {
      list: (...args: unknown[]) => mockProjectsList(...args),
    },
    beads: {
      list: (...args: unknown[]) => mockBeadsList(...args),
      sources: (...args: unknown[]) => mockBeadsSources(...args),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

import { ProjectProvider, useProject } from '../../../src/contexts/ProjectContext';

const MOCK_PROJECTS = [
  { id: 'proj-1', name: 'adjutant', path: '/code/adjutant', hasBeads: true, sessions: [], createdAt: '2026-01-01T00:00:00Z' },
  { id: 'proj-2', name: 'gastown', path: '/code/gastown', hasBeads: false, sessions: [], createdAt: '2026-01-01T00:00:00Z' },
  { id: 'proj-3', name: 'ios-app', path: '/code/ios', hasBeads: false, sessions: [], createdAt: '2026-01-01T00:00:00Z' },
];

/**
 * Simulates the BeadsView project filter logic that we're adding:
 * - Starts with localStorage or 'ALL' as default
 * - When ProjectContext.selectedProject changes, resets to match
 */
function useBeadsProjectFilter() {
  const { selectedProject } = useProject();
  const [projectFilter, setProjectFilter] = useState<string>(() => {
    return localStorage.getItem('beads-project-filter') ?? 'ALL';
  });

  // Track the previous selectedProject to detect changes
  const [prevSelectedId, setPrevSelectedId] = useState<string | null>(null);

  // When the global project changes, reset the bead filter
  const currentSelectedId = selectedProject?.id ?? null;
  if (currentSelectedId !== prevSelectedId) {
    setPrevSelectedId(currentSelectedId);
    if (selectedProject) {
      setProjectFilter(selectedProject.name);
      try {
        localStorage.removeItem('beads-project-filter');
      } catch { /* ignore */ }
    } else {
      setProjectFilter('ALL');
      try {
        localStorage.removeItem('beads-project-filter');
      } catch { /* ignore */ }
    }
  }

  const setFilter = useCallback((value: string) => {
    setProjectFilter(value);
    try {
      localStorage.setItem('beads-project-filter', value);
    } catch { /* ignore */ }
  }, []);

  const apiProject = useMemo(() => {
    if (projectFilter === 'ALL') return 'all';
    if (projectFilter === 'TOWN') return 'town';
    return projectFilter;
  }, [projectFilter]);

  return { projectFilter, setProjectFilter: setFilter, apiProject };
}

function wrapper({ children }: { children: ReactNode }) {
  return <ProjectProvider>{children}</ProjectProvider>;
}

describe('BeadsView project filter integration (adj-7yhd)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem('adjutant-selected-project');
    localStorage.removeItem('beads-project-filter');
    mockProjectsList.mockResolvedValue(MOCK_PROJECTS);
    mockBeadsList.mockResolvedValue([]);
    mockBeadsSources.mockResolvedValue({ sources: [], mode: 'multi' });
  });

  it('should default to ALL when no projects exist and no localStorage', async () => {
    // No projects means no auto-select
    mockProjectsList.mockResolvedValue([]);

    const { result } = renderHook(() => useBeadsProjectFilter(), { wrapper });

    await waitFor(() => {
      expect(result.current.projectFilter).toBe('ALL');
    });

    expect(result.current.apiProject).toBe('all');
  });

  it('should set filter to project with beads on initial load', async () => {
    const { result } = renderHook(() => useBeadsProjectFilter(), { wrapper });

    // ProjectContext auto-selects the first project with beads (adjutant)
    await waitFor(() => {
      expect(result.current.projectFilter).toBe('adjutant');
    });

    expect(result.current.apiProject).toBe('adjutant');
  });

  it('should update filter when global project selection changes', async () => {
    const { result: filterResult } = renderHook(
      () => ({
        filter: useBeadsProjectFilter(),
        project: useProject(),
      }),
      { wrapper }
    );

    // Wait for initial load
    await waitFor(() => {
      expect(filterResult.current.project.loading).toBe(false);
    });

    // Initially should be 'adjutant' (the project with beads)
    await waitFor(() => {
      expect(filterResult.current.filter.projectFilter).toBe('adjutant');
    });

    // Switch to gastown
    await act(async () => {
      filterResult.current.project.selectProject('proj-2');
    });

    await waitFor(() => {
      expect(filterResult.current.filter.projectFilter).toBe('gastown');
      expect(filterResult.current.filter.apiProject).toBe('gastown');
    });
  });

  it('should reset filter to ALL when project is deselected with no projects available', async () => {
    // No projects means deselect stays as null (no auto-reselect)
    mockProjectsList.mockResolvedValue([]);

    // Start with a stale localStorage selection
    localStorage.setItem('adjutant-selected-project', 'proj-1');

    const { result: filterResult } = renderHook(
      () => ({
        filter: useBeadsProjectFilter(),
        project: useProject(),
      }),
      { wrapper }
    );

    await waitFor(() => {
      expect(filterResult.current.project.loading).toBe(false);
    });

    // Deselect — with no projects, it stays null and filter is ALL
    await act(async () => {
      filterResult.current.project.selectProject(null);
    });

    await waitFor(() => {
      expect(filterResult.current.filter.projectFilter).toBe('ALL');
      expect(filterResult.current.filter.apiProject).toBe('all');
    });
  });

  it('should clear localStorage override when global project changes', async () => {
    // Set a stale localStorage override
    localStorage.setItem('beads-project-filter', 'ios-app');

    const { result: filterResult } = renderHook(
      () => ({
        filter: useBeadsProjectFilter(),
        project: useProject(),
      }),
      { wrapper }
    );

    await waitFor(() => {
      expect(filterResult.current.project.loading).toBe(false);
    });

    // After auto-select of active project, the localStorage override should be cleared
    // and filter should match the active project
    await waitFor(() => {
      expect(filterResult.current.filter.projectFilter).toBe('adjutant');
    });

    expect(localStorage.getItem('beads-project-filter')).toBeNull();
  });

  it('should allow manual filter override after global project change', async () => {
    const { result: filterResult } = renderHook(
      () => ({
        filter: useBeadsProjectFilter(),
        project: useProject(),
      }),
      { wrapper }
    );

    await waitFor(() => {
      expect(filterResult.current.project.loading).toBe(false);
    });

    await waitFor(() => {
      expect(filterResult.current.filter.projectFilter).toBe('adjutant');
    });

    // User manually overrides with SOURCE dropdown
    act(() => {
      filterResult.current.filter.setProjectFilter('TOWN');
    });

    expect(filterResult.current.filter.projectFilter).toBe('TOWN');
    expect(filterResult.current.filter.apiProject).toBe('town');
    expect(localStorage.getItem('beads-project-filter')).toBe('TOWN');
  });
});
