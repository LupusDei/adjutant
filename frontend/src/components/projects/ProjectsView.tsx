import { useState, useCallback, type CSSProperties } from 'react';

import { useProject } from '../../contexts/ProjectContext';
import { CreateProjectDialog } from '../shared/CreateProjectDialog';
import { StyleGuideEditor } from '../dashboard/StyleGuideEditor';
import type { ProjectInfo } from '../../types';

/**
 * Projects page for the web dashboard.
 *
 * Replaces the former Personas page (the persona deploy flow still lives in the
 * Agents/crew view). Surfaces all registered projects as selectable rows —
 * switching the active project context here mirrors the header ProjectSelector —
 * and hosts the per-project STYLE GUIDE editor (the proposal brand-color
 * settings, relocated off the Overview page where it was just noise).
 *
 * Visuals reuse the global `.dashboard-widget-*` panel chrome for parity with
 * the Overview, with CRT-phosphor inline styling for the list rows.
 */

interface ProjectsViewProps {
  /** Whether this tab is currently active (data comes from ProjectContext, so unused). */
  isActive?: boolean;
}

const C = {
  primary: 'var(--crt-phosphor)',
  dim: 'var(--crt-phosphor-dim)',
  glow: 'var(--crt-phosphor-glow)',
  bg: 'var(--theme-bg-screen, #020502)',
} as const;

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    padding: '20px',
    maxWidth: '960px',
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
  } as CSSProperties,

  hint: {
    fontSize: '0.78rem',
    letterSpacing: '0.06em',
    color: C.dim,
    lineHeight: 1.6,
    margin: 0,
  } as CSSProperties,

  newButton: {
    fontFamily: 'inherit',
    fontSize: '0.72rem',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: C.primary,
    background: 'transparent',
    border: `1px solid ${C.dim}`,
    borderRadius: '3px',
    padding: '5px 12px',
    cursor: 'pointer',
  } as CSSProperties,

  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  } as CSSProperties,

  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    width: '100%',
    textAlign: 'left',
    padding: '12px 14px',
    background: 'transparent',
    border: `1px solid transparent`,
    borderLeft: `3px solid transparent`,
    borderRadius: '3px',
    color: C.primary,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'background 120ms ease, border-color 120ms ease',
  } as CSSProperties,

  rowHover: {
    background: 'rgba(0, 255, 0, 0.04)',
    borderColor: C.dim,
    borderLeftColor: C.dim,
  } as CSSProperties,

  rowActive: {
    background: 'rgba(0, 255, 0, 0.08)',
    borderColor: C.dim,
    borderLeftColor: C.primary,
    boxShadow: `inset 0 0 12px ${C.glow}`,
  } as CSSProperties,

  caret: {
    width: '12px',
    flexShrink: 0,
    color: C.primary,
    textShadow: `0 0 6px ${C.glow}`,
  } as CSSProperties,

  rowMain: {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    minWidth: 0,
    flex: 1,
  } as CSSProperties,

  rowName: {
    fontSize: '0.92rem',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: C.primary,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  } as CSSProperties,

  rowPath: {
    fontSize: '0.68rem',
    letterSpacing: '0.02em',
    color: C.dim,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  } as CSSProperties,

  badges: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexShrink: 0,
  } as CSSProperties,

  badge: {
    fontSize: '0.6rem',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: C.dim,
    border: `1px solid ${C.dim}`,
    borderRadius: '2px',
    padding: '2px 6px',
  } as CSSProperties,

  badgeActive: {
    fontSize: '0.6rem',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: C.bg,
    background: C.primary,
    borderRadius: '2px',
    padding: '2px 6px',
    boxShadow: `0 0 8px ${C.glow}`,
  } as CSSProperties,
} as const;

export function ProjectsView({ isActive: _isActive }: ProjectsViewProps) {
  const { projects, selectedProject, selectProject, loading, refresh } = useProject();
  const [showCreate, setShowCreate] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const handleCreateSuccess = useCallback(
    (project: ProjectInfo) => {
      setShowCreate(false);
      refresh();
      selectProject(project.id);
    },
    [refresh, selectProject],
  );

  return (
    <div style={styles.root}>
      {/* Project roster — selecting a row switches the active project context */}
      <div className="dashboard-widget-container">
        <div className="dashboard-widget-header">
          <h3 className="dashboard-widget-title">PROJECTS</h3>
          <div className="dashboard-widget-header-right">
            <button
              type="button"
              style={styles.newButton}
              onClick={() => { setShowCreate(true); }}
            >
              + NEW PROJECT
            </button>
          </div>
        </div>
        <div className="dashboard-widget-content">
          {loading && projects.length === 0 ? (
            <p style={styles.hint}>Loading projects…</p>
          ) : projects.length === 0 ? (
            <p style={styles.hint}>
              No projects registered yet. Use <strong>+ NEW PROJECT</strong> to register one.
            </p>
          ) : (
            <div style={styles.list} role="list">
              {projects.map((p) => {
                const active = selectedProject?.id === p.id;
                const hovered = hoveredId === p.id;
                const sessionCount = p.sessions.length;
                return (
                  <button
                    type="button"
                    key={p.id}
                    role="listitem"
                    aria-pressed={active}
                    onClick={() => { selectProject(p.id); }}
                    onMouseEnter={() => { setHoveredId(p.id); }}
                    onMouseLeave={() => { setHoveredId((h) => (h === p.id ? null : h)); }}
                    style={{
                      ...styles.row,
                      ...(hovered && !active ? styles.rowHover : {}),
                      ...(active ? styles.rowActive : {}),
                    }}
                  >
                    <span style={styles.caret} aria-hidden>{active ? '▸' : ''}</span>
                    <span style={styles.rowMain}>
                      <span style={styles.rowName}>{p.name}</span>
                      <span style={styles.rowPath}>{p.path}</span>
                    </span>
                    <span style={styles.badges}>
                      {p.hasBeads && <span style={styles.badge}>BEADS</span>}
                      {sessionCount > 0 && (
                        <span style={styles.badge}>
                          {sessionCount} SESSION{sessionCount === 1 ? '' : 'S'}
                        </span>
                      )}
                      {active && <span style={styles.badgeActive}>● ACTIVE</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Per-project STYLE GUIDE — relocated here from the Overview page */}
      <div className="dashboard-widget-container">
        <div className="dashboard-widget-header">
          <h3 className="dashboard-widget-title">
            STYLE GUIDE{selectedProject ? ` — ${selectedProject.name}` : ''}
          </h3>
        </div>
        <div className="dashboard-widget-content">
          {selectedProject ? (
            <StyleGuideEditor projectId={selectedProject.id} />
          ) : (
            <p style={styles.hint}>
              Select a project above to set the brand colors agents use when authoring its
              proposal pages.
            </p>
          )}
        </div>
      </div>

      {showCreate && (
        <CreateProjectDialog
          onSuccess={handleCreateSuccess}
          onCancel={() => { setShowCreate(false); }}
        />
      )}
    </div>
  );
}

export default ProjectsView;
