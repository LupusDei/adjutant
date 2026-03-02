import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';

// Mock the api module
const mockProjectsList = vi.fn();
const mockProjectsActivate = vi.fn();
vi.mock('../../../src/services/api', () => ({
  default: {
    projects: {
      list: (...args: unknown[]) => mockProjectsList(...args),
      activate: (...args: unknown[]) => mockProjectsActivate(...args),
    },
  },
}));

import { ProjectProvider, useProject } from '../../../src/contexts/ProjectContext';

function wrapper({ children }: { children: ReactNode }) {
  return <ProjectProvider>{children}</ProjectProvider>;
}

const MOCK_PROJECTS = [
  { id: 'proj-1', name: 'adjutant', path: '/code/adjutant', active: true, sessions: [], createdAt: '2026-01-01T00:00:00Z' },
  { id: 'proj-2', name: 'gastown', path: '/code/gastown', active: false, sessions: [], createdAt: '2026-01-01T00:00:00Z' },
  { id: 'proj-3', name: 'ios-app', path: '/code/ios', active: false, sessions: [], createdAt: '2026-01-01T00:00:00Z' },
];

describe('ProjectContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem('adjutant-selected-project');
    localStorage.removeItem('beads-project-filter');
    mockProjectsList.mockResolvedValue(MOCK_PROJECTS);
    mockProjectsActivate.mockResolvedValue({ ...MOCK_PROJECTS[1], active: true });
  });

  describe('selectProject calls activate API', () => {
    it('should call api.projects.activate when a project is selected', async () => {
      const { result } = renderHook(() => useProject(), { wrapper });

      // Wait for initial load
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Select a different project
      await act(async () => {
        result.current.selectProject('proj-2');
      });

      expect(mockProjectsActivate).toHaveBeenCalledWith('proj-2');
    });

    it('should not call activate API when deselecting (null)', async () => {
      const { result } = renderHook(() => useProject(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        result.current.selectProject(null);
      });

      expect(mockProjectsActivate).not.toHaveBeenCalled();
    });

    it('should still update local state even if activate API fails', async () => {
      mockProjectsActivate.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useProject(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        result.current.selectProject('proj-2');
      });

      // Local state should still update despite API failure
      expect(result.current.selectedProject?.id).toBe('proj-2');
    });

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

    it('should remove localStorage when deselecting (no active project to auto-select)', async () => {
      // Use projects with no active flag so auto-select doesn't re-select
      mockProjectsList.mockResolvedValue(
        MOCK_PROJECTS.map(p => ({ ...p, active: false }))
      );
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
});
