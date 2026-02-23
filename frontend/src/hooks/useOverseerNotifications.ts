/**
 * useOverseerNotifications Hook
 * Monitors for new mail directed to the Overseer and automatically plays audio notifications.
 * Part of the continuous town progress update system.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../services/api';
import type { Message } from '../types';
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
const DEFAULT_POLL_INTERVAL = 15000; // 15 seconds for responsive updates

/**
 * Check if a message is relevant for the Overseer dashboard.
 * Includes messages to/from mayor/overseer.
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
 * Check if a message should trigger a voice notification.
 * Read all relevant messages except those sent BY the overseer.
 */
function shouldReadAloud(msg: Message): boolean {
  const fromLower = msg.from.toLowerCase();

  // Skip messages sent BY the overseer - we don't need to read our own outgoing messages
  if (fromLower.includes('overseer')) {
    return false;
  }

  // Read everything else that passed isOverseerRelevant
  return true;
}

/**
 * Hook for automatic audio notifications when new Overseer mail arrives.
 */
export function useOverseerNotifications(): UseOverseerNotificationsReturn {
  // Mobile audio support
  const mobileAudio = useMobileAudio();

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

    // On mobile, don't try to play if audio isn't unlocked
    if (mobileAudio.isMobile && !mobileAudio.isUnlocked) {
      console.log('[OverseerNotifications] Waiting for audio unlock on mobile');
      return;
    }

    isProcessingRef.current = true;
    setIsPlaying(true);

    while (notificationQueueRef.current.length > 0) {
      const msg = notificationQueueRef.current.shift();
      if (!msg) continue;

      try {
        // Create notification text - read full message body, not just subject
        const messageBody = msg.body?.trim() || msg.subject;
        const notificationText = `Message from ${msg.from}. ${messageBody}`;
        setLastNotification(`From ${msg.from}: ${msg.subject}`);

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

        // Check if response is OK before parsing JSON
        if (!response.ok) {
          console.error(`[OverseerNotifications] API error: ${response.status} ${response.statusText}`);
          continue;
        }

        // Check content type to avoid parsing HTML as JSON
        const contentType = response.headers.get('content-type');
        if (!contentType?.includes('application/json')) {
          console.error(`[OverseerNotifications] Expected JSON, got: ${contentType}`);
          continue;
        }

        const result = await response.json() as {
          success: boolean;
          data?: { audioUrl: string; skipped?: boolean };
        };

        console.log('[OverseerNotifications] API response:', result);

        if (result.success && result.data?.audioUrl && !result.data.skipped) {
          const audioUrl = result.data.audioUrl;
          console.log('[OverseerNotifications] Playing audio:', audioUrl);

          // On mobile, use the mobile audio player (requires unlock)
          // On desktop, create a fresh Audio element (more reliable)
          if (mobileAudio.isMobile) {
            await mobileAudio.play(audioUrl, settings.volume);
          } else {
            // Desktop: create new Audio element for each notification
            const audio = new Audio(audioUrl);
            audio.volume = settings.volume;
            await new Promise<void>((resolve, reject) => {
              audio.onended = () => { resolve(); };
              audio.onerror = () => { reject(new Error('Audio playback failed')); };
              audio.play().catch(reject);
            });
          }
          setNotificationCount((c) => c + 1);
        } else {
          console.log('[OverseerNotifications] Skipping playback:', {
            success: result.success,
            hasAudioUrl: !!result.data?.audioUrl,
            skipped: result.data?.skipped
          });
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
        const response = await api.mail.list({ all: true });
        const overseerMessages = response.items.filter(isOverseerRelevant);

        // Detect new unread messages
        if (!isInitialFetchRef.current) {
          for (const msg of overseerMessages) {
            // Only queue if unread, not seen before, and should be read aloud
            // (skips messages from overseer - we don't read our own outgoing messages)
            if (!msg.read && !seenMessageIdsRef.current.has(msg.id) && shouldReadAloud(msg)) {
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
      mobileAudio.stop();
    };
  }, [settings.enabled, settings.pollInterval, processQueue, mobileAudio]);

  // Toggle enabled
  const setEnabled = useCallback((enabled: boolean) => {
    setSettings((prev) => ({ ...prev, enabled }));
    if (!enabled) {
      // Clear queue and stop playing
      notificationQueueRef.current = [];
      mobileAudio.stop();
      setIsPlaying(false);
    }
  }, [mobileAudio]);

  // Set volume
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
