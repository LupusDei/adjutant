/**
 * Audio feedback utilities for Pip-Boy UI
 *
 * Provides simple Web Audio API based sound generation
 * for authentic retro terminal feedback sounds.
 *
 * Usage:
 *   const { playClick, playBeep, playError } = useAudio();
 *   <button onClick={() => { playClick(); handleAction(); }}>
 */

import { useCallback, useRef } from 'react';

// Audio context singleton (created on first use)
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

/**
 * Generates a simple beep/click sound using oscillator
 */
function generateTone(
  frequency: number,
  duration: number,
  type: OscillatorType = 'square',
  volume: number = 0.1
): void {
  try {
    const ctx = getAudioContext();

    // Create oscillator for the tone
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

    // Quick attack, short decay for that retro click
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.005);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration);
  } catch {
    // Silently fail if audio not available
  }
}

/**
 * Hook providing Pip-Boy themed audio feedback functions
 */
export function useAudio() {
  // Track if audio is enabled (user preference)
  const enabledRef = useRef(true);

  /**
   * Play a short click sound (for button presses)
   * Frequency: 1000Hz, Duration: 50ms
   */
  const playClick = useCallback(() => {
    if (!enabledRef.current) return;
    generateTone(1000, 0.05, 'square', 0.08);
  }, []);

  /**
   * Play a confirmation beep (for successful actions)
   * Two-tone ascending: 800Hz -> 1200Hz
   */
  const playConfirm = useCallback(() => {
    if (!enabledRef.current) return;
    generateTone(800, 0.08, 'square', 0.06);
    setTimeout(() => generateTone(1200, 0.1, 'square', 0.08), 80);
  }, []);

  /**
   * Play an error/warning sound
   * Two-tone descending: 400Hz -> 200Hz
   */
  const playError = useCallback(() => {
    if (!enabledRef.current) return;
    generateTone(400, 0.15, 'sawtooth', 0.1);
    setTimeout(() => generateTone(200, 0.2, 'sawtooth', 0.08), 150);
  }, []);

  /**
   * Play a soft tick (for hover or selection)
   * Very short, high frequency
   */
  const playTick = useCallback(() => {
    if (!enabledRef.current) return;
    generateTone(2000, 0.02, 'square', 0.04);
  }, []);

  /**
   * Play boot/startup sound sequence
   */
  const playBoot = useCallback(() => {
    if (!enabledRef.current) return;
    // Rising sequence mimicking CRT warm-up
    generateTone(100, 0.3, 'sine', 0.05);
    setTimeout(() => generateTone(200, 0.2, 'sine', 0.06), 200);
    setTimeout(() => generateTone(400, 0.15, 'square', 0.07), 400);
    setTimeout(() => generateTone(800, 0.1, 'square', 0.08), 550);
    setTimeout(() => generateTone(1000, 0.15, 'square', 0.1), 650);
  }, []);

  /**
   * Toggle audio on/off
   */
  const setEnabled = useCallback((enabled: boolean) => {
    enabledRef.current = enabled;
  }, []);

  return {
    playClick,
    playConfirm,
    playError,
    playTick,
    playBoot,
    setEnabled,
    isEnabled: () => enabledRef.current,
  };
}

export default useAudio;
