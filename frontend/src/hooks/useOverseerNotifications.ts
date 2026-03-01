/**
 * useOverseerNotifications Hook
 * Monitors for new chat messages and automatically plays audio notifications.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../services/api';
import type { ChatMessage } from '../types';
import { useMobileAudio } from './useMobileAudio';

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
  /** Whether mobile audio needs to be unlocked */
  needsAudioUnlock: boolean;
  /** Unlock mobile audio (call on user tap) */
  unlockAudio: () => Promise<boolean>;
}

const STORAGE_KEY = 'overseer-notifications';
const DEFAULT_POLL_INTERVAL = 15000;

/**
 * Check if a message should trigger a voice notification.
 * Only read messages FROM agents (not user's own messages).
 */
function shouldReadAloud(msg: ChatMessage): boolean {
  return msg.role === 'agent';
}

/**
 * Hook for automatic audio notifications when new messages arrive.
 */
export function useOverseerNotifications(): UseOverseerNotificationsReturn {
  const mobileAudio = useMobileAudio();

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

  const seenMessageIdsRef = useRef(new Set<string>());
  const isInitialFetchRef = useRef(true);
  const notificationQueueRef = useRef<ChatMessage[]>([]);
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

    if (mobileAudio.isMobile && !mobileAudio.isUnlocked) {
      return;
    }

    isProcessingRef.current = true;
    setIsPlaying(true);

    while (notificationQueueRef.current.length > 0) {
      const msg = notificationQueueRef.current.shift();
      if (!msg) continue;

      try {
        const notificationText = `Message from ${msg.agentId}. ${msg.body}`;
        setLastNotification(`From ${msg.agentId}: ${msg.body.slice(0, 50)}`);

        const response = await fetch(`${API_BASE_URL}/voice/notification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: notificationText,
            priority: 'normal',
            source: 'chat',
          }),
        });

        if (!response.ok) {
          console.error(`[OverseerNotifications] API error: ${response.status} ${response.statusText}`);
          continue;
        }

        const contentType = response.headers.get('content-type');
        if (!contentType?.includes('application/json')) {
          console.error(`[OverseerNotifications] Expected JSON, got: ${contentType}`);
          continue;
        }

        const result = await response.json() as {
          success: boolean;
          data?: { audioUrl: string; skipped?: boolean };
        };

        if (result.success && result.data?.audioUrl && !result.data.skipped) {
          const audioUrl = result.data.audioUrl;

          if (mobileAudio.isMobile) {
            await mobileAudio.play(audioUrl, settings.volume);
          } else {
            const audio = new Audio(audioUrl);
            audio.volume = settings.volume;
            await new Promise<void>((resolve, reject) => {
              audio.onended = () => { resolve(); };
              audio.onerror = () => { reject(new Error('Audio playback failed')); };
              audio.play().catch(reject);
            });
          }
          setNotificationCount((c) => c + 1);
        }
      } catch (err) {
        console.error('Failed to play notification:', err);
        setError(err instanceof Error ? err.message : 'Notification failed');
      }
    }

    isProcessingRef.current = false;
    setIsPlaying(false);
  }, [settings.volume, mobileAudio]);

  // Poll for new messages
  useEffect(() => {
    if (!settings.enabled) return;

    const fetchAndNotify = async () => {
      try {
        const response = await api.messages.list({ limit: 50 });
        const agentMessages = response.items.filter(shouldReadAloud);

        if (!isInitialFetchRef.current) {
          for (const msg of agentMessages) {
            if (!seenMessageIdsRef.current.has(msg.id)) {
              notificationQueueRef.current.push(msg);
            }
          }

          if (notificationQueueRef.current.length > 0) {
            void processQueue();
          }
        }

        seenMessageIdsRef.current = new Set(response.items.map((m) => m.id));
        isInitialFetchRef.current = false;
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to check messages');
      }
    };

    void fetchAndNotify();

    const intervalId = setInterval(() => {
      void fetchAndNotify();
    }, settings.pollInterval);

    return () => {
      clearInterval(intervalId);
      mobileAudio.stop();
    };
  }, [settings.enabled, settings.pollInterval, processQueue, mobileAudio]);

  const setEnabled = useCallback((enabled: boolean) => {
    setSettings((prev) => ({ ...prev, enabled }));
    if (!enabled) {
      notificationQueueRef.current = [];
      mobileAudio.stop();
      setIsPlaying(false);
    }
  }, [mobileAudio]);

  const setVolume = useCallback((volume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, volume));
    setSettings((prev) => ({ ...prev, volume: clampedVolume }));
  }, []);

  // Process queue when audio is unlocked on mobile
  useEffect(() => {
    if (mobileAudio.isUnlocked && notificationQueueRef.current.length > 0 && !isProcessingRef.current) {
      void processQueue();
    }
  }, [mobileAudio.isUnlocked, processQueue]);

  return {
    enabled: settings.enabled,
    setEnabled,
    volume: settings.volume,
    setVolume,
    isPlaying,
    notificationCount,
    lastNotification,
    error,
    needsAudioUnlock: mobileAudio.needsUnlock,
    unlockAudio: mobileAudio.unlock,
  };
}

export default useOverseerNotifications;
