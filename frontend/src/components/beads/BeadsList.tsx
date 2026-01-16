import { useState, useCallback, useEffect, useMemo, type CSSProperties } from 'react';
import { usePolling } from '../../hooks/usePolling';
import { api } from '../../services/api';
import type { BeadInfo } from '../../types';

export type BeadsStatusFilter = 'default' | 'open' | 'hooked' | 'in_progress' | 'blocked' | 'deferred' | 'closed' | 'all';

export interface BeadsListProps {
  statusFilter: BeadsStatusFilter;
  isActive?: boolean;
}

/** Group of beads belonging to a rig */
interface BeadGroup {
  rig: string | null;
  displayName: string;
  beads: BeadInfo[];
}

/**
 * Gets priority label and color.
 */
function getPriorityInfo(priority: number): { label: string; color: string } {
  switch (priority) {
    case 0:
      return { label: 'P0', color: '#FF4444' }; // Critical
    case 1:
      return { label: 'P1', color: '#FFB000' }; // High
    case 2:
      return { label: 'P2', color: 'var(--crt-phosphor)' }; // Normal
    case 3:
      return { label: 'P3', color: 'var(--crt-phosphor-dim)' }; // Low
    case 4:
      return { label: 'P4', color: '#666666' }; // Backlog
    default:
      return { label: `P${priority}`, color: 'var(--crt-phosphor-dim)' };
  }
}

/**
 * Gets status display info with distinct colors for each state.
 */
function getStatusInfo(status: string): { label: string; color: string; bgColor?: string } {
  switch (status.toLowerCase()) {
    case 'open':
      return { label: 'OPEN', color: 'var(--crt-phosphor)' };
    case 'in_progress':
      return { label: 'ACTIVE', color: '#00FF88', bgColor: 'rgba(0, 255, 136, 0.1)' }; // Bright cyan-green
    case 'blocked':
      return { label: 'BLOCKED', color: '#FF6B35', bgColor: 'rgba(255, 107, 53, 0.1)' }; // Warning orange
    case 'deferred':
      return { label: 'DEFER', color: '#888888' }; // Dim gray
    case 'closed':
      return { label: 'DONE', color: '#555555' }; // Dark gray
    case 'hooked':
      return { label: 'HOOKED', color: '#FFB000', bgColor: 'rgba(255, 176, 0, 0.1)' }; // Amber
    default:
      return { label: status.toUpperCase(), color: 'var(--crt-phosphor-dim)' };
  }
}

/**
 * Formats a timestamp for display.
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return 'TODAY';
  } else if (diffDays === 1) {
    return 'YESTERDAY';
  } else if (diffDays < 7) {
    return `${diffDays}D AGO`;
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

/**
 * Extracts short assignee name.
 */
function formatAssignee(assignee: string | null): string {
  if (!assignee) return '-';
  // Extract name from path like "gastown_boy/dag" -> "dag"
  const parts = assignee.split('/');
  return parts[parts.length - 1] || assignee;
}

/**
 * Groups beads by rig, maintaining sort order within each group.
 */
function groupBeadsByRig(beads: BeadInfo[]): BeadGroup[] {
  const groupMap = new Map<string | null, BeadInfo[]>();

  for (const bead of beads) {
    const existing = groupMap.get(bead.rig);
    if (existing) {
      existing.push(bead);
    } else {
      groupMap.set(bead.rig, [bead]);
    }
  }

  // Convert to array and sort: town-level (null) first, then alphabetically
  const groups: BeadGroup[] = [];
  const sortedRigs = Array.from(groupMap.keys()).sort((a, b) => {
    if (a === null) return -1;
    if (b === null) return 1;
    return a.localeCompare(b);
  });

  for (const rig of sortedRigs) {
    const rigBeads = groupMap.get(rig) ?? [];
    groups.push({
      rig,
      displayName: rig ? rig.toUpperCase().replace(/_/g, ' ') : 'TOWN LEVEL',
      beads: rigBeads,
    });
  }

  return groups;
}

