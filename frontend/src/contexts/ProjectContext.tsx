import { createContext, useContext, useState, useCallback, useMemo, useEffect, type ReactNode } from 'react';
import api from '../services/api';
import type { ProjectInfo } from '../types';

// ============================================================================
// Types
// ============================================================================

export interface ProjectContextValue {
  /** All registered projects */
  projects: ProjectInfo[];
  /** Currently selected project (null = all projects / town-level) */
  selectedProject: ProjectInfo | null;
  /** Whether projects are currently loading */
  loading: boolean;
  /** Set the selected project */
  selectProject: (projectId: string | null) => void;
  /** Refresh the project list */
  refresh: () => void;
}

// ============================================================================
// Context
// ============================================================================

const ProjectContext = createContext<ProjectContextValue | null>(null);

const STORAGE_KEY = 'adjutant-selected-project';

// ============================================================================
// Provider
// ============================================================================

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);

  // Fetch projects on mount
  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      const result = await api.projects.list();
      setProjects(result);
    } catch {
      // Silent fail — projects list is non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  // Derive selected project from ID
  const selectedProject = useMemo(() => {
    if (!selectedProjectId) return null;
    return projects.find((p) => p.id === selectedProjectId) ?? null;
  }, [selectedProjectId, projects]);

  // Auto-select active project if none selected and projects are loaded
  useEffect(() => {
    if (!selectedProjectId && projects.length > 0) {
      const active = projects.find((p) => p.active);
      if (active) {
        setSelectedProjectId(active.id);
        try {
          localStorage.setItem(STORAGE_KEY, active.id);
        } catch { /* ignore */ }
      }
    }
  }, [selectedProjectId, projects]);

  const selectProject = useCallback((projectId: string | null) => {
    setSelectedProjectId(projectId);
    try {
      if (projectId) {
        localStorage.setItem(STORAGE_KEY, projectId);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch { /* ignore */ }
  }, []);

  const refresh = useCallback(() => {
    void fetchProjects();
  }, [fetchProjects]);

  const value = useMemo(() => ({
    projects,
    selectedProject,
    loading,
    selectProject,
    refresh,
  }), [projects, selectedProject, loading, selectProject, refresh]);

  return (
    <ProjectContext.Provider value={value}>
      {children}
    </ProjectContext.Provider>
  );
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to access project context.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useProject(): ProjectContextValue {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error('useProject must be used within a ProjectProvider');
  }
  return context;
}

export default ProjectContext;
