import React from 'react';
import { useDashboardMail } from '../../hooks/useDashboardMail';
import { useDashboardConvoys } from '../../hooks/useDashboardConvoys';
import { useDashboardCrew } from '../../hooks/useDashboardCrew';
import './DashboardView.css'; // Import the CSS file

// Simple widget wrapper for dashboard sections
interface DashboardWidgetProps {
  title: string;
  children: React.ReactNode;
  className?: string;
}

const DashboardWidget: React.FC<DashboardWidgetProps> = ({ title, children, className }) => (
  <div className={`dashboard-widget-container ${className || ''}`}>
    <h3 className="dashboard-widget-title">{title}</h3>
    <div className="dashboard-widget-content">{children}</div>
  </div>
);

/**
 * DashboardView component displays a snapshot of information from other tabs.
 */
export function DashboardView() {
  const { unreadMessages, recentMessages, loading: mailLoading, error: mailError } = useDashboardMail();
  const { recentConvoys, loading: convoysLoading, error: convoysError } = useDashboardConvoys();
  const { totalCrew, activeCrew, crewAlerts, loading: crewLoading, error: crewError } = useDashboardCrew();



  return (
    <div className="dashboard-view-container">
      <h2 className="dashboard-view-main-title">SYSTEM OVERVIEW</h2>

      <div className="dashboard-view-grid">
        {/* Mail Widget */}
        <DashboardWidget title="MAIL">
          {mailLoading && <p>Loading mail...</p>}
          {mailError && <p className="dashboard-view-error-text">Error: {mailError}</p>}
          {!mailLoading && !mailError && (
            <>
              {unreadMessages.length > 0 && (
                <>
                  <p className="dashboard-view-sub-title">Unread ({unreadMessages.length}):</p>
                  <ul className="dashboard-view-list">
                    {unreadMessages.map((msg) => (
                      <li key={msg.id} className="dashboard-view-list-item">
                        <span className="dashboard-view-list-item-label">From:</span> {msg.sender} <span className="dashboard-view-list-item-label">Subj:</span> {msg.subject}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {(unreadMessages.length === 0 && recentMessages.length > 0) && (
                <>
                  <p className="dashboard-view-sub-title">Recent:</p>
                  <ul className="dashboard-view-list">
                    {recentMessages.map((msg) => (
                      <li key={msg.id} className="dashboard-view-list-item">
                        <span className="dashboard-view-list-item-label">From:</span> {msg.sender} <span className="dashboard-view-list-item-label">Subj:</span> {msg.subject}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {(unreadMessages.length === 0 && recentMessages.length === 0) && (
                <p>No recent messages.</p>
              )}
            </>
          )}
        </DashboardWidget>

        {/* Crew Widget */}
        <DashboardWidget title="CREW">
          {crewLoading && <p>Loading crew data...</p>}
          {crewError && <p className="dashboard-view-error-text">Error: {crewError}</p>}
          {!crewLoading && !crewError && (
            <>
              <p><span className="dashboard-view-list-item-label">Total Crew:</span> {totalCrew}</p>
              <p><span className="dashboard-view-list-item-label">Active Crew:</span> {activeCrew}</p>
              {crewAlerts.length > 0 ? (
                <>
                  <p className="dashboard-view-sub-title">Alerts:</p>
                  <ul className="dashboard-view-list">
                    {crewAlerts.map((alert, index) => (
                      <li key={index} className="dashboard-view-list-item dashboard-view-error-text">{alert}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>No active crew alerts.</p>
              )}
            </>
          )}
        </DashboardWidget>

        {/* Convoys Widget */}
        <DashboardWidget title="CONVOYS" className="dashboard-widget-full-width">
          {convoysLoading && <p>Loading convoys...</p>}
          {convoysError && <p className="dashboard-view-error-text">Error: {convoysError}</p>}
          {!convoysLoading && !convoysError && (
            <>
              {recentConvoys.length > 0 ? (
                <ul className="dashboard-view-list">
                  {recentConvoys.map((convoy) => (
                    <li key={convoy.id} className="dashboard-view-list-item">
                      <span className="dashboard-view-list-item-label">ID:</span> {convoy.id} <span className="dashboard-view-list-item-label">Status:</span> {convoy.status}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No recent convoys.</p>
              )}
            </>
          )}
        </DashboardWidget>


      </div>
    </div>
  );
}

export default DashboardView;