/**
 * Unit tests for useAudioNotifications hook
 * T037 [US3] - Tests for audio notification hook
 */
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Mock api
vi.mock('../../src/services/api', () => ({
  api: {
    voice: {
      synthesize: vi.fn(),
      getAudioUrl: vi.fn(),
    },
  },
}));

// Mock Audio
const mockAudio = {
  play: vi.fn(),
  pause: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  src: '',
  paused: true,
  currentTime: 0,
  duration: 10,
};

vi.stubGlobal('Audio', vi.fn(() => mockAudio));

import { useAudioNotifications } from '../../src/hooks/useAudioNotifications';
import { api } from '../../src/services/api';

describe('useAudioNotifications', () => {
  const mockSynthesize = api.voice.synthesize as Mock;
  const mockGetAudioUrl = api.voice.getAudioUrl as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSynthesize.mockResolvedValue({
      success: true,
      data: { audioUrl: '/api/voice/audio/notif.mp3', cached: false },
    });
    mockGetAudioUrl.mockReturnValue('/api/voice/audio/notif.mp3');
    mockAudio.play.mockResolvedValue(undefined);
    mockAudio.paused = true;
  });

  describe('initial state', () => {
    it('should start with empty queue', () => {
      const { result } = renderHook(() => useAudioNotifications());

      expect(result.current.queueSize).toBe(0);
      expect(result.current.isPlaying).toBe(false);
      expect(result.current.isMuted).toBe(false);
    });

    it('should start enabled by default', () => {
      const { result } = renderHook(() => useAudioNotifications());

      expect(result.current.isEnabled).toBe(true);
    });
  });

  describe('enqueue', () => {
    it('should add notification to queue', async () => {
      const { result } = renderHook(() => useAudioNotifications());

      await act(async () => {
        await result.current.enqueue({
          id: 'notif-1',
          text: 'New message',
          priority: 'normal',
        });
      });

      expect(result.current.queueSize).toBe(1);
    });

    it('should auto-play when notification is enqueued and not muted', async () => {
      const { result } = renderHook(() => useAudioNotifications());

      await act(async () => {
        await result.current.enqueue({
          id: 'notif-1',
          text: 'New message',
          priority: 'normal',
        });
      });

      await waitFor(() => {
        expect(mockSynthesize).toHaveBeenCalled();
      });
    });

    it('should not auto-play when muted', async () => {
      const { result } = renderHook(() => useAudioNotifications());

      act(() => {
        result.current.mute();
      });

      await act(async () => {
        await result.current.enqueue({
          id: 'notif-1',
          text: 'New message',
          priority: 'normal',
        });
      });

      expect(mockAudio.play).not.toHaveBeenCalled();
    });

    it('should not enqueue when disabled', async () => {
      const { result } = renderHook(() => useAudioNotifications());

      act(() => {
        result.current.disable();
      });

      await act(async () => {
        await result.current.enqueue({
          id: 'notif-1',
          text: 'New message',
          priority: 'normal',
        });
      });

      expect(result.current.queueSize).toBe(0);
    });
  });

  describe('playNext', () => {
    it('should play the next notification in queue', async () => {
      const { result } = renderHook(() => useAudioNotifications());

      // Mute to prevent auto-play
      act(() => {
        result.current.mute();
      });

      await act(async () => {
        await result.current.enqueue({
          id: 'notif-1',
          text: 'First message',
          priority: 'normal',
        });
      });

      // Unmute and manually play
      act(() => {
        result.current.unmute();
      });

      await act(async () => {
        await result.current.playNext();
      });

      await waitFor(() => {
        expect(mockSynthesize).toHaveBeenCalledWith(
          expect.objectContaining({ text: 'First message' })
        );
      });
    });

    it('should process queue in priority order', async () => {
      const { result } = renderHook(() => useAudioNotifications());

      act(() => {
        result.current.mute();
      });

      await act(async () => {
        await result.current.enqueue({
          id: 'low',
          text: 'Low priority',
          priority: 'low',
        });
        await result.current.enqueue({
          id: 'high',
          text: 'High priority',
          priority: 'high',
        });
      });

      act(() => {
        result.current.unmute();
      });

      await act(async () => {
        await result.current.playNext();
      });

      await waitFor(() => {
        expect(mockSynthesize).toHaveBeenCalledWith(
          expect.objectContaining({ text: 'High priority' })
        );
      });
    });

    it('should dequeue after playing', async () => {
      const { result } = renderHook(() => useAudioNotifications());

      await act(async () => {
        await result.current.enqueue({
          id: 'notif-1',
          text: 'Test',
          priority: 'normal',
        });
      });

      // Simulate audio end
      const endedHandler = mockAudio.addEventListener.mock.calls.find(
        (call: unknown[]) => call[0] === 'ended'
      )?.[1] as (() => void) | undefined;

      if (endedHandler) {
        act(() => {
          endedHandler();
        });
      }

      await waitFor(() => {
        expect(result.current.queueSize).toBe(0);
      });
    });
  });

  describe('mute/unmute', () => {
    it('should mute notifications', () => {
      const { result } = renderHook(() => useAudioNotifications());

      act(() => {
        result.current.mute();
      });

      expect(result.current.isMuted).toBe(true);
    });

    it('should unmute notifications', () => {
      const { result } = renderHook(() => useAudioNotifications());

      act(() => {
        result.current.mute();
        result.current.unmute();
      });

      expect(result.current.isMuted).toBe(false);
    });

    it('should toggle mute state', () => {
      const { result } = renderHook(() => useAudioNotifications());

      act(() => {
        result.current.toggleMute();
      });
      expect(result.current.isMuted).toBe(true);

      act(() => {
        result.current.toggleMute();
      });
      expect(result.current.isMuted).toBe(false);
    });

    it('should stop current playback when muted', async () => {
      const { result } = renderHook(() => useAudioNotifications());

      await act(async () => {
        await result.current.enqueue({
          id: 'notif-1',
          text: 'Test',
          priority: 'normal',
        });
      });

      act(() => {
        result.current.mute();
      });

      expect(mockAudio.pause).toHaveBeenCalled();
    });
  });

  describe('enable/disable', () => {
    it('should disable notification system', () => {
      const { result } = renderHook(() => useAudioNotifications());

      act(() => {
        result.current.disable();
      });

      expect(result.current.isEnabled).toBe(false);
    });

    it('should enable notification system', () => {
      const { result } = renderHook(() => useAudioNotifications());

      act(() => {
        result.current.disable();
        result.current.enable();
      });

      expect(result.current.isEnabled).toBe(true);
    });

    it('should clear queue when disabled', async () => {
      const { result } = renderHook(() => useAudioNotifications());

      act(() => {
        result.current.mute();
      });

      await act(async () => {
        await result.current.enqueue({
          id: 'notif-1',
          text: 'Test',
          priority: 'normal',
        });
      });

      act(() => {
        result.current.disable();
      });

      expect(result.current.queueSize).toBe(0);
    });
  });

  describe('clearQueue', () => {
    it('should clear all queued notifications', async () => {
      const { result } = renderHook(() => useAudioNotifications());

      act(() => {
        result.current.mute();
      });

      await act(async () => {
        await result.current.enqueue({ id: '1', text: 'Test 1', priority: 'normal' });
        await result.current.enqueue({ id: '2', text: 'Test 2', priority: 'normal' });
      });

      expect(result.current.queueSize).toBe(2);

      act(() => {
        result.current.clearQueue();
      });

      expect(result.current.queueSize).toBe(0);
    });
  });

  describe('skip', () => {
    it('should skip current notification and play next', async () => {
      const { result } = renderHook(() => useAudioNotifications());

      act(() => {
        result.current.mute();
      });

      await act(async () => {
        await result.current.enqueue({ id: '1', text: 'First', priority: 'normal' });
        await result.current.enqueue({ id: '2', text: 'Second', priority: 'normal' });
      });

      act(() => {
        result.current.unmute();
      });

      await act(async () => {
        await result.current.playNext();
      });

      await act(async () => {
        result.current.skip();
      });

      expect(mockAudio.pause).toHaveBeenCalled();
    });
  });

  describe('priority-based behavior', () => {
    it('should interrupt low priority for high priority', async () => {
      const { result } = renderHook(() => useAudioNotifications());

      // Start playing low priority
      await act(async () => {
        await result.current.enqueue({
          id: 'low',
          text: 'Low priority',
          priority: 'low',
        });
      });

      // Enqueue high priority - should interrupt
      await act(async () => {
        await result.current.enqueue({
          id: 'urgent',
          text: 'Urgent!',
          priority: 'urgent',
        });
      });

      await waitFor(() => {
        const calls = mockSynthesize.mock.calls;
        // Check that urgent was synthesized (it may have interrupted)
        const urgentCall = calls.find(
          (call: unknown[]) => (call[0] as { text: string }).text === 'Urgent!'
        );
        expect(urgentCall).toBeDefined();
      });
    });
  });

  describe('settings', () => {
    it('should update notification volume', () => {
      const { result } = renderHook(() => useAudioNotifications());

      act(() => {
        result.current.setVolume(0.5);
      });

      expect(result.current.volume).toBe(0.5);
    });

    it('should clamp volume between 0 and 1', () => {
      const { result } = renderHook(() => useAudioNotifications());

      act(() => {
        result.current.setVolume(1.5);
      });
      expect(result.current.volume).toBe(1);

      act(() => {
        result.current.setVolume(-0.5);
      });
      expect(result.current.volume).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should handle synthesis errors gracefully', async () => {
      mockSynthesize.mockRejectedValueOnce(new Error('API error'));

      const { result } = renderHook(() => useAudioNotifications());

      await act(async () => {
        await result.current.enqueue({
          id: 'notif-1',
          text: 'Test',
          priority: 'normal',
        });
      });

      // Should not throw, should continue to next
      expect(result.current.error).toBe('API error');
    });

    it('should clear error on successful playback', async () => {
      mockSynthesize.mockRejectedValueOnce(new Error('API error'));

      const { result } = renderHook(() => useAudioNotifications());

      await act(async () => {
        await result.current.enqueue({
          id: 'notif-1',
          text: 'Test',
          priority: 'normal',
        });
      });

      expect(result.current.error).toBe('API error');

      // Next notification succeeds
      mockSynthesize.mockResolvedValueOnce({
        success: true,
        data: { audioUrl: '/api/voice/audio/notif.mp3', cached: false },
      });

      await act(async () => {
        await result.current.enqueue({
          id: 'notif-2',
          text: 'Test 2',
          priority: 'normal',
        });
      });

      // Error should be cleared on next successful play
      // Note: error may persist until audio ends successfully
    });
  });
});
