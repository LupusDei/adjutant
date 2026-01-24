/**
 * useMobileAudio Hook
 * Manages audio playback for mobile devices with autoplay restrictions.
 * Mobile browsers require user interaction to enable audio playback.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

// =============================================================================
// Types
// =============================================================================

export interface UseMobileAudioReturn {
  /** Whether audio is unlocked and ready to play */
  isUnlocked: boolean;
  /** Whether we're on a mobile device */
  isMobile: boolean;
  /** Whether audio needs user interaction to unlock */
  needsUnlock: boolean;
  /** Unlock audio (call this on user tap/click) */
  unlock: () => Promise<boolean>;
  /** Play audio from URL */
  play: (url: string, volume?: number) => Promise<void>;
  /** Pause current audio */
  pause: () => void;
  /** Stop and reset audio */
  stop: () => void;
  /** Whether audio is currently playing */
  isPlaying: boolean;
  /** Current audio element for advanced control */
  audioElement: HTMLAudioElement | null;
}

// =============================================================================
// Singleton State (shared across all hook instances)
// =============================================================================

let globalAudioElement: HTMLAudioElement | null = null;
let globalIsUnlocked = false;
let globalUnlockListeners: Set<() => void> = new Set();

/**
 * Check if device is mobile
 */
function checkIsMobile(): boolean {
  if (typeof window === 'undefined') return false;

  const userAgent = navigator.userAgent.toLowerCase();
  const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const isSmallScreen = window.innerWidth <= 768;

  return isMobileUA || (isTouchDevice && isSmallScreen);
}

/**
 * Initialize or get the shared audio element
 */
function getSharedAudioElement(): HTMLAudioElement {
  if (!globalAudioElement) {
    globalAudioElement = new Audio();
    // Set attributes for better mobile compatibility
    globalAudioElement.setAttribute('playsinline', 'true');
    globalAudioElement.setAttribute('webkit-playsinline', 'true');
    globalAudioElement.preload = 'auto';
  }
  return globalAudioElement;
}

/**
 * Try to unlock audio by playing a silent sound
 */
async function tryUnlockAudio(): Promise<boolean> {
  if (globalIsUnlocked) return true;

  const audio = getSharedAudioElement();

  try {
    // Create a short silent audio data URL
    // This is a minimal valid MP3 file (silence)
    const silentMp3 = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7v/////////////////////////////////' +
      '//////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRwmHAAAAAAD/+1DEAAAGAAGn9AAAIgAANIAAAARMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tQxBKAAADSAAAAAAAAANIAAAAATEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQ==';

    audio.src = silentMp3;
    audio.volume = 0.01; // Near-silent

    await audio.play();
    audio.pause();
    audio.currentTime = 0;
    // Don't set src to '' - it causes errors. Keep the silent mp3 loaded.

    globalIsUnlocked = true;

    // Notify all listeners
    globalUnlockListeners.forEach(listener => listener());

    console.log('[MobileAudio] Audio unlocked successfully');
    return true;
  } catch (err) {
    console.warn('[MobileAudio] Failed to unlock audio:', err);
    return false;
  }
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useMobileAudio(): UseMobileAudioReturn {
  const [isUnlocked, setIsUnlocked] = useState(globalIsUnlocked);
  const [isMobile] = useState(checkIsMobile);
  const [isPlaying, setIsPlaying] = useState(false);

  const playbackRef = useRef<{
    onEnded?: () => void;
    onError?: (e: Event) => void;
  }>({});

  // Subscribe to global unlock state
  useEffect(() => {
    const handleUnlock = () => setIsUnlocked(true);
    globalUnlockListeners.add(handleUnlock);

    // Sync initial state
    if (globalIsUnlocked) {
      setIsUnlocked(true);
    }

    return () => {
      globalUnlockListeners.delete(handleUnlock);
    };
  }, []);

  // Unlock audio (call on user interaction)
  const unlock = useCallback(async (): Promise<boolean> => {
    const success = await tryUnlockAudio();
    if (success) {
      setIsUnlocked(true);
    }
    return success;
  }, []);

  // Play audio from URL
  const play = useCallback(async (url: string, volume = 0.8): Promise<void> => {
    const audio = getSharedAudioElement();

    // Cleanup previous handlers
    if (playbackRef.current.onEnded) {
      audio.removeEventListener('ended', playbackRef.current.onEnded);
    }
    if (playbackRef.current.onError) {
      audio.removeEventListener('error', playbackRef.current.onError);
    }

    return new Promise((resolve, reject) => {
      const onEnded = () => {
        setIsPlaying(false);
        cleanup();
        resolve();
      };

      const onError = (e: Event) => {
        setIsPlaying(false);
        cleanup();
        // Get more details about the error
        const audioEl = e.target as HTMLAudioElement;
        const errorCode = audioEl?.error?.code;
        const errorMessage = audioEl?.error?.message || 'Unknown error';
        console.error('[MobileAudio] Playback error:', {
          code: errorCode,
          message: errorMessage,
          src: audioEl?.src
        });
        reject(new Error(`Audio playback failed: ${errorMessage} (code: ${errorCode})`));
      };

      const cleanup = () => {
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
        playbackRef.current = {};
      };

      playbackRef.current = { onEnded, onError };
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);

      console.log('[MobileAudio] Playing:', url);
      audio.src = url;
      audio.volume = Math.max(0, Math.min(1, volume));

      audio.play()
        .then(() => {
          setIsPlaying(true);
          // Don't resolve here - wait for 'ended' event
        })
        .catch((err) => {
          cleanup();
          reject(err);
        });
    });
  }, []);

  // Pause audio
  const pause = useCallback(() => {
    const audio = getSharedAudioElement();
    audio.pause();
    setIsPlaying(false);
  }, []);

  // Stop and reset
  const stop = useCallback(() => {
    const audio = getSharedAudioElement();
    audio.pause();
    audio.currentTime = 0;
    // Don't set src to '' - it resolves to base URL and causes errors
    setIsPlaying(false);
  }, []);

  return {
    isUnlocked,
    isMobile,
    needsUnlock: isMobile && !isUnlocked,
    unlock,
    play,
    pause,
    stop,
    isPlaying,
    audioElement: globalAudioElement,
  };
}

export default useMobileAudio;
