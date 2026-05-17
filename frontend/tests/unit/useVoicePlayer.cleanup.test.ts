/**
 * Tests for adj-139.3.2: useVoicePlayer error-path cleanup.
 *
 * When audio.play() rejects, all six event listeners must be removed
 * before state moves to 'error', so the failed Audio element can be GC'd.
 */
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../../src/services/api', () => ({
  api: {
    voice: {
      synthesize: vi.fn(),
      getAudioUrl: vi.fn((filename: string) => `/api/voice/audio/${filename}`),
    },
  },
}));

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
  load: Mock;
  /** Fire all listeners for an event (mimics a real DOM event). */
  fire: (event: string) => void;
}

const createdAudios: AudioDouble[] = [];

function createAudioDouble(): AudioDouble {
  const listeners = new Map<string, Set<EventListener>>();
  const audio: AudioDouble = {
    listeners,
    src: '',
    volume: 1,
    paused: true,
    currentTime: 0,
    duration: 10,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    load: vi.fn(),
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
      const evt = new Event(event);
      Object.defineProperty(evt, 'target', { value: audio, writable: false });
      for (const fn of [...set]) {
        fn(evt);
      }
    },
  };
  return audio;
}

vi.stubGlobal('Audio', vi.fn(() => {
  const a = createAudioDouble();
  createdAudios.push(a);
  return a;
}));

import { useVoicePlayer } from '../../src/hooks/useVoicePlayer';
import { api } from '../../src/services/api';

describe('useVoicePlayer - error-path cleanup (adj-139.3.2)', () => {
  const mockSynthesize = api.voice.synthesize as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    createdAudios.length = 0;
    mockSynthesize.mockResolvedValue({
      success: true,
      data: { audioUrl: '/api/voice/audio/voice.mp3', duration: 5 },
    });
  });

  it('should remove all 6 listeners when audio.play() rejects', async () => {
    const { result } = renderHook(() => useVoicePlayer());

    // Make play() reject AFTER listeners are attached.
    let audioRef: AudioDouble | null = null;
    (global as unknown as { Audio: Mock }).Audio.mockImplementationOnce(() => {
      const a = createAudioDouble();
      a.play = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
      createdAudios.push(a);
      audioRef = a;
      return a;
    });

    await act(async () => {
      await result.current.play('hello world');
    });

    expect(audioRef).not.toBeNull();
    const audio = audioRef as unknown as AudioDouble;

    // All 6 listeners must have been removed.
    const eventNames = ['play', 'pause', 'timeupdate', 'ended', 'error', 'loadedmetadata'] as const;
    for (const evt of eventNames) {
      expect(audio.listeners.get(evt)?.size ?? 0).toBe(0);
    }

    // Hook state must reflect the error.
    await waitFor(() => {
      expect(result.current.state).toBe('error');
    });
  });

  it('should set audio.src to empty string on play() rejection (release source)', async () => {
    const { result } = renderHook(() => useVoicePlayer());

    let audioRef: AudioDouble | null = null;
    (global as unknown as { Audio: Mock }).Audio.mockImplementationOnce(() => {
      const a = createAudioDouble();
      a.play = vi.fn().mockRejectedValue(new Error('boom'));
      createdAudios.push(a);
      audioRef = a;
      return a;
    });

    await act(async () => {
      await result.current.play('hello');
    });

    expect(audioRef).not.toBeNull();
    const audio = audioRef as unknown as AudioDouble;
    expect(audio.src).toBe('');
  });

  it('should not retain listeners after multiple rejected plays', async () => {
    const { result } = renderHook(() => useVoicePlayer());

    for (let i = 0; i < 10; i++) {
      (global as unknown as { Audio: Mock }).Audio.mockImplementationOnce(() => {
        const a = createAudioDouble();
        a.play = vi.fn().mockRejectedValue(new Error(`fail-${i}`));
        createdAudios.push(a);
        return a;
      });

      await act(async () => {
        await result.current.play(`text-${i}`);
      });
    }

    // Every audio that was attached must have zero residual listeners.
    for (const audio of createdAudios) {
      const eventNames = ['play', 'pause', 'timeupdate', 'ended', 'error', 'loadedmetadata'] as const;
      for (const evt of eventNames) {
        expect(audio.listeners.get(evt)?.size ?? 0).toBe(0);
      }
    }
  });

  // adj-topfa: natural-completion ('ended' event) must invoke the same
  // cleanup path as the rejected-play branch — otherwise every completed
  // voice message leaks 6 listeners + decoded src until the next play.
  it('should remove all 6 listeners and clear src on natural ended event', async () => {
    const { result } = renderHook(() => useVoicePlayer());

    await act(async () => {
      await result.current.play('hello');
    });

    // After successful start, audio is created and listeners are attached.
    expect(createdAudios.length).toBe(1);
    const audio = createdAudios[0]!;
    const eventNames = ['play', 'pause', 'timeupdate', 'ended', 'error', 'loadedmetadata'] as const;

    // Sanity: listeners were attached.
    for (const evt of eventNames) {
      expect(audio.listeners.get(evt)?.size ?? 0).toBeGreaterThanOrEqual(1);
    }

    // Fire the natural 'ended' event.
    act(() => {
      audio.fire('ended');
    });

    await waitFor(() => {
      // All 6 listeners must be removed.
      for (const evt of eventNames) {
        expect(audio.listeners.get(evt)?.size ?? 0).toBe(0);
      }
    });
    // And the audio source must be released so the decoded buffer can be GC'd.
    expect(audio.src).toBe('');
  });

  it('should not retain listeners after multiple successful plays that end naturally', async () => {
    const { result } = renderHook(() => useVoicePlayer());

    for (let i = 0; i < 10; i++) {
      await act(async () => {
        await result.current.play(`text-${i}`);
      });

      const audio = createdAudios[i]!;
      act(() => {
        audio.fire('ended');
      });
    }

    // Every audio must have zero residual listeners after natural completion.
    const eventNames = ['play', 'pause', 'timeupdate', 'ended', 'error', 'loadedmetadata'] as const;
    for (const audio of createdAudios) {
      for (const evt of eventNames) {
        expect(audio.listeners.get(evt)?.size ?? 0).toBe(0);
      }
      expect(audio.src).toBe('');
    }
  });
});
