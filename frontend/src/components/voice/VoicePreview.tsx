/**
 * VoicePreview Component - T051 [US4]
 * Preview voice settings with sample text synthesis
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { api } from '../../services/api';
import './voice.css';

export interface VoicePreviewProps {
  /** Voice ID to preview */
  voiceId: string;
  /** Speed setting */
  speed?: number;
  /** Stability setting */
  stability?: number;
  /** Similarity boost setting */
  similarityBoost?: number;
  /** Custom preview text */
  previewText?: string;
  /** Optional class name */
  className?: string;
}

const DEFAULT_PREVIEW_TEXT = 'This is a preview of the selected voice configuration. Gas Town is operational.';

/**
 * Voice preview component for testing voice settings.
 */
export const VoicePreview: React.FC<VoicePreviewProps> = ({
  voiceId,
  speed = 1.0,
  stability = 0.5,
  similarityBoost = 0.75,
  previewText = DEFAULT_PREVIEW_TEXT,
  className = '',
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // Stop current playback when voice settings change
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setIsPlaying(false);
    }
  }, [voiceId, speed, stability, similarityBoost]);

  const handlePreview = useCallback(async () => {
    if (isLoading || isPlaying) {
      // Stop if playing
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
        setIsPlaying(false);
      }
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Synthesize preview audio
      const result = await api.voice.synthesize({
        text: previewText,
        voiceId,
      });

      if (!result.success || !result.data) {
        throw new Error('Failed to synthesize preview');
      }

      // Create and play audio
      const filename = result.data.audioUrl.split('/').pop() ?? '';
      const audio = new Audio(api.voice.getAudioUrl(filename));
      audioRef.current = audio;

      audio.addEventListener('ended', () => {
        setIsPlaying(false);
        audioRef.current = null;
      });

      audio.addEventListener('error', () => {
        setError('Audio playback failed');
        setIsPlaying(false);
        audioRef.current = null;
      });

      setIsPlaying(true);
      setIsLoading(false);
      await audio.play();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Preview failed';
      setError(message);
      setIsLoading(false);
    }
  }, [isLoading, isPlaying, previewText, voiceId]);

  return (
    <div className={`voice-preview ${className}`}>
      <div className="voice-preview-controls">
        <button
          type="button"
          className={`voice-preview-btn ${isPlaying ? 'voice-preview-playing' : ''} ${isLoading ? 'voice-loading' : ''}`}
          onClick={() => void handlePreview()}
          disabled={isLoading}
          title={isPlaying ? 'Stop preview' : 'Play preview'}
        >
          <span className="voice-icon">
            {isLoading ? '◌' : isPlaying ? '⏹' : '▶'}
          </span>
          <span className="voice-label">
            {isLoading ? 'LOADING...' : isPlaying ? 'STOP' : 'PREVIEW VOICE'}
          </span>
        </button>
      </div>

      {error && (
        <div className="voice-error" role="alert">
          {error}
        </div>
      )}

      <div className="voice-preview-info">
        <span className="voice-preview-text">
          "{previewText.slice(0, 50)}{previewText.length > 50 ? '...' : ''}"
        </span>
      </div>
    </div>
  );
};

export default VoicePreview;
