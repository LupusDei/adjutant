/**
 * NotificationSettings Component - T042 [US3]
 * Pip-Boy themed notification audio preferences panel
 */
import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../services/api';
import './voice.css';

export interface NotificationSettingsProps {
  /** Optional class name */
  className?: string;
  /** Callback when settings change */
  onSettingsChange?: (settings: NotificationSettingsData) => void;
}

export interface NotificationSettingsData {
  enabled: boolean;
  volume: number;
  priorities: {
    urgent: boolean;
    high: boolean;
    normal: boolean;
    low: boolean;
  };
  sources: {
    mail: boolean;
    system: boolean;
    agent: boolean;
  };
}

const defaultSettings: NotificationSettingsData = {
  enabled: true,
  volume: 0.8,
  priorities: {
    urgent: true,
    high: true,
    normal: true,
    low: false,
  },
  sources: {
    mail: true,
    system: true,
    agent: true,
  },
};

/**
 * Notification settings panel for audio preferences.
 */
export const NotificationSettings: React.FC<NotificationSettingsProps> = ({
  className = '',
  onSettingsChange,
}) => {
  const [settings, setSettings] = useState<NotificationSettingsData>(defaultSettings);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Fetch settings on mount
  useEffect(() => {
    async function fetchSettings() {
      try {
        const response = await fetch('/api/voice/settings');
        const json = await response.json() as { success: boolean; data?: NotificationSettingsData };
        if (json.success && json.data) {
          setSettings(json.data);
        }
      } catch {
        setError('Failed to load settings');
      } finally {
        setIsLoading(false);
      }
    }
    void fetchSettings();
  }, []);

  // Save settings
  const saveSettings = useCallback(async (newSettings: NotificationSettingsData) => {
    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/voice/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings),
      });
      const json = await response.json() as { success: boolean; data?: NotificationSettingsData };
      if (json.success && json.data) {
        setSettings(json.data);
        onSettingsChange?.(json.data);
      }
    } catch {
      setError('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  }, [onSettingsChange]);

  const handleToggleEnabled = useCallback(() => {
    const newSettings = { ...settings, enabled: !settings.enabled };
    setSettings(newSettings);
    void saveSettings(newSettings);
  }, [settings, saveSettings]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const volume = parseFloat(e.target.value);
    const newSettings = { ...settings, volume };
    setSettings(newSettings);
  }, [settings]);

  const handleVolumeCommit = useCallback(() => {
    void saveSettings(settings);
  }, [settings, saveSettings]);

  const handlePriorityToggle = useCallback((priority: keyof NotificationSettingsData['priorities']) => {
    const newSettings = {
      ...settings,
      priorities: {
        ...settings.priorities,
        [priority]: !settings.priorities[priority],
      },
    };
    setSettings(newSettings);
    void saveSettings(newSettings);
  }, [settings, saveSettings]);

  const handleSourceToggle = useCallback((source: keyof NotificationSettingsData['sources']) => {
    const newSettings = {
      ...settings,
      sources: {
        ...settings.sources,
        [source]: !settings.sources[source],
      },
    };
    setSettings(newSettings);
    void saveSettings(newSettings);
  }, [settings, saveSettings]);

  if (isLoading) {
    return (
      <div className={`notification-settings notification-settings-loading ${className}`}>
        <span className="voice-loading">◌</span> Loading settings...
      </div>
    );
  }

  return (
    <div className={`notification-settings ${className}`}>
      <header className="notification-settings-header">
        <h3 className="notification-settings-title">🔔 AUDIO NOTIFICATIONS</h3>
        <button
          type="button"
          className={`notification-toggle ${settings.enabled ? 'notification-toggle-on' : ''}`}
          onClick={handleToggleEnabled}
          disabled={isSaving}
          aria-label={settings.enabled ? 'Disable notifications' : 'Enable notifications'}
        >
          {settings.enabled ? 'ON' : 'OFF'}
        </button>
      </header>

      {error && (
        <div className="voice-error" role="alert">
          {error}
        </div>
      )}

      <div className={`notification-settings-body ${!settings.enabled ? 'notification-settings-disabled' : ''}`}>
        {/* Volume Control */}
        <div className="notification-setting-group">
          <label className="notification-setting-label" htmlFor="notif-volume">
            VOLUME: {Math.round(settings.volume * 100)}%
          </label>
          <input
            id="notif-volume"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.volume}
            onChange={handleVolumeChange}
            onMouseUp={handleVolumeCommit}
            onTouchEnd={handleVolumeCommit}
            disabled={!settings.enabled || isSaving}
            className="notification-volume-slider"
          />
        </div>

        {/* Priority Settings */}
        <div className="notification-setting-group">
          <span className="notification-setting-label">PRIORITY LEVELS:</span>
          <div className="notification-checkbox-group">
            {(Object.keys(settings.priorities) as Array<keyof typeof settings.priorities>).map((priority) => (
              <label key={priority} className="notification-checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.priorities[priority]}
                  onChange={() => handlePriorityToggle(priority)}
                  disabled={!settings.enabled || isSaving}
                  className="notification-checkbox"
                />
                <span className="notification-checkbox-text">{priority.toUpperCase()}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Source Settings */}
        <div className="notification-setting-group">
          <span className="notification-setting-label">NOTIFICATION SOURCES:</span>
          <div className="notification-checkbox-group">
            {(Object.keys(settings.sources) as Array<keyof typeof settings.sources>).map((source) => (
              <label key={source} className="notification-checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.sources[source]}
                  onChange={() => handleSourceToggle(source)}
                  disabled={!settings.enabled || isSaving}
                  className="notification-checkbox"
                />
                <span className="notification-checkbox-text">{source.toUpperCase()}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {isSaving && (
        <div className="notification-settings-saving">
          <span className="voice-loading">◌</span> Saving...
        </div>
      )}
    </div>
  );
};

export default NotificationSettings;
