import type { CSSProperties } from 'react';
import { useMemo, useState, useCallback } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { usePolling } from '../../hooks/usePolling';
import { useSwarmAgents } from '../../hooks/useSwarmAgents';
import { api, ApiError } from '../../services/api';
import { useMode } from '../../contexts/ModeContext';
import { TerminalPane } from '../terminal';
import type { CrewMember } from '../../types';
import { SwarmAgentCard } from './SwarmAgentCard';

/** localStorage key for polecat filter preference */
const SHOW_ALL_POLECATS_KEY = 'adjutant:showAllPolecats';

/**
 * Hook for persisting show-all-polecats preference to localStorage.
 */
function useShowAllPolecats(): [boolean, (value: boolean) => void] {
  const [showAll, setShowAll] = useState(() => {
    try {
      const stored = localStorage.getItem(SHOW_ALL_POLECATS_KEY);
      return stored === 'true';
    } catch {
      return false;
    }
  });

  const setShowAllPersisted = useCallback((value: boolean) => {
    setShowAll(value);
    try {
      localStorage.setItem(SHOW_ALL_POLECATS_KEY, String(value));
    } catch {
      // localStorage not available, ignore
    }
  }, []);

  return [showAll, setShowAllPersisted];
}

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
 * Grouped agent structure for hierarchical display.
 */
interface AgentGroup {
  /** Town-level agents (mayor, deacon) */
  town: CrewMember[];
  /** Per-rig agent groups */
  rigs: Map<string, RigAgents>;
  /** Peer agents (no rig) - for non-infrastructure agents in swarm mode */
  peers: CrewMember[];
}

/**
 * Agents within a single rig.
 */
interface RigAgents {
  crew: CrewMember[];
  witness: CrewMember | null;
  refinery: CrewMember | null;
  polecats: CrewMember[];
}

/**
 * Groups flat agent list into hierarchical structure.
 */
function groupAgents(agents: CrewMember[]): AgentGroup {
  const town: CrewMember[] = [];
  const rigs = new Map<string, RigAgents>();
  const peers: CrewMember[] = [];

  for (const agent of agents) {
    // Town-level/infrastructure agents have no rig
    if (!agent.rig) {
      // Gas Town infrastructure
      if (agent.type === 'mayor' || agent.type === 'deacon') {
        town.push(agent);
      }
      // Swarm mode agents
      else if (agent.type === 'user' || agent.type === 'agent') {
        peers.push(agent);
      }
      continue;
    }

    // Get or create rig group
    if (!rigs.has(agent.rig)) {
      rigs.set(agent.rig, {
        crew: [],
        witness: null,
        refinery: null,
        polecats: [],
      });
    }
    const rigGroup = rigs.get(agent.rig)!;

    // Sort into appropriate category
    switch (agent.type) {
      case 'crew':
        rigGroup.crew.push(agent);
        break;
      case 'witness':
        rigGroup.witness = agent;
        break;
      case 'refinery':
        rigGroup.refinery = agent;
        break;
      case 'polecat':
        rigGroup.polecats.push(agent);
        break;
    }
  }

  return { town, rigs, peers };
}

// =============================================================================
// Swarm Status Grouping
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
  if (agent.status === 'idle' && agent.currentTask) return 'working';
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

/**
 * Pip-Boy styled crew stats dashboard.
 * Displays agents organized by hierarchy: Town-level → Per-rig sections.
 */
