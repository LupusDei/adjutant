import React, { useMemo } from 'react';
import { useDashboard } from '../../hooks/useDashboard';
import { priorityLabel } from '../../hooks/useDashboardBeads';
import { EpicCard } from '../epics/EpicCard';
import type { BeadInfo, AgentType, CrewMemberStatus, EpicWithProgressResponse } from '../../types';
import type { EpicWithProgress } from '../../types/epics';
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

/** Format relative timestamp */
function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Render a compact bead row */
function BeadRow({ bead }: { bead: BeadInfo }) {
  return (
    <div className="dashboard-bead-row">
      <span className="dashboard-bead-id">{bead.id}</span>
      <span className="dashboard-bead-title">{bead.title}</span>
      <span className={`dashboard-bead-priority dashboard-bead-priority-${bead.priority}`}>
        {priorityLabel(bead.priority)}
      </span>
    </div>
  );
}

/** Agent types shown in the crew widget */
const DASHBOARD_AGENT_TYPES: AgentType[] = ['crew', 'polecat'];

/** Status priority for crew sorting (lower = more important) */
const STATUS_PRIORITY: Record<CrewMemberStatus, number> = {
  working: 0,
  blocked: 1,
  stuck: 2,
  idle: 3,
  offline: 4,
};

/** Transform server epic response to frontend EpicWithProgress type */
function toEpicWithProgress(item: EpicWithProgressResponse): EpicWithProgress {
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

interface DashboardViewProps {
  onNavigateToChat?: (agentName: string) => void;
}

export function DashboardView({ onNavigateToChat }: DashboardViewProps) {
  const { data, loading } = useDashboard();

  // --- Per-section errors ---
  const mailError = data?.mail?.error;
  const crewError = data?.crew?.error;
  const epicsError = data?.epics?.error;
  const beadsError = data?.beads?.error;

  // --- Mail data ---
  const mailData = data?.mail?.data ?? null;

  // --- Beads data ---
  const beadsData = data?.beads?.data ?? null;

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

  // --- Crew data (filter, sort, derive stats) ---
  const { totalCrew, activeCrew, recentCrew, crewAlerts } = useMemo(() => {
    const rawCrew = data?.crew?.data;
    if (!rawCrew) return { totalCrew: 0, activeCrew: 0, recentCrew: [] as typeof rawCrew, crewAlerts: [] as string[] };

    const filtered = rawCrew.filter((m) =>
      DASHBOARD_AGENT_TYPES.includes(m.type) &&
      !(m.type === 'polecat' && m.status === 'offline')
    );

    const active = filtered.filter((m) => m.status === 'working' || m.status === 'idle').length;

    const recent = [...filtered]
      .sort((a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status])
      .slice(0, 3);

    const alerts: string[] = [];
    for (const m of filtered) {
      if (m.status === 'stuck') alerts.push(`${m.name} is STUCK`);
      else if (m.status === 'blocked') alerts.push(`${m.name} is blocked`);
    }

    return { totalCrew: filtered.length, activeCrew: active, recentCrew: recent, crewAlerts: alerts };
  }, [data?.crew?.data]);

  return (
    <div className="dashboard-view-container">

      <div className="dashboard-view-grid">
        {/* Mail Widget */}
        <DashboardWidget
          title="MAIL"
          headerRight={
            !loading && !mailError && mailData && (
              <div className="dashboard-header-stats">
                <span className="dashboard-header-stat">{mailData.totalCount} total</span>
                <span className={`dashboard-header-stat ${mailData.unreadCount > 0 ? 'dashboard-header-stat-highlight' : ''}`}>{mailData.unreadCount} unread</span>
              </div>
            )
          }
        >
          {loading && <p>Loading mail...</p>}
          {!loading && mailError && <p className="dashboard-view-error-text">Error: {mailError}</p>}
          {!loading && mailData && (
            <>
              {mailData.recentMessages.length > 0 ? (
                <ul className="dashboard-view-list">
                  {mailData.recentMessages.map((msg) => (
                    <li key={msg.id} className="dashboard-view-list-item">
                      <div className="dashboard-mail-item">
                        <span className="dashboard-mail-subject">{msg.subject}</span>
                        <span className="dashboard-mail-meta">
                          <span className="dashboard-mail-from">{msg.from.replace(/\/$/, '')}</span>
                          <span className="dashboard-mail-time">{formatRelativeTime(msg.timestamp)}</span>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="dashboard-empty-text">No messages</p>
              )}
            </>
          )}
        </DashboardWidget>

        {/* Crew Widget */}
        <DashboardWidget
          title="CREW & POLECATS"
          headerRight={
            !loading && !crewError && data?.crew?.data && (
              <div className="dashboard-header-stats">
                <span className="dashboard-header-stat">{totalCrew} total</span>
                <span className={`dashboard-header-stat ${activeCrew > 0 ? 'dashboard-header-stat-highlight' : ''}`}>{activeCrew} active</span>
              </div>
            )
          }
        >
          {loading && <p>Loading crew data...</p>}
          {!loading && crewError && <p className="dashboard-view-error-text">Error: {crewError}</p>}
          {!loading && data?.crew?.data && (
            <>
              {crewAlerts.length > 0 && (
                <div className="dashboard-crew-alerts">
                  {crewAlerts.map((alert, index) => (
                    <span key={index} className="dashboard-crew-alert">{alert}</span>
                  ))}
                </div>
              )}
              {recentCrew.length > 0 ? (
                <div className="dashboard-crew-cards">
                  {recentCrew.map((crew) => (
                    <div key={crew.name} className="dashboard-crew-card" style={{ cursor: onNavigateToChat ? 'pointer' : undefined }} onClick={() => onNavigateToChat?.(crew.name)} role={onNavigateToChat ? 'button' : undefined} tabIndex={onNavigateToChat ? 0 : undefined} onKeyDown={(e) => { if (onNavigateToChat && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onNavigateToChat(crew.name); } }}>
                      <div className="dashboard-crew-card-header">
                        <div className="dashboard-crew-card-name-row">
                          <span className="dashboard-crew-card-name">{crew.name.toUpperCase()}</span>
                          {crew.status === 'offline' && (
                            <span className="dashboard-crew-card-indicator dashboard-indicator-offline" title="Offline" />
                          )}
                        </div>
                        <div className="dashboard-crew-card-tags">
                          <span className="dashboard-crew-card-type">{crew.type.toUpperCase()}</span>
                          {crew.rig && (
                            <span className="dashboard-crew-card-rig">{crew.rig}</span>
                          )}
                        </div>
                      </div>
                      <div className="dashboard-crew-card-body">
                        {crew.status !== 'offline' && (
                          <div className="dashboard-crew-card-status">
                            <span className={`dashboard-crew-card-indicator dashboard-indicator-${crew.status}`} />
                            <span className={`dashboard-crew-card-status-text dashboard-text-${crew.status}`}>
                              {crew.status.toUpperCase()}
                            </span>
                          </div>
                        )}
                        {crew.currentTask && (
                          <div className="dashboard-crew-card-task">
                            <span className="dashboard-crew-card-task-label">LAST MSG:</span>
                            <span className="dashboard-crew-card-task-text">{crew.currentTask}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="dashboard-empty-text">No crew members</p>
              )}
            </>
          )}
        </DashboardWidget>

        {/* Epics Widget */}
        <DashboardWidget
          title="ACTIVE EPICS"
          className="dashboard-widget-full-width"
          headerRight={
            !loading && !epicsError && epicsInProgress && epicsCompleted && (
              <div className="dashboard-header-stats">
                <span className={`dashboard-header-stat ${epicsInProgress.totalCount > 0 ? 'dashboard-header-stat-highlight' : ''}`}>
                  {epicsInProgress.items.length < epicsInProgress.totalCount
                    ? `${epicsInProgress.items.length} of ${epicsInProgress.totalCount} in progress`
                    : `${epicsInProgress.totalCount} in progress`}
                </span>
                <span className="dashboard-header-stat">
                  {epicsCompleted.items.length < epicsCompleted.totalCount
                    ? `${epicsCompleted.items.length} of ${epicsCompleted.totalCount} completed`
                    : `${epicsCompleted.totalCount} completed`}
                </span>
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
                  <h4 className="dashboard-view-sub-title" style={{ marginTop: '16px' }}>COMPLETED</h4>
                  <div className="dashboard-convoy-list">
                    {epicsCompleted.items.map((epic) => (
                      <EpicCard key={epic.epic.id} epic={epic} />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </DashboardWidget>

        {/* Beads Widget */}
        <DashboardWidget
          title="BEADS"
          className="dashboard-widget-full-width"
          headerRight={
            !loading && !beadsError && beadsData && (
              <div className="dashboard-header-stats">
                <span className={`dashboard-header-stat ${beadsData.inProgress.totalCount > 0 ? 'dashboard-header-stat-highlight' : ''}`}>
                  {beadsData.inProgress.totalCount} in progress
                </span>
                <span className="dashboard-header-stat">{beadsData.open.totalCount} open</span>
                <span className="dashboard-header-stat">{beadsData.closed.totalCount} closed</span>
              </div>
            )
          }
        >
          {loading && <p>Loading beads...</p>}
          {!loading && beadsError && <p className="dashboard-view-error-text">Error: {beadsError}</p>}
          {!loading && beadsData && (
            <>
              {beadsData.inProgress.items.length > 0 && (
                <>
                  <h4 className="dashboard-view-sub-title">IN PROGRESS</h4>
                  <div className="dashboard-beads-list">
                    {beadsData.inProgress.items.map((bead) => (
                      <BeadRow key={bead.id} bead={bead} />
                    ))}
                  </div>
                </>
              )}
              {beadsData.open.items.length > 0 && (
                <>
                  <h4 className="dashboard-view-sub-title">OPEN</h4>
                  <div className="dashboard-beads-list">
                    {beadsData.open.items.map((bead) => (
                      <BeadRow key={bead.id} bead={bead} />
                    ))}
                  </div>
                </>
              )}
              {beadsData.closed.items.length > 0 && (
                <>
                  <h4 className="dashboard-view-sub-title">CLOSED</h4>
                  <div className="dashboard-beads-list">
                    {beadsData.closed.items.map((bead) => (
                      <BeadRow key={bead.id} bead={bead} />
                    ))}
                  </div>
                </>
              )}
              {beadsData.inProgress.items.length === 0 && beadsData.open.items.length === 0 && beadsData.closed.items.length === 0 && (
                <p className="dashboard-empty-text">No beads</p>
              )}
            </>
          )}
        </DashboardWidget>


      </div>
    </div>
  );
}

export default DashboardView;
