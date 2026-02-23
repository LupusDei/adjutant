// ============================================================================
// useVoiceInput Hook Tests - T027
// Unit tests for voice input/recording hook
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// Polyfill Blob.arrayBuffer for jsdom using FileReader
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function(): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(reader.result);
        } else {
          reject(new Error('Failed to read blob as ArrayBuffer'));
        }
      };
      reader.onerror = () => { reject(reader.error ?? new Error('FileReader error')); };
      reader.readAsArrayBuffer(this);
    });
  };
}

// Mock the API
vi.mock("../../src/services/api", () => ({
  api: {
    voice: {
      transcribe: vi.fn(),
    },
  },
}));

// Mock MediaRecorder - create fresh instance per test via factory
const createMockMediaRecorder = () => {
  const recorder: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    ondataavailable: ((event: { data: Blob }) => void) | null;
    onstop: (() => void) | null;
    onerror: ((event: { error: Error }) => void) | null;
    state: "inactive" | "recording" | "paused";
    mimeType: string;
  } = {
    start: vi.fn(),
    stop: vi.fn(),
    ondataavailable: null,
    onstop: null,
    onerror: null,
    state: "inactive",
    mimeType: "audio/webm",
  };

  return recorder;
};

type MockMediaRecorderType = ReturnType<typeof createMockMediaRecorder>;
let mockMediaRecorder: MockMediaRecorderType;

const MockMediaRecorder = vi.fn(() => {
  return mockMediaRecorder;
}) as unknown as {
  new (stream: MediaStream, options?: MediaRecorderOptions): MockMediaRecorderType;
  isTypeSupported: ReturnType<typeof vi.fn>;
};
MockMediaRecorder.isTypeSupported = vi.fn().mockReturnValue(true);
vi.stubGlobal("MediaRecorder", MockMediaRecorder);

// Mock navigator.mediaDevices
const mockGetUserMedia = vi.fn();
vi.stubGlobal("navigator", {
  mediaDevices: {
    getUserMedia: mockGetUserMedia,
  },
});

import { useVoiceInput } from "../../src/hooks/useVoiceInput";
import { api } from "../../src/services/api";

