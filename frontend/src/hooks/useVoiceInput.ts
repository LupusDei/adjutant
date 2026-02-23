// ============================================================================
// useVoiceInput Hook - T031
// Manages voice recording and transcription
// ============================================================================

import { useState, useCallback, useRef, useEffect } from 'react';
import { api } from '../services/api';

export type VoiceInputState =
  | 'idle'
  | 'recording'
  | 'processing'
  | 'error';

export interface UseVoiceInputReturn {
  /** Current state */
  state: VoiceInputState;
  /** Whether currently recording */
  isRecording: boolean;
  /** Whether processing transcription */
  isProcessing: boolean;
  /** Transcribed text result */
  transcript: string;
  /** Error message if any */
  error: string | null;
  /** Recording duration in seconds */
  duration: number;
  /** Start recording */
  startRecording: () => Promise<void>;
  /** Stop recording and transcribe */
  stopRecording: () => void;
  /** Cancel recording without transcribing */
  cancelRecording: () => void;
  /** Clear the transcript */
  clearTranscript: () => void;
}

/**
 * Hook for voice input with recording and transcription.
 * Uses Web Audio API and ElevenLabs STT.
 */
export function useVoiceInput(): UseVoiceInputReturn {
  const [state, setState] = useState<VoiceInputState>('idle');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isCancelledRef = useRef(false);

  // Cleanup function
  const cleanup = useCallback(() => {
    // Stop duration timer
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    // Stop all tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => { track.stop(); });
      streamRef.current = null;
    }

    mediaRecorderRef.current = null;
    chunksRef.current = [];
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  // Start recording
  const startRecording = useCallback(async () => {
    try {
      cleanup();
      isCancelledRef.current = false;
      setState('recording');
      setError(null);
      setDuration(0);
      setTranscript('');

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      streamRef.current = stream;

      // Create MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4',
      });
      mediaRecorderRef.current = mediaRecorder;

      // Collect data chunks
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      // Handle recording stop
      mediaRecorder.onstop = async () => {
        if (isCancelledRef.current) {
          cleanup();
          setState('idle');
          return;
        }

        // Combine chunks into blob
        const audioBlob = new Blob(chunksRef.current, {
          type: mediaRecorder.mimeType,
        });

        cleanup();
        setState('processing');

        try {
          // Convert blob to buffer for API
          const arrayBuffer = await audioBlob.arrayBuffer();
          const buffer = new Uint8Array(arrayBuffer);

          // Transcribe
          const response = await api.voice.transcribe(buffer, audioBlob.type);

          if (response.success && response.data) {
            setTranscript(response.data.text);
            setState('idle');
          } else {
            const errorMessage =
              (response as { error?: { message: string } }).error?.message ||
              'Transcription failed';
            setError(errorMessage);
            setState('error');
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Transcription failed');
          setState('error');
        }
      };

      mediaRecorder.onerror = () => {
        setError('Recording failed');
        setState('error');
        cleanup();
      };

      // Start recording
      mediaRecorder.start();

      // Start duration timer
      const startTime = Date.now();
      durationIntervalRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start recording');
      setState('error');
      cleanup();
    }
  }, [cleanup]);

  // Stop recording and transcribe
  const stopRecording = useCallback(() => {
    isCancelledRef.current = false;
    if (
      mediaRecorderRef.current?.state === 'recording'
    ) {
      mediaRecorderRef.current.stop();
    }
  }, []);

  // Cancel recording without transcribing
  const cancelRecording = useCallback(() => {
    isCancelledRef.current = true;
    if (
      mediaRecorderRef.current?.state === 'recording'
    ) {
      mediaRecorderRef.current.stop();
    } else {
      cleanup();
      setState('idle');
    }
  }, [cleanup]);

  // Clear transcript
  const clearTranscript = useCallback(() => {
    setTranscript('');
    setError(null);
    if (state === 'error') {
      setState('idle');
    }
  }, [state]);

  return {
    state,
    isRecording: state === 'recording',
    isProcessing: state === 'processing',
    transcript,
    error,
    duration,
    startRecording,
    stopRecording,
    cancelRecording,
    clearTranscript,
  };
}

export default useVoiceInput;
