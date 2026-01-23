// ============================================================================
// AudioProgressBar Component - T023
// Pip-Boy themed audio progress bar with seek functionality
// ============================================================================

import React, { useCallback, useRef } from 'react';
import './voice.css';

export interface AudioProgressBarProps {
  /** Progress percentage (0-100) */
  progress: number;
  /** Duration in seconds */
  duration: number;
  /** Current time in seconds */
  currentTime: number;
  /** Whether seeking is enabled */
  seekable?: boolean;
  /** Callback when user seeks */
  onSeek?: (position: number) => void;
}

/**
 * Format seconds to mm:ss display.
 */
function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Audio progress bar with Pip-Boy styling.
 * Shows current position, duration, and allows seeking.
 */
export const AudioProgressBar: React.FC<AudioProgressBarProps> = ({
  progress,
  duration,
  currentTime,
  seekable = true,
  onSeek,
}) => {
  const progressBarRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!seekable || !onSeek || !progressBarRef.current) return;

      const rect = progressBarRef.current.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
      onSeek(percentage);
    },
    [seekable, onSeek]
  );

  return (
    <div className="voice-progress-container">
      <span className="voice-progress-time">{formatTime(currentTime)}</span>

      <div
        ref={progressBarRef}
        className={`voice-progress-bar ${seekable ? 'voice-progress-seekable' : ''}`}
        onClick={handleClick}
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="voice-progress-track">
          <div
            className="voice-progress-fill"
            style={{ width: `${progress}%` }}
          />
          {seekable && (
            <div
              className="voice-progress-handle"
              style={{ left: `${progress}%` }}
            />
          )}
        </div>
      </div>

      <span className="voice-progress-time">{formatTime(duration)}</span>
    </div>
  );
};

export default AudioProgressBar;
