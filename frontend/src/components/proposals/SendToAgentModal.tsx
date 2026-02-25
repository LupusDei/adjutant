/**
 * SendToAgentModal - Modal for choosing how to send a proposal to an agent.
 *
 * Two paths:
 * 1. Pick an existing active agent -> sends proposal as MCP message
 * 2. Spawn a new agent -> creates session, sends proposal as initial prompt
 */

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../services/api';
import type { CrewMember, Proposal } from '../../types';

export interface SendToAgentModalProps {
  proposal: Proposal;
  onClose: () => void;
  onSent: (target: string) => void;
}

type ModalTab = 'existing' | 'spawn';
type SendState = 'idle' | 'sending' | 'success' | 'error';

function buildProposalPrompt(proposal: Proposal): string {
  return [
    `## Proposal: ${proposal.title}`,
    '',
    `**Type:** ${proposal.type}`,
    `**Author:** ${proposal.author}`,
    `**Status:** ${proposal.status}`,
    '',
    '### Description',
    '',
    proposal.description,
    '',
    '---',
    '',
    'Please use /speckit.specify to create a feature specification from this proposal, then /speckit.plan to generate an implementation plan, and /speckit.beads to create executable beads for orchestration.',
  ].join('\n');
}

export function SendToAgentModal({ proposal, onClose, onSent }: SendToAgentModalProps) {
  const [tab, setTab] = useState<ModalTab>('existing');
  const [agents, setAgents] = useState<CrewMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [callsign, setCallsign] = useState('');
  const [sendState, setSendState] = useState<SendState>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.agents.list()
      .then((data) => {
        setAgents(data.filter((a) => a.status !== 'offline'));
        setLoading(false);
      })
      .catch(() => {
        setAgents([]);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => { window.removeEventListener('keydown', handleKeyDown); };
  }, [onClose]);

  const handleSendToExisting = useCallback(async () => {
    if (!selectedAgent) return;
    setSendState('sending');
    setError(null);
    try {
      const prompt = buildProposalPrompt(proposal);
      await api.messages.send({
        to: selectedAgent,
        body: prompt,
        threadId: `proposal-${proposal.id}`,
      });
      setSendState('success');
      setTimeout(() => { onSent(selectedAgent); }, 800);
    } catch (err) {
      setSendState('error');
      setError(err instanceof ApiError ? err.message : 'Failed to send message');
    }
  }, [selectedAgent, proposal, onSent]);

  const handleSpawnAndSend = useCallback(async () => {
    setSendState('sending');
    setError(null);
    try {
      const projectPath = '/Users/Reason/code/ai/adjutant';
      const trimmedName = callsign.trim();

      const session = await api.sessions.create({
        projectPath,
        ...(trimmedName ? { name: trimmedName } : {}),
        mode: 'swarm',
        workspaceType: 'primary',
      });

      // Wait briefly for agent to start, then send the proposal as initial prompt
      const prompt = buildProposalPrompt(proposal);
      setTimeout(() => {
        void (async () => {
          try {
            await api.sessions.sendInput(session.id, prompt);
          } catch {
            // If sendInput fails, send as a message instead
            await api.messages.send({
              to: session.name,
              body: prompt,
              threadId: `proposal-${proposal.id}`,
            });
          }
        })();
      }, 3000);

      setSendState('success');
      const agentName = session.name;
      setTimeout(() => { onSent(agentName); }, 800);
    } catch (err) {
      setSendState('error');
      setError(err instanceof ApiError ? err.message : 'Failed to spawn agent');
    }
  }, [callsign, proposal, onSent]);

  const isExistingTab = tab === 'existing';
  const canSend = isExistingTab ? !!selectedAgent : true;

  return (
    <>
      <div style={styles.backdrop} onClick={onClose} />
      <div style={styles.modal}>
        <div style={styles.header}>
          <h3 style={styles.headerTitle}>SEND TO AGENT</h3>
          <button style={styles.closeBtn} onClick={onClose} aria-label="Close">
            {'\u00D7'}
          </button>
        </div>

        <div style={styles.proposalSummary}>
          <span style={styles.proposalTitle}>{proposal.title}</span>
          <span style={{
            ...styles.proposalBadge,
            ...(proposal.type === 'product' ? styles.badgeProduct : styles.badgeEngineering),
          }}>
            {proposal.type.toUpperCase()}
          </span>
        </div>

        <div style={styles.tabs}>
          <button
            style={{ ...styles.tab, ...(isExistingTab ? styles.tabActive : {}) }}
            onClick={() => { setTab('existing'); }}
          >
            EXISTING AGENT
          </button>
          <button
            style={{ ...styles.tab, ...(!isExistingTab ? styles.tabActive : {}) }}
            onClick={() => { setTab('spawn'); }}
          >
            SPAWN NEW
          </button>
        </div>

        <div style={styles.content}>
          {isExistingTab ? (
            <div style={styles.agentList}>
              {loading && <div style={styles.loadingText}>SCANNING AGENTS...</div>}
              {!loading && agents.length === 0 && (
                <div style={styles.emptyText}>NO ACTIVE AGENTS FOUND</div>
              )}
              {agents.map((agent) => {
                const isSelected = selectedAgent === agent.name;
                const statusColor = agent.status === 'working' ? '#00ff00'
                  : agent.status === 'idle' ? 'var(--crt-phosphor)'
                  : agent.status === 'blocked' ? '#FFB000'
                  : '#666';

                return (
                  <button
                    key={agent.id}
                    style={{
                      ...styles.agentRow,
                      ...(isSelected ? styles.agentRowSelected : {}),
                    }}
                    onClick={() => { setSelectedAgent(agent.name); }}
                  >
                    <span style={{
                      ...styles.statusDot,
                      backgroundColor: statusColor,
                      boxShadow: `0 0 6px ${statusColor}`,
                    }} />
                    <span style={styles.agentName}>{agent.name.toUpperCase()}</span>
                    <span style={{ ...styles.agentStatus, color: statusColor }}>
                      {agent.status.toUpperCase()}
                    </span>
                    {agent.currentTask && (
                      <span style={styles.agentTask} title={agent.currentTask}>
                        {'\u26A1'} {agent.currentTask.length > 30
                          ? agent.currentTask.slice(0, 30) + '...'
                          : agent.currentTask}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div style={styles.spawnForm}>
              <label style={styles.fieldLabel}>CALLSIGN (OPTIONAL)</label>
              <input
                style={styles.input}
                type="text"
                value={callsign}
                onChange={(e) => { setCallsign(e.target.value); }}
                placeholder="Auto-assigned if empty..."
                autoFocus
              />
              <div style={styles.spawnHint}>
                A new agent will be spawned and given this proposal as its initial task.
              </div>
            </div>
          )}
        </div>

        {error && <div style={styles.errorRow}>ERROR: {error}</div>}

        <div style={styles.actions}>
          <button style={styles.cancelBtn} onClick={onClose}>CANCEL</button>
          <button
            style={{
              ...styles.sendBtn,
              ...((!canSend || sendState === 'sending') ? styles.sendBtnDisabled : {}),
              ...(sendState === 'success' ? styles.sendBtnSuccess : {}),
            }}
            disabled={!canSend || sendState === 'sending'}
            onClick={() => {
              void (isExistingTab ? handleSendToExisting() : handleSpawnAndSend());
            }}
          >
            {sendState === 'sending' ? 'SENDING...'
              : sendState === 'success' ? 'SENT'
              : isExistingTab ? 'SEND MESSAGE' : 'SPAWN & SEND'}
          </button>
        </div>
      </div>
    </>
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
    backgroundColor: '#0A0A0A',
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
  proposalSummary: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 16px',
    borderBottom: '1px solid rgba(0, 255, 0, 0.1)',
  },
  proposalTitle: {
    flex: 1,
    fontSize: '0.8rem',
    color: 'var(--crt-phosphor)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textTransform: 'uppercase',
  },
  proposalBadge: {
    fontSize: '0.6rem',
    padding: '2px 6px',
    border: '1px solid',
    fontWeight: 'bold',
    letterSpacing: '0.05em',
    flexShrink: 0,
  },
  badgeProduct: {
    color: 'var(--pipboy-green, #00ff00)',
    borderColor: 'var(--pipboy-green, #00ff00)',
  },
  badgeEngineering: {
    color: '#ffaa00',
    borderColor: '#ffaa00',
  },
  tabs: {
    display: 'flex',
    borderBottom: '1px solid var(--crt-phosphor-dim)',
  },
  tab: {
    flex: 1,
    padding: '8px 16px',
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    color: 'var(--crt-phosphor-dim)',
    fontSize: '0.75rem',
    fontFamily: '"Share Tech Mono", monospace',
    fontWeight: 'bold',
    letterSpacing: '0.1em',
    cursor: 'pointer',
    textTransform: 'uppercase',
    transition: 'all 0.2s ease',
  },
  tabActive: {
    color: 'var(--crt-phosphor)',
    borderBottomColor: 'var(--crt-phosphor)',
  },
  content: {
    flex: 1,
    padding: '12px 16px',
    overflowY: 'auto',
    minHeight: '180px',
    maxHeight: '300px',
  },
  agentList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  loadingText: {
    color: 'var(--crt-phosphor-dim)',
    fontSize: '0.75rem',
    letterSpacing: '0.1em',
    textAlign: 'center',
    padding: '24px',
  },
  emptyText: {
    color: 'var(--crt-phosphor-dim)',
    fontSize: '0.75rem',
    letterSpacing: '0.1em',
    textAlign: 'center',
    padding: '24px',
  },
  agentRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 10px',
    background: 'transparent',
    border: '1px solid transparent',
    color: 'var(--crt-phosphor)',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.75rem',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'all 0.15s ease',
    width: '100%',
  },
  agentRowSelected: {
    borderColor: 'var(--crt-phosphor)',
    backgroundColor: 'rgba(0, 255, 0, 0.05)',
  },
  statusDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  agentName: {
    fontWeight: 'bold',
    letterSpacing: '0.1em',
    minWidth: '80px',
  },
  agentStatus: {
    fontSize: '0.6rem',
    letterSpacing: '0.1em',
    flexShrink: 0,
  },
  agentTask: {
    fontSize: '0.6rem',
    color: 'var(--crt-phosphor-dim)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
    fontStyle: 'italic',
  },
  spawnForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '8px 0',
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
  spawnHint: {
    fontSize: '0.65rem',
    color: 'var(--crt-phosphor-dim)',
    lineHeight: 1.5,
    marginTop: '4px',
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
  sendBtn: {
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
  sendBtnDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
    boxShadow: 'none',
  },
  sendBtnSuccess: {
    borderColor: '#00ff00',
    color: '#00ff00',
    boxShadow: '0 0 10px rgba(0, 255, 0, 0.3)',
  },
} satisfies Record<string, CSSProperties>;
