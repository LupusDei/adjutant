/**
 * useAudioNotifications Hook - T041 [US3]
 * Manages audio notification queue and playback
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { api } from '../services/api';

// =============================================================================
// Types
// =============================================================================

export type NotificationPriority = 'urgent' | 'high' | 'normal' | 'low';

export interface NotificationItem {
  id: string;
  text: string;
  priority: NotificationPriority;
  source?: 'mail' | 'system' | 'agent';
}

interface QueueEntry extends NotificationItem {
  enqueuedAt: number;
}

export interface UseAudioNotificationsReturn {
  /** Number of notifications in queue */
  queueSize: number;
  /** Whether audio is currently playing */
  isPlaying: boolean;
  /** Whether notifications are muted */
  isMuted: boolean;
  /** Whether notification system is enabled */
  isEnabled: boolean;
  /** Current volume (0-1) */
  volume: number;
  /** Last error message */
  error: string | null;
  /** Add notification to queue */
  enqueue: (item: Omit<NotificationItem, 'priority'> & { priority?: NotificationPriority }) => Promise<void>;
  /** Play next notification in queue */
  playNext: () => Promise<void>;
  /** Skip current notification */
  skip: () => void;
  /** Mute notifications */
  mute: () => void;
  /** Unmute notifications */
  unmute: () => void;
  /** Toggle mute state */
  toggleMute: () => void;
  /** Enable notification system */
  enable: () => void;
  /** Disable notification system */
  disable: () => void;
  /** Set volume (0-1) */
  setVolume: (volume: number) => void;
  /** Clear all queued notifications */
  clearQueue: () => void;
}

// =============================================================================
// Priority Weights
// =============================================================================

const PRIORITY_WEIGHTS: Record<NotificationPriority, number> = {
  urgent: 4,
  high: 3,
  normal: 2,
  low: 1,
};

// =============================================================================
// Hook Implementation
// =============================================================================

