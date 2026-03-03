import React, { useMemo } from 'react';

import { useOverview } from '../../hooks/useProjectOverview';
import { priorityLabel } from '../../hooks/useDashboardBeads';
import type { AgentOverview, EpicProgress, OverviewBeadSummary, OverviewUnreadSummary } from '../../types/overview';
import './DashboardView.css';

// Simple widget wrapper for dashboard sections
interface DashboardWidgetProps {
  title: string;
  children: React.ReactNode;
  className?: string;
  headerRight?: React.ReactNode;
}

const DashboardWidget: React.FC<DashboardWidgetProps> = ({ title, children, className, headerRight }) => (
  <div className={`dashboard-widget-container ${className ?? ''}`}>
    <div className="dashboard-widget-header">
      <h3 className="dashboard-widget-title">{title}</h3>
      {headerRight && <div className="dashboard-widget-header-right">{headerRight}</div>}
    </div>
    <div className="dashboard-widget-content">{children}</div>
  </div>
);

/** Format timestamp in chat style: "8:23pm" today, "Yesterday 8:23pm", "Wed 8:23pm", "Feb 26 8:23pm" */
function formatChatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).toLowerCase().replace(/\s/g, '');

  if (diffDays === 0) {
    return timeStr;
  } else if (diffDays === 1) {
    return `Yesterday ${timeStr}`;
  } else if (diffDays < 7) {
    const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
    return `${dayName} ${timeStr}`;
  } else {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}/${day} ${timeStr}`;
  }
}

/** Render a compact bead row with optional completion timestamp */
function BeadRow({ bead, completedAt }: { bead: OverviewBeadSummary; completedAt?: string }) {
  return (
    <div className="dashboard-bead-row">
      <span className="dashboard-bead-id">{bead.id}</span>
      <span className="dashboard-bead-title">{bead.title}</span>
      {completedAt && (
        <span className="dashboard-bead-timestamp">{formatChatTimestamp(completedAt)}</span>
      )}
      <span className={`dashboard-bead-priority dashboard-bead-priority-${bead.priority}`}>
        {priorityLabel(bead.priority)}
      </span>
    </div>
  );
}

/** Get the CSS class suffix for an agent status */
function statusIndicatorClass(status: string): string {
  switch (status) {
    case 'working': return 'working';
    case 'idle': return 'idle';
    case 'blocked': return 'stuck';
    default: return 'offline';
  }
}

/** Get the display label for an agent status */
function statusLabel(status: string): string {
  switch (status) {
    case 'working': return 'WORKING';
    case 'idle': return 'IDLE';
    case 'blocked': return 'BLOCKED';
    default: return 'OFFLINE';
  }
}

/** Get progress bar color based on epic completion percentage */
function getEpicProgressColor(completionPercent: number, status: string): string {
  if (status === 'closed' || completionPercent >= 100) return '#00FF00';
  if (completionPercent > 50) return 'var(--crt-phosphor)';
  if (completionPercent > 0) return '#FFB000';
  return 'var(--crt-phosphor-dim)';
}

/** Truncate a message body for preview display */
function truncateBody(body: string, maxLen = 80): string {
  const oneLine = body.replace(/\n/g, ' ').trim();
  if (oneLine.length <= maxLen) return oneLine;
  return oneLine.slice(0, maxLen) + '...';
}

interface DashboardViewProps {
  onNavigateToChat?: (agentName: string) => void;
}

export function DashboardView({ onNavigateToChat }: DashboardViewProps) {
  const { data, loading } = useOverview();

  // --- Agents ---
  const agents: AgentOverview[] = data?.agents ?? [];

  // --- Unread messages ---
  const unreadMessages: OverviewUnreadSummary[] = data?.unreadMessages ?? [];

  // --- Beads data (tasks only — exclude epics) ---
  const { tasksInProgress, tasksCompleted } = useMemo(() => {
    if (!data?.beads) return { tasksInProgress: [], tasksCompleted: [] };

    const filterTasks = (items: OverviewBeadSummary[]) => items.filter((b) => b.type !== 'epic');

    return {
      tasksInProgress: filterTasks(data.beads.inProgress).slice(0, 7),
      tasksCompleted: filterTasks(data.beads.recentlyClosed).slice(0, 5),
    };
  }, [data?.beads]);

  // --- Epics data ---
  const epicsInProgress: EpicProgress[] = data?.epics?.inProgress ?? [];
  const epicsCompleted: EpicProgress[] = data?.epics?.recentlyCompleted ?? [];

  return (
    <div className="dashboard-view-container">
      <div className="dashboard-view-grid">

        {/* Agents Widget (top, full width) */}
        <DashboardWidget
          title="AGENTS"
          className="dashboard-widget-full-width"
          headerRight={
            !loading && agents.length > 0 && (
              <div className="dashboard-header-stats">
                <span className="dashboard-header-stat dashboard-header-stat-highlight">
                  {agents.filter((a) => a.status === 'working').length} working
                </span>
                <span className="dashboard-header-stat">
                  {agents.length} total
                </span>
              </div>
            )
          }
        >
          {loading && <p>Loading agents...</p>}
          {!loading && (
            <>
              {agents.length > 0 ? (
                <div className="dashboard-agents-list">
                  {agents.map((agent) => (
                    <div
                      key={agent.id}
                      className="dashboard-agent-row"
                      onClick={() => onNavigateToChat?.(agent.name)}
                      role={onNavigateToChat ? 'button' : undefined}
                      tabIndex={onNavigateToChat ? 0 : undefined}
                      onKeyDown={(e) => {
                        if (onNavigateToChat && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          onNavigateToChat(agent.name);
                        }
                      }}
                    >
                      <span className={`dashboard-crew-card-indicator dashboard-indicator-${statusIndicatorClass(agent.status)}`} />
                      <span className="dashboard-agent-name">{agent.name.toUpperCase()}</span>
                      <span className={`dashboard-crew-card-status-text dashboard-text-${statusIndicatorClass(agent.status)}`}>
                        {statusLabel(agent.status)}
                      </span>
                      {agent.currentBead && (
                        <span className="dashboard-agent-task">{truncateBody(agent.currentBead, 60)}</span>
                      )}
                      {agent.unreadCount > 0 && (
                        <span className="dashboard-unread-count">{agent.unreadCount}</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="dashboard-empty-text">No agents connected</p>
              )}
            </>
          )}
        </DashboardWidget>

        {/* Unread Messages Widget (full width) */}
        <DashboardWidget
          title="UNREAD MESSAGES"
          className="dashboard-widget-full-width"
          headerRight={
            !loading && unreadMessages.length > 0 && (
              <div className="dashboard-header-stats">
                <span className="dashboard-header-stat dashboard-header-stat-highlight">
                  {unreadMessages.reduce((sum, a) => sum + a.unreadCount, 0)} unread
                </span>
              </div>
            )
          }
        >
          {loading && <p>Loading messages...</p>}
          {!loading && (
            <>
              {unreadMessages.length > 0 ? (
                <div className="dashboard-unread-list">
                  {unreadMessages.map((agent) => (
                    <div
                      key={agent.agentId}
                      className="dashboard-unread-row"
                      onClick={() => onNavigateToChat?.(agent.agentId)}
                      role={onNavigateToChat ? 'button' : undefined}
                      tabIndex={onNavigateToChat ? 0 : undefined}
                      onKeyDown={(e) => {
                        if (onNavigateToChat && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          onNavigateToChat(agent.agentId);
                        }
                      }}
                    >
                      <span className="dashboard-unread-agent">{agent.agentId.toUpperCase()}</span>
                      <span className="dashboard-unread-preview">{truncateBody(agent.latestBody)}</span>
                      <span className="dashboard-unread-count">{agent.unreadCount}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="dashboard-empty-text">No unread messages</p>
              )}
            </>
          )}
        </DashboardWidget>

        {/* Tasks Widget (full width) */}
        <DashboardWidget
          title="TASKS"
          className="dashboard-widget-full-width"
          headerRight={
            !loading && (
              <div className="dashboard-header-stats">
                <span className={`dashboard-header-stat ${tasksInProgress.length > 0 ? 'dashboard-header-stat-highlight' : ''}`}>
                  {tasksInProgress.length} in progress
                </span>
                <span className="dashboard-header-stat">{tasksCompleted.length} completed</span>
              </div>
            )
          }
        >
          {loading && <p>Loading tasks...</p>}
          {!loading && (
            <>
              {tasksInProgress.length > 0 && (
                <>
                  <h4 className="dashboard-view-sub-title">IN PROGRESS</h4>
                  <div className="dashboard-beads-list">
                    {tasksInProgress.map((bead) => (
                      <BeadRow key={bead.id} bead={bead} />
                    ))}
                  </div>
                </>
              )}
              {tasksCompleted.length > 0 && (
                <>
                  <h4 className="dashboard-view-sub-title" style={tasksInProgress.length > 0 ? { marginTop: '16px' } : undefined}>
                    RECENTLY COMPLETED
                  </h4>
                  <div className="dashboard-beads-list">
                    {tasksCompleted.map((bead) => (
                      <BeadRow key={bead.id} bead={bead} completedAt={bead.updatedAt ?? undefined} />
                    ))}
                  </div>
                </>
              )}
              {tasksInProgress.length === 0 && tasksCompleted.length === 0 && (
                <p className="dashboard-empty-text">No tasks</p>
              )}
            </>
          )}
        </DashboardWidget>

        {/* Epics Widget (full width) */}
        <DashboardWidget
          title="EPICS"
          className="dashboard-widget-full-width"
          headerRight={
            !loading && (
              <div className="dashboard-header-stats">
                <span className={`dashboard-header-stat ${epicsInProgress.length > 0 ? 'dashboard-header-stat-highlight' : ''}`}>
                  {epicsInProgress.length} in progress
                </span>
                <span className="dashboard-header-stat">{epicsCompleted.length} completed</span>
              </div>
            )
          }
        >
          {loading && <p>Loading epics...</p>}
          {!loading && (
            <>
              {epicsInProgress.length > 0 ? (
                <div className="dashboard-epics-list">
                  {epicsInProgress.map((epic) => (
                    <OverviewEpicCard key={epic.id} epic={epic} />
                  ))}
                </div>
              ) : (
                <p className="dashboard-empty-text">No active epics</p>
              )}
              {epicsCompleted.length > 0 && (
                <>
                  <h4 className="dashboard-view-sub-title" style={{ marginTop: '16px' }}>RECENTLY COMPLETED</h4>
                  <div className="dashboard-epics-list">
                    {epicsCompleted.map((epic) => (
                      <div key={epic.id} className="dashboard-epic-completed-row">
                        <OverviewEpicCard epic={epic} />
                        {epic.closedAt && (
                          <span className="dashboard-epic-completed-time">{formatChatTimestamp(epic.closedAt)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </DashboardWidget>

      </div>
    </div>
  );
}

/** Inline epic card for the overview — uses EpicProgress directly instead of EpicWithProgress wrapper */
function OverviewEpicCard({ epic }: { epic: EpicProgress }) {
  const progressColor = getEpicProgressColor(epic.completionPercent, epic.status);
  const isComplete = epic.status === 'closed' || epic.completionPercent >= 100;
  const statusText = isComplete ? 'COMPLETE' : epic.status === 'in_progress' ? 'IN PROGRESS' : epic.status.toUpperCase();
  const statusColor = isComplete ? '#00FF00' : epic.status === 'in_progress' ? 'var(--crt-phosphor)' : 'var(--crt-phosphor-dim)';

  return (
    <div className="dashboard-overview-epic-card">
      <div className="dashboard-overview-epic-header">
        <span className="dashboard-overview-epic-id">{epic.id.toUpperCase()}</span>
        <span
          className="dashboard-overview-epic-status"
          style={{
            color: statusColor,
            borderColor: statusColor,
            backgroundColor: `${statusColor}15`,
          }}
        >
          {statusText}
        </span>
      </div>
      <div className="dashboard-overview-epic-title">{epic.title}</div>
      <div className="dashboard-overview-epic-progress">
        <div className="dashboard-progress-bar">
          <div
            className="dashboard-progress-fill"
            style={{
              width: `${Math.round(epic.completionPercent)}%`,
              backgroundColor: progressColor,
              boxShadow: `0 0 6px ${progressColor}`,
            }}
          />
        </div>
        <span className="dashboard-progress-text">
          {epic.closedChildren}/{epic.totalChildren} ({Math.round(epic.completionPercent)}%)
        </span>
      </div>
    </div>
  );
}

export default DashboardView;
