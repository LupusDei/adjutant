// ============================================================================
// VoiceMicButton Component - T032
// Pip-Boy themed microphone button for voice input
// ============================================================================

import React, { useCallback, useEffect } from 'react';
import { useVoiceInput } from '../../hooks/useVoiceInput';
import './voice.css';

export interface VoiceMicButtonProps {
  /** Callback when transcription is complete */
  onTranscript?: (text: string) => void;
  /** Callback when recording starts */
  onRecordingStart?: () => void;
  /** Callback when recording stops */
  onRecordingStop?: () => void;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Optional class name */
  className?: string;
}

/**
 * Microphone button for voice input with Pip-Boy styling.
 * Records audio and transcribes using ElevenLabs STT.
 */
export const VoiceMicButton: React.FC<VoiceMicButtonProps> = ({
  onTranscript,
  onRecordingStart,
  onRecordingStop,
  disabled = false,
  className = '',
}) => {
  const {
    isRecording,
    isProcessing,
    transcript,
    error,
    duration,
    startRecording,
    stopRecording,
    cancelRecording,
    clearTranscript,
  } = useVoiceInput();

  // Notify when transcript is available
  useEffect(() => {
    if (transcript && onTranscript) {
      onTranscript(transcript);
      clearTranscript();
    }
  }, [transcript, onTranscript, clearTranscript]);

  const handleClick = useCallback(async () => {
    if (disabled || isProcessing) return;

    if (isRecording) {
      stopRecording();
      onRecordingStop?.();
    } else {
      await startRecording();
      onRecordingStart?.();
    }
  }, [
    disabled,
    isProcessing,
    isRecording,
    stopRecording,
    startRecording,
    onRecordingStart,
    onRecordingStop,
  ]);

  const handleCancel = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      cancelRecording();
      onRecordingStop?.();
    },
    [cancelRecording, onRecordingStop]
  );

  // Format duration as mm:ss
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Determine button content
  const getIcon = () => {
    if (isProcessing) return '◌'; // Processing indicator
    if (isRecording) return '⏹'; // Stop
    return '🎤'; // Microphone
  };

  const getLabel = () => {
    if (isProcessing) return 'Processing...';
    if (isRecording) return formatDuration(duration);
    return 'Record';
  };

  return (
    <div className={`voice-mic-container ${className}`}>
      <button
        type="button"
        className={`voice-mic-button ${isRecording ? 'voice-recording' : ''} ${
          isProcessing ? 'voice-loading' : ''
        }`}
        onClick={() => { void handleClick(); }}
        disabled={disabled || isProcessing}
        aria-label={isRecording ? 'Stop recording' : 'Start recording'}
        title={isRecording ? 'Stop recording' : 'Start voice input'}
      >
        <span className="voice-icon">{getIcon()}</span>
        <span className="voice-label">{getLabel()}</span>
      </button>

      {isRecording && (
        <button
          type="button"
          className="voice-cancel-button"
          onClick={handleCancel}
          aria-label="Cancel recording"
          title="Cancel"
        >
          ✕
        </button>
      )}

      {error && (
        <div className="voice-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
};

export default VoiceMicButton;
