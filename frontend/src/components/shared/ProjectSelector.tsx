import { type CSSProperties } from 'react';
import { useProject } from '../../contexts/ProjectContext';

/**
 * Pip-Boy styled project selector dropdown.
 * Shows registered projects and allows switching the active project context.
 */
export function ProjectSelector({ className = '' }: { className?: string }) {
  const { projects, selectedProject, selectProject, loading } = useProject();

  // Don't render if no projects or still loading
  if (loading || projects.length === 0) {
    return null;
  }

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    selectProject(value === '' ? null : value);
  };

  return (
    <div style={styles.container} className={className}>
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
    </div>
  );
}

const colors = {
  primary: 'var(--crt-phosphor)',
  primaryDim: 'var(--crt-phosphor-dim)',
  background: '#050805',
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
} satisfies Record<string, CSSProperties>;

export default ProjectSelector;
