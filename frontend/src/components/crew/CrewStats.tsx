import type { CSSProperties } from 'react';
import { usePolling } from '../../hooks/usePolling';
import { api } from '../../services/api';
import type { CrewMember, CrewMemberStatus, AgentType } from '../../types';

/**
 * Props for the CrewStats component.
 */
export interface CrewStatsProps {
  /** Optional CSS class name */
  className?: string;
}

/**
 * Pip-Boy styled crew stats dashboard.
 * Displays all agents with their status, type, and metrics.
 */
export function CrewStats({ className = '' }: CrewStatsProps) {
  const {
    data: agents,
    loading,
    error,
    refresh,
    lastUpdated,
  } = usePolling<CrewMember[]>(() => api.agents.list(), {
    interval: 5000,
  });

  return (
    <section style={styles.container} className={className}>
      <header style={styles.header}>
        <h2 style={styles.title}>CREW STATS</h2>
        <div style={styles.syncStatus}>
          {loading ? 'SYNCING...' : 'LIVE'}
          {lastUpdated && !loading && (
            <span style={styles.syncTime}>
              {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
      </header>

      {error && (
        <div style={styles.errorBanner} role="alert">
          ⚠ CREW ERROR: {error.message}
        </div>
      )}

      <div style={styles.body}>
        {loading && !agents && (
          <div style={styles.loadingState}>LOADING CREW DATA...</div>
        )}

        {!loading && (!agents || agents.length === 0) && (
          <div style={styles.emptyState}>NO AGENTS FOUND</div>
        )}

        {agents && agents.length > 0 && (
          <div style={styles.crewGrid} role="list" aria-label="Crew members">
            {agents.map((agent) => (
              <CrewCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </div>

      <footer style={styles.footer}>
        <button
          type="button"
          style={styles.refreshButton}
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? 'REFRESHING...' : 'REFRESH'}
        </button>
        <div style={styles.stats}>
          {agents && (
            <>
              <span style={styles.statItem}>
                TOTAL: {agents.length}
              </span>
              <span style={styles.statItem}>
                ONLINE: {agents.filter(a => a.status !== 'offline').length}
              </span>
              <span style={styles.statItem}>
                WORKING: {agents.filter(a => a.status === 'working').length}
              </span>
            </>
          )}
        </div>
      </footer>
    </section>
  );
}

/**
 * Individual crew member card component.
 */
interface CrewCardProps {
  agent: CrewMember;
}

function CrewCard({ agent }: CrewCardProps) {
  const statusColor = getStatusColor(agent.status);
  const typeIcon = getTypeIcon(agent.type);

  return (
    <div
      style={{
        ...styles.card,
        borderColor: statusColor,
      }}
      role="listitem"
      aria-label={`${agent.name} - ${agent.status}`}
    >
      <div style={styles.cardHeader}>
        <span style={styles.typeIcon} title={agent.type}>
          {typeIcon}
        </span>
        <span style={styles.agentName}>{agent.name}</span>
        {agent.unreadMail > 0 && (
          <span style={styles.mailBadge} title={`${agent.unreadMail} unread`}>
            ✉ {agent.unreadMail}
          </span>
        )}
      </div>

      <div style={styles.cardBody}>
        <div style={styles.statusRow}>
          <span
            style={{
              ...styles.statusIndicator,
              backgroundColor: statusColor,
              boxShadow: `0 0 6px ${statusColor}`,
            }}
          />
          <span style={{ ...styles.statusText, color: statusColor }}>
            {agent.status.toUpperCase()}
          </span>
        </div>

        {agent.rig && (
          <div style={styles.rigInfo}>
            RIG: {agent.rig}
          </div>
        )}

        {agent.currentTask && (
          <div style={styles.taskInfo} title={agent.currentTask}>
            {agent.currentTask}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Get color for agent status.
 */
function getStatusColor(status: CrewMemberStatus): string {
  switch (status) {
    case 'working':
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

/**
 * Get icon for agent type.
 */
function getTypeIcon(type: AgentType): string {
  switch (type) {
    case 'mayor':
      return '👑';
    case 'deacon':
      return '📋';
    case 'witness':
      return '👁';
    case 'refinery':
      return '⚙';
    case 'crew':
      return '👷';
    case 'polecat':
      return '🏃';
    default:
      return '●';
  }
}

// Pip-Boy color palette
const colors = {
  primary: '#14F07D',
  primaryBright: '#2BFF96',
  primaryDim: '#0A7A3E',
  primaryGlow: 'rgba(20, 240, 125, 0.35)',
  background: '#0A0A0A',
  backgroundDark: '#050505',
  panelBorder: '#0A7A3E',
  // Status colors
  working: '#2BFF96',
  idle: '#7CFFDD',
  blocked: '#FFB000',
  stuck: '#FF4444',
  offline: '#666666',
} as const;

const styles = {
  container: {
    border: `1px solid ${colors.panelBorder}`,
    backgroundColor: colors.background,
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    color: colors.primary,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    borderBottom: `1px solid ${colors.panelBorder}`,
    paddingBottom: '8px',
  },
  title: {
    margin: 0,
    fontSize: '1.25rem',
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    color: colors.primary,
  },
  syncStatus: {
    fontSize: '0.75rem',
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    color: colors.primary,
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  syncTime: {
    color: colors.primaryBright,
    fontSize: '0.7rem',
  },
  body: {
    flex: 1,
    minHeight: '200px',
  },
  loadingState: {
    textAlign: 'center',
    padding: '48px',
    color: colors.primaryDim,
    letterSpacing: '0.1em',
  },
  emptyState: {
    textAlign: 'center',
    padding: '48px',
    color: colors.primaryDim,
    letterSpacing: '0.1em',
  },
  errorBanner: {
    border: `1px solid ${colors.stuck}`,
    color: colors.stuck,
    padding: '8px 12px',
    fontSize: '0.85rem',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    backgroundColor: colors.backgroundDark,
  },
  crewGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: '12px',
  },
  card: {
    border: `1px solid ${colors.panelBorder}`,
    backgroundColor: colors.backgroundDark,
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  typeIcon: {
    fontSize: '1rem',
  },
  agentName: {
    flex: 1,
    fontSize: '0.95rem',
    fontWeight: 'bold',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
  },
  mailBadge: {
    fontSize: '0.75rem',
    color: colors.primaryBright,
    backgroundColor: `${colors.primaryGlow}`,
    padding: '2px 6px',
    borderRadius: '2px',
  },
  cardBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  statusIndicator: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  statusText: {
    fontSize: '0.8rem',
    letterSpacing: '0.1em',
  },
  rigInfo: {
    fontSize: '0.75rem',
    color: colors.primaryDim,
    letterSpacing: '0.05em',
  },
  taskInfo: {
    fontSize: '0.75rem',
    color: colors.primaryDim,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontStyle: 'italic',
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTop: `1px solid ${colors.panelBorder}`,
    paddingTop: '12px',
  },
  refreshButton: {
    padding: '8px 16px',
    fontSize: '0.85rem',
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    backgroundColor: 'transparent',
    border: `1px solid ${colors.primaryDim}`,
    color: colors.primary,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.2s ease',
  },
  stats: {
    display: 'flex',
    gap: '16px',
    fontSize: '0.75rem',
    letterSpacing: '0.1em',
  },
  statItem: {
    color: colors.primaryDim,
  },
} satisfies Record<string, CSSProperties>;

export default CrewStats;
