import { useState, useCallback, type CSSProperties } from 'react';
import { useProject } from '../../contexts/ProjectContext';
import { CreateProjectDialog } from './CreateProjectDialog';
import type { ProjectInfo } from '../../types';

/**
 * Pip-Boy styled project selector dropdown with "+ NEW" button.
 * Shows registered projects, allows switching the active project context,
 * and opens a creation dialog for registering new projects.
 */
export function ProjectSelector({ className = '' }: { className?: string }) {
  const { projects, selectedProject, selectProject, loading, refresh } = useProject();
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    selectProject(value === '' ? null : value);
  };

  const handleCreateSuccess = useCallback((project: ProjectInfo) => {
    setShowCreateDialog(false);
    refresh();
    // Auto-select the newly created project
    selectProject(project.id);
  }, [refresh, selectProject]);

  // Don't render selector if no projects and still loading,
  // but always render the + NEW button
  const showSelector = !loading && projects.length > 0;

  return (
    <>
      <div style={styles.container} className={className}>
        {showSelector && (
          <>
            <label style={styles.label} htmlFor="project-selector">
              PROJECT:
            </label>
            <div style={styles.selectWrapper}>
              <select
                id="project-selector"
                value={selectedProject?.id ?? ''}
                onChange={handleChange}
                style={styles.select}
              >
                <option value="">ALL PROJECTS</option>
                {projects.map(project => (
                  <option key={project.id} value={project.id}>
                    {project.name.toUpperCase()}
                    {project.hasBeads ? ' ●' : ''}
                  </option>
                ))}
              </select>
              <span style={styles.selectArrow}>▼</span>
            </div>
          </>
        )}
        <button
          style={styles.newButton}
          onClick={() => { setShowCreateDialog(true); }}
          title="Create new project"
        >
          + NEW
        </button>
      </div>

      {showCreateDialog && (
        <CreateProjectDialog
          onSuccess={handleCreateSuccess}
          onCancel={() => { setShowCreateDialog(false); }}
        />
      )}
    </>
  );
}

const colors = {
  primary: 'var(--crt-phosphor)',
  primaryDim: 'var(--crt-phosphor-dim)',
  background: 'var(--theme-bg-screen)',
} as const;

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
  },
  label: {
    fontSize: '0.7rem',
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    color: colors.primaryDim,
  },
  selectWrapper: {
    position: 'relative',
    display: 'inline-block',
  },
  select: {
    appearance: 'none',
    WebkitAppearance: 'none',
    MozAppearance: 'none',
    backgroundColor: colors.background,
    border: `1px solid ${colors.primaryDim}`,
    color: colors.primary,
    padding: '4px 24px 4px 8px',
    fontSize: '0.7rem',
    fontFamily: 'inherit',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    outline: 'none',
    minWidth: '120px',
  },
  selectArrow: {
    position: 'absolute',
    right: '8px',
    top: '50%',
    transform: 'translateY(-50%)',
    pointerEvents: 'none',
    fontSize: '0.6rem',
    color: colors.primaryDim,
  },
  newButton: {
    backgroundColor: 'transparent',
    border: `1px solid ${colors.primaryDim}`,
    color: colors.primaryDim,
    padding: '4px 10px',
    fontSize: '0.65rem',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    letterSpacing: '0.1em',
    cursor: 'pointer',
    transition: 'color 0.15s, border-color 0.15s',
  },
} satisfies Record<string, CSSProperties>;

export default ProjectSelector;
