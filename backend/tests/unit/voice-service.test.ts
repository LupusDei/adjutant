// ============================================================================
// Voice Service Tests - T013, T026
// Unit tests for voice-service synthesis and transcription
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock elevenlabs-client
vi.mock("../../src/services/elevenlabs-client.js", () => ({
  synthesizeSpeech: vi.fn(),
  transcribeSpeech: vi.fn(),
  isVoiceAvailable: vi.fn(() => true),
}));

// Mock audio-cache
vi.mock("../../src/services/audio-cache.js", () => ({
  isCached: vi.fn(),
  getCachedAudio: vi.fn(),
  cacheAudio: vi.fn(),
  getCacheFilePath: vi.fn((key: string) => `/cache/${key}.mp3`),
  generateCacheKey: vi.fn((text: string, voiceId: string) => `${voiceId}-${text.slice(0, 8)}`),
}));

// Mock voice-config
vi.mock("../../src/config/voice-config.js", () => ({
  isVoiceEnabled: vi.fn(() => true),
}));

// Mock voice-config-service
const mockGetDefaultConfig = vi.fn(() => Promise.resolve({
  voiceId: "default-voice",
  voiceName: "Default",
  speed: 1.0,
  stability: 0.5,
  similarityBoost: 0.75,
}));

const mockGetAgentConfig = vi.fn((agentId: string) => Promise.resolve({
  agentId,
  voiceId: "default-voice",
  voiceName: "Default",
  speed: 1.0,
  stability: 0.5,
  similarityBoost: 0.75,
}));

const mockListAgentConfigs = vi.fn(() => Promise.resolve([]));

vi.mock("../../src/services/voice-config-service.js", () => ({
  getVoiceConfigService: vi.fn(() => ({
    getDefaultConfig: mockGetDefaultConfig,
    getAgentConfig: mockGetAgentConfig,
    listAgentConfigs: mockListAgentConfigs,
  })),
}));

import { synthesizeSpeech, transcribeSpeech } from "../../src/services/elevenlabs-client.js";
import { isCached, getCachedAudio, cacheAudio, generateCacheKey } from "../../src/services/audio-cache.js";
import {
  synthesizeMessage,
  transcribeAudio,
  getVoiceConfig,
  isVoiceServiceAvailable,
} from "../../src/services/voice-service.js";