describe("useVoiceInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Create fresh mock instance for each test
    mockMediaRecorder = createMockMediaRecorder();

    // Reset API mock
    vi.mocked(api.voice.transcribe).mockReset();

    // Mock successful getUserMedia
    mockGetUserMedia.mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("initial state", () => {
    it("should start in idle state", () => {
      const { result } = renderHook(() => useVoiceInput());

      expect(result.current.state).toBe("idle");
      expect(result.current.isRecording).toBe(false);
      expect(result.current.transcript).toBe("");
      expect(result.current.error).toBeNull();
    });
  });

  describe("startRecording", () => {
    it("should request microphone access", async () => {
      const { result } = renderHook(() => useVoiceInput());

      await act(async () => {
        await result.current.startRecording();
      });

      expect(mockGetUserMedia).toHaveBeenCalledWith({
        audio: true,
      });
    });

    it("should start MediaRecorder", async () => {
      const { result } = renderHook(() => useVoiceInput());

      await act(async () => {
        await result.current.startRecording();
      });

      expect(mockMediaRecorder.start).toHaveBeenCalled();
      expect(result.current.state).toBe("recording");
      expect(result.current.isRecording).toBe(true);
    });

    it("should handle microphone permission denied", async () => {
      mockGetUserMedia.mockRejectedValue(new Error("Permission denied"));

      const { result } = renderHook(() => useVoiceInput());

      await act(async () => {
        await result.current.startRecording();
      });

      expect(result.current.state).toBe("error");
      expect(result.current.error).toContain("Permission denied");
    });
  });

  describe("stopRecording", () => {
    it("should stop MediaRecorder and transcribe", async () => {
      vi.mocked(api.voice.transcribe).mockResolvedValue({
        success: true,
        data: { text: "Hello world", confidence: 0.95 },
      });

      const { result } = renderHook(() => useVoiceInput());

      await act(async () => {
        await result.current.startRecording();
      });

      mockMediaRecorder.state = "recording";

      await act(async () => {
        result.current.stopRecording();
      });

      expect(mockMediaRecorder.stop).toHaveBeenCalled();

      // Simulate MediaRecorder events
      const audioBlob = new Blob(["audio-data"], { type: "audio/webm" });
      await act(async () => {
        mockMediaRecorder.ondataavailable?.({ data: audioBlob });
        mockMediaRecorder.onstop?.();
      });

      // Wait for async transcription to complete
      await waitFor(() => {
        expect(result.current.state).toBe("idle");
      });

      expect(result.current.transcript).toBe("Hello world");
    });

    it("should set processing state while transcribing", async () => {
      let resolveTranscribe: (value: unknown) => void;
      const transcribePromise = new Promise((resolve) => {
        resolveTranscribe = resolve;
      });
      vi.mocked(api.voice.transcribe).mockReturnValue(
        transcribePromise as ReturnType<typeof api.voice.transcribe>
      );

      const { result } = renderHook(() => useVoiceInput());

      await act(async () => {
        await result.current.startRecording();
      });

      mockMediaRecorder.state = "recording";

      await act(async () => {
        result.current.stopRecording();
      });

      // Simulate MediaRecorder events
      const audioBlob = new Blob(["data"], { type: "audio/webm" });
      await act(async () => {
        mockMediaRecorder.ondataavailable?.({ data: audioBlob });
        mockMediaRecorder.onstop?.();
      });

      // Wait for processing state
      await waitFor(() => {
        expect(result.current.state).toBe("processing");
      });

      // Now resolve the transcription
      await act(async () => {
        resolveTranscribe!({
          success: true,
          data: { text: "Test", confidence: 0.9 },
        });
      });

      // Wait for completion
      await waitFor(() => {
        expect(result.current.state).toBe("idle");
      });
    });

    it("should handle transcription errors", async () => {
      vi.mocked(api.voice.transcribe).mockResolvedValue({
        success: false,
        error: { code: "TRANSCRIPTION_FAILED", message: "API error" },
      });

      const { result } = renderHook(() => useVoiceInput());

      await act(async () => {
        await result.current.startRecording();
      });

      mockMediaRecorder.state = "recording";

      await act(async () => {
        result.current.stopRecording();
      });

      const audioBlob = new Blob(["data"], { type: "audio/webm" });
      await act(async () => {
        mockMediaRecorder.ondataavailable?.({ data: audioBlob });
        mockMediaRecorder.onstop?.();
      });

      // Wait for error state
      await waitFor(() => {
        expect(result.current.state).toBe("error");
      });

      expect(result.current.error).toBe("API error");
    });
  });

  describe("cancelRecording", () => {
    it("should cancel without transcribing", async () => {
      const { result } = renderHook(() => useVoiceInput());

      await act(async () => {
        await result.current.startRecording();
      });

      mockMediaRecorder.state = "recording";

      await act(async () => {
        result.current.cancelRecording();
        // Trigger onstop - the hook will check isCancelledRef and skip transcription
        mockMediaRecorder.onstop?.();
      });

      expect(mockMediaRecorder.stop).toHaveBeenCalled();
      expect(api.voice.transcribe).not.toHaveBeenCalled();
      expect(result.current.state).toBe("idle");
    });
  });

  describe("clearTranscript", () => {
    it("should clear the transcript", async () => {
      vi.mocked(api.voice.transcribe).mockResolvedValue({
        success: true,
        data: { text: "Some text", confidence: 0.9 },
      });

      const { result } = renderHook(() => useVoiceInput());

      await act(async () => {
        await result.current.startRecording();
      });

      mockMediaRecorder.state = "recording";

      await act(async () => {
        result.current.stopRecording();
        mockMediaRecorder.ondataavailable?.({
          data: new Blob(["data"], { type: "audio/webm" }),
        });
        mockMediaRecorder.onstop?.();
      });

      // Wait for transcription to complete
      await waitFor(() => {
        expect(result.current.transcript).toBe("Some text");
      });

      act(() => {
        result.current.clearTranscript();
      });

      expect(result.current.transcript).toBe("");
    });
  });

  describe("cleanup", () => {
    it("should stop recording on unmount", async () => {
      const mockTrack = { stop: vi.fn() };
      mockGetUserMedia.mockResolvedValue({
        getTracks: () => [mockTrack],
      });

      const { result, unmount } = renderHook(() => useVoiceInput());

      await act(async () => {
        await result.current.startRecording();
      });

      unmount();

      expect(mockTrack.stop).toHaveBeenCalled();
    });
  });
});
