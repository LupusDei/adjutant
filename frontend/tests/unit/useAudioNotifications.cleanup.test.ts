/**
 * Tests for adj-139.3.1: useAudioNotifications listener cleanup.
 *
 * Verifies that after a notification ends (or errors), the Audio element
 * has no residual event listeners and its src is cleared, so the Audio
 * object can be garbage collected.
 */
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../../src/services/api', () => ({
  api: {
    voice: {
      synthesize: vi.fn(),
      getAudioUrl: vi.fn(),
    },
  },
}));

/**
 * Test double for HTMLAudioElement that tracks listener registrations.
 * Each Audio instance gets its own listener map so we can assert per-instance
 * cleanup.
 */
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
      // Copy to allow handlers to mutate the set during iteration
      for (const fn of [...set]) {
        fn(new Event(event));
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

import { useAudioNotifications } from '../../src/hooks/useAudioNotifications';
import { api } from '../../src/services/api';

describe('useAudioNotifications - cleanup (adj-139.3.1)', () => {
  const mockSynthesize = api.voice.synthesize as Mock;
  const mockGetAudioUrl = api.voice.getAudioUrl as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    createdAudios.length = 0;
    mockSynthesize.mockResolvedValue({
      success: true,
      data: { audioUrl: '/api/voice/audio/notif.mp3', cached: false },
    });
    mockGetAudioUrl.mockReturnValue('/api/voice/audio/notif.mp3');
  });

  it('should remove all event listeners after notification ends', async () => {
    const { result } = renderHook(() => useAudioNotifications());

    await act(async () => {
      await result.current.enqueue({
        id: 'notif-1',
        text: 'Test notification',
        priority: 'normal',
      });
    });

    await waitFor(() => {
      expect(createdAudios.length).toBe(1);
    });
    const audio = createdAudios[0]!;

    // Sanity: we registered listeners.
    expect(audio.listeners.get('ended')?.size).toBe(1);
    expect(audio.listeners.get('error')?.size).toBe(1);

    // Fire 'ended' (simulates audio finishing).
    act(() => {
      audio.fire('ended');
    });

    await waitFor(() => {
      // Both listeners should have been removed.
      expect(audio.listeners.get('ended')?.size ?? 0).toBe(0);
      expect(audio.listeners.get('error')?.size ?? 0).toBe(0);
    });
  });

  it('should remove all event listeners after error event', async () => {
    const { result } = renderHook(() => useAudioNotifications());

    await act(async () => {
      await result.current.enqueue({
        id: 'notif-err',
        text: 'Will error',
        priority: 'normal',
      });
    });

    await waitFor(() => {
      expect(createdAudios.length).toBe(1);
    });
    const audio = createdAudios[0]!;

    act(() => {
      audio.fire('error');
    });

    await waitFor(() => {
      expect(audio.listeners.get('ended')?.size ?? 0).toBe(0);
      expect(audio.listeners.get('error')?.size ?? 0).toBe(0);
    });
  });

  it('should clear audio.src on ended to release the audio source', async () => {
    const { result } = renderHook(() => useAudioNotifications());

    await act(async () => {
      await result.current.enqueue({
        id: 'notif-src',
        text: 'src test',
        priority: 'normal',
      });
    });

    await waitFor(() => {
      expect(createdAudios.length).toBe(1);
    });
    const audio = createdAudios[0]!;

    act(() => {
      audio.fire('ended');
    });

    await waitFor(() => {
      expect(audio.src).toBe('');
    });
  });

  it('should call pause() in the ended handler to free decode resources', async () => {
    const { result } = renderHook(() => useAudioNotifications());

    await act(async () => {
      await result.current.enqueue({
        id: 'notif-pause',
        text: 'pause test',
        priority: 'normal',
      });
    });

    await waitFor(() => {
      expect(createdAudios.length).toBe(1);
    });
    const audio = createdAudios[0]!;
    audio.pause.mockClear();

    act(() => {
      audio.fire('ended');
    });

    expect(audio.pause).toHaveBeenCalled();
  });

  it('should not retain listeners across 50 sequential notifications', async () => {
    const { result } = renderHook(() => useAudioNotifications());

    for (let i = 0; i < 50; i++) {
      // Use mute to control playback timing precisely.
      await act(async () => {
        await result.current.enqueue({
          id: `notif-${i}`,
          text: `n${i}`,
          priority: 'normal',
        });
      });

      // Wait for the new audio object to exist.
      await waitFor(() => {
        expect(createdAudios.length).toBeGreaterThanOrEqual(i + 1);
      });

      const audio = createdAudios[i]!;
      act(() => {
        audio.fire('ended');
      });
    }

    // After all 50 finished, every Audio should have zero residual listeners.
    for (const audio of createdAudios) {
      expect(audio.listeners.get('ended')?.size ?? 0).toBe(0);
      expect(audio.listeners.get('error')?.size ?? 0).toBe(0);
      expect(audio.src).toBe('');
    }
  });

  it('should clean up current audio on hook unmount', async () => {
    const { result, unmount } = renderHook(() => useAudioNotifications());

    await act(async () => {
      await result.current.enqueue({
        id: 'notif-unmount',
        text: 'unmount test',
        priority: 'normal',
      });
    });

    await waitFor(() => {
      expect(createdAudios.length).toBe(1);
    });
    const audio = createdAudios[0]!;
    audio.pause.mockClear();

    unmount();

    // Unmount must pause + clean the audio.
    expect(audio.pause).toHaveBeenCalled();
    expect(audio.listeners.get('ended')?.size ?? 0).toBe(0);
    expect(audio.listeners.get('error')?.size ?? 0).toBe(0);
    expect(audio.src).toBe('');
  });
});
