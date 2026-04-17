import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';

// Mock the api module
const mockProjectsList = vi.fn();
vi.mock('../../../src/services/api', () => ({
  default: {
    projects: {
      list: (...args: unknown[]) => mockProjectsList(...args),
    },
  },
}));

import { ProjectProvider, useProject } from '../../../src/contexts/ProjectContext';

function wrapper({ children }: { children: ReactNode }) {
  return <ProjectProvider>{children}</ProjectProvider>;
}

const MOCK_PROJECTS = [
  { id: 'proj-1', name: 'adjutant', path: '/code/adjutant', hasBeads: true, sessions: [], createdAt: '2026-01-01T00:00:00Z' },
  { id: 'proj-2', name: 'gastown', path: '/code/gastown', hasBeads: false, sessions: [], createdAt: '2026-01-01T00:00:00Z' },
  { id: 'proj-3', name: 'ios-app', path: '/code/ios', hasBeads: false, sessions: [], createdAt: '2026-01-01T00:00:00Z' },
];

describe('ProjectContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem('adjutant-selected-project');
    localStorage.removeItem('beads-project-filter');
    mockProjectsList.mockResolvedValue(MOCK_PROJECTS);
  });

  describe('selectProject (client-side only)', () => {
    it('should update localStorage when selecting a project', async () => {
      const { result } = renderHook(() => useProject(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        result.current.selectProject('proj-2');
      });

      expect(localStorage.getItem('adjutant-selected-project')).toBe('proj-2');
    });

    it('should update selectedProject state when selecting', async () => {
      const { result } = renderHook(() => useProject(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        result.current.selectProject('proj-2');
      });

      expect(result.current.selectedProject?.id).toBe('proj-2');
      expect(result.current.selectedProject?.name).toBe('gastown');
    });

    it('should remove localStorage when deselecting', async () => {
      // Use empty projects list so auto-select doesn't re-select
      mockProjectsList.mockResolvedValue([]);
      localStorage.setItem('adjutant-selected-project', 'proj-1');

      const { result } = renderHook(() => useProject(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        result.current.selectProject(null);
      });

      expect(localStorage.getItem('adjutant-selected-project')).toBeNull();
    });
  });

  describe('auto-select on fresh load', () => {
    it('should auto-select first project with beads on fresh load', async () => {
      const { result } = renderHook(() => useProject(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // proj-1 has hasBeads: true, so it should be auto-selected
      expect(result.current.selectedProject?.id).toBe('proj-1');
      expect(localStorage.getItem('adjutant-selected-project')).toBe('proj-1');
    });

    it('should auto-select first project when no project has beads', async () => {
      mockProjectsList.mockResolvedValue(
        MOCK_PROJECTS.map(p => ({ ...p, hasBeads: false }))
      );

      const { result } = renderHook(() => useProject(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // No project has beads, so fallback to first project
      expect(result.current.selectedProject?.id).toBe('proj-1');
    });

    it('should not auto-select when localStorage already has a selection', async () => {
      localStorage.setItem('adjutant-selected-project', 'proj-3');

      const { result } = renderHook(() => useProject(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Should respect localStorage, not auto-select
      expect(result.current.selectedProject?.id).toBe('proj-3');
    });
  });
});
