/**
 * useOverseerNotifications Hook
 * Monitors for new mail directed to the Overseer and automatically plays audio notifications.
 * Part of the continuous town progress update system.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../services/api';
import type { Message } from '../types';

const API_BASE_URL = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '/api';

export interface OverseerNotificationSettings {
  /** Whether auto-notifications are enabled */
  enabled: boolean;
  /** Volume for playback (0-1) */
  volume: number;
  /** Poll interval in milliseconds */
  pollInterval: number;
}

export interface UseOverseerNotificationsReturn {
  /** Whether notifications are enabled */
  enabled: boolean;
  /** Toggle notifications on/off */
  setEnabled: (enabled: boolean) => void;
  /** Current volume */
  volume: number;
  /** Set volume */
  setVolume: (volume: number) => void;
  /** Whether currently playing a notification */
  isPlaying: boolean;
  /** Count of notifications played this session */
  notificationCount: number;
  /** Last notification message */
  lastNotification: string | null;
  /** Any error that occurred */
  error: string | null;
}

const STORAGE_KEY = 'overseer-notifications';
const DEFAULT_POLL_INTERVAL = 15000; // 15 seconds for responsive updates

/**
 * Check if a message is directed to/from the Overseer.
 */
function isOverseerRelevant(msg: Message): boolean {
  const fromLower = msg.from.toLowerCase();
  const toLower = msg.to.toLowerCase();
  return (
    fromLower.includes('mayor') ||
    fromLower.includes('overseer') ||
    toLower.includes('mayor') ||
    toLower.includes('overseer')
  );
}

/**
 * Hook for automatic audio notifications when new Overseer mail arrives.
 */
export function useOverseerNotifications(): UseOverseerNotificationsReturn {
  // Load settings from localStorage
  const [settings, setSettings] = useState<OverseerNotificationSettings>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored) as OverseerNotificationSettings;
      }
    } catch {
      // Ignore parse errors
    }
    return {
      enabled: true,
      volume: 0.8,
      pollInterval: DEFAULT_POLL_INTERVAL,
    };
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);
  const [lastNotification, setLastNotification] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Track seen message IDs to detect new messages
  const seenMessageIdsRef = useRef(new Set<string>());
  const isInitialFetchRef = useRef(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const notificationQueueRef = useRef<Message[]>([]);
  const isProcessingRef = useRef(false);

  // Persist settings
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  // Process notification queue
  const processQueue = useCallback(async () => {
    if (isProcessingRef.current || notificationQueueRef.current.length === 0) {
      return;
    }

    isProcessingRef.current = true;
    setIsPlaying(true);

    while (notificationQueueRef.current.length > 0) {
      const msg = notificationQueueRef.current.shift();
      if (!msg) continue;

      try {
        // Create notification text
        const notificationText = `New message from ${msg.from}: ${msg.subject}`;
        setLastNotification(notificationText);

        // Synthesize notification audio
        const response = await fetch(`${API_BASE_URL}/voice/notification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: notificationText,
            priority: msg.priority <= 1 ? 'urgent' : msg.priority === 2 ? 'high' : 'normal',
            source: 'mail',
          }),
        });

        const result = await response.json() as {
          success: boolean;
          data?: { audioUrl: string; skipped?: boolean };
        };

        if (result.success && result.data?.audioUrl && !result.data.skipped) {
          // Play the audio
          const audio = new Audio(result.data.audioUrl);
          audio.volume = settings.volume;
          audioRef.current = audio;

          await new Promise<void>((resolve, reject) => {
            audio.onended = () => resolve();
            audio.onerror = () => reject(new Error('Audio playback failed'));
            audio.play().catch(reject);
          });

          setNotificationCount((c) => c + 1);
        }
      } catch (err) {
        console.error('Failed to play notification:', err);
        setError(err instanceof Error ? err.message : 'Notification failed');
      }
    }

    isProcessingRef.current = false;
    setIsPlaying(false);
  }, [settings.volume]);

  // Poll for new messages
  useEffect(() => {
    if (!settings.enabled) return;

    const fetchAndNotify = async () => {
      try {
        const response = await api.mail.list({ all: true });
        const overseerMessages = response.items.filter(isOverseerRelevant);

        // Detect new unread messages
        if (!isInitialFetchRef.current) {
          for (const msg of overseerMessages) {
            if (!msg.read && !seenMessageIdsRef.current.has(msg.id)) {
              // Queue notification
              notificationQueueRef.current.push(msg);
            }
          }

          // Process queue if we have new notifications
          if (notificationQueueRef.current.length > 0) {
            void processQueue();
          }
        }

        // Update seen IDs
        seenMessageIdsRef.current = new Set(response.items.map((m) => m.id));
        isInitialFetchRef.current = false;
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to check mail');
      }
    };

    // Initial fetch
    void fetchAndNotify();

    // Set up polling
    const intervalId = setInterval(() => {
      void fetchAndNotify();
    }, settings.pollInterval);

    return () => {
      clearInterval(intervalId);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [settings.enabled, settings.pollInterval, processQueue]);

  // Toggle enabled
  const setEnabled = useCallback((enabled: boolean) => {
    setSettings((prev) => ({ ...prev, enabled }));
    if (!enabled) {
      // Clear queue and stop playing
      notificationQueueRef.current = [];
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setIsPlaying(false);
    }
  }, []);

  // Set volume
  const setVolume = useCallback((volume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, volume));
    setSettings((prev) => ({ ...prev, volume: clampedVolume }));
    if (audioRef.current) {
      audioRef.current.volume = clampedVolume;
    }
  }, []);

  return {
    enabled: settings.enabled,
    setEnabled,
    volume: settings.volume,
    setVolume,
    isPlaying,
    notificationCount,
    lastNotification,
    error,
  };
}

export default useOverseerNotifications;
