/**
 * OverseerNotificationStatus Component
 * Shows notification status indicator and controls in the header area.
 * Provides visual feedback when audio notifications are playing.
 */

import React from 'react';
import { useOverseerNotifications } from '../../hooks/useOverseerNotifications';
import './notifications.css';

export interface OverseerNotificationStatusProps {
  /** Optional class name */
  className?: string;
}

/**
 * Notification status indicator with toggle control.
 */
export const OverseerNotificationStatus: React.FC<OverseerNotificationStatusProps> = ({
  className = '',
}) => {
  const {
    enabled,
    setEnabled,
    volume,
    setVolume,
    isPlaying,
    notificationCount,
    lastNotification,
    error,
    needsAudioUnlock,
    unlockAudio,
  } = useOverseerNotifications();

  // Handle unlock button click
  const handleUnlock = async () => {
    await unlockAudio();
  };

  return (
    <div className={`notification-status ${className}`}>
      {/* Show unlock button on mobile when audio needs to be unlocked */}
      {needsAudioUnlock && enabled && (
        <button
          type="button"
          className="notification-unlock-button"
          onClick={() => { void handleUnlock(); }}
          title="Tap to enable audio on mobile"
          aria-label="Enable audio playback"
        >
          <span className="notification-icon">🔇</span>
          <span className="notification-unlock-text">TAP</span>
        </button>
      )}

      <button
        type="button"
        className={`notification-status-button ${enabled ? 'notification-enabled' : 'notification-disabled'} ${isPlaying ? 'notification-playing' : ''}`}
        onClick={() => { setEnabled(!enabled); }}
        title={enabled ? `Auto-notifications ON (${notificationCount} played)` : 'Auto-notifications OFF'}
        aria-label={enabled ? 'Disable auto-notifications' : 'Enable auto-notifications'}
      >
        <span className="notification-icon">
          {isPlaying ? '🔊' : enabled ? '🔔' : '🔕'}
        </span>
        {isPlaying && <span className="notification-pulse" />}
      </button>

      {enabled && (
        <div className="notification-volume-control">
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={volume}
            onChange={(e) => { setVolume(parseFloat(e.target.value)); }}
            className="notification-volume-slider"
            title={`Volume: ${Math.round(volume * 100)}%`}
            aria-label="Notification volume"
          />
        </div>
      )}

      {isPlaying && lastNotification && (
        <div className="notification-now-playing" title={lastNotification}>
          <span className="notification-now-playing-text">
            {lastNotification.length > 40
              ? lastNotification.slice(0, 40) + '...'
              : lastNotification}
          </span>
        </div>
      )}

      {error && (
        <div className="notification-error" title={error}>
          ⚠️
        </div>
      )}
    </div>
  );
};

export default OverseerNotificationStatus;
