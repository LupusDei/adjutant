/**
 * DeployPersonaModal - Modal for deploying a persona-based agent with project selection.
 *
 * Matches iOS DeployPersonaSheet: shows persona info (name, description, radar chart),
 * editable callsign (pre-filled from persona name), and project selector.
 */

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../services/api';
import { useProject } from '../../contexts/ProjectContext';
import { RadarChart } from '../personas/RadarChart';
import type { Persona, ProjectInfo } from '../../types';

export interface DeployPersonaModalProps {
  persona: Persona;
  onClose: () => void;
  onDeployed: (callsign: string) => void;
}

type DeployState = 'idle' | 'deploying' | 'success' | 'error';

export function DeployPersonaModal({ persona, onClose, onDeployed }: DeployPersonaModalProps) {
  const { projects } = useProject();
  const [callsign, setCallsign] = useState(persona.name.toLowerCase());
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [deployState, setDeployState] = useState<DeployState>('idle');
  const [error, setError] = useState<string | null>(null);

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

  const handleDeploy = useCallback(async () => {
    if (deployState === 'deploying' || !selectedProjectId) return;
    setDeployState('deploying');
    setError(null);
    try {
      const trimmed = callsign.trim();
      const result = await api.agents.spawn({
        personaId: persona.id,
        projectId: selectedProjectId,
        ...(trimmed ? { callsign: trimmed } : {}),
      });
      setDeployState('success');
      setTimeout(() => { onDeployed(result.callsign); }, 800);
    } catch (err) {
      setDeployState('error');
      setError(err instanceof ApiError ? err.message : 'Failed to deploy persona');
    }
  }, [callsign, selectedProjectId, persona.id, deployState, onDeployed]);

  const canDeploy = !!selectedProjectId && deployState !== 'deploying';

  return (
    <>
      <div style={styles.backdrop} onClick={onClose} />
      <div style={styles.modal}>
        <div style={styles.header}>
          <h3 style={styles.headerTitle}>DEPLOY PERSONA</h3>
          <button style={styles.closeBtn} onClick={onClose} aria-label="Close">
            {'\u00D7'}
          </button>
        </div>

        <div style={styles.content}>
          {/* Persona info */}
          <div style={styles.personaInfo}>
            <div style={styles.personaDetails}>
              <div style={styles.personaName}>
                <span style={styles.diamondIcon}>{'\u25C7'}</span>
                {persona.name.toUpperCase()}
              </div>
              {persona.description && (
                <div style={styles.personaDescription}>{persona.description}</div>
              )}
            </div>
            <div style={styles.radarContainer}>
              <RadarChart traits={persona.traits} size={72} />
            </div>
          </div>

          {/* Callsign field */}
          <div style={styles.fieldGroup}>
            <label style={styles.fieldLabel}>CALLSIGN</label>
            <input
              style={styles.input}
              type="text"
              value={callsign}
              onChange={(e) => { setCallsign(e.target.value); }}
              placeholder={persona.name.toLowerCase()}
            />
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
              ...styles.deployBtn,
              ...(!canDeploy ? styles.deployBtnDisabled : {}),
              ...(deployState === 'success' ? styles.deployBtnSuccess : {}),
            }}
            disabled={!canDeploy}
            onClick={() => { void handleDeploy(); }}
          >
            {deployState === 'deploying' ? 'DEPLOYING...'
              : deployState === 'success' ? 'DEPLOYED'
              : `DEPLOY ${persona.name.toUpperCase()}`}
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
  personaInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 12px',
    border: '1px dashed var(--crt-phosphor-dim)',
    backgroundColor: 'var(--theme-bg-elevated)',
  },
  personaDetails: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minWidth: 0,
  },
  personaName: {
    fontSize: '0.9rem',
    fontWeight: 'bold',
    letterSpacing: '0.1em',
    color: 'var(--crt-phosphor)',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  diamondIcon: {
    fontSize: '0.8rem',
    color: 'var(--crt-phosphor)',
  },
  personaDescription: {
    fontSize: '0.7rem',
    color: 'var(--crt-phosphor-dim)',
    lineHeight: 1.4,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
  },
  radarContainer: {
    flexShrink: 0,
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
  input: {
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
  deployBtn: {
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
  deployBtnDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
    boxShadow: 'none',
  },
  deployBtnSuccess: {
    borderColor: '#00ff00',
    color: '#00ff00',
    boxShadow: '0 0 10px rgba(0, 255, 0, 0.3)',
  },
} satisfies Record<string, CSSProperties>;
