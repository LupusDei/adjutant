/**
 * Tests for adj-139.3.3: useMobileAudio src clearing.
 *
 * After 'ended' or 'error' fires, the shared audio element's src is cleared
 * so the decoded buffer is released. (The element itself is reused — this is
 * the singleton pattern in useMobileAudio.)
 */
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';

interface AudioDouble {
  listeners: Map<string, Set<EventListener>>;
  src: string;
  volume: number;
  paused: boolean;
  currentTime: number;
  duration: number;
  play: Mock;
  pause: Mock;
  addEventListener: Mock;
  removeEventListener: Mock;
  setAttribute: Mock;
  preload: string;
  error: { code: number; message: string } | null;
  fire: (event: string) => void;
}

function createAudioDouble(): AudioDouble {
  const listeners = new Map<string, Set<EventListener>>();
  const audio: AudioDouble = {
    listeners,
    src: '',
    volume: 1,
    paused: true,
    currentTime: 0,
    duration: 10,
    preload: 'auto',
    error: null,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    setAttribute: vi.fn(),
    addEventListener: vi.fn((event: string, listener: EventListener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    }),
    removeEventListener: vi.fn((event: string, listener: EventListener) => {
      listeners.get(event)?.delete(listener);
    }),
    fire: (event: string) => {
      const set = listeners.get(event);
      if (!set) return;
      // Construct an Event whose target points to this audio double so
      // handlers that read e.target.error etc. don't NPE.
      const evt = new Event(event);
      Object.defineProperty(evt, 'target', { value: audio, writable: false });
      for (const fn of [...set]) {
        fn(evt);
      }
    },
  };
  return audio;
}

// One shared mock for the whole file — the hook uses a module-level singleton,
// so we want one Audio object across all tests too.
const mockAudio = createAudioDouble();
vi.stubGlobal('Audio', vi.fn(() => mockAudio));

import { useMobileAudio } from '../../src/hooks/useMobileAudio';

describe('useMobileAudio - src clearing (adj-139.3.3)', () => {
  beforeEach(() => {
    mockAudio.src = '';
    mockAudio.paused = true;
    mockAudio.currentTime = 0;
    mockAudio.listeners.clear();
    mockAudio.play.mockClear();
    mockAudio.play.mockResolvedValue(undefined);
    mockAudio.pause.mockClear();
  });

  it('should clear audio.src after the ended event fires', async () => {
    const { result } = renderHook(() => useMobileAudio());

    // Kick off playback. play() returns a Promise that resolves on 'ended',
    // so we don't await it — we only need src to be set.
    await act(async () => {
      result.current.play('/api/voice/audio/test.mp3', 0.8).catch(() => undefined);
    });

    expect(mockAudio.src).toBe('/api/voice/audio/test.mp3');

    act(() => {
      mockAudio.fire('ended');
    });

    expect(mockAudio.src).toBe('');
  });

  it('should clear audio.src after the error event fires', async () => {
    const { result } = renderHook(() => useMobileAudio());

    await act(async () => {
      result.current.play('/api/voice/audio/bad.mp3').catch(() => undefined);
    });

    expect(mockAudio.src).toBe('/api/voice/audio/bad.mp3');

    act(() => {
      mockAudio.fire('error');
    });

    expect(mockAudio.src).toBe('');
  });

  it('should set isPlaying false and clear src when ended fires', async () => {
    const { result } = renderHook(() => useMobileAudio());

    await act(async () => {
      result.current.play('/api/voice/audio/order.mp3').catch(() => undefined);
    });

    // Allow the play().then(setIsPlaying(true)) microtask to run.
    await act(async () => { await Promise.resolve(); });

    act(() => {
      mockAudio.fire('ended');
    });

    expect(result.current.isPlaying).toBe(false);
    expect(mockAudio.src).toBe('');
  });

  // adj-fwywd + adj-139.3.3.P: when audio.play() rejects (before any
  // 'error' DOM event), the catch handler removes listeners but used to
  // leave audio.src set. Because the audio element is a singleton, the
  // failed URL stayed bound. Must also clear src on play()-rejection.
  it('should clear audio.src when play() rejects before any event fires', async () => {
    mockAudio.play.mockClear();
    mockAudio.play.mockRejectedValueOnce(new Error('NotAllowedError'));

    const { result } = renderHook(() => useMobileAudio());

    let caught: unknown = null;
    await act(async () => {
      try {
        await result.current.play('/api/voice/audio/blocked.mp3');
      } catch (err) {
        caught = err;
      }
    });

    expect(caught).toBeInstanceOf(Error);
    expect(mockAudio.src).toBe('');
  });
});
