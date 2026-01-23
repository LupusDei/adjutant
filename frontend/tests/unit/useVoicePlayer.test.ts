// ============================================================================
// useVoicePlayer Hook Tests - T014
// Unit tests for voice playback hook
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// Mock the API
vi.mock("../../src/services/api", () => ({
  api: {
    voice: {
      synthesize: vi.fn(),
      getAudioUrl: vi.fn((filename: string) => `/api/voice/audio/${filename}`),
    },
  },
}));

// Mock HTMLAudioElement
const mockAudio = {
  play: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn(),
  load: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  currentTime: 0,
  duration: 10,
  paused: true,
  src: "",
};

vi.stubGlobal("Audio", vi.fn(() => mockAudio));

import { useVoicePlayer } from "../../src/hooks/useVoicePlayer";
import { api } from "../../src/services/api";

describe("useVoicePlayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAudio.currentTime = 0;
    mockAudio.duration = 10;
    mockAudio.paused = true;
    mockAudio.src = "";
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("initial state", () => {
    it("should start in idle state", () => {
      const { result } = renderHook(() => useVoicePlayer());

      expect(result.current.state).toBe("idle");
      expect(result.current.isPlaying).toBe(false);
      expect(result.current.progress).toBe(0);
      expect(result.current.error).toBeNull();
    });

    it("should not be loading initially", () => {
      const { result } = renderHook(() => useVoicePlayer());

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe("play", () => {
    it("should synthesize and play audio", async () => {
      vi.mocked(api.voice.synthesize).mockResolvedValue({
        success: true,
        data: {
          audioUrl: "/api/voice/audio/test.mp3",
          duration: 5.0,
          cached: false,
          voiceId: "voice-123",
        },
      });

      const { result } = renderHook(() => useVoicePlayer());

      await act(async () => {
        await result.current.play("Hello world", "mayor/");
      });

      expect(api.voice.synthesize).toHaveBeenCalledWith({
        text: "Hello world",
        agentId: "mayor/",
      });
      expect(mockAudio.play).toHaveBeenCalled();
    });

    it("should set loading state while synthesizing", async () => {
      let resolvePromise: (value: unknown) => void;
      const synthPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      vi.mocked(api.voice.synthesize).mockReturnValue(synthPromise as ReturnType<typeof api.voice.synthesize>);

      const { result } = renderHook(() => useVoicePlayer());

      act(() => {
        result.current.play("Test", "agent");
      });

      expect(result.current.isLoading).toBe(true);
      expect(result.current.state).toBe("loading");

      await act(async () => {
        resolvePromise!({
          success: true,
          data: { audioUrl: "/test.mp3", duration: 1, cached: false, voiceId: "v" },
        });
        await synthPromise;
      });
    });

    it("should set playing state after audio starts", async () => {
      vi.mocked(api.voice.synthesize).mockResolvedValue({
        success: true,
        data: { audioUrl: "/test.mp3", duration: 5, cached: false, voiceId: "v" },
      });

      const { result } = renderHook(() => useVoicePlayer());

      await act(async () => {
        await result.current.play("Test", "agent");
      });

      // Simulate audio playing
      mockAudio.paused = false;
      const playHandler = mockAudio.addEventListener.mock.calls.find(
        (call) => call[0] === "play"
      );
      if (playHandler) {
        act(() => playHandler[1]());
      }

      expect(result.current.isPlaying).toBe(true);
      expect(result.current.state).toBe("playing");
    });

    it("should handle synthesis error", async () => {
      vi.mocked(api.voice.synthesize).mockResolvedValue({
        success: false,
        error: { code: "SYNTHESIS_FAILED", message: "API error" },
      });

      const { result } = renderHook(() => useVoicePlayer());

      await act(async () => {
        await result.current.play("Test", "agent");
      });

      expect(result.current.state).toBe("error");
      expect(result.current.error).toBe("API error");
    });

    it("should handle network error", async () => {
      vi.mocked(api.voice.synthesize).mockRejectedValue(new Error("Network error"));

      const { result } = renderHook(() => useVoicePlayer());

      await act(async () => {
        await result.current.play("Test", "agent");
      });

      expect(result.current.state).toBe("error");
      expect(result.current.error).toContain("Network error");
    });
  });

  describe("pause", () => {
    it("should pause playing audio", async () => {
      vi.mocked(api.voice.synthesize).mockResolvedValue({
        success: true,
        data: { audioUrl: "/test.mp3", duration: 5, cached: false, voiceId: "v" },
      });

      const { result } = renderHook(() => useVoicePlayer());

      await act(async () => {
        await result.current.play("Test", "agent");
      });

      // Simulate audio is playing (not paused)
      mockAudio.paused = false;

      act(() => {
        result.current.pause();
      });

      expect(mockAudio.pause).toHaveBeenCalled();
    });

    it("should set paused state", async () => {
      vi.mocked(api.voice.synthesize).mockResolvedValue({
        success: true,
        data: { audioUrl: "/test.mp3", duration: 5, cached: false, voiceId: "v" },
      });

      const { result } = renderHook(() => useVoicePlayer());

      await act(async () => {
        await result.current.play("Test", "agent");
      });

      // Simulate pause event
      const pauseHandler = mockAudio.addEventListener.mock.calls.find(
        (call) => call[0] === "pause"
      );
      if (pauseHandler) {
        act(() => pauseHandler[1]());
      }

      expect(result.current.state).toBe("paused");
    });
  });

  describe("stop", () => {
    it("should stop and reset audio", async () => {
      vi.mocked(api.voice.synthesize).mockResolvedValue({
        success: true,
        data: { audioUrl: "/test.mp3", duration: 5, cached: false, voiceId: "v" },
      });

      const { result } = renderHook(() => useVoicePlayer());

      await act(async () => {
        await result.current.play("Test", "agent");
      });

      act(() => {
        result.current.stop();
      });

      expect(mockAudio.pause).toHaveBeenCalled();
      expect(result.current.state).toBe("idle");
      expect(result.current.progress).toBe(0);
    });
  });

  describe("progress tracking", () => {
    it("should update progress during playback", async () => {
      vi.mocked(api.voice.synthesize).mockResolvedValue({
        success: true,
        data: { audioUrl: "/test.mp3", duration: 10, cached: false, voiceId: "v" },
      });

      const { result } = renderHook(() => useVoicePlayer());

      await act(async () => {
        await result.current.play("Test", "agent");
      });

      // Simulate timeupdate event
      mockAudio.currentTime = 5;
      const timeUpdateHandler = mockAudio.addEventListener.mock.calls.find(
        (call) => call[0] === "timeupdate"
      );
      if (timeUpdateHandler) {
        act(() => timeUpdateHandler[1]());
      }

      expect(result.current.progress).toBe(50); // 5/10 * 100
    });

    it("should return duration from audio", async () => {
      vi.mocked(api.voice.synthesize).mockResolvedValue({
        success: true,
        data: { audioUrl: "/test.mp3", duration: 15, cached: false, voiceId: "v" },
      });

      const { result } = renderHook(() => useVoicePlayer());

      await act(async () => {
        await result.current.play("Test", "agent");
      });

      expect(result.current.duration).toBe(15);
    });
  });

  describe("ended event", () => {
    it("should reset state when audio ends", async () => {
      vi.mocked(api.voice.synthesize).mockResolvedValue({
        success: true,
        data: { audioUrl: "/test.mp3", duration: 5, cached: false, voiceId: "v" },
      });

      const { result } = renderHook(() => useVoicePlayer());

      await act(async () => {
        await result.current.play("Test", "agent");
      });

      // Simulate ended event
      const endedHandler = mockAudio.addEventListener.mock.calls.find(
        (call) => call[0] === "ended"
      );
      if (endedHandler) {
        act(() => endedHandler[1]());
      }

      expect(result.current.state).toBe("idle");
      expect(result.current.progress).toBe(0);
    });
  });

  describe("cleanup", () => {
    it("should clean up event listeners on unmount", async () => {
      vi.mocked(api.voice.synthesize).mockResolvedValue({
        success: true,
        data: { audioUrl: "/test.mp3", duration: 5, cached: false, voiceId: "v" },
      });

      const { result, unmount } = renderHook(() => useVoicePlayer());

      await act(async () => {
        await result.current.play("Test", "agent");
      });

      unmount();

      expect(mockAudio.removeEventListener).toHaveBeenCalled();
      expect(mockAudio.pause).toHaveBeenCalled();
    });
  });
});
