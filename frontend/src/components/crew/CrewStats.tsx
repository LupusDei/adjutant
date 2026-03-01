import type { CSSProperties } from 'react';
import { useMemo, useState, useCallback } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useSwarmAgents } from '../../hooks/useSwarmAgents';
import { api, ApiError } from '../../services/api';
import type { CrewMember } from '../../types';
import { SwarmAgentCard } from './SwarmAgentCard';

// =============================================================================
// Status Grouping
// =============================================================================

type StatusGroup = 'working' | 'blocked' | 'stuck' | 'idle' | 'offline';

const STATUS_GROUP_ORDER: StatusGroup[] = ['working', 'blocked', 'stuck', 'idle', 'offline'];

const STATUS_GROUP_LABELS: Record<StatusGroup, string> = {
  working: 'WORKING',
  blocked: 'BLOCKED',
  stuck: 'STUCK',
  idle: 'IDLE',
  offline: 'OFFLINE',
};

function getEffectiveStatusGroup(agent: CrewMember): StatusGroup {
  if (agent.status === 'offline') return 'offline';
  if (agent.status === 'stuck') return 'stuck';
  if (agent.status === 'blocked') return 'blocked';
  if (agent.status === 'working') return 'working';
  if (agent.currentTask) return 'working';
  return 'idle';
}

function sortByLastActivity(a: CrewMember, b: CrewMember): number {
  if (!a.lastActivity && !b.lastActivity) return 0;
  if (!a.lastActivity) return 1;
  if (!b.lastActivity) return -1;
  return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
}

function getGroupColor(group: StatusGroup): string {
  switch (group) {
    case 'working': return colors.working;
    case 'blocked': return colors.blocked;
    case 'stuck': return colors.stuck;
    case 'idle': return colors.idle;
    case 'offline': return colors.offline;
  }
}

// =============================================================================
// CrewStats
// =============================================================================

/**
 * Props for the CrewStats component.
 */
export interface CrewStatsProps {
  /** Optional CSS class name */
  className?: string;
  /** Whether this tab is currently active */
  isActive?: boolean;
}

/**
 * Pip-Boy styled crew stats dashboard.
 * Displays agents grouped by status.
 */
export function CrewStats({ className = '' }: CrewStatsProps) {
  const swarm = useSwarmAgents();
  const agents = swarm.agents;
  const loading = swarm.loading;
  const error = swarm.error ? { message: swarm.error } : null;

  const isNarrow = useMediaQuery('(max-width: 768px)');
  const agentGridStyle = isNarrow
    ? { ...styles.agentGrid, gridTemplateColumns: '1fr' }
    : styles.agentGrid;

  const totalAgents = agents?.length ?? 0;
  const runningAgents = agents?.filter(a => a.status !== 'offline').length ?? 0;

  return (
    <section style={styles.container} className={className}>
      <header style={styles.header}>
        <h2 style={styles.title} className="crt-glow">AGENTS</h2>
        <div style={styles.headerControls}>
          <div style={styles.syncStatus}>
            <span style={styles.syncIndicator}>
              {loading ? '◌' : error ? '✕' : '●'}
            </span>
            {loading ? 'SYNCING...' : error ? 'OFFLINE' : 'LIVE'}
          </div>
        </div>
      </header>

      {error && (
        <div style={styles.errorBanner} role="alert">
          ⚠ COMM ERROR: {error.message}
        </div>
      )}

      <div style={styles.body} role="list" aria-label="Crew members">
        {loading && !agents && (
          <div style={styles.loadingState}>
            <div style={styles.loadingPulse} />
            INITIALIZING CREW TELEMETRY...
          </div>
        )}

        {agents && agents.length > 0 && (
          <>
            <SwarmSummaryPanel agents={agents} />
            <SwarmSection agents={agents} gridStyle={agentGridStyle} />
          </>
        )}

        {agents && agents.length === 0 && (
          <div style={styles.emptyState}>NO AGENTS CONFIGURED</div>
        )}
      </div>

      <footer style={styles.footer}>
        <div style={styles.stats}>
          <span style={styles.statItem}>
            <span style={styles.statLabel}>AGENTS</span>
            <span style={styles.statValue}>{totalAgents}</span>
          </span>
          <span style={styles.statDivider}>│</span>
          <span style={styles.statItem}>
            <span style={styles.statLabel}>ONLINE</span>
            <span style={{ ...styles.statValue, color: colors.working }}>
              {runningAgents}
            </span>
          </span>
          <span style={styles.statDivider}>│</span>
          <span style={styles.statItem}>
            <span style={styles.statLabel}>OFFLINE</span>
            <span style={{ ...styles.statValue, color: colors.offline }}>
              {totalAgents - runningAgents}
            </span>
          </span>
        </div>
      </footer>
    </section>
  );
}

