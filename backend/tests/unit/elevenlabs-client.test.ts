// ============================================================================
// ElevenLabs Client Tests - T006
// Unit tests for ElevenLabs API client
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock the config module
vi.mock("../../src/config/voice-config.js", () => ({
  getElevenLabsApiKey: vi.fn(() => "test-api-key"),
  DEFAULT_ELEVENLABS_MODEL: "eleven_turbo_v2",
  DEFAULT_OUTPUT_FORMAT: "mp3_44100_128",
  ELEVENLABS_API_BASE: "https://api.elevenlabs.io/v1",
  MAX_TEXT_LENGTH: 5000,
}));

import {
  synthesizeSpeech,
  transcribeSpeech,
  listVoices,
  getVoice,
  ElevenLabsError,
} from "../../src/services/elevenlabs-client.js";

describe("elevenlabs-client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("synthesizeSpeech", () => {
    it("should synthesize text to speech successfully", async () => {
      const mockAudioBuffer = new ArrayBuffer(1024);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockAudioBuffer),
        headers: new Headers({
          "content-type": "audio/mpeg",
        }),
      });

      const result = await synthesizeSpeech({
        text: "Hello, world!",
        voiceId: "test-voice-id",
      });

      expect(result.audioBuffer).toBeInstanceOf(Buffer);
      expect(result.audioBuffer.length).toBe(1024);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/text-to-speech/test-voice-id"),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "xi-api-key": "test-api-key",
            "Content-Type": "application/json",
          }),
        })
      );
    });

    it("should throw ElevenLabsError on API failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: () =>
          Promise.resolve({
            detail: { message: "Invalid API key" },
          }),
      });

      await expect(
        synthesizeSpeech({
          text: "Hello",
          voiceId: "test-voice-id",
        })
      ).rejects.toThrow(ElevenLabsError);
    });

    it("should include model and voice settings in request", async () => {
      const mockAudioBuffer = new ArrayBuffer(512);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockAudioBuffer),
        headers: new Headers(),
      });

      await synthesizeSpeech({
        text: "Test",
        voiceId: "voice-123",
        model: "eleven_multilingual_v2",
        stability: 0.7,
        similarityBoost: 0.8,
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.text).toBe("Test");
      expect(body.model_id).toBe("eleven_multilingual_v2");
      expect(body.voice_settings.stability).toBe(0.7);
      expect(body.voice_settings.similarity_boost).toBe(0.8);
    });

    it("should respect speed/rate parameter", async () => {
      const mockAudioBuffer = new ArrayBuffer(256);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockAudioBuffer),
        headers: new Headers(),
      });

      await synthesizeSpeech({
        text: "Fast speech",
        voiceId: "voice-123",
        speed: 1.5,
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.voice_settings.speed).toBe(1.5);
    });

    it("should throw on empty text", async () => {
      await expect(
        synthesizeSpeech({
          text: "",
          voiceId: "voice-123",
        })
      ).rejects.toThrow("Text is required");
    });

    it("should throw on text exceeding max length", async () => {
      const longText = "a".repeat(5001);

      await expect(
        synthesizeSpeech({
          text: longText,
          voiceId: "voice-123",
        })
      ).rejects.toThrow("exceeds maximum");
    });
  });

  describe("transcribeSpeech", () => {
    it("should transcribe audio successfully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            text: "Hello world",
            confidence: 0.95,
          }),
      });

      const audioBuffer = Buffer.from("fake-audio-data");
      const result = await transcribeSpeech({
        audio: audioBuffer,
        mimeType: "audio/webm",
      });

      expect(result.text).toBe("Hello world");
      expect(result.confidence).toBe(0.95);
    });

    it("should throw ElevenLabsError on transcription failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: () =>
          Promise.resolve({
            detail: { message: "Invalid audio format" },
          }),
      });

      const audioBuffer = Buffer.from("invalid-audio");
      await expect(
        transcribeSpeech({
          audio: audioBuffer,
          mimeType: "audio/invalid",
        })
      ).rejects.toThrow(ElevenLabsError);
    });

    it("should send audio as form data", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            text: "Transcribed text",
            confidence: 0.88,
          }),
      });

      const audioBuffer = Buffer.from("audio-bytes");
      await transcribeSpeech({
        audio: audioBuffer,
        mimeType: "audio/wav",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/speech-to-text"),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "xi-api-key": "test-api-key",
          }),
        })
      );
    });
  });

  describe("listVoices", () => {
    it("should list available voices", async () => {
      const mockVoices = {
        voices: [
          { voice_id: "voice-1", name: "Adam", category: "premade" },
          { voice_id: "voice-2", name: "Rachel", category: "premade" },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockVoices),
      });

      const voices = await listVoices();

      expect(voices).toHaveLength(2);
      expect(voices[0]).toEqual({
        voiceId: "voice-1",
        name: "Adam",
        category: "premade",
      });
    });

    it("should throw ElevenLabsError on failure", async () => {
      // Use 401 (non-retryable) to avoid retry delays in tests
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: () => Promise.resolve({ detail: { message: "Invalid API key" } }),
      });

      await expect(listVoices()).rejects.toThrow(ElevenLabsError);
    });
  });

  describe("getVoice", () => {
    it("should get a specific voice by ID", async () => {
      const mockVoice = {
        voice_id: "voice-123",
        name: "Test Voice",
        category: "cloned",
        labels: { accent: "american" },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockVoice),
      });

      const voice = await getVoice("voice-123");

      expect(voice.voiceId).toBe("voice-123");
      expect(voice.name).toBe("Test Voice");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/voices/voice-123"),
        expect.any(Object)
      );
    });

    it("should throw ElevenLabsError when voice not found", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: () =>
          Promise.resolve({
            detail: { message: "Voice not found" },
          }),
      });

      await expect(getVoice("nonexistent")).rejects.toThrow(ElevenLabsError);
    });
  });

  describe("ElevenLabsError", () => {
    it("should contain status code and message", () => {
      const error = new ElevenLabsError(401, "Unauthorized", "Invalid API key");

      expect(error.statusCode).toBe(401);
      expect(error.statusText).toBe("Unauthorized");
      expect(error.message).toContain("Invalid API key");
      expect(error.name).toBe("ElevenLabsError");
    });
  });
});
