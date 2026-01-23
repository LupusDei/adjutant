// ============================================================================
// Audio Cache Service - T005
// Caches synthesized audio files with hash-based naming
// ============================================================================

import { createHash } from "crypto";
import { existsSync, mkdirSync, statSync, unlinkSync } from "fs";
import { readFile, writeFile, unlink, stat, readdir } from "fs/promises";
import { join, resolve } from "path";
import type { AudioCacheEntry } from "../types/voice.js";

// ============================================================================
// Configuration
// ============================================================================

/**
 * Default cache directory (relative to backend root).
 */
const DEFAULT_CACHE_DIR = ".audio-cache";

/**
 * Default max age for cache entries (in hours).
 */
const DEFAULT_MAX_AGE_HOURS = 168; // 7 days

/**
 * Cache metadata file name.
 */
const METADATA_FILE = "cache-metadata.json";

// ============================================================================
// Cache Directory Management
// ============================================================================

let cacheDir: string | null = null;
let cacheMetadata: Map<string, AudioCacheEntry> = new Map();

/**
 * Get the cache directory path.
 * Creates the directory if it doesn't exist.
 */
export function getCacheDir(): string {
  if (cacheDir) {
    return cacheDir;
  }

  const envCacheDir = process.env["AUDIO_CACHE_DIR"];
  const baseDir = envCacheDir || DEFAULT_CACHE_DIR;

  // Resolve relative to backend directory
  cacheDir = resolve(process.cwd(), baseDir);

  // Ensure directory exists
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }

  return cacheDir;
}

/**
 * Reset the cache directory (useful for testing).
 */
export function resetCacheDir(): void {
  cacheDir = null;
  cacheMetadata.clear();
}

// ============================================================================
// Cache Key Generation
// ============================================================================

/**
 * Generate a cache key from text and voice ID.
 * Uses SHA-256 hash for collision-resistant naming.
 */
export function generateCacheKey(text: string, voiceId: string): string {
  const input = `${voiceId}:${text}`;
  return createHash("sha256").update(input).digest("hex").substring(0, 16);
}

/**
 * Generate the filename for a cached audio file.
 */
export function getCacheFilename(cacheKey: string): string {
  return `${cacheKey}.mp3`;
}

/**
 * Get the full path to a cached audio file.
 */
export function getCacheFilePath(cacheKey: string): string {
  return join(getCacheDir(), getCacheFilename(cacheKey));
}

// ============================================================================
// Cache Metadata Management
// ============================================================================

/**
 * Load cache metadata from disk.
 */
export async function loadCacheMetadata(): Promise<void> {
  const metadataPath = join(getCacheDir(), METADATA_FILE);

  if (!existsSync(metadataPath)) {
    cacheMetadata = new Map();
    return;
  }

  try {
    const data = await readFile(metadataPath, "utf-8");
    const entries: AudioCacheEntry[] = JSON.parse(data);
    cacheMetadata = new Map(entries.map((e) => [e.key, e]));
  } catch {
    // If metadata is corrupted, start fresh
    cacheMetadata = new Map();
  }
}

/**
 * Save cache metadata to disk.
 */
export async function saveCacheMetadata(): Promise<void> {
  const metadataPath = join(getCacheDir(), METADATA_FILE);
  const entries = Array.from(cacheMetadata.values());
  await writeFile(metadataPath, JSON.stringify(entries, null, 2));
}

/**
 * Initialize cache metadata (load if exists).
 */
let metadataLoaded = false;
export async function ensureMetadataLoaded(): Promise<void> {
  if (!metadataLoaded) {
    await loadCacheMetadata();
    metadataLoaded = true;
  }
}

// ============================================================================
// Cache Operations
// ============================================================================

/**
 * Check if an audio file is cached.
 */
export async function isCached(text: string, voiceId: string): Promise<boolean> {
  await ensureMetadataLoaded();
  const key = generateCacheKey(text, voiceId);
  const filePath = getCacheFilePath(key);

  // Check both metadata and file existence
  return cacheMetadata.has(key) && existsSync(filePath);
}

/**
 * Get a cached audio file.
 * Returns null if not cached.
 */
export async function getCachedAudio(
  text: string,
  voiceId: string
): Promise<{ buffer: Buffer; entry: AudioCacheEntry } | null> {
  await ensureMetadataLoaded();
  const key = generateCacheKey(text, voiceId);
  const entry = cacheMetadata.get(key);

  if (!entry) {
    return null;
  }

  const filePath = getCacheFilePath(key);
  if (!existsSync(filePath)) {
    // Metadata exists but file is missing, clean up
    cacheMetadata.delete(key);
    await saveCacheMetadata();
    return null;
  }

  // Update last accessed time
  entry.lastAccessedAt = new Date().toISOString();
  await saveCacheMetadata();

  const buffer = await readFile(filePath);
  return { buffer, entry };
}

/**
 * Cache an audio file.
 */
export async function cacheAudio(
  text: string,
  voiceId: string,
  audioBuffer: Buffer,
  duration: number
): Promise<AudioCacheEntry> {
  await ensureMetadataLoaded();
  const key = generateCacheKey(text, voiceId);
  const filePath = getCacheFilePath(key);

  // Write audio file
  await writeFile(filePath, audioBuffer);

  // Create metadata entry
  const now = new Date().toISOString();
  const entry: AudioCacheEntry = {
    key,
    filePath,
    voiceId,
    duration,
    size: audioBuffer.length,
    createdAt: now,
    lastAccessedAt: now,
  };

  cacheMetadata.set(key, entry);
  await saveCacheMetadata();

  return entry;
}

