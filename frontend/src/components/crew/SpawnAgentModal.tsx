/**
 * SpawnAgentModal - Modal form for spawning a new agent with callsign and project selection.
 *
 * Matches iOS SpawnAgentSheet behavior: callsign input with available roster,
 * project selector with active badge, and spawn button.
 */

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../services/api';
import { useProject } from '../../contexts/ProjectContext';
import type { CallsignSetting, ProjectInfo } from '../../types';

export interface SpawnAgentModalProps {
  onClose: () => void;
  onSpawned: (callsign: string) => void;
}

type SpawnState = 'idle' | 'spawning' | 'success' | 'error';

export function SpawnAgentModal({ onClose, onSpawned }: SpawnAgentModalProps) {
  const { projects } = useProject();
  const [callsign, setCallsign] = useState('');
  const [callsigns, setCallsigns] = useState<CallsignSetting[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [spawnState, setSpawnState] = useState<SpawnState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [showRoster, setShowRoster] = useState(false);

  // Load callsigns and auto-select active project
  useEffect(() => {
    api.callsigns.list()
      .then((data) => {
        setCallsigns(data.callsigns.filter(c => c.enabled));
      })
      .catch(() => { /* callsigns are optional */ });
  }, []);

  // Auto-select: first project with beads, or the only project
  useEffect(() => {
    if (selectedProjectId) return;
    const defaultProject = projects.find(p => p.hasBeads) ?? projects[0];
    if (defaultProject) {
      setSelectedProjectId(defaultProject.id);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => { window.removeEventListener('keydown', handleKeyDown); };
  }, [onClose]);

  const handleSpawn = useCallback(async () => {
    if (spawnState === 'spawning' || !selectedProjectId) return;
    setSpawnState('spawning');
    setError(null);
    try {
      const trimmed = callsign.trim();
      const result = await api.agents.spawn({
        projectId: selectedProjectId,
        ...(trimmed ? { callsign: trimmed } : {}),
      });
      setSpawnState('success');
      setTimeout(() => { onSpawned(result.callsign); }, 800);
    } catch (err) {
      setSpawnState('error');
      setError(err instanceof ApiError ? err.message : 'Failed to spawn agent');
    }
  }, [callsign, selectedProjectId, spawnState, onSpawned]);

  const handleSelectCallsign = useCallback((name: string) => {
    setCallsign(name);
    setShowRoster(false);
  }, []);

  const canSpawn = !!selectedProjectId && spawnState !== 'spawning';

  return (
    <>
      <div style={styles.backdrop} onClick={onClose} />
      <div style={styles.modal}>
        <div style={styles.header}>
          <h3 style={styles.headerTitle}>SPAWN AGENT</h3>
          <button style={styles.closeBtn} onClick={onClose} aria-label="Close">
            {'\u00D7'}
          </button>
        </div>

        <div style={styles.content}>
          {/* Callsign field */}
          <div style={styles.fieldGroup}>
            <label style={styles.fieldLabel}>CALLSIGN</label>
            <div style={styles.callsignRow}>
              <input
                style={styles.input}
                type="text"
                value={callsign}
                onChange={(e) => { setCallsign(e.target.value); }}
                placeholder="Auto-assigned if empty..."
                autoFocus
              />
              <button
                style={styles.rosterBtn}
                onClick={() => { setShowRoster(prev => !prev); }}
                title="Browse callsign roster"
              >
                {showRoster ? '\u25BC' : '\u25B6'}
              </button>
            </div>

            {/* Callsign roster dropdown */}
            {showRoster && callsigns.length > 0 && (
              <div style={styles.rosterDropdown}>
                {callsigns.map(cs => (
                  <button
                    key={cs.name}
                    style={{
                      ...styles.rosterItem,
                      ...(cs.name === callsign ? styles.rosterItemSelected : {}),
                    }}
                    onClick={() => { handleSelectCallsign(cs.name); }}
                  >
                    {cs.name.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Project selector */}
          <div style={styles.fieldGroup}>
            <label style={styles.fieldLabel}>PROJECT</label>
            <div style={styles.projectList}>
              {projects.length === 0 && (
                <div style={styles.emptyText}>NO PROJECTS FOUND</div>
              )}
              {projects.map((project) => (
                <ProjectButton
                  key={project.id}
                  project={project}
                  selected={selectedProjectId === project.id}
                  onSelect={() => { setSelectedProjectId(project.id); }}
                />
              ))}
            </div>
          </div>
        </div>

        {error && <div style={styles.errorRow}>ERROR: {error}</div>}

        <div style={styles.actions}>
          <button style={styles.cancelBtn} onClick={onClose}>CANCEL</button>
          <button
            style={{
              ...styles.spawnBtn,
              ...(!canSpawn ? styles.spawnBtnDisabled : {}),
              ...(spawnState === 'success' ? styles.spawnBtnSuccess : {}),
            }}
            disabled={!canSpawn}
            onClick={() => { void handleSpawn(); }}
          >
            {spawnState === 'spawning' ? 'SPAWNING...'
              : spawnState === 'success' ? 'SPAWNED'
              : callsign.trim() ? `SPAWN ${callsign.trim().toUpperCase()}` : 'SPAWN AGENT'}
          </button>
        </div>
      </div>
    </>
  );
}


function ProjectButton({ project, selected, onSelect }: {
  project: ProjectInfo;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      style={{
        ...styles.projectItem,
        ...(selected ? styles.projectItemSelected : {}),
      }}
      onClick={onSelect}
    >
      <span style={styles.projectName}>{project.name.toUpperCase()}</span>
      {project.gitRemote && (
        <span style={styles.projectRemote}>{project.gitRemote}</span>
      )}
      {project.hasBeads && <span style={styles.activeBadge}>HAS BEADS</span>}
      {selected && <span style={styles.checkmark}>{'\u2713'}</span>}
    </button>
  );
}


const styles = {
  backdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    zIndex: 1100,
  },
  modal: {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '480px',
    maxWidth: '90vw',
    maxHeight: '80vh',
    backgroundColor: 'var(--theme-bg-screen)',
    border: '1px solid var(--crt-phosphor-dim)',
    boxShadow: '0 0 30px rgba(0, 255, 0, 0.15)',
    zIndex: 1101,
    display: 'flex',
    flexDirection: 'column',
    fontFamily: '"Share Tech Mono", monospace',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: '2px solid var(--crt-phosphor-dim)',
  },
  headerTitle: {
    margin: 0,
    fontSize: '0.95rem',
    color: 'var(--crt-phosphor)',
    letterSpacing: '0.15em',
  },
  closeBtn: {
    background: 'none',
    border: '1px solid var(--crt-phosphor-dim)',
    color: 'var(--crt-phosphor)',
    fontSize: '1.3rem',
    width: '28px',
    height: '28px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
    fontFamily: '"Share Tech Mono", monospace',
  },
  content: {
    flex: 1,
    padding: '16px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  fieldLabel: {
    fontSize: '0.65rem',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.15em',
  },
  callsignRow: {
    display: 'flex',
    gap: '4px',
  },
  input: {
    flex: 1,
    padding: '8px 10px',
    border: '1px solid var(--crt-phosphor-dim)',
    backgroundColor: 'transparent',
    color: 'var(--crt-phosphor)',
    fontSize: '0.8rem',
    fontFamily: '"Share Tech Mono", monospace',
    outline: 'none',
    caretColor: 'var(--crt-phosphor)',
    letterSpacing: '0.05em',
  },
  rosterBtn: {
    padding: '8px 10px',
    border: '1px solid var(--crt-phosphor-dim)',
    backgroundColor: 'transparent',
    color: 'var(--crt-phosphor-dim)',
    fontSize: '0.7rem',
    fontFamily: '"Share Tech Mono", monospace',
    cursor: 'pointer',
    flexShrink: 0,
  },
  rosterDropdown: {
    maxHeight: '140px',
    overflowY: 'auto',
    border: '1px solid var(--crt-phosphor-dim)',
    backgroundColor: 'var(--theme-bg-elevated)',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '2px',
    padding: '6px',
  },
  rosterItem: {
    padding: '4px 8px',
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    color: 'var(--crt-phosphor)',
    fontSize: '0.65rem',
    fontFamily: '"Share Tech Mono", monospace',
    cursor: 'pointer',
    letterSpacing: '0.05em',
    transition: 'all 0.15s ease',
  },
  rosterItemSelected: {
    borderColor: 'var(--crt-phosphor)',
    backgroundColor: 'rgba(0, 255, 0, 0.08)',
  },
  projectList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  projectItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 10px',
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    color: 'var(--crt-phosphor)',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.75rem',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'all 0.15s ease',
    width: '100%',
  },
  projectItemSelected: {
    borderColor: 'var(--crt-phosphor)',
    backgroundColor: 'rgba(0, 255, 0, 0.05)',
  },
  projectName: {
    fontWeight: 'bold',
    letterSpacing: '0.1em',
  },
  projectRemote: {
    flex: 1,
    fontSize: '0.6rem',
    color: 'var(--crt-phosphor-dim)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  activeBadge: {
    fontSize: '0.55rem',
    padding: '1px 5px',
    border: '1px solid var(--crt-phosphor)',
    color: 'var(--crt-phosphor)',
    letterSpacing: '0.05em',
    flexShrink: 0,
  },
  checkmark: {
    color: 'var(--crt-phosphor-bright)',
    fontSize: '0.85rem',
    flexShrink: 0,
  },
  emptyText: {
    color: 'var(--crt-phosphor-dim)',
    fontSize: '0.75rem',
    letterSpacing: '0.1em',
    textAlign: 'center',
    padding: '16px',
  },
  errorRow: {
    padding: '6px 16px',
    fontSize: '0.7rem',
    color: '#FF4444',
    letterSpacing: '0.05em',
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    padding: '12px 16px',
    borderTop: '1px solid var(--crt-phosphor-dim)',
  },
  cancelBtn: {
    background: 'transparent',
    border: '1px solid var(--crt-phosphor-dim)',
    color: 'var(--crt-phosphor-dim)',
    padding: '6px 16px',
    fontSize: '0.7rem',
    fontFamily: '"Share Tech Mono", monospace',
    cursor: 'pointer',
    letterSpacing: '0.1em',
  },
  spawnBtn: {
    background: 'transparent',
    border: '1px solid var(--crt-phosphor)',
    color: 'var(--crt-phosphor)',
    padding: '6px 16px',
    fontSize: '0.7rem',
    fontFamily: '"Share Tech Mono", monospace',
    fontWeight: 'bold',
    cursor: 'pointer',
    letterSpacing: '0.1em',
    boxShadow: '0 0 6px var(--pipboy-green-glow, #00ff0066)',
    transition: 'all 0.2s ease',
  },
  spawnBtnDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
    boxShadow: 'none',
  },
  spawnBtnSuccess: {
    borderColor: '#00ff00',
    color: '#00ff00',
    boxShadow: '0 0 10px rgba(0, 255, 0, 0.3)',
  },
} satisfies Record<string, CSSProperties>;