// =============================================================================
// Swarm Summary Panel
// =============================================================================

interface SwarmSummaryPanelProps {
  agents: CrewMember[];
}

/** Spawn button state for swarm summary panel */
type SwarmSpawnState = 'idle' | 'loading' | 'success' | 'error';

function SwarmSummaryPanel({ agents }: SwarmSummaryPanelProps) {
  const counts = useMemo(() => {
    let active = 0, idle = 0, blocked = 0, offline = 0;
    for (const agent of agents) {
      const group = getEffectiveStatusGroup(agent);
      switch (group) {
        case 'working': active++; break;
        case 'idle': idle++; break;
        case 'blocked':
        case 'stuck': blocked++; break;
        case 'offline': offline++; break;
      }
    }
    return { active, idle, blocked, offline };
  }, [agents]);

  const swarmId = useMemo(() => agents.find(a => a.swarmId)?.swarmId ?? null, [agents]);
  const [spawnState, setSpawnState] = useState<SwarmSpawnState>('idle');
  const [spawnError, setSpawnError] = useState<string | null>(null);

  const handleSpawnAgent = useCallback(async () => {
    if (spawnState === 'loading' || !swarmId) return;
    setSpawnState('loading');
    setSpawnError(null);
    try {
      await api.swarms.addAgent(swarmId);
      setSpawnState('success');
      setTimeout(() => { setSpawnState('idle'); }, 2000);
    } catch (err) {
      setSpawnState('error');
      setSpawnError(err instanceof ApiError ? err.message : 'Failed to spawn agent');
      setTimeout(() => { setSpawnState('idle'); setSpawnError(null); }, 3000);
    }
  }, [swarmId, spawnState]);

  const hasIssues = counts.blocked > 0;
  const overallStatus = hasIssues ? 'AGENTS BLOCKED' : 'OPERATIONAL';
  const overallColor = hasIssues ? colors.blocked : colors.working;

  const spawnLabel = spawnState === 'loading' ? 'SPAWNING...'
    : spawnState === 'success' ? 'SPAWNED'
    : spawnState === 'error' ? 'FAILED'
    : 'SPAWN AGENT';

  const spawnBtnStyle: CSSProperties = {
    ...styles.swarmSpawnButton,
    ...(spawnState === 'loading' ? { cursor: 'wait', opacity: 0.7 } : {}),
    ...(spawnState === 'success' ? { borderColor: colors.working, color: colors.working } : {}),
    ...(spawnState === 'error' ? { borderColor: colors.stuck, color: colors.stuck } : {}),
    ...(!swarmId ? { opacity: 0.4, cursor: 'not-allowed' } : {}),
  };

  return (
    <div style={styles.summaryPanel}>
      <div style={styles.summaryBadges}>
        <span style={{ ...styles.summaryBadge, color: colors.working }}>
          {counts.active} ACTIVE
        </span>
        <span style={styles.summaryDivider}>│</span>
        <span style={{ ...styles.summaryBadge, color: colors.idle }}>
          {counts.idle} IDLE
        </span>
        <span style={styles.summaryDivider}>│</span>
        <span style={{ ...styles.summaryBadge, color: colors.blocked }}>
          {counts.blocked} BLOCKED
        </span>
        <span style={styles.summaryDivider}>│</span>
        <span style={{ ...styles.summaryBadge, color: colors.offline }}>
          {counts.offline} OFFLINE
        </span>
      </div>
      <div style={styles.summaryStatusRow}>
        <div style={{ ...styles.summaryStatus, color: overallColor }} className="crt-glow">
          {'>'} {overallStatus}
        </div>
        <div style={styles.swarmSpawnContainer}>
          <button
            style={spawnBtnStyle}
            onClick={() => { void handleSpawnAgent(); }}
            disabled={spawnState === 'loading' || !swarmId}
            title={spawnError ?? (swarmId ? 'Spawn a new agent' : 'No active swarm')}
            aria-label="Spawn new agent"
          >
            {spawnLabel}
          </button>
          {spawnState === 'error' && spawnError && (
            <span style={styles.swarmSpawnError} title={spawnError}>
              {spawnError.length > 25 ? `${spawnError.slice(0, 25)}...` : spawnError}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Swarm Section - Agents grouped by status
// =============================================================================

interface SwarmSectionProps {
  agents: CrewMember[];
  gridStyle: CSSProperties;
}

function SwarmSection({ agents, gridStyle }: SwarmSectionProps) {
  const [showOffline, setShowOffline] = useState(false);

  const groups = useMemo(() => {
    const grouped: Record<StatusGroup, CrewMember[]> = {
      working: [], blocked: [], stuck: [], idle: [], offline: [],
    };
    for (const agent of agents) {
      grouped[getEffectiveStatusGroup(agent)].push(agent);
    }
    for (const key of STATUS_GROUP_ORDER) {
      grouped[key].sort(sortByLastActivity);
    }
    return grouped;
  }, [agents]);

  return (
    <div style={styles.section}>
      <div style={styles.sectionHeader}>
        <span style={styles.sectionIcon}>◈</span>
        <span style={styles.sectionTitle} className="crt-glow">AGENTS</span>
        <span style={styles.sectionLine} />
      </div>
      {STATUS_GROUP_ORDER.map((group) => {
        const groupAgents = groups[group];
        if (groupAgents.length === 0) return null;

        if (group === 'offline') {
          return (
            <div key={group} style={styles.statusGroup}>
              <button
                style={styles.offlineToggle}
                onClick={() => { setShowOffline(prev => !prev); }}
                aria-expanded={showOffline}
              >
                <span style={{ color: getGroupColor(group) }}>
                  {'>'} {STATUS_GROUP_LABELS[group]} ({groupAgents.length})
                </span>
                <span style={styles.toggleArrow}>{showOffline ? '▼' : '▶'}</span>
              </button>
              {showOffline && (
                <div style={gridStyle}>
                  {groupAgents.map((agent) => (
                    <SwarmAgentCard key={agent.id} agent={agent} />
                  ))}
                </div>
              )}
            </div>
          );
        }

        return (
          <div key={group} style={styles.statusGroup}>
            <div style={{ ...styles.groupHeader, color: getGroupColor(group) }}>
              {'>'} {STATUS_GROUP_LABELS[group]} ({groupAgents.length})
            </div>
            <div style={gridStyle}>
              {groupAgents.map((agent) => (
                <SwarmAgentCard key={agent.id} agent={agent} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// =============================================================================
// Styles
// =============================================================================

const colors = {
  primary: 'var(--crt-phosphor)',
  primaryBright: 'var(--crt-phosphor-bright)',
  primaryDim: 'var(--crt-phosphor-dim)',
  primaryGlow: 'var(--crt-phosphor-glow)',
  background: '#0A0A0A',
  backgroundDark: '#050505',
  panelBorder: 'var(--crt-phosphor-dim)',
  // Status colors
  working: 'var(--crt-phosphor-bright)',
  idle: 'var(--crt-phosphor)',
  blocked: '#FFB000',
  stuck: '#FF4444',
  offline: '#666666',
} as const;

const styles = {
  container: {
    border: `1px solid ${colors.panelBorder}`,
    backgroundColor: colors.background,
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    color: colors.primary,
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },

  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: `1px solid ${colors.panelBorder}`,
    paddingBottom: '10px',
    flexShrink: 0,
  },

  title: {
    margin: 0,
    fontSize: '1.25rem',
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    color: colors.primary,
  },

  headerControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },

  syncStatus: {
    fontSize: '0.75rem',
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    color: colors.primaryDim,
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },

  syncIndicator: {
    fontSize: '0.8rem',
  },

  body: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    minHeight: 0,
    overflow: 'auto',
    paddingRight: '4px',
  },

  loadingState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px',
    color: colors.primaryDim,
    letterSpacing: '0.1em',
    gap: '16px',
  },

  loadingPulse: {
    width: '40px',
    height: '40px',
    border: `2px solid ${colors.primaryDim}`,
    borderTopColor: colors.primary,
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
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
    backgroundColor: 'rgba(255, 68, 68, 0.1)',
  },

  // Section styles
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },

  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '0.85rem',
    letterSpacing: '0.15em',
  },

  sectionIcon: {
    color: colors.primaryBright,
    fontSize: '0.9rem',
  },

  sectionTitle: {
    color: colors.primary,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },

  sectionLine: {
    flex: 1,
    height: '1px',
    background: `linear-gradient(to right, ${colors.panelBorder}, transparent)`,
  },

  // Swarm summary panel styles
  summaryPanel: {
    border: `1px solid ${colors.panelBorder}`,
    backgroundColor: colors.backgroundDark,
    padding: '12px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },

  summaryBadges: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '0.8rem',
    letterSpacing: '0.1em',
    fontWeight: 'bold',
    flexWrap: 'wrap',
  },

  summaryBadge: {
    fontWeight: 'bold',
  },

  summaryDivider: {
    color: colors.primaryDim,
    opacity: 0.5,
  },

  summaryStatusRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
  },

  summaryStatus: {
    fontSize: '0.85rem',
    letterSpacing: '0.15em',
    fontWeight: 'bold',
  },

  swarmSpawnContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexShrink: 0,
  },

  swarmSpawnButton: {
    padding: '4px 12px',
    border: `1px solid ${colors.primary}`,
    backgroundColor: 'transparent',
    color: colors.primary,
    fontSize: '0.7rem',
    fontWeight: 'bold',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },

  swarmSpawnError: {
    fontSize: '0.6rem',
    color: colors.stuck,
    letterSpacing: '0.05em',
    maxWidth: '150px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  // Status group styles
  statusGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginLeft: '8px',
  },

  groupHeader: {
    fontSize: '0.75rem',
    letterSpacing: '0.15em',
    fontWeight: 'bold',
  },

  offlineToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'none',
    border: 'none',
    padding: '4px 0',
    cursor: 'pointer',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    fontSize: '0.75rem',
    letterSpacing: '0.15em',
    fontWeight: 'bold',
    color: colors.primary,
    textAlign: 'left',
  },

  toggleArrow: {
    fontSize: '0.6rem',
    color: colors.primaryDim,
  },

  // Grid layout
  agentGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '10px',
  },

  // Footer
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTop: `1px solid ${colors.panelBorder}`,
    paddingTop: '10px',
    flexShrink: 0,
  },

  stats: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    fontSize: '0.75rem',
  },

  statItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px',
  },

  statLabel: {
    fontSize: '0.6rem',
    color: colors.primaryDim,
    letterSpacing: '0.1em',
  },

  statValue: {
    fontSize: '1rem',
    fontWeight: 'bold',
    color: colors.primary,
  },

  statDivider: {
    color: colors.primaryDim,
    opacity: 0.5,
  },
} satisfies Record<string, CSSProperties>;

export default CrewStats;