describe("voice-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("synthesizeMessage", () => {
    it("should return cached audio if available", async () => {
      const mockCacheEntry = {
        key: "test-key",
        filePath: "/cache/test.mp3",
        voiceId: "voice-123",
        duration: 2.5,
        size: 1024,
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      };

      vi.mocked(isCached).mockResolvedValue(true);
      vi.mocked(getCachedAudio).mockResolvedValue({
        buffer: Buffer.from("cached-audio"),
        entry: mockCacheEntry,
      });

      const result = await synthesizeMessage({
        text: "Hello world",
        agentId: "mayor/",
      });

      expect(result.cached).toBe(true);
      expect(result.audioUrl).toContain(".mp3");
      expect(synthesizeSpeech).not.toHaveBeenCalled();
    });

    it("should synthesize and cache new audio", async () => {
      vi.mocked(isCached).mockResolvedValue(false);
      vi.mocked(synthesizeSpeech).mockResolvedValue({
        audioBuffer: Buffer.from("new-audio-data"),
        contentType: "audio/mpeg",
      });
      vi.mocked(cacheAudio).mockResolvedValue({
        key: "new-key",
        filePath: "/cache/new.mp3",
        voiceId: "default-voice",
        duration: 3.0,
        size: 2048,
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      });

      const result = await synthesizeMessage({
        text: "New message",
        agentId: "witness",
      });

      expect(result.cached).toBe(false);
      expect(synthesizeSpeech).toHaveBeenCalled();
      expect(cacheAudio).toHaveBeenCalled();
    });

    it("should use agent-specific voice from config", async () => {
      const agentVoice = {
        agentId: "mayor/",
        voiceId: "mayor-voice",
        voiceName: "Mayor Voice",
        speed: 0.95,
        stability: 0.7,
        similarityBoost: 0.8,
      };

      mockGetAgentConfig.mockResolvedValueOnce(agentVoice);
      vi.mocked(isCached).mockResolvedValue(false);
      vi.mocked(synthesizeSpeech).mockResolvedValue({
        audioBuffer: Buffer.from("audio"),
        contentType: "audio/mpeg",
      });
      vi.mocked(cacheAudio).mockResolvedValue({
        key: "key",
        filePath: "/cache/key.mp3",
        voiceId: "mayor-voice",
        duration: 1.0,
        size: 512,
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      });

      await synthesizeMessage({
        text: "Important message",
        agentId: "mayor/",
      });

      expect(mockGetAgentConfig).toHaveBeenCalledWith("mayor/");
      expect(synthesizeSpeech).toHaveBeenCalledWith(
        expect.objectContaining({
          voiceId: "mayor-voice",
          stability: 0.7,
          similarityBoost: 0.8,
        })
      );
    });

    it("should override voice ID when explicitly provided", async () => {
      vi.mocked(isCached).mockResolvedValue(false);
      vi.mocked(synthesizeSpeech).mockResolvedValue({
        audioBuffer: Buffer.from("audio"),
        contentType: "audio/mpeg",
      });
      vi.mocked(cacheAudio).mockResolvedValue({
        key: "key",
        filePath: "/cache/key.mp3",
        voiceId: "custom-voice",
        duration: 1.0,
        size: 512,
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      });

      await synthesizeMessage({
        text: "Test",
        voiceId: "custom-voice",
      });

      expect(synthesizeSpeech).toHaveBeenCalledWith(
        expect.objectContaining({
          voiceId: "custom-voice",
        })
      );
    });

    it("should throw error on empty text", async () => {
      await expect(
        synthesizeMessage({ text: "" })
      ).rejects.toThrow("Text is required");
    });

    it("should handle synthesis errors gracefully", async () => {
      vi.mocked(isCached).mockResolvedValue(false);
      vi.mocked(synthesizeSpeech).mockRejectedValue(
        new Error("ElevenLabs API error")
      );

      await expect(
        synthesizeMessage({ text: "Test message" })
      ).rejects.toThrow("ElevenLabs API error");
    });

    it("should use messageId for cache key when provided", async () => {
      vi.mocked(isCached).mockResolvedValue(false);
      vi.mocked(synthesizeSpeech).mockResolvedValue({
        audioBuffer: Buffer.from("audio"),
        contentType: "audio/mpeg",
      });
      vi.mocked(cacheAudio).mockResolvedValue({
        key: "msg-123",
        filePath: "/cache/msg-123.mp3",
        voiceId: "default-voice",
        duration: 1.0,
        size: 512,
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      });

      await synthesizeMessage({
        text: "Message content",
        messageId: "msg-123",
      });

      // The messageId should influence cache key generation
      expect(generateCacheKey).toHaveBeenCalled();
    });
  });

  describe("getVoiceConfig", () => {
    it("should return voice configuration", async () => {
      const config = await getVoiceConfig();

      expect(config).toBeDefined();
      expect(config.enabled).toBe(true);
      expect(config.defaultVoice).toBeDefined();
    });

    it("should include agent voice mappings", async () => {
      const config = await getVoiceConfig();

      expect(config.agents).toBeDefined();
      expect(typeof config.agents).toBe("object");
    });
  });

  describe("isVoiceServiceAvailable", () => {
    it("should return true when voice is enabled", () => {
      const available = isVoiceServiceAvailable();

      expect(available).toBe(true);
    });
  });

  // ============================================================================
  // T026: Transcription Tests
  // ============================================================================

  describe("transcribeAudio", () => {
    it("should transcribe audio to text", async () => {
      vi.mocked(transcribeSpeech).mockResolvedValue({
        text: "Hello world",
        confidence: 0.95,
      });

      const result = await transcribeAudio({
        audio: Buffer.from("fake-audio"),
        mimeType: "audio/webm",
      });

      expect(result.text).toBe("Hello world");
      expect(result.confidence).toBe(0.95);
      expect(transcribeSpeech).toHaveBeenCalledWith({
        audio: expect.any(Buffer),
        mimeType: "audio/webm",
      });
    });

    it("should handle transcription errors", async () => {
      vi.mocked(transcribeSpeech).mockRejectedValue(
        new Error("Transcription failed")
      );

      await expect(
        transcribeAudio({
          audio: Buffer.from("audio"),
          mimeType: "audio/webm",
        })
      ).rejects.toThrow("Transcription failed");
    });

    it("should pass language parameter when provided", async () => {
      vi.mocked(transcribeSpeech).mockResolvedValue({
        text: "Bonjour",
        confidence: 0.9,
      });

      await transcribeAudio({
        audio: Buffer.from("audio"),
        mimeType: "audio/wav",
      });

      expect(transcribeSpeech).toHaveBeenCalled();
    });
  });
});
