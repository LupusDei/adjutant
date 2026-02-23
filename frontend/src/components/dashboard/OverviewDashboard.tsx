import React from 'react';
import { useDashboardMail } from '../../hooks/useDashboardMail';
import { useDashboardEpics } from '../../hooks/useDashboardEpics';
import { useDashboardCrew } from '../../hooks/useDashboardCrew';
import { EpicCard } from '../epics/EpicCard';
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

/**
 * DashboardView component displays a snapshot of information from other tabs.
 */
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

export function DashboardView() {
  const { recentMessages, totalCount: mailTotal, unreadCount, loading: mailLoading, error: mailError } = useDashboardMail();
  const { recentEpics, loading: epicsLoading, error: epicsError } = useDashboardEpics();
  const { totalCrew, activeCrew, recentCrew, crewAlerts, loading: crewLoading, error: crewError } = useDashboardCrew();



  return (
    <div className="dashboard-view-container">

      <div className="dashboard-view-grid">
        {/* Mail Widget */}
        <DashboardWidget
          title="MAIL"
          headerRight={
            !mailLoading && !mailError && (
              <div className="dashboard-header-stats">
                <span className="dashboard-header-stat">{mailTotal} total</span>
                <span className={`dashboard-header-stat ${unreadCount > 0 ? 'dashboard-header-stat-highlight' : ''}`}>{unreadCount} unread</span>
              </div>
            )
          }
        >
          {mailLoading && <p>Loading mail...</p>}
          {mailError && <p className="dashboard-view-error-text">Error: {mailError}</p>}
          {!mailLoading && !mailError && (
            <>
              {recentMessages.length > 0 ? (
                <ul className="dashboard-view-list">
                  {recentMessages.map((msg) => (
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
            !crewLoading && !crewError && (
              <div className="dashboard-header-stats">
                <span className="dashboard-header-stat">{totalCrew} total</span>
                <span className={`dashboard-header-stat ${activeCrew > 0 ? 'dashboard-header-stat-highlight' : ''}`}>{activeCrew} active</span>
              </div>
            )
          }
        >
          {crewLoading && <p>Loading crew data...</p>}
          {crewError && <p className="dashboard-view-error-text">Error: {crewError}</p>}
          {!crewLoading && !crewError && (
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
                    <div key={crew.name} className="dashboard-crew-card">
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
        <DashboardWidget title="ACTIVE EPICS" className="dashboard-widget-full-width">
          {epicsLoading && <p>Loading epics...</p>}
          {epicsError && <p className="dashboard-view-error-text">Error: {epicsError}</p>}
          {!epicsLoading && !epicsError && (
            <>
              {recentEpics.length > 0 ? (
                <div className="dashboard-convoy-list">
                  {recentEpics.map((epic) => (
                    <EpicCard key={epic.epic.id} epic={epic} />
                  ))}
                </div>
              ) : (
                <p className="dashboard-empty-text">No active epics</p>
              )}
            </>
          )}
        </DashboardWidget>


      </div>
    </div>
  );
}

export default DashboardView;