import React, { useMemo } from 'react';
import { useDashboard } from '../../hooks/useDashboard';
import { priorityLabel } from '../../hooks/useDashboardBeads';
import { EpicCard } from '../epics/EpicCard';
import type { BeadInfo } from '../../types';
import type { EpicWithProgress } from '../../types/epics';
import type { EpicWithProgressItem, UnreadAgentSummary } from '../../types/dashboard';
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
function BeadRow({ bead, completedAt }: { bead: BeadInfo; completedAt?: string }) {
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

/** Transform server epic response to frontend EpicWithProgress type */
function toEpicWithProgress(item: EpicWithProgressItem): EpicWithProgress {
  const isComplete = item.epic.status === 'closed' ||
    (item.totalCount > 0 && item.closedCount === item.totalCount);
  return {
    epic: item.epic,
    completedCount: item.closedCount,
    totalCount: item.totalCount,
    progress: item.progress,
    progressText: item.totalCount > 0 ? `${item.closedCount}/${item.totalCount}` : '0/0',
    isComplete,
  };
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
  const { data, loading } = useDashboard();

  // --- Per-section errors ---
  const epicsError = data?.epics?.error;
  const beadsError = data?.beads?.error;
  const unreadMsgError = data?.unreadMessages?.error;

  // --- Unread messages grouped by agent ---
  const unreadMessages: UnreadAgentSummary[] = data?.unreadMessages?.data ?? [];

  // --- Beads data (tasks only — exclude epics) ---
  const { tasksInProgress, tasksCompleted } = useMemo(() => {
    const beadsData = data?.beads?.data;
    if (!beadsData) return { tasksInProgress: [], tasksCompleted: [] };

    const filterTasks = (items: BeadInfo[]) => items.filter((b) => b.type !== 'epic');

    return {
      tasksInProgress: filterTasks(beadsData.inProgress.items),
      tasksCompleted: filterTasks(beadsData.closed.items),
    };
  }, [data?.beads?.data]);

  // --- Epics data (transform EpicWithProgressResponse → EpicWithProgress) ---
  const { epicsInProgress, epicsCompleted } = useMemo(() => {
    const raw = data?.epics?.data;
    if (!raw) return { epicsInProgress: null, epicsCompleted: null };
    return {
      epicsInProgress: {
        items: raw.inProgress.items.map(toEpicWithProgress),
        totalCount: raw.inProgress.totalCount,
      },
      epicsCompleted: {
        items: raw.completed.items.map(toEpicWithProgress),
        totalCount: raw.completed.totalCount,
      },
    };
  }, [data?.epics?.data]);

  return (
    <div className="dashboard-view-container">
      <div className="dashboard-view-grid">

        {/* Unread Messages Widget (top, full width) */}
        <DashboardWidget
          title="UNREAD MESSAGES"
          className="dashboard-widget-full-width"
          headerRight={
            !loading && !unreadMsgError && unreadMessages.length > 0 && (
              <div className="dashboard-header-stats">
                <span className="dashboard-header-stat dashboard-header-stat-highlight">
                  {unreadMessages.reduce((sum, a) => sum + a.unreadCount, 0)} unread
                </span>
              </div>
            )
          }
        >
          {loading && <p>Loading messages...</p>}
          {!loading && unreadMsgError && <p className="dashboard-view-error-text">Error: {unreadMsgError}</p>}
          {!loading && !unreadMsgError && (
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
            !loading && !beadsError && (
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
          {!loading && beadsError && <p className="dashboard-view-error-text">Error: {beadsError}</p>}
          {!loading && !beadsError && (
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
            !loading && !epicsError && epicsInProgress && epicsCompleted && (
              <div className="dashboard-header-stats">
                <span className={`dashboard-header-stat ${epicsInProgress.totalCount > 0 ? 'dashboard-header-stat-highlight' : ''}`}>
                  {epicsInProgress.totalCount} in progress
                </span>
                <span className="dashboard-header-stat">{epicsCompleted.totalCount} completed</span>
              </div>
            )
          }
        >
          {loading && <p>Loading epics...</p>}
          {!loading && epicsError && <p className="dashboard-view-error-text">Error: {epicsError}</p>}
          {!loading && epicsInProgress && epicsCompleted && (
            <>
              {epicsInProgress.items.length > 0 ? (
                <div className="dashboard-convoy-list">
                  {epicsInProgress.items.map((epic) => (
                    <EpicCard key={epic.epic.id} epic={epic} />
                  ))}
                </div>
              ) : (
                <p className="dashboard-empty-text">No active epics</p>
              )}
              {epicsCompleted.items.length > 0 && (
                <>
                  <h4 className="dashboard-view-sub-title" style={{ marginTop: '16px' }}>RECENTLY COMPLETED</h4>
                  <div className="dashboard-convoy-list">
                    {epicsCompleted.items.map((epic) => (
                      <div key={epic.epic.id} className="dashboard-epic-completed-row">
                        <EpicCard epic={epic} />
                        {epic.epic.updatedAt && (
                          <span className="dashboard-epic-completed-time">{formatChatTimestamp(epic.epic.updatedAt)}</span>
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

export default DashboardView;