export function useAudioNotifications(): UseAudioNotificationsReturn {
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isEnabled, setIsEnabled] = useState(true);
  const [volume, setVolumeState] = useState(0.8);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentIdRef = useRef<string | null>(null);
  const seenIdsRef = useRef(new Set<string>());

  /**
   * Insert item in priority order
   */
  const insertSorted = useCallback((items: QueueEntry[], entry: QueueEntry): QueueEntry[] => {
    const weight = PRIORITY_WEIGHTS[entry.priority];
    const newItems = [...items];

    let insertIndex = newItems.length;
    for (let i = 0; i < newItems.length; i++) {
      const existingItem = newItems[i];
      if (existingItem !== undefined) {
        const existingWeight = PRIORITY_WEIGHTS[existingItem.priority];
        if (weight > existingWeight) {
          insertIndex = i;
          break;
        }
      }
    }

    newItems.splice(insertIndex, 0, entry);
    return newItems;
  }, []);

  /**
   * Play a notification
   */
  const playNotification = useCallback(async (item: QueueEntry) => {
    try {
      setError(null);

      // Synthesize notification audio
      const result = await api.voice.synthesize({
        text: item.text,
        agentId: 'system',
      });

      if (!result.success || !result.data) {
        throw new Error('Failed to synthesize notification');
      }

      // Create and play audio
      const audio = new Audio(api.voice.getAudioUrl(result.data.audioUrl.split('/').pop() || ''));
      audio.volume = volume;
      audioRef.current = audio;
      currentIdRef.current = item.id;

      audio.addEventListener('ended', () => {
        setIsPlaying(false);
        currentIdRef.current = null;
        audioRef.current = null;

        // Remove from queue
        setQueue((prev) => prev.filter((q) => q.id !== item.id));
      });

      audio.addEventListener('error', () => {
        setError('Audio playback failed');
        setIsPlaying(false);
        currentIdRef.current = null;
        audioRef.current = null;
        setQueue((prev) => prev.filter((q) => q.id !== item.id));
      });

      setIsPlaying(true);
      await audio.play();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Notification failed';
      setError(message);
      setIsPlaying(false);
      // Remove failed item from queue
      setQueue((prev) => prev.filter((q) => q.id !== item.id));
    }
  }, [volume]);

  /**
   * Enqueue a notification
   */
  const enqueue = useCallback(async (
    item: Omit<NotificationItem, 'priority'> & { priority?: NotificationPriority }
  ) => {
    if (!isEnabled) return;
    if (seenIdsRef.current.has(item.id)) return;

    const entry: QueueEntry = {
      ...item,
      priority: item.priority ?? 'normal',
      source: item.source ?? 'system',
      enqueuedAt: Date.now(),
    };

    seenIdsRef.current.add(entry.id);

    // If urgent priority and currently playing lower priority, interrupt
    if (entry.priority === 'urgent' && isPlaying && audioRef.current) {
      const currentId = currentIdRef.current;
      const currentItem = queue.find((q) => q.id === currentId);
      if (currentItem && PRIORITY_WEIGHTS[currentItem.priority] < PRIORITY_WEIGHTS.urgent) {
        audioRef.current.pause();
        setIsPlaying(false);
        // Re-add current item back to queue
        setQueue((prev) => {
          const filtered = prev.filter((q) => q.id !== currentId);
          if (currentItem) {
            return insertSorted(filtered, currentItem);
          }
          return filtered;
        });
      }
    }

    setQueue((prev) => insertSorted(prev, entry));

    // Auto-play if not muted and not already playing
    if (!isMuted && !isPlaying) {
      await playNotification(entry);
    }
  }, [isEnabled, isMuted, isPlaying, queue, insertSorted, playNotification]);

  /**
   * Play next notification in queue
   */
  const playNext = useCallback(async () => {
    if (queue.length === 0 || isMuted) return;

    const nextItem = queue[0];
    if (nextItem) {
      await playNotification(nextItem);
    }
  }, [queue, isMuted, playNotification]);

  /**
   * Skip current notification
   */
  const skip = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsPlaying(false);

    if (currentIdRef.current) {
      setQueue((prev) => prev.filter((q) => q.id !== currentIdRef.current));
      currentIdRef.current = null;
    }
  }, []);

  /**
   * Mute notifications
   */
  const mute = useCallback(() => {
    setIsMuted(true);
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setIsPlaying(false);
  }, []);

  /**
   * Unmute notifications
   */
  const unmute = useCallback(() => {
    setIsMuted(false);
  }, []);

  /**
   * Toggle mute state
   */
  const toggleMute = useCallback(() => {
    if (isMuted) {
      unmute();
    } else {
      mute();
    }
  }, [isMuted, mute, unmute]);

  /**
   * Enable notification system
   */
  const enable = useCallback(() => {
    setIsEnabled(true);
  }, []);

  /**
   * Disable notification system
   */
  const disable = useCallback(() => {
    setIsEnabled(false);
    setQueue([]);
    seenIdsRef.current.clear();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  /**
   * Set volume (0-1)
   */
  const setVolume = useCallback((newVolume: number) => {
    const clamped = Math.max(0, Math.min(1, newVolume));
    setVolumeState(clamped);
    if (audioRef.current) {
      audioRef.current.volume = clamped;
    }
  }, []);

  /**
   * Clear all queued notifications
   */
  const clearQueue = useCallback(() => {
    setQueue([]);
    seenIdsRef.current.clear();
  }, []);

  // Auto-play next when queue changes and not playing
  useEffect(() => {
    if (!isPlaying && !isMuted && queue.length > 0) {
      void playNext();
    }
  }, [isPlaying, isMuted, queue.length, playNext]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  return {
    queueSize: queue.length,
    isPlaying,
    isMuted,
    isEnabled,
    volume,
    error,
    enqueue,
    playNext,
    skip,
    mute,
    unmute,
    toggleMute,
    enable,
    disable,
    setVolume,
    clearQueue,
  };
}

export default useAudioNotifications;
