import React, { Suspense, useMemo, useState, useEffect, useCallback } from 'react';

import { useOverview } from '../../hooks/useProjectOverview';
import { api } from '../../services/api';
import type { AutoDevelopStatus } from '../../types';
import { getTimelineEvents, type TimelineEvent } from '../../services/api';
import type { AgentOverview, OverviewUnreadSummary } from '../../types/overview';
import { AutoDevelopToggle } from './AutoDevelopToggle';
import { AutoDevelopPanel } from './AutoDevelopPanel';
import { EscalationBanner } from './EscalationBanner';
import { CycleHistory } from './CycleHistory';
import './DashboardView.css';

/** Lazy-loaded CostPanel — loads independently from other overview widgets. */
const LazyCostPanel = React.lazy(() => import('./CostPanel'));

/** Loading skeleton for CostPanel while it loads. */
function CostPanelSkeleton() {
  return (
    <div style={{ padding: '24px', textAlign: 'center' }}>
      <div
        style={{
          width: '32px',
          height: '32px',
          border: '2px solid var(--crt-phosphor-dim)',
          borderTopColor: 'var(--crt-phosphor)',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
          margin: '0 auto 12px',
        }}
      />
      <span style={{ color: 'var(--crt-phosphor-dim)', fontSize: '0.75rem', letterSpacing: '0.1em' }}>
        LOADING COST DATA...
      </span>
    </div>
  );
}

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