/**
 * Remove a cached audio file.
 */
export async function removeCachedAudio(
  text: string,
  voiceId: string
): Promise<boolean> {
  await ensureMetadataLoaded();
  const key = generateCacheKey(text, voiceId);
  const entry = cacheMetadata.get(key);

  if (!entry) {
    return false;
  }

  // Remove file if exists
  const filePath = getCacheFilePath(key);
  if (existsSync(filePath)) {
    await unlink(filePath);
  }

  // Remove from metadata
  cacheMetadata.delete(key);
  await saveCacheMetadata();

  return true;
}

// ============================================================================
// Cache Cleanup
// ============================================================================

/**
 * Get max age from environment or default.
 */
function getMaxAgeMs(): number {
  const hours = parseInt(
    process.env["AUDIO_CACHE_MAX_AGE_HOURS"] || String(DEFAULT_MAX_AGE_HOURS),
    10
  );
  return hours * 60 * 60 * 1000;
}

/**
 * Clean up old cache entries.
 * Removes entries older than maxAge.
 */
export async function cleanupCache(): Promise<{
  removed: number;
  remaining: number;
  freedBytes: number;
}> {
  await ensureMetadataLoaded();
  const maxAgeMs = getMaxAgeMs();
  const cutoff = Date.now() - maxAgeMs;

  let removed = 0;
  let freedBytes = 0;

  for (const [key, entry] of cacheMetadata.entries()) {
    const lastAccessed = new Date(entry.lastAccessedAt).getTime();

    if (lastAccessed < cutoff) {
      const filePath = getCacheFilePath(key);
      if (existsSync(filePath)) {
        try {
          const stats = statSync(filePath);
          freedBytes += stats.size;
          unlinkSync(filePath);
        } catch {
          // File may have been removed externally
        }
      }
      cacheMetadata.delete(key);
      removed++;
    }
  }

  if (removed > 0) {
    await saveCacheMetadata();
  }

  return {
    removed,
    remaining: cacheMetadata.size,
    freedBytes,
  };
}

/**
 * Get cache statistics.
 */
export async function getCacheStats(): Promise<{
  entries: number;
  totalSize: number;
  oldestEntry: string | null;
  newestEntry: string | null;
}> {
  await ensureMetadataLoaded();

  let totalSize = 0;
  let oldest: AudioCacheEntry | null = null;
  let newest: AudioCacheEntry | null = null;

  for (const entry of cacheMetadata.values()) {
    totalSize += entry.size;

    if (!oldest || entry.createdAt < oldest.createdAt) {
      oldest = entry;
    }
    if (!newest || entry.createdAt > newest.createdAt) {
      newest = entry;
    }
  }

  return {
    entries: cacheMetadata.size,
    totalSize,
    oldestEntry: oldest?.createdAt || null,
    newestEntry: newest?.createdAt || null,
  };
}

/**
 * Clear the entire cache.
 */
export async function clearCache(): Promise<{
  removed: number;
  freedBytes: number;
}> {
  await ensureMetadataLoaded();
  const dir = getCacheDir();
  let removed = 0;
  let freedBytes = 0;

  // Remove all .mp3 files
  const files = await readdir(dir);
  for (const file of files) {
    if (file.endsWith(".mp3")) {
      const filePath = join(dir, file);
      try {
        const stats = await stat(filePath);
        freedBytes += stats.size;
        await unlink(filePath);
        removed++;
      } catch {
        // File may have been removed
      }
    }
  }

  // Clear metadata
  cacheMetadata.clear();
  await saveCacheMetadata();

  return { removed, freedBytes };
}

// ============================================================================
// Cache Cleanup Scheduler (T056)
// ============================================================================

/**
 * Default cleanup interval: 1 hour
 */
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Start the cache cleanup scheduler.
 * Runs cleanup periodically to remove expired entries.
 * @param intervalMs - Interval in milliseconds (default: 1 hour)
 */
export function startCacheCleanupScheduler(
  intervalMs: number = DEFAULT_CLEANUP_INTERVAL_MS
): void {
  // Don't start if already running
  if (cleanupIntervalId !== null) {
    return;
  }

  // Run cleanup immediately on start
  cleanupCache().catch((err) => {
    console.error("[AudioCache] Initial cleanup failed:", err);
  });

  // Schedule periodic cleanup
  cleanupIntervalId = setInterval(() => {
    cleanupCache()
      .then((result) => {
        if (result.removed > 0) {
          console.log(
            `[AudioCache] Cleanup: removed ${result.removed} files, freed ${Math.round(result.freedBytes / 1024)}KB`
          );
        }
      })
      .catch((err) => {
        console.error("[AudioCache] Scheduled cleanup failed:", err);
      });
  }, intervalMs);

  console.log(
    `[AudioCache] Cleanup scheduler started (interval: ${Math.round(intervalMs / 60000)}min)`
  );
}

/**
 * Stop the cache cleanup scheduler.
 */
export function stopCacheCleanupScheduler(): void {
  if (cleanupIntervalId !== null) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
    console.log("[AudioCache] Cleanup scheduler stopped");
  }
}

/**
 * Check if the cleanup scheduler is running.
 */
export function isCacheCleanupSchedulerRunning(): boolean {
  return cleanupIntervalId !== null;
}