export function CrewStats({ className = '', isActive = true }: CrewStatsProps) {
  const { isGasTown, isSwarm } = useMode();

  // Gas Town mode: simple polling
  const polling = usePolling<CrewMember[]>(() => api.agents.list(), {
    interval: 60000,
    enabled: isActive && !isSwarm,
  });

  // Swarm mode: WebSocket + polling hybrid
  const swarm = useSwarmAgents();

  // Pick the active data source based on mode
  const agents = isSwarm ? swarm.agents : polling.data;
  const loading = isSwarm ? swarm.loading : polling.loading;
  const error = isSwarm ? (swarm.error ? { message: swarm.error } : null) : polling.error;
  const lastUpdated = isSwarm ? null : polling.lastUpdated;

  const isNarrow = useMediaQuery('(max-width: 768px)');
  const [showAllPolecats, setShowAllPolecats] = useShowAllPolecats();
  const [expandedPolecat, setExpandedPolecat] = useState<string | null>(null);

  // Group agents into hierarchical structure
  const grouped = useMemo(() => {
    if (!agents) return null;
    return groupAgents(agents);
  }, [agents]);

  const totalAgents = agents?.length ?? 0;
  const runningAgents = agents?.filter(a => a.status !== 'offline').length ?? 0;
  const townGridStyle = isNarrow
    ? { ...styles.townGrid, gridTemplateColumns: '1fr' }
    : styles.townGrid;
  const agentGridStyle = isNarrow
    ? { ...styles.agentGrid, gridTemplateColumns: '1fr' }
    : styles.agentGrid;
  const infraGridStyle = isNarrow
    ? { ...styles.infraGrid, gridTemplateColumns: '1fr' }
    : styles.infraGrid;

  return (
    <section style={styles.container} className={className}>
      <header style={styles.header}>
        <h2 style={styles.title} className="crt-glow">
          {isSwarm ? 'SWARM AGENTS' : 'CREW MANIFEST'}
        </h2>
        <div style={styles.headerControls}>
          {isGasTown && (
            <label style={styles.toggleLabel}>
              <span
                style={{
                  ...styles.toggleCheckbox,
                  backgroundColor: showAllPolecats ? colors.primary : 'transparent',
                  borderColor: showAllPolecats ? colors.primary : colors.primaryDim,
                }}
                role="checkbox"
                aria-checked={showAllPolecats}
              >
                {showAllPolecats && <span style={styles.toggleCheckmark}>✓</span>}
              </span>
              <input
                type="checkbox"
                checked={showAllPolecats}
                onChange={(e) => setShowAllPolecats(e.target.checked)}
                style={styles.toggleHiddenInput}
              />
              <span style={styles.toggleText}>SHOW ALL</span>
            </label>
          )}
          <div style={styles.syncStatus}>
            <span style={styles.syncIndicator}>
              {loading ? '◌' : error ? '✕' : '●'}
            </span>
            {loading ? 'SYNCING...' : error ? 'OFFLINE' : 'LIVE'}
            {lastUpdated && !loading && (
              <span style={styles.syncTime}>
                {lastUpdated.toLocaleTimeString()}
              </span>
            )}
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

        {grouped && (
          <>
            {/* Town-level agents (Gas Town mode) */}
            {grouped.town.length > 0 && (
              <TownSection agents={grouped.town} gridStyle={townGridStyle} />
            )}

            {/* Swarm summary panel (swarm mode only) */}
            {isSwarm && grouped.peers.length > 0 && (
              <SwarmSummaryPanel agents={grouped.peers} />
            )}

            {/* Swarm peer agents */}
            {grouped.peers.length > 0 && (
              <SwarmSection agents={grouped.peers} gridStyle={agentGridStyle} />
            )}

            {/* Per-rig sections */}
            {Array.from(grouped.rigs.entries()).map(([rigName, rigAgents]) => (
              <RigSection
                key={rigName}
                name={rigName}
                agents={rigAgents}
                agentGridStyle={agentGridStyle}
                infraGridStyle={infraGridStyle}
                showAllPolecats={showAllPolecats}
                expandedPolecat={expandedPolecat}
                onPolecatClick={setExpandedPolecat}
              />
            ))}

            {grouped.rigs.size === 0 && grouped.town.length === 0 && grouped.peers.length === 0 && (
              <div style={styles.emptyState}>NO AGENTS CONFIGURED</div>
            )}
          </>
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
// Town Section - Mayor | Deacon
// =============================================================================

interface TownSectionProps {
  agents: CrewMember[];
  gridStyle: CSSProperties;
}

function TownSection({ agents, gridStyle }: TownSectionProps) {
  const mayor = agents.find(a => a.type === 'mayor');
  const deacon = agents.find(a => a.type === 'deacon');

  return (
    <div style={styles.section}>
      <div style={styles.sectionHeader}>
        <span style={styles.sectionIcon}>◈</span>
        <span style={styles.sectionTitle} className="crt-glow">TOWN COMMAND</span>
        <span style={styles.sectionLine} />
      </div>
      <div style={gridStyle}>
        {mayor && <AgentCard agent={mayor} icon="👑" />}
        {deacon && <AgentCard agent={deacon} icon="📋" />}
      </div>
    </div>
  );
}

// =============================================================================
// Swarm Summary Panel - Overview stats for swarm mode
// =============================================================================

interface SwarmSummaryPanelProps {
  agents: CrewMember[];
}

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

  const hasIssues = counts.blocked > 0;
  const overallStatus = hasIssues ? 'AGENTS BLOCKED' : 'SWARM OPERATIONAL';
  const overallColor = hasIssues ? colors.blocked : colors.working;

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
      <div style={{ ...styles.summaryStatus, color: overallColor }} className="crt-glow">
        {'>'} {overallStatus}
      </div>
    </div>
  );
}

// =============================================================================
// Swarm Section - For swarm mode agents
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
                onClick={() => setShowOffline(prev => !prev)}
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
// Rig Section - Per-rig groupings
// =============================================================================

interface RigSectionProps {
  name: string;
  agents: RigAgents;
  agentGridStyle: CSSProperties;
  infraGridStyle: CSSProperties;
  /** Whether to show all polecats including inactive ones */
  showAllPolecats: boolean;
  /** Currently expanded polecat ID (for terminal view) */
  expandedPolecat: string | null;
  /** Callback when a polecat is clicked to expand/collapse terminal */
  onPolecatClick: (polecatId: string | null) => void;
}

/** Spawn button state */
type SpawnState = 'idle' | 'loading' | 'success' | 'error';

function RigSection({ name, agents, agentGridStyle, infraGridStyle, showAllPolecats, expandedPolecat, onPolecatClick }: RigSectionProps) {
  const [spawnState, setSpawnState] = useState<SpawnState>('idle');
  const [spawnError, setSpawnError] = useState<string | null>(null);

  // Filter polecats based on showAll preference
  const visiblePolecats = showAllPolecats
    ? agents.polecats
    : agents.polecats.filter(p => p.status !== 'offline');
  const totalPolecats = agents.polecats.length;
  const activePolecats = agents.polecats.filter(p => p.status !== 'offline').length;

  const allAgents = [
    ...(agents.witness ? [agents.witness] : []),
    ...(agents.refinery ? [agents.refinery] : []),
    ...agents.crew,
    ...agents.polecats,
  ];
  const totalInRig = allAgents.length;
  const runningInRig = allAgents.filter(a => a.status !== 'offline').length;

  const handleSpawnPolecat = useCallback(async () => {
    if (spawnState === 'loading') return;

    setSpawnState('loading');
    setSpawnError(null);

    try {
      await api.agents.spawnPolecat(name);
      setSpawnState('success');
      // Reset to idle after showing success
      setTimeout(() => setSpawnState('idle'), 2000);
    } catch (err) {
      setSpawnState('error');
      if (err instanceof ApiError) {
        setSpawnError(err.message);
      } else {
        setSpawnError('Failed to request polecat');
      }
      // Reset to idle after showing error
      setTimeout(() => {
        setSpawnState('idle');
        setSpawnError(null);
      }, 3000);
    }
  }, [name, spawnState]);

  return (
    <div style={styles.section}>
      <div style={styles.sectionHeader}>
        <span style={styles.sectionIcon}>◇</span>
        <span style={styles.sectionTitle} className="crt-glow">RIG: {name.toUpperCase()}</span>
        <span style={styles.rigStats}>
          {runningInRig}/{totalInRig} ACTIVE
        </span>
        <span style={styles.sectionLine} />
      </div>

      {/* Crew Members */}
      {agents.crew.length > 0 && (
        <div style={styles.subsection}>
          <div style={styles.subsectionHeader}>
            <span style={styles.subsectionIcon}>├─</span>
            <span style={styles.subsectionTitle}>CREW</span>
          </div>
          <div style={agentGridStyle}>
            {agents.crew.map((agent) => (
              <AgentCard key={agent.id} agent={agent} icon="👷" />
            ))}
          </div>
        </div>
      )}

      {/* Witness | Refinery */}
      {(agents.witness || agents.refinery) && (
        <div style={styles.subsection}>
          <div style={styles.subsectionHeader}>
            <span style={styles.subsectionIcon}>├─</span>
            <span style={styles.subsectionTitle}>INFRASTRUCTURE</span>
          </div>
          <div style={infraGridStyle}>
            {agents.witness && <AgentCard agent={agents.witness} icon="👁" />}
            {agents.refinery && <AgentCard agent={agents.refinery} icon="⚙" />}
          </div>
        </div>
      )}

      {/* Polecats */}
      <div style={styles.subsection}>
        <div style={styles.subsectionHeader}>
          <span style={styles.subsectionIcon}>└─</span>
          <span style={styles.subsectionTitle}>POLECATS</span>
          <SpawnPolecatButton
            state={spawnState}
            onClick={handleSpawnPolecat}
            error={spawnError}
          />
          <span style={styles.polecatCount}>
            {totalPolecats > 0
              ? showAllPolecats
                ? `${activePolecats}/${totalPolecats} ACTIVE`
                : `${activePolecats} ACTIVE`
              : 'NONE'}
          </span>
        </div>
        {visiblePolecats.length > 0 ? (
          <div style={styles.polecatList}>
            {visiblePolecats.map((agent) => {
              const isExpanded = expandedPolecat === agent.id;
              const isOnline = agent.status !== 'offline';
              return (
                <div key={agent.id} style={styles.polecatWrapper}>
                  <PolecatCard
                    agent={agent}
                    isExpanded={isExpanded}
                    onClick={() => onPolecatClick(isExpanded ? null : agent.id)}
                    disabled={!isOnline}
                  />
                  {isExpanded && agent.rig && (
                    <div style={styles.terminalContainer}>
                      <TerminalPane
                        rig={agent.rig}
                        polecat={agent.name}
                        pollInterval={2000}
                        onClose={() => onPolecatClick(null)}
                        style={{ height: '300px' }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div style={styles.polecatEmpty}>
            {totalPolecats > 0 ? 'NO ACTIVE POLECATS' : 'NO POLECATS'}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Spawn Polecat Button
// =============================================================================

interface SpawnPolecatButtonProps {
  state: SpawnState;
  onClick: () => void;
  error: string | null;
}

function SpawnPolecatButton({ state, onClick, error }: SpawnPolecatButtonProps) {
  const getButtonContent = () => {
    switch (state) {
      case 'loading':
        return '◌';
      case 'success':
        return '✓';
      case 'error':
        return '✕';
      default:
        return '+';
    }
  };

  const getButtonStyle = (): CSSProperties => {
    const base = styles.spawnButton;
    switch (state) {
      case 'loading':
        return { ...base, cursor: 'wait', opacity: 0.7 };
      case 'success':
        return { ...base, borderColor: colors.working, color: colors.working };
      case 'error':
        return { ...base, borderColor: colors.stuck, color: colors.stuck };
      default:
        return base;
    }
  };

  return (
    <div style={styles.spawnButtonContainer}>
      <button
        style={getButtonStyle()}
        onClick={onClick}
        disabled={state === 'loading'}
        title={state === 'error' && error ? error : 'Spawn new polecat'}
        aria-label="Spawn new polecat"
      >
        {getButtonContent()}
      </button>
      {state === 'error' && error && (
        <span style={styles.spawnError} title={error}>
          {error.length > 20 ? `${error.slice(0, 20)}...` : error}
        </span>
      )}
    </div>
  );
}

// =============================================================================
// Agent Card - Full card for important agents
// =============================================================================

interface AgentCardProps {
  agent: CrewMember;
  icon: string;
}

function AgentCard({ agent, icon }: AgentCardProps) {
  const isOnline = agent.status !== 'offline';
  // Determine if agent is "active" - has hooked work but raw status shows idle
  const isActive = agent.currentTask && agent.status === 'idle';
  const displayStatus = isActive ? 'active' : agent.status;
  const statusColor = getStatusColor(displayStatus);

  return (
    <div
      style={{
        ...styles.card,
        borderColor: isOnline ? colors.panelBorder : colors.offlineBorder,
      }}
      role="listitem"
      aria-label={`${agent.name} - ${displayStatus}`}
    >
      <div style={styles.cardHeader}>
        <span style={styles.typeIcon}>{icon}</span>
        <span style={styles.agentName}>{agent.name.toUpperCase()}</span>
        {agent.unreadMail > 0 && (
          <span style={styles.headerMailBadge}>📬{agent.unreadMail}</span>
        )}
      </div>

      <div style={styles.cardBody}>
        <div style={styles.statusRow} data-testid="status-row">
          <span
            data-testid="status-indicator"
            className={isActive ? 'pulsate' : ''}
            style={{
              ...styles.statusIndicator,
              backgroundColor: statusColor,
              boxShadow: isOnline ? `0 0 8px ${statusColor}` : 'none',
            }}
          />
          <span style={{ ...styles.statusText, color: statusColor }}>
            {displayStatus.toUpperCase()}
          </span>
        </div>

        {agent.firstSubject && (
          <div style={styles.mailRow}>
            <span style={styles.mailPreview}>
              📨 "{agent.firstSubject}"{agent.firstFrom && ` (from ${agent.firstFrom})`}
            </span>
          </div>
        )}

        {agent.currentTask && (
          <div style={styles.taskRow}>
            <span style={styles.taskIcon}>⚡</span>
            <span style={styles.taskText}>{agent.currentTask}</span>
          </div>
        )}

        {agent.branch && (
          <div style={styles.branchRow}>
            <span style={styles.branchIcon}>⎇</span>
            <span style={styles.branchText}>{agent.branch}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Polecat Card - Expandable card for polecats with terminal view
// =============================================================================

interface PolecatCardProps {
  agent: CrewMember;
  isExpanded: boolean;
  onClick: () => void;
  disabled?: boolean;
}

function PolecatCard({ agent, isExpanded, onClick, disabled }: PolecatCardProps) {
  const isOnline = agent.status !== 'offline';
  const isActive = agent.currentTask && agent.status === 'idle';
  const displayStatus = isActive ? 'active' : agent.status;
  const statusColor = getStatusColor(displayStatus);

  return (
    <button
      style={{
        ...styles.polecatCard,
        borderColor: isExpanded ? colors.primaryBright : (isOnline ? colors.panelBorder : colors.offlineBorder),
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
      onClick={onClick}
      disabled={disabled}
      role="listitem"
      aria-expanded={isExpanded}
      aria-label={`${agent.name} - ${displayStatus}${isExpanded ? ' (terminal open)' : ''}`}
    >
      <div style={styles.polecatCardHeader} data-testid="status-row">
        <span style={styles.polecatIcon}>🐱</span>
        <span style={styles.polecatName}>{agent.name.toUpperCase()}</span>
        <span
          data-testid="status-indicator"
          className={isActive ? 'pulsate' : ''}
          style={{
            ...styles.statusIndicator,
            backgroundColor: statusColor,
            boxShadow: isOnline ? `0 0 6px ${statusColor}` : 'none',
          }}
        />
        <span style={{ ...styles.polecatStatus, color: statusColor }}>
          {displayStatus.toUpperCase()}
        </span>
        {agent.unreadMail > 0 && (
          <span style={styles.polecatMail}>📬{agent.unreadMail}</span>
        )}
        <span style={styles.expandIcon}>{isExpanded ? '▼' : '▶'}</span>
      </div>
      {agent.currentTask && (
        <div style={styles.polecatTask}>
          <span style={styles.taskIcon}>⚡</span>
          <span style={styles.taskText}>{agent.currentTask}</span>
        </div>
      )}
      {agent.branch && (
        <div style={styles.polecatBranch}>
          <span style={styles.branchIcon}>⎇</span>
          <span style={styles.branchText}>{agent.branch}</span>
        </div>
      )}
    </button>
  );
}

// =============================================================================
// Agent Chip - Compact display for polecats
// =============================================================================

interface AgentChipProps {
  agent: CrewMember;
}

function AgentChip({ agent }: AgentChipProps) {
  const isOnline = agent.status !== 'offline';
  const statusColor = getStatusColor(agent.status);

  // Extract short branch name (e.g., "polecat/dag-mkfuo827" -> "dag-mkfuo827")
  const shortBranch = agent.branch?.replace(/^polecat\//, '');

  return (
    <div
      style={{
        ...styles.chip,
        borderColor: isOnline ? colors.primaryDim : colors.offlineBorder,
        opacity: isOnline ? 1 : 0.6,
      }}
      title={`${agent.name} - ${agent.status}${agent.branch ? ` (${agent.branch})` : ''}`}
      role="listitem"
      aria-label={`${agent.name} - ${agent.status}`}
    >
      <span
        style={{
          ...styles.chipIndicator,
          backgroundColor: statusColor,
          boxShadow: isOnline ? `0 0 4px ${statusColor}` : 'none',
        }}
      />
      <span style={styles.chipName}>{agent.name}</span>
      {shortBranch && (
        <span style={styles.chipBranch}>{shortBranch}</span>
      )}
      {agent.unreadMail > 0 && (
        <span style={styles.chipMail}>📬{agent.unreadMail}</span>
      )}
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

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
  offlineBorder: '#333333',
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

  syncTime: {
    color: colors.primary,
    fontSize: '0.7rem',
    opacity: 0.7,
  },

  headerControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },

  toggleLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    cursor: 'pointer',
    fontSize: '0.7rem',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: colors.primaryDim,
    transition: 'color 0.2s ease',
  },

  toggleCheckbox: {
    width: '14px',
    height: '14px',
    border: `1px solid ${colors.primaryDim}`,
    backgroundColor: 'transparent',
    cursor: 'pointer',
    position: 'relative',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  toggleCheckmark: {
    color: colors.background,
    fontSize: '10px',
    fontWeight: 'bold',
    lineHeight: 1,
  },

  toggleHiddenInput: {
    position: 'absolute',
    opacity: 0,
    width: 0,
    height: 0,
    pointerEvents: 'none',
  },

  toggleText: {
    userSelect: 'none',
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

  rigStats: {
    fontSize: '0.7rem',
    color: colors.primaryDim,
    letterSpacing: '0.1em',
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

  summaryStatus: {
    fontSize: '0.85rem',
    letterSpacing: '0.15em',
    fontWeight: 'bold',
  },

  // Status group styles (swarm grouping)
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

  // Subsection styles
  subsection: {
    marginLeft: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },

  subsectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '0.75rem',
    letterSpacing: '0.1em',
  },

  subsectionIcon: {
    color: colors.primaryDim,
    fontFamily: 'monospace',
  },

  subsectionTitle: {
    color: colors.primaryDim,
    textTransform: 'uppercase',
  },

  polecatCount: {
    fontSize: '0.65rem',
    color: colors.idle,
    marginLeft: 'auto',
  },

  spawnButtonContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginLeft: '8px',
  },

  spawnButton: {
    width: '20px',
    height: '20px',
    padding: 0,
    border: `1px solid ${colors.primaryDim}`,
    backgroundColor: 'transparent',
    color: colors.primary,
    fontSize: '14px',
    fontWeight: 'bold',
    fontFamily: 'monospace',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
    lineHeight: 1,
  },

  spawnError: {
    fontSize: '0.6rem',
    color: colors.stuck,
    letterSpacing: '0.05em',
    maxWidth: '120px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  // Grid layouts
  townGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '12px',
  },

  agentGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '10px',
  },

  infraGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '10px',
  },

  polecatGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  },

  polecatList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },

  polecatWrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0',
  },

  polecatCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '10px 12px',
    border: `1px solid ${colors.panelBorder}`,
    backgroundColor: colors.backgroundDark,
    fontFamily: '"Share Tech Mono", monospace',
    color: colors.primary,
    textAlign: 'left',
    transition: 'border-color 0.2s ease, background-color 0.2s ease',
    width: '100%',
  },

  polecatCardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },

  polecatIcon: {
    fontSize: '1rem',
  },

  polecatName: {
    flex: 1,
    fontSize: '0.85rem',
    fontWeight: 'bold',
    letterSpacing: '0.1em',
  },

  polecatStatus: {
    fontSize: '0.7rem',
    letterSpacing: '0.1em',
    marginLeft: '4px',
  },

  polecatMail: {
    fontSize: '0.7rem',
    color: colors.primaryBright,
    marginLeft: '8px',
  },

  expandIcon: {
    fontSize: '0.6rem',
    color: colors.primaryDim,
    marginLeft: 'auto',
  },

  polecatTask: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '0.7rem',
    color: colors.idle,
    marginLeft: '24px',
  },

  polecatBranch: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '0.65rem',
    color: colors.primaryDim,
    marginLeft: '24px',
  },

  terminalContainer: {
    borderLeft: `1px solid ${colors.panelBorder}`,
    borderRight: `1px solid ${colors.panelBorder}`,
    borderBottom: `1px solid ${colors.panelBorder}`,
    marginTop: '-1px',
  },

  polecatEmpty: {
    fontSize: '0.7rem',
    color: colors.offline,
    letterSpacing: '0.1em',
    marginLeft: '24px',
    fontStyle: 'italic',
  },

  // Card styles
  card: {
    border: `1px solid ${colors.panelBorder}`,
    backgroundColor: colors.backgroundDark,
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    transition: 'border-color 0.2s ease',
  },

  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },

  typeIcon: {
    fontSize: '1.1rem',
  },

  agentName: {
    flex: 1,
    fontSize: '0.9rem',
    fontWeight: 'bold',
    letterSpacing: '0.1em',
  },

  typeBadge: {
    fontSize: '0.6rem',
    color: colors.primaryDim,
    border: `1px solid ${colors.primaryDim}`,
    padding: '2px 6px',
    letterSpacing: '0.05em',
  },

  headerMailBadge: {
    fontSize: '0.75rem',
    color: colors.primaryBright,
    marginLeft: 'auto',
    marginRight: '8px',
    fontWeight: 'bold',
  },

  cardBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
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
    transition: 'all 0.2s ease',
  },

  statusText: {
    fontSize: '0.75rem',
    letterSpacing: '0.1em',
  },

  mailRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '0.7rem',
    color: colors.primaryBright,
  },

  mailIcon: {
    fontSize: '0.8rem',
  },

  mailCount: {
    fontWeight: 'bold',
  },

  mailPreview: {
    color: colors.primaryDim,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
    fontStyle: 'italic',
    fontSize: '0.7rem',
  },

  taskRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '0.7rem',
    color: colors.idle,
  },

  taskIcon: {
    fontSize: '0.7rem',
  },

  taskText: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontStyle: 'italic',
  },

  branchRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '0.7rem',
    color: colors.primaryDim,
  },

  branchIcon: {
    fontSize: '0.8rem',
  },

  branchText: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: 'monospace',
    fontSize: '0.65rem',
  },

  // Chip styles (for polecats)
  chip: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    border: `1px solid ${colors.primaryDim}`,
    backgroundColor: colors.backgroundDark,
    fontSize: '0.75rem',
    transition: 'all 0.2s ease',
  },

  chipIndicator: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
  },

  chipName: {
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  },

  chipMail: {
    fontSize: '0.65rem',
    color: colors.primaryBright,
    marginLeft: '4px',
  },

  chipBranch: {
    fontSize: '0.6rem',
    color: colors.primaryDim,
    marginLeft: '6px',
    fontStyle: 'italic',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '120px',
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