/** Map timeline event type to short label */
function timelineEventLabel(eventType: string): string {
  switch (eventType) {
    case 'status_change': return 'STATUS';
    case 'progress_report': return 'PROGRESS';
    case 'announcement': return 'ANNOUNCE';
    case 'message_sent': return 'MESSAGE';
    case 'bead_updated': return 'BEAD';
    case 'bead_closed': return 'CLOSED';
    case 'coordinator_action': return 'COORD';
    case 'auto_develop_enabled': return 'AUTO-DEV ON';
    case 'auto_develop_disabled': return 'AUTO-DEV OFF';
    case 'auto_develop_phase_changed': return 'PHASE';
    case 'proposal_completed': return 'PROPOSAL';
    default: return eventType.replace(/_/g, ' ').toUpperCase();
  }
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

  // --- Auto-Develop status ---
  const [autoDevelopStatus, setAutoDevelopStatus] = useState<AutoDevelopStatus | null>(null);

  // Use the first active project as the auto-develop target
  const projects = data?.projects;
  const activeProjectId = useMemo(() => {
    if (!projects) return null;
    const active = projects.find((p) => p.active);
    return active?.id ?? projects[0]?.id ?? null;
  }, [projects]);

  const fetchAutoDevelopStatus = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      const status = await api.projects.getAutoDevelopStatus(activeProjectId);
      setAutoDevelopStatus(status);
    } catch {
      // API may not exist yet - silently ignore
      setAutoDevelopStatus(null);
    }
  }, [activeProjectId]);

  // Poll auto-develop status every 15s for live phase updates
  useEffect(() => {
    void fetchAutoDevelopStatus();
    const intervalId = setInterval(() => {
      if (!document.hidden) { void fetchAutoDevelopStatus(); }
    }, 15_000);
    return () => { clearInterval(intervalId); };
  }, [fetchAutoDevelopStatus]);

  const handleAutoDevelopToggled = useCallback(() => {
    void fetchAutoDevelopStatus();
  }, [fetchAutoDevelopStatus]);

  // --- Agents ---
  const agents: AgentOverview[] = data?.agents ?? [];

  // --- Unread messages ---
  const unreadMessages: OverviewUnreadSummary[] = data?.unreadMessages ?? [];

  // --- Timeline events ---
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  useEffect(() => {
    void getTimelineEvents({ limit: 20 }).then((res) => {
      setTimelineEvents(res.events);
    }).catch(() => { /* silently fail */ });
    const intervalId = setInterval(() => {
      if (!document.hidden) {
        void getTimelineEvents({ limit: 20 }).then((res) => {
          setTimelineEvents(res.events);
        }).catch(() => { /* ignore */ });
      }
    }, 15_000);
    return () => { clearInterval(intervalId); };
  }, []);

  const showEscalation = autoDevelopStatus?.paused && autoDevelopStatus?.enabled && activeProjectId;
  const showAutoDevPanel = autoDevelopStatus?.enabled && activeProjectId;

  return (
    <div className="dashboard-view-container">
      {/* Escalation Banner - above all widgets when escalation needed */}
      {showEscalation && activeProjectId && (
        <div style={{ marginBottom: '20px' }}>
          <EscalationBanner
            projectId={activeProjectId}
            onSubmitted={handleAutoDevelopToggled}
          />
        </div>
      )}

      <div className="dashboard-view-grid">

        {/* Auto-Develop Toggle - rendered before agents when project exists */}
        {activeProjectId && (
          <div className="dashboard-widget-full-width" style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 4px' }}>
            <AutoDevelopToggle
              projectId={activeProjectId}
              status={autoDevelopStatus}
              onToggled={handleAutoDevelopToggled}
            />
          </div>
        )}

        {/* Auto-Develop Panel - shown when enabled */}
        {showAutoDevPanel && autoDevelopStatus && (
          <AutoDevelopPanel status={autoDevelopStatus} />
        )}

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
                      {agent.project && (
                        <span className="dashboard-agent-project">{agent.project}</span>
                      )}
                      <span className={`dashboard-crew-card-status-text dashboard-text-${statusIndicatorClass(agent.status)}`}>
                        {statusLabel(agent.status)}
                      </span>
                      {agent.currentBead && (
                        <span className="dashboard-agent-task">{truncateBody(agent.currentBead, 60)}</span>
                      )}
                      {(agent.contextPercent != null || agent.cost != null) && (
                        <span className="dashboard-agent-cost-context">
                          {agent.contextPercent != null && (
                            <span className={`dashboard-agent-context ${agent.contextPercent > 90 ? 'ctx-critical' : agent.contextPercent > 75 ? 'ctx-warning' : ''}`}>
                              CTX {agent.contextPercent}%
                            </span>
                          )}
                          {agent.cost != null && (
                            <span className="dashboard-agent-cost">${agent.cost.toFixed(2)}</span>
                          )}
                        </span>
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

        {/* Timeline Events Widget (directly below Agents — adj-157) */}
        <DashboardWidget
          title="TIMELINE"
          className="dashboard-widget-full-width"
          headerRight={
            timelineEvents.length > 0 && (
              <div className="dashboard-header-stats">
                <span className="dashboard-header-stat">
                  {timelineEvents.length} recent
                </span>
              </div>
            )
          }
        >
          {timelineEvents.length > 0 ? (
            <div className="dashboard-timeline-list">
              {timelineEvents.map((evt) => (
                <div key={evt.id} className="dashboard-timeline-row">
                  <span className={`dashboard-timeline-type dashboard-timeline-type-${evt.eventType.replace(/_/g, '-')}`}>
                    {timelineEventLabel(evt.eventType)}
                  </span>
                  <span className="dashboard-timeline-action">{truncateBody(evt.action, 70)}</span>
                  <span className="dashboard-timeline-agent">{evt.agentId}</span>
                  <span className="dashboard-timeline-time">{formatChatTimestamp(evt.createdAt)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="dashboard-empty-text">No timeline events</p>
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

        {/* Tasks widget removed — adj-157 */}

        {/* Cycle History Widget - shown when auto-develop has cycle data */}
        {showAutoDevPanel && autoDevelopStatus && (
          <CycleHistory status={autoDevelopStatus} />
        )}

        {/* Cost Widget (full width, lazy-loaded) */}
        <DashboardWidget
          title="COSTS"
          className="dashboard-widget-full-width"
        >
          <Suspense fallback={<CostPanelSkeleton />}>
            <LazyCostPanel />
          </Suspense>
        </DashboardWidget>

      </div>
    </div>
  );
}

export default DashboardView;
