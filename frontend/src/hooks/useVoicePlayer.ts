// ============================================================================
// useVoicePlayer Hook - T021
// Manages voice playback state and audio control
// ============================================================================

import { useState, useCallback, useRef, useEffect } from 'react';
import { api } from '../services/api';
import type { VoicePlayerState } from '../types/voice';

export interface UseVoicePlayerReturn {
  /** Current playback state */
  state: VoicePlayerState;
  /** Whether audio is currently playing */
  isPlaying: boolean;
  /** Whether audio is loading/synthesizing */
  isLoading: boolean;
  /** Playback progress (0-100) */
  progress: number;
  /** Duration in seconds */
  duration: number;
  /** Current time in seconds */
  currentTime: number;
  /** Error message if any */
  error: string | null;
  /** Play audio for text */
  play: (text: string, agentId?: string) => Promise<void>;
  /** Pause playback */
  pause: () => void;
  /** Resume playback */
  resume: () => void;
  /** Stop playback and reset */
  stop: () => void;
  /** Seek to position (0-100) */
  seek: (position: number) => void;
}

/**
 * Hook for managing voice playback.
 * Synthesizes text via ElevenLabs and plays it back with controls.
 */
export function useVoicePlayer(): UseVoicePlayerReturn {
  const [state, setState] = useState<VoicePlayerState>('idle');
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Cleanup function for audio element
  const cleanupAudio = useCallback(() => {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupAudio();
    };
  }, [cleanupAudio]);

  // Play audio for text
  const play = useCallback(async (text: string, agentId?: string) => {
    // Cleanup previous audio
    cleanupAudio();

    setState('loading');
    setError(null);
    setProgress(0);
    setCurrentTime(0);

    try {
      // Synthesize the text
      const response = await api.voice.synthesize({
        text,
        agentId,
      });

      if (!response.success || !response.data) {
        const errorMessage = (response as { error?: { message: string } }).error?.message || 'Synthesis failed';
        setState('error');
        setError(errorMessage);
        return;
      }

      const { audioUrl, duration: audioDuration } = response.data;
      setDuration(audioDuration);

      // Create audio element
      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      // Event handlers
      const handlePlay = () => {
        setState('playing');
      };

      const handlePause = () => {
        if (audioRef.current && audioRef.current.currentTime < (audioRef.current.duration || 0)) {
          setState('paused');
        }
      };

      const handleTimeUpdate = () => {
        if (audioRef.current) {
          const current = audioRef.current.currentTime;
          const total = audioRef.current.duration || audioDuration;
          setCurrentTime(current);
          setProgress(total > 0 ? (current / total) * 100 : 0);
        }
      };

      const handleEnded = () => {
        setState('idle');
        setProgress(0);
        setCurrentTime(0);
      };

      const handleError = () => {
        setState('error');
        setError('Audio playback failed');
      };

      const handleLoadedMetadata = () => {
        if (audioRef.current && audioRef.current.duration) {
          setDuration(audioRef.current.duration);
        }
      };

      // Add event listeners
      audio.addEventListener('play', handlePlay);
      audio.addEventListener('pause', handlePause);
      audio.addEventListener('timeupdate', handleTimeUpdate);
      audio.addEventListener('ended', handleEnded);
      audio.addEventListener('error', handleError);
      audio.addEventListener('loadedmetadata', handleLoadedMetadata);

      // Setup cleanup
      cleanupRef.current = () => {
        audio.removeEventListener('play', handlePlay);
        audio.removeEventListener('pause', handlePause);
        audio.removeEventListener('timeupdate', handleTimeUpdate);
        audio.removeEventListener('ended', handleEnded);
        audio.removeEventListener('error', handleError);
        audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      };

      // Start playback
      await audio.play();
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : 'Failed to play audio');
    }
  }, [cleanupAudio]);

  // Pause playback
  const pause = useCallback(() => {
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
    }
  }, []);

  // Resume playback
  const resume = useCallback(() => {
    if (audioRef.current && audioRef.current.paused) {
      audioRef.current.play().catch(() => {
        setState('error');
        setError('Failed to resume playback');
      });
    }
  }, []);

  // Stop playback
  const stop = useCallback(() => {
    cleanupAudio();
    setState('idle');
    setProgress(0);
    setCurrentTime(0);
    setDuration(0);
    setError(null);
  }, [cleanupAudio]);

  // Seek to position
  const seek = useCallback((position: number) => {
    if (audioRef.current && audioRef.current.duration) {
      const newTime = (position / 100) * audioRef.current.duration;
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
      setProgress(position);
    }
  }, []);

  return {
    state,
    isPlaying: state === 'playing',
    isLoading: state === 'loading',
    progress,
    duration,
    currentTime,
    error,
    play,
    pause,
    resume,
    stop,
    seek,
  };
}

export default useVoicePlayer;
