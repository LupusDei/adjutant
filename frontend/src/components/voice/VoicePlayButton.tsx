// ============================================================================
// VoicePlayButton Component - T022
// Pip-Boy themed voice playback button with loading/playing states
// ============================================================================

import React, { useCallback } from 'react';
import { useVoicePlayer } from '../../hooks/useVoicePlayer';
import { AudioProgressBar } from './AudioProgressBar';
import './voice.css';

export interface VoicePlayButtonProps {
  /** Text to synthesize and play */
  text: string;
  /** Agent ID for voice selection */
  agentId?: string;
  /** Whether to show inline progress bar */
  showProgress?: boolean;
  /** Compact mode (icon only) */
  compact?: boolean;
  /** Optional class name */
  className?: string;
}

/**
 * Voice playback button with Pip-Boy styling.
 * Synthesizes text on click and plays with visual feedback.
 */
export const VoicePlayButton: React.FC<VoicePlayButtonProps> = ({
  text,
  agentId,
  showProgress = true,
  compact = false,
  className = '',
}) => {
  const {
    state,
    isPlaying,
    isLoading,
    progress,
    duration,
    currentTime,
    error,
    play,
    pause,
    resume,
    stop,
    seek,
  } = useVoicePlayer();

  const handleClick = useCallback(() => {
    if (isLoading) return;

    if (isPlaying) {
      pause();
    } else if (state === 'paused') {
      resume();
    } else {
      void play(text, agentId);
    }
  }, [isLoading, isPlaying, state, pause, resume, play, text, agentId]);

  const handleStop = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    stop();
  }, [stop]);

  // Determine button icon and label
  const getIcon = () => {
    if (isLoading) return '◌'; // Loading spinner placeholder
    if (isPlaying) return '⏸'; // Pause
    if (state === 'paused') return '▶'; // Resume
    return '▶'; // Play
  };

  const getLabel = () => {
    if (isLoading) return 'Loading...';
    if (isPlaying) return 'Pause';
    if (state === 'paused') return 'Resume';
    return 'Play';
  };

  return (
    <div className={`voice-player ${className} ${state === 'error' ? 'voice-player-error' : ''}`}>
      <div className="voice-controls">
        <button
          type="button"
          className={`voice-play-button ${isLoading ? 'voice-loading' : ''} ${isPlaying ? 'voice-playing' : ''}`}
          onClick={handleClick}
          disabled={isLoading}
          aria-label={getLabel()}
          title={getLabel()}
        >
          <span className="voice-icon">{getIcon()}</span>
          {!compact && <span className="voice-label">{getLabel()}</span>}
        </button>

        {(isPlaying || state === 'paused') && (
          <button
            type="button"
            className="voice-stop-button"
            onClick={handleStop}
            aria-label="Stop"
            title="Stop"
          >
            <span className="voice-icon">⏹</span>
          </button>
        )}
      </div>

      {showProgress && (isPlaying || state === 'paused') && (
        <AudioProgressBar
          progress={progress}
          duration={duration}
          currentTime={currentTime}
          onSeek={seek}
        />
      )}

      {error && (
        <div className="voice-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
};

export default VoicePlayButton;
