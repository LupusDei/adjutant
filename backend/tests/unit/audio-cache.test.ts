// ============================================================================
// Audio Cache Tests - T010
// Unit tests for audio cache service
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Set up test cache directory before importing the module
const TEST_CACHE_DIR = join(tmpdir(), `audio-cache-test-${Date.now()}`);
process.env["AUDIO_CACHE_DIR"] = TEST_CACHE_DIR;

import {
  generateCacheKey,
  getCacheFilename,
  getCacheFilePath,
  getCacheDir,
  resetCacheDir,
  isCached,
  getCachedAudio,
  cacheAudio,
  removeCachedAudio,
  cleanupCache,
  getCacheStats,
  clearCache,
} from "../../src/services/audio-cache.js";

describe("audio-cache", () => {
  beforeEach(() => {
    // Reset cache state before each test
    resetCacheDir();

    // Ensure test directory exists
    if (!existsSync(TEST_CACHE_DIR)) {
      mkdirSync(TEST_CACHE_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test directory
    try {
      if (existsSync(TEST_CACHE_DIR)) {
        rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("generateCacheKey", () => {
    it("should generate consistent keys for same input", () => {
      const key1 = generateCacheKey("Hello world", "voice-123");
      const key2 = generateCacheKey("Hello world", "voice-123");

      expect(key1).toBe(key2);
    });

    it("should generate different keys for different text", () => {
      const key1 = generateCacheKey("Hello", "voice-123");
      const key2 = generateCacheKey("Goodbye", "voice-123");

      expect(key1).not.toBe(key2);
    });

    it("should generate different keys for different voices", () => {
      const key1 = generateCacheKey("Hello", "voice-123");
      const key2 = generateCacheKey("Hello", "voice-456");

      expect(key1).not.toBe(key2);
    });

    it("should return a 16-character hex string", () => {
      const key = generateCacheKey("Test text", "voice-id");

      expect(key).toMatch(/^[a-f0-9]{16}$/);
    });
  });

  describe("getCacheFilename", () => {
    it("should return filename with .mp3 extension", () => {
      const filename = getCacheFilename("abc123");

      expect(filename).toBe("abc123.mp3");
    });
  });

  describe("getCacheFilePath", () => {
    it("should return full path to cache file", () => {
      const path = getCacheFilePath("abc123");

      expect(path).toContain("abc123.mp3");
      expect(path).toContain(TEST_CACHE_DIR);
    });
  });

  describe("getCacheDir", () => {
    it("should return the cache directory path", () => {
      const dir = getCacheDir();

      expect(dir).toBe(TEST_CACHE_DIR);
    });

    it("should create directory if it does not exist", () => {
      // Remove the directory first
      if (existsSync(TEST_CACHE_DIR)) {
        rmSync(TEST_CACHE_DIR, { recursive: true });
      }
      resetCacheDir();

      const dir = getCacheDir();

      expect(existsSync(dir)).toBe(true);
    });
  });

  describe("cacheAudio", () => {
    it("should cache audio and return entry", async () => {
      const audioBuffer = Buffer.from("fake-audio-data");
      const entry = await cacheAudio("Hello", "voice-123", audioBuffer, 2.5);

      expect(entry.key).toBeDefined();
      expect(entry.voiceId).toBe("voice-123");
      expect(entry.duration).toBe(2.5);
      expect(entry.size).toBe(audioBuffer.length);
      expect(entry.createdAt).toBeDefined();
      expect(entry.lastAccessedAt).toBeDefined();
    });

    it("should create file on disk", async () => {
      const audioBuffer = Buffer.from("audio-content");
      const entry = await cacheAudio("Test", "voice-456", audioBuffer, 1.0);

      expect(existsSync(entry.filePath)).toBe(true);
    });
  });

  describe("isCached", () => {
    it("should return false for non-cached audio", async () => {
      const result = await isCached("New text", "voice-123");

      expect(result).toBe(false);
    });

    it("should return true for cached audio", async () => {
      const audioBuffer = Buffer.from("cached-audio");
      await cacheAudio("Cached text", "voice-789", audioBuffer, 1.5);

      const result = await isCached("Cached text", "voice-789");

      expect(result).toBe(true);
    });
  });

  describe("getCachedAudio", () => {
    it("should return null for non-cached audio", async () => {
      const result = await getCachedAudio("Missing", "voice-123");

      expect(result).toBeNull();
    });

    it("should return buffer and entry for cached audio", async () => {
      const originalBuffer = Buffer.from("original-audio-data");
      await cacheAudio("Cached message", "voice-999", originalBuffer, 3.0);

      const result = await getCachedAudio("Cached message", "voice-999");

      expect(result).not.toBeNull();
      expect(result!.buffer).toEqual(originalBuffer);
      expect(result!.entry.voiceId).toBe("voice-999");
      expect(result!.entry.duration).toBe(3.0);
    });

    it("should update lastAccessedAt on retrieval", async () => {
      const audioBuffer = Buffer.from("test-audio");
      const entry = await cacheAudio("Access test", "voice-111", audioBuffer, 1.0);
      const originalAccessTime = entry.lastAccessedAt;

      // Wait a tiny bit to ensure time difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = await getCachedAudio("Access test", "voice-111");

      expect(result!.entry.lastAccessedAt).not.toBe(originalAccessTime);
    });
  });

  describe("removeCachedAudio", () => {
    it("should return false when removing non-existent entry", async () => {
      const result = await removeCachedAudio("Nonexistent", "voice-000");

      expect(result).toBe(false);
    });

    it("should remove cached audio and return true", async () => {
      const audioBuffer = Buffer.from("to-be-removed");
      const entry = await cacheAudio("Remove me", "voice-222", audioBuffer, 1.0);

      expect(existsSync(entry.filePath)).toBe(true);

      const result = await removeCachedAudio("Remove me", "voice-222");

      expect(result).toBe(true);
      expect(existsSync(entry.filePath)).toBe(false);
    });

    it("should mark entry as not cached after removal", async () => {
      const audioBuffer = Buffer.from("remove-test");
      await cacheAudio("Remove test", "voice-333", audioBuffer, 1.0);

      await removeCachedAudio("Remove test", "voice-333");

      const isCachedResult = await isCached("Remove test", "voice-333");
      expect(isCachedResult).toBe(false);
    });
  });

  describe("getCacheStats", () => {
    it("should return empty stats for empty cache", async () => {
      const stats = await getCacheStats();

      expect(stats.entries).toBe(0);
      expect(stats.totalSize).toBe(0);
      expect(stats.oldestEntry).toBeNull();
      expect(stats.newestEntry).toBeNull();
    });

    it("should return accurate stats for populated cache", async () => {
      const buffer1 = Buffer.from("audio-1");
      const buffer2 = Buffer.from("audio-data-2");

      await cacheAudio("Text 1", "voice-1", buffer1, 1.0);
      await new Promise((resolve) => setTimeout(resolve, 10));
      await cacheAudio("Text 2", "voice-2", buffer2, 2.0);

      const stats = await getCacheStats();

      expect(stats.entries).toBe(2);
      expect(stats.totalSize).toBe(buffer1.length + buffer2.length);
      expect(stats.oldestEntry).toBeDefined();
      expect(stats.newestEntry).toBeDefined();
    });
  });

  describe("cleanupCache", () => {
    it("should not remove recent entries", async () => {
      const audioBuffer = Buffer.from("recent-audio");
      await cacheAudio("Recent", "voice-444", audioBuffer, 1.0);

      const result = await cleanupCache();

      expect(result.removed).toBe(0);
      expect(result.remaining).toBe(1);
    });

    // Note: Testing old entry removal would require mocking time
    // which is complex. In real usage, entries older than max age are removed.
  });

  describe("clearCache", () => {
    it("should remove all cached entries", async () => {
      await cacheAudio("Entry 1", "voice-a", Buffer.from("audio-a"), 1.0);
      await cacheAudio("Entry 2", "voice-b", Buffer.from("audio-b"), 1.0);
      await cacheAudio("Entry 3", "voice-c", Buffer.from("audio-c"), 1.0);

      const result = await clearCache();

      expect(result.removed).toBe(3);

      const stats = await getCacheStats();
      expect(stats.entries).toBe(0);
    });

    it("should return freed bytes", async () => {
      const buffer = Buffer.from("some-audio-content-here");
      await cacheAudio("Clear test", "voice-555", buffer, 1.0);

      const result = await clearCache();

      expect(result.freedBytes).toBe(buffer.length);
    });
  });
});
