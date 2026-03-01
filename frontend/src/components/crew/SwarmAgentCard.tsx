import type { CSSProperties } from 'react';
import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { api, ApiError } from '../../services/api';
import { useTerminalStream } from '../../hooks/useTerminalStream';
import type { CrewMember } from '../../types';

/** Format ISO timestamp as relative time (e.g., "2m ago", "just now"). */
function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 60_000) return 'just now';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diffMs / 86_400_000);
  return `${days}d ago`;
}

const colors = {
  primary: 'var(--crt-phosphor)',
  primaryBright: 'var(--crt-phosphor-bright)',
  primaryDim: 'var(--crt-phosphor-dim)',
  primaryGlow: 'var(--crt-phosphor-glow)',
  backgroundDark: '#050505',
  panelBorder: 'var(--crt-phosphor-dim)',
  offlineBorder: '#333333',
  working: 'var(--crt-phosphor-bright)',
  idle: 'var(--crt-phosphor)',
  blocked: '#FFB000',
  stuck: '#FF4444',
  offline: '#666666',
} as const;

function getStatusColor(status: string): string {
  switch (status) {
    case 'working':
    case 'active':
      return colors.working;
    case 'idle':
      return colors.idle;
    case 'blocked':
      return colors.blocked;
    case 'stuck':
      return colors.stuck;
    case 'offline':
      return colors.offline;
    default:
      return colors.idle;
  }
}

interface SwarmAgentCardProps {
  agent: CrewMember;
}

/** Kill button state for agent card. */
type KillState = 'idle' | 'confirm' | 'loading';

/** Assign bead state. */
type AssignState = 'idle' | 'loading';

/**
 * Rich agent card for swarm mode.
 * Shows status, current task, branch, last activity, mail preview, and worktree.
 * Includes kill (D2) and assign (D3) controls.
 * Supports expandable inline terminal view with WebSocket streaming + polling fallback.
 */
