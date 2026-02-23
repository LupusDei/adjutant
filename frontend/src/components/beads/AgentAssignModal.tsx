/**
 * AgentAssignModal - Pip-Boy themed modal for selecting an agent to assign to a bead.
 * Used by the drag-to-assign flow when a bead is dropped on the IN PROGRESS column.
 */

import { useState, useEffect, useCallback, type CSSProperties } from 'react';
import { api } from '../../services/api';
import type { CrewMember } from '../../types';

export interface AgentAssignModalProps {
  /** Bead ID being assigned */
  beadId: string;
  /** Called with the selected agent name on confirm */
  onConfirm: (agentName: string) => void;
  /** Called when the user cancels the assignment */
  onCancel: () => void;
}

export function AgentAssignModal({ beadId, onConfirm, onCancel }: AgentAssignModalProps) {
  const [agents, setAgents] = useState<CrewMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void api.agents.list().then((result) => {
      if (cancelled) return;
      // Show idle and working agents (available for assignment)
      const available = result.filter((a) => a.status === 'idle' || a.status === 'working');
      setAgents(available);
      setLoading(false);
    }).catch((err) => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : 'Failed to fetch agents');
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, []);

  const handleConfirm = useCallback(() => {
    if (selectedAgent) {
      onConfirm(selectedAgent);
    }
  }, [selectedAgent, onConfirm]);

  // Close on Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && selectedAgent) handleConfirm();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onCancel, selectedAgent, handleConfirm]);

  return (
    <div style={styles.backdrop} onClick={onCancel}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <span style={styles.headerText}>ASSIGN AGENT</span>
          <span style={styles.beadIdText}>{beadId}</span>
        </div>

        {/* Content */}
        <div style={styles.content}>
          {loading && (
            <div style={styles.statusText}>SCANNING CREW...</div>
          )}

          {error && (
            <div style={styles.errorText}>ERROR: {error}</div>
          )}

          {!loading && !error && agents.length === 0 && (
            <div style={styles.statusText}>NO AGENTS AVAILABLE</div>
          )}

          {!loading && !error && agents.length > 0 && (
            <div style={styles.agentList}>
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  style={{
                    ...styles.agentRow,
                    ...(selectedAgent === agent.name ? styles.agentRowSelected : {}),
                  }}
                  onClick={() => setSelectedAgent(agent.name)}
                >
                  <span style={styles.agentName}>{agent.name}</span>
                  <span style={{
                    ...styles.agentStatus,
                    color: agent.status === 'idle' ? '#00FF00' : '#00FF88',
                  }}>
                    {agent.status.toUpperCase()}
                  </span>
                  {agent.rig && (
                    <span style={styles.agentRig}>{agent.rig}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <button style={styles.cancelButton} onClick={onCancel}>
            CANCEL
          </button>
          <button
            style={{
              ...styles.confirmButton,
              ...(selectedAgent ? {} : styles.confirmButtonDisabled),
            }}
            onClick={handleConfirm}
            disabled={!selectedAgent}
          >
            ASSIGN
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: '#0A0A0A',
    border: '1px solid var(--crt-phosphor)',
    boxShadow: '0 0 20px rgba(0, 255, 0, 0.15), inset 0 0 30px rgba(0, 0, 0, 0.5)',
    width: '360px',
    maxHeight: '480px',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: '"Share Tech Mono", monospace',
  },
  header: {
    padding: '12px 16px',
    borderBottom: '1px solid var(--crt-phosphor-dim)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerText: {
    color: 'var(--crt-phosphor)',
    fontSize: '0.9rem',
    letterSpacing: '0.15em',
  },
  beadIdText: {
    color: 'var(--crt-phosphor-dim)',
    fontSize: '0.75rem',
    letterSpacing: '0.05em',
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '8px',
    minHeight: '120px',
  },
  statusText: {
    color: 'var(--crt-phosphor-dim)',
    fontSize: '0.8rem',
    textAlign: 'center',
    padding: '24px',
    letterSpacing: '0.1em',
  },
  errorText: {
    color: '#FF4444',
    fontSize: '0.8rem',
    textAlign: 'center',
    padding: '24px',
    letterSpacing: '0.1em',
  },
  agentList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  agentRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 12px',
    backgroundColor: 'transparent',
    border: '1px solid transparent',
    color: 'var(--crt-phosphor)',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.8rem',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
    transition: 'background-color 0.1s',
  },
  agentRowSelected: {
    backgroundColor: 'rgba(0, 255, 0, 0.1)',
    border: '1px solid var(--crt-phosphor-dim)',
  },
  agentName: {
    flex: 1,
    letterSpacing: '0.05em',
  },
  agentStatus: {
    fontSize: '0.7rem',
    letterSpacing: '0.1em',
  },
  agentRig: {
    fontSize: '0.7rem',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.05em',
  },
  footer: {
    padding: '12px 16px',
    borderTop: '1px solid var(--crt-phosphor-dim)',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
  },
  cancelButton: {
    backgroundColor: 'transparent',
    border: '1px solid var(--crt-phosphor-dim)',
    color: 'var(--crt-phosphor-dim)',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.75rem',
    padding: '6px 16px',
    cursor: 'pointer',
    letterSpacing: '0.1em',
  },
  confirmButton: {
    backgroundColor: 'rgba(0, 255, 0, 0.1)',
    border: '1px solid var(--crt-phosphor)',
    color: 'var(--crt-phosphor)',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.75rem',
    padding: '6px 16px',
    cursor: 'pointer',
    letterSpacing: '0.1em',
  },
  confirmButtonDisabled: {
    opacity: 0.4,
    cursor: 'default',
  },
} satisfies Record<string, CSSProperties>;