export function BeadsList({ statusFilter, isActive = true }: BeadsListProps) {
  const [slingingId, setSlingingId] = useState<string | null>(null);
  const [slingResult, setSlingResult] = useState<{ id: string; success: boolean } | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string | null>>(new Set());

  const {
    data: beads,
    loading,
    error,
    refresh,
  } = usePolling<BeadInfo[]>(
    // No rig filter - show ALL town beads (gastown_boy is dashboard for all of Gas Town)
    // Filter to task type only - excludes messages, agents, etc.
    () => api.beads.list({ status: statusFilter, type: 'task', limit: 50 }),
    {
      interval: 30000,
      enabled: isActive,
    }
  );

  // Group beads by rig
  const beadGroups = useMemo(() => {
    if (!beads) return [];
    return groupBeadsByRig(beads);
  }, [beads]);

  // Refetch when status filter changes
  useEffect(() => {
    void refresh();
  }, [statusFilter, refresh]);

  const toggleGroup = useCallback((rig: string | null) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(rig)) {
        next.delete(rig);
      } else {
        next.add(rig);
      }
      return next;
    });
  }, []);

  const handleSling = useCallback(async (bead: BeadInfo) => {
    setSlingingId(bead.id);
    setSlingResult(null);

    try {
      await api.mail.send({
        to: 'mayor/',
        subject: `Sling request: ${bead.id}`,
        body: `Please sling this bead to a polecat:\n\nID: ${bead.id}\nTitle: ${bead.title}\nType: ${bead.type}\nPriority: P${bead.priority}`,
        priority: 1,
        type: 'task',
      });
      setSlingResult({ id: bead.id, success: true });
      // Clear success indicator after 2 seconds
      setTimeout(() => setSlingResult(null), 2000);
    } catch {
      setSlingResult({ id: bead.id, success: false });
      // Clear error indicator after 3 seconds
      setTimeout(() => setSlingResult(null), 3000);
    } finally {
      setSlingingId(null);
    }
  }, []);

  if (loading && !beads) {
    return (
      <div style={styles.loadingState}>
        <div style={styles.loadingPulse} />
        SCANNING BEADS DATABASE...
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.errorState}>
        SCAN FAILED: {error.message}
      </div>
    );
  }

  if (!beads || beads.length === 0) {
    return (
      <div style={styles.emptyState}>
        NO BEADS FOUND
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {beadGroups.map((group) => {
        const isCollapsed = collapsedGroups.has(group.rig);
        const groupKey = group.rig ?? '__town__';

        return (
          <div key={groupKey} style={styles.group}>
            {/* Group Header */}
            <button
              style={styles.groupHeader}
              onClick={() => toggleGroup(group.rig)}
              aria-expanded={!isCollapsed}
            >
              <span style={styles.groupChevron}>
                {isCollapsed ? '▶' : '▼'}
              </span>
              <span style={styles.groupName}>{group.displayName}</span>
              <span style={styles.groupCount}>[{group.beads.length}]</span>
            </button>

            {/* Group Content */}
            {!isCollapsed && (
              <table style={styles.table}>
                <thead>
                  <tr style={styles.headerRow}>
                    <th style={{ ...styles.th, width: '80px' }}>ID</th>
                    <th style={{ ...styles.th, width: '40px' }}>PRI</th>
                    <th style={{ ...styles.th, width: '60px' }}>TYPE</th>
                    <th style={styles.th}>TITLE</th>
                    <th style={{ ...styles.th, width: '70px' }}>STATUS</th>
                    <th style={{ ...styles.th, width: '80px' }}>ASSIGNEE</th>
                    <th style={{ ...styles.th, width: '70px' }}>UPDATED</th>
                    <th style={{ ...styles.th, width: '60px' }}>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {group.beads.map((bead) => {
                    const priorityInfo = getPriorityInfo(bead.priority);
                    const statusInfo = getStatusInfo(bead.status);
                    const isClosed = bead.status.toLowerCase() === 'closed';

                    const isSlinging = slingingId === bead.id;
                    const result = slingResult?.id === bead.id ? slingResult : null;
                    const canSling = !isClosed && !bead.assignee;

                    const isDeferred = bead.status.toLowerCase() === 'deferred';

                    return (
                      <tr
                        key={bead.id}
                        style={{
                          ...styles.row,
                          opacity: isClosed || isDeferred ? 0.5 : 1,
                          backgroundColor: statusInfo.bgColor ?? 'transparent',
                        }}
                      >
                        <td style={styles.idCell}>{bead.id}</td>
                        <td style={{ ...styles.cell, color: priorityInfo.color }}>
                          {priorityInfo.label}
                        </td>
                        <td style={styles.typeCell}>{bead.type.toUpperCase()}</td>
                        <td style={styles.titleCell} title={bead.title}>
                          {bead.title}
                        </td>
                        <td style={{ ...styles.cell, color: statusInfo.color, fontWeight: statusInfo.bgColor ? 'bold' : 'normal' }}>
                          {statusInfo.label}
                        </td>
                        <td style={styles.cell}>{formatAssignee(bead.assignee)}</td>
                        <td style={styles.dateCell}>
                          {formatDate(bead.updatedAt ?? bead.createdAt)}
                        </td>
                        <td style={styles.actionCell}>
                          {canSling && (
                            <button
                              style={{
                                ...styles.slingButton,
                                ...(isSlinging && styles.slingButtonLoading),
                                ...(result?.success && styles.slingButtonSuccess),
                                ...(result && !result.success && styles.slingButtonError),
                              }}
                              onClick={() => handleSling(bead)}
                              disabled={isSlinging || !!result}
                              title="Request mayor to sling this bead"
                            >
                              {isSlinging ? '...' : result?.success ? '✓' : result ? '✗' : 'SLING'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}

const styles = {
  container: {
    flex: 1,
    overflow: 'auto',
    padding: '8px',
  },
  group: {
    marginBottom: '12px',
  },
  groupHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    padding: '8px 12px',
    backgroundColor: '#111',
    border: '1px solid var(--crt-phosphor-dim)',
    borderRadius: '2px',
    cursor: 'pointer',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.85rem',
    color: 'var(--crt-phosphor)',
    letterSpacing: '0.1em',
    textAlign: 'left',
    transition: 'background-color 0.15s ease',
  },
  groupChevron: {
    fontSize: '0.7rem',
    color: 'var(--crt-phosphor-dim)',
    width: '12px',
  },
  groupName: {
    flex: 1,
    fontWeight: 'bold',
  },
  groupCount: {
    color: 'var(--crt-phosphor-dim)',
    fontSize: '0.75rem',
  },
  loadingState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px',
    color: 'var(--crt-phosphor-dim)',
    letterSpacing: '0.1em',
    gap: '16px',
    fontFamily: '"Share Tech Mono", monospace',
  },
  loadingPulse: {
    width: '40px',
    height: '40px',
    border: '2px solid var(--crt-phosphor-dim)',
    borderTopColor: 'var(--crt-phosphor)',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  errorState: {
    padding: '24px',
    color: '#FF4444',
    textAlign: 'center',
    fontFamily: '"Share Tech Mono", monospace',
    letterSpacing: '0.1em',
  },
  emptyState: {
    padding: '48px',
    color: 'var(--crt-phosphor-dim)',
    textAlign: 'center',
    fontFamily: '"Share Tech Mono", monospace',
    letterSpacing: '0.1em',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.8rem',
    marginTop: '4px',
  },
  headerRow: {
    borderBottom: '1px solid var(--crt-phosphor-dim)',
  },
  th: {
    textAlign: 'left',
    padding: '8px 6px',
    color: 'var(--crt-phosphor-dim)',
    fontWeight: 'normal',
    fontSize: '0.7rem',
    letterSpacing: '0.1em',
    whiteSpace: 'nowrap',
  },
  row: {
    borderBottom: '1px solid #222',
    transition: 'background-color 0.1s ease',
  },
  cell: {
    padding: '8px 6px',
    color: 'var(--crt-phosphor)',
    whiteSpace: 'nowrap',
  },
  idCell: {
    padding: '8px 6px',
    color: 'var(--crt-phosphor-bright)',
    fontWeight: 'bold',
    whiteSpace: 'nowrap',
  },
  typeCell: {
    padding: '8px 6px',
    color: 'var(--crt-phosphor-dim)',
    fontSize: '0.7rem',
    whiteSpace: 'nowrap',
  },
  titleCell: {
    padding: '8px 6px',
    color: 'var(--crt-phosphor)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '300px',
  },
  dateCell: {
    padding: '8px 6px',
    color: 'var(--crt-phosphor-dim)',
    fontSize: '0.7rem',
    whiteSpace: 'nowrap',
  },
  actionCell: {
    padding: '4px 6px',
    textAlign: 'center',
  },
  slingButton: {
    backgroundColor: 'transparent',
    color: 'var(--crt-phosphor)',
    border: '1px solid var(--crt-phosphor-dim)',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '0.65rem',
    padding: '2px 8px',
    cursor: 'pointer',
    letterSpacing: '0.05em',
    transition: 'all 0.15s ease',
  },
  slingButtonLoading: {
    color: 'var(--crt-phosphor-dim)',
    cursor: 'wait',
  },
  slingButtonSuccess: {
    color: 'var(--crt-phosphor-bright)',
    borderColor: 'var(--crt-phosphor-bright)',
  },
  slingButtonError: {
    color: '#FF4444',
    borderColor: '#FF4444',
  },
} satisfies Record<string, CSSProperties>;