export function SwarmAgentCard({ agent }: SwarmAgentCardProps) {
  const isOnline = agent.status !== 'offline';
  const isActive = agent.currentTask && agent.status === 'idle';
  const displayStatus = isActive ? 'active' : agent.status;
  const statusColor = getStatusColor(displayStatus);
  const isWorking = displayStatus === 'working' || displayStatus === 'active';
  const canKill = isOnline && !agent.isCoordinator && agent.sessionId;
  const canAssign = displayStatus === 'idle' && isOnline;
  const hasSession = Boolean(agent.sessionId) && isOnline;

  // D2: Kill agent state
  const [killState, setKillState] = useState<KillState>('idle');
  const [killError, setKillError] = useState<string | null>(null);

  const handleKillClick = useCallback(() => {
    if (killState === 'idle') setKillState('confirm');
  }, [killState]);

  const handleKillCancel = useCallback(() => {
    setKillState('idle');
    setKillError(null);
  }, []);

  const handleKillConfirm = useCallback(async () => {
    if (!agent.sessionId) return;
    setKillState('loading');
    setKillError(null);
    try {
      await api.sessions.kill(agent.sessionId);
      // Card will show offline on next poll refresh
    } catch (err) {
      setKillError(err instanceof ApiError ? err.message : 'Kill failed');
      setKillState('idle');
    }
  }, [agent.sessionId]);

  // D3: Assign bead state
  const [showAssign, setShowAssign] = useState(false);
  const [beadId, setBeadId] = useState('');
  const [assignState, setAssignState] = useState<AssignState>('idle');

  const handleAssignSubmit = useCallback(async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = beadId.trim();
    if (!trimmed || assignState === 'loading') return;
    setAssignState('loading');
    try {
      await api.messages.send({
        to: agent.name,
        body: `Please work on bead ${trimmed}`,
      });
      setShowAssign(false);
      setBeadId('');
    } catch {
      // Keep form open on error
    }
    setAssignState('idle');
  }, [beadId, agent.name, assignState]);

  // Terminal expansion state
  const [expanded, setExpanded] = useState(false);
  const terminalRef = useRef<HTMLPreElement>(null);
  const userScrolledRef = useRef(false);

  // WebSocket terminal stream with polling fallback
  const { content: terminalContent, error: terminalError, loading: terminalLoading, mode: streamMode } = useTerminalStream({
    sessionId: agent.sessionId,
    enabled: expanded && hasSession,
  });

  const relativeTime = useMemo(() => {
    if (!agent.lastActivity) return null;
    return formatRelativeTime(agent.lastActivity);
  }, [agent.lastActivity]);

  const hasFooter = (relativeTime ?? agent.worktreePath ?? agent.progress) != null;

  // Auto-scroll to bottom unless user scrolled up
  useEffect(() => {
    const el = terminalRef.current;
    if (!el || !terminalContent || userScrolledRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [terminalContent]);

  // Detect user scroll-up to pause auto-scroll
  const handleTerminalScroll = useCallback(() => {
    const el = terminalRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledRef.current = distanceFromBottom > 40;
  }, []);

  // Reset scroll lock when collapsing
  const toggleExpand = useCallback(() => {
    if (!hasSession) return;
    setExpanded(prev => {
      if (prev) userScrolledRef.current = false;
      return !prev;
    });
  }, [hasSession]);

  const modeLabel = streamMode === 'ws' ? 'LIVE' : streamMode === 'polling' ? 'POLL' : '';

  return (
    <div
      style={{
        ...styles.card,
        borderColor: killState === 'loading' ? colors.stuck
          : expanded ? colors.primaryBright
          : isOnline ? colors.panelBorder : colors.offlineBorder,
        boxShadow: isWorking
          ? `0 0 12px ${colors.primaryGlow}, inset 0 0 6px ${colors.primaryGlow}`
          : 'none',
        opacity: killState === 'loading' ? 0.5 : isOnline ? 1 : 0.6,
      }}
      role="listitem"
      aria-label={`${agent.name} - ${displayStatus}`}
    >
      {/* Header: status dot + name + badges + kill button + terminal toggle */}
      <div
        style={{
          ...styles.header,
          cursor: hasSession ? 'pointer' : 'default',
        }}
        onClick={toggleExpand}
        role={hasSession ? 'button' : undefined}
        aria-expanded={hasSession ? expanded : undefined}
      >
        <span
          className={isActive ? 'pulsate' : ''}
          style={{
            ...styles.statusDot,
            backgroundColor: statusColor,
            boxShadow: isOnline ? `0 0 8px ${statusColor}` : 'none',
          }}
        />
        <span style={styles.name}>{agent.name.toUpperCase()}</span>
        <span style={{ ...styles.statusLabel, color: statusColor }}>
          {killState === 'loading' ? 'TERMINATING...' : displayStatus.toUpperCase()}
        </span>
        {agent.isCoordinator && (
          <span style={styles.coordinatorBadge}>COORD</span>
        )}
        {agent.unreadMail > 0 && (
          <span style={styles.mailBadge}>📬{agent.unreadMail}</span>
        )}
        {canKill && killState === 'idle' && (
          <button
            style={styles.killButton}
            onClick={(e) => { e.stopPropagation(); handleKillClick(); }}
            title={`Terminate ${agent.name}`}
            aria-label={`Kill ${agent.name}`}
          >
            ✕
          </button>
        )}
        {hasSession && (
          <span style={styles.terminalToggle} title="Toggle terminal">
            {expanded ? '▼' : '▶'}
          </span>
        )}
      </div>

      {/* D2: Kill confirmation prompt */}
      {killState === 'confirm' && (
        <div style={styles.confirmRow}>
          <span style={styles.confirmText}>TERMINATE {agent.name.toUpperCase()}?</span>
          <button style={styles.confirmYes} onClick={() => { void handleKillConfirm(); }}>YES</button>
          <button style={styles.confirmNo} onClick={handleKillCancel}>NO</button>
        </div>
      )}

      {/* Kill error */}
      {killError && (
        <div style={styles.killErrorRow}>{killError}</div>
      )}

      {/* Current task — shown prominently */}
      {agent.currentTask && (
        <div style={styles.taskRow}>
          <span style={styles.rowIcon}>⚡</span>
          <span style={styles.taskText}>{agent.currentTask}</span>
        </div>
      )}

      {/* Branch */}
      {agent.branch && (
        <div style={styles.detailRow}>
          <span style={styles.rowIcon}>⎇</span>
          <span style={styles.detailText}>{agent.branch}</span>
        </div>
      )}

      {/* Mail preview */}
      {agent.firstSubject && (
        <div style={styles.detailRow}>
          <span style={styles.rowIcon}>📨</span>
          <span style={styles.mailPreview}>
            "{agent.firstSubject}"{agent.firstFrom && ` from ${agent.firstFrom}`}
          </span>
        </div>
      )}

      {/* Footer: last activity, worktree, progress */}
      {hasFooter && (
        <div style={styles.footer}>
          {relativeTime && (
            <span style={styles.footerItem}>◷ {relativeTime}</span>
          )}
          {agent.worktreePath && (
            <span style={styles.footerItem} title={agent.worktreePath}>
              📁 {agent.worktreePath.split('/').slice(-2).join('/')}
            </span>
          )}
          {agent.progress && (
            <span style={styles.footerItem}>
              {agent.progress.completed}/{agent.progress.total} tasks
            </span>
          )}
        </div>
      )}

      {/* D3: Assign bead action for idle agents */}
      {canAssign && !showAssign && (
        <button
          style={styles.assignButton}
          onClick={() => { setShowAssign(true); }}
          aria-label={`Assign bead to ${agent.name}`}
        >
          ASSIGN BEAD
        </button>
      )}

      {/* D3: Assign bead inline form */}
      {showAssign && (
        <form style={styles.assignForm} onSubmit={(e) => { void handleAssignSubmit(e); }}>
          <input
            style={styles.assignInput}
            type="text"
            value={beadId}
            onChange={(e) => { setBeadId(e.target.value); }}
            placeholder="BEAD ID..."
            autoFocus
            disabled={assignState === 'loading'}
          />
          <button
            style={styles.assignSubmit}
            type="submit"
            disabled={!beadId.trim() || assignState === 'loading'}
          >
            {assignState === 'loading' ? '...' : 'GO'}
          </button>
          <button
            style={styles.assignCancel}
            type="button"
            onClick={() => { setShowAssign(false); setBeadId(''); }}
          >
            ✕
          </button>
        </form>
      )}

      {/* Inline terminal expansion */}
      {expanded && (
        <div style={styles.terminalContainer}>
          <div style={styles.terminalHeader}>
            <span style={styles.terminalTitle}>
              TERMINAL {agent.sessionId ? `[${agent.sessionId.slice(0, 8)}]` : ''}
              {modeLabel && (
                <span style={{
                  ...styles.modeBadge,
                  color: streamMode === 'ws' ? colors.working : colors.primaryDim,
                }}>
                  {modeLabel}
                </span>
              )}
            </span>
            <button
              style={styles.terminalCloseBtn}
              onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
              aria-label="Close terminal"
            >
              ✕
            </button>
          </div>
          {terminalLoading && !terminalContent ? (
            <div style={styles.terminalLoading}>CONNECTING...</div>
          ) : terminalError && !terminalContent ? (
            <div style={styles.terminalErrorMsg}>{terminalError}</div>
          ) : (
            <pre
              ref={terminalRef}
              style={styles.terminalOutput}
              onScroll={handleTerminalScroll}
            >
              {terminalContent ?? 'No output yet.'}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

const styles = {
  card: {
    border: `1px solid ${colors.panelBorder}`,
    backgroundColor: colors.backgroundDark,
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    color: colors.primary,
    transition: 'border-color 0.2s ease, box-shadow 0.3s ease',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
    transition: 'all 0.2s ease',
  },
  name: {
    fontSize: '0.9rem',
    fontWeight: 'bold',
    letterSpacing: '0.1em',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  statusLabel: {
    fontSize: '0.65rem',
    letterSpacing: '0.1em',
    flexShrink: 0,
  },
  coordinatorBadge: {
    fontSize: '0.55rem',
    border: `1px solid ${colors.primaryDim}`,
    padding: '1px 4px',
    letterSpacing: '0.05em',
    color: colors.primaryBright,
    flexShrink: 0,
  },
  mailBadge: {
    fontSize: '0.75rem',
    color: colors.primaryBright,
    fontWeight: 'bold',
    flexShrink: 0,
  },
  terminalToggle: {
    fontSize: '0.6rem',
    color: colors.primaryDim,
    flexShrink: 0,
    marginLeft: '4px',
  },
  taskRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '0.8rem',
    color: colors.primaryBright,
  },
  rowIcon: {
    fontSize: '0.75rem',
    flexShrink: 0,
    width: '16px',
    textAlign: 'center',
  },
  taskText: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: 'bold',
  },
  detailRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '0.7rem',
    color: colors.primaryDim,
  },
  detailText: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: 'monospace',
    fontSize: '0.65rem',
  },
  mailPreview: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontStyle: 'italic',
    fontSize: '0.65rem',
  },
  footer: {
    display: 'flex',
    gap: '12px',
    fontSize: '0.6rem',
    color: colors.primaryDim,
    borderTop: `1px solid ${colors.offlineBorder}`,
    paddingTop: '6px',
    marginTop: '2px',
    flexWrap: 'wrap',
  },
  footerItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  // D2: Kill button
  killButton: {
    width: '18px',
    height: '18px',
    padding: 0,
    border: `1px solid ${colors.stuck}`,
    backgroundColor: 'transparent',
    color: colors.stuck,
    fontSize: '10px',
    fontWeight: 'bold',
    fontFamily: 'monospace',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'all 0.2s ease',
    opacity: 0.6,
    lineHeight: 1,
  },

  confirmRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '4px 0',
    fontSize: '0.7rem',
    color: colors.stuck,
    letterSpacing: '0.1em',
  },

  confirmText: {
    flex: 1,
    fontWeight: 'bold',
  },

  confirmYes: {
    padding: '2px 8px',
    border: `1px solid ${colors.stuck}`,
    backgroundColor: 'transparent',
    color: colors.stuck,
    fontSize: '0.65rem',
    fontWeight: 'bold',
    fontFamily: '"Share Tech Mono", monospace',
    letterSpacing: '0.1em',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },

  confirmNo: {
    padding: '2px 8px',
    border: `1px solid ${colors.primaryDim}`,
    backgroundColor: 'transparent',
    color: colors.primaryDim,
    fontSize: '0.65rem',
    fontWeight: 'bold',
    fontFamily: '"Share Tech Mono", monospace',
    letterSpacing: '0.1em',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },

  killErrorRow: {
    fontSize: '0.65rem',
    color: colors.stuck,
    letterSpacing: '0.05em',
    padding: '2px 0',
  },

  // D3: Assign bead
  assignButton: {
    padding: '3px 10px',
    border: `1px solid ${colors.primaryDim}`,
    backgroundColor: 'transparent',
    color: colors.primaryDim,
    fontSize: '0.6rem',
    fontWeight: 'bold',
    fontFamily: '"Share Tech Mono", monospace',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    alignSelf: 'flex-start',
    marginTop: '2px',
  },

  assignForm: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginTop: '4px',
  },

  assignInput: {
    flex: 1,
    padding: '3px 6px',
    border: `1px solid ${colors.primaryDim}`,
    backgroundColor: 'transparent',
    color: colors.primary,
    fontSize: '0.65rem',
    fontFamily: '"Share Tech Mono", monospace',
    letterSpacing: '0.05em',
    outline: 'none',
    caretColor: colors.primary,
  },

  assignSubmit: {
    padding: '3px 8px',
    border: `1px solid ${colors.primary}`,
    backgroundColor: 'transparent',
    color: colors.primary,
    fontSize: '0.6rem',
    fontWeight: 'bold',
    fontFamily: '"Share Tech Mono", monospace',
    letterSpacing: '0.1em',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },

  assignCancel: {
    width: '18px',
    height: '18px',
    padding: 0,
    border: `1px solid ${colors.primaryDim}`,
    backgroundColor: 'transparent',
    color: colors.primaryDim,
    fontSize: '10px',
    fontWeight: 'bold',
    fontFamily: 'monospace',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
    transition: 'all 0.2s ease',
  },

  // Terminal expansion styles
  terminalContainer: {
    borderTop: `1px solid ${colors.panelBorder}`,
    marginTop: '4px',
    paddingTop: '4px',
    display: 'flex',
    flexDirection: 'column',
    gap: '0',
  },
  terminalHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 8px',
    fontSize: '0.6rem',
    letterSpacing: '0.1em',
    color: colors.primaryDim,
  },
  terminalTitle: {
    textTransform: 'uppercase',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  modeBadge: {
    fontSize: '0.5rem',
    letterSpacing: '0.05em',
    padding: '1px 4px',
    border: `1px solid currentColor`,
  },
  terminalCloseBtn: {
    background: 'none',
    border: 'none',
    color: colors.primaryDim,
    cursor: 'pointer',
    fontSize: '0.7rem',
    fontFamily: 'monospace',
    padding: '2px 4px',
    lineHeight: 1,
  },
  terminalOutput: {
    margin: 0,
    padding: '8px',
    backgroundColor: '#020202',
    color: colors.primary,
    fontSize: '0.65rem',
    lineHeight: 1.4,
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    maxHeight: '250px',
    overflowY: 'auto',
    overflowX: 'hidden',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    border: `1px solid #1a1a1a`,
  },
  terminalLoading: {
    padding: '16px 8px',
    color: colors.primaryDim,
    fontSize: '0.65rem',
    letterSpacing: '0.1em',
    textAlign: 'center',
  },
  terminalErrorMsg: {
    padding: '16px 8px',
    color: colors.stuck,
    fontSize: '0.65rem',
    letterSpacing: '0.05em',
    textAlign: 'center',
  },
} satisfies Record<string, CSSProperties>;
