/**
 * API Key Service
 *
 * Manages API keys for authenticating requests to the backend.
 * Keys are stored hashed (SHA-256) in a JSON file.
 */

import { createHash, randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { logInfo, logWarn } from "../utils/index.js";

interface StoredApiKey {
  /** SHA-256 hash of the API key */
  hash: string;
  /** Optional label to identify the key's purpose */
  label?: string;
  /** ISO timestamp when the key was created */
  createdAt: string;
}

interface ApiKeyStore {
  keys: StoredApiKey[];
}

/**
 * Get the path to the API keys file.
 * Defaults to ~/.gastown/api-keys.json unless overridden by API_KEYS_PATH env var.
 */
function getKeysPath(): string {
  return process.env["API_KEYS_PATH"] ?? join(homedir(), ".gastown", "api-keys.json");
}

/**
 * Hash an API key using SHA-256.
 */
function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Load the API key store from disk.
 */
function loadStore(): ApiKeyStore {
  const path = getKeysPath();
  if (!existsSync(path)) {
    return { keys: [] };
  }
  try {
    const data = readFileSync(path, "utf-8");
    return JSON.parse(data) as ApiKeyStore;
  } catch {
    logWarn("failed to parse API keys file, starting fresh", { path });
    return { keys: [] };
  }
}

/**
 * Save the API key store to disk.
 */
function saveStore(store: ApiKeyStore): void {
  const path = getKeysPath();
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(store, null, 2), "utf-8");
}

// In-memory cache of key hashes for fast validation
let cachedHashes: Set<string> | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60_000; // Reload from disk every minute

/**
 * Get cached key hashes, reloading from disk if stale.
 */
function getCachedHashes(): Set<string> {
  const now = Date.now();
  if (cachedHashes === null || now - cacheLoadedAt > CACHE_TTL_MS) {
    const store = loadStore();
    cachedHashes = new Set(store.keys.map((k) => k.hash));
    cacheLoadedAt = now;
  }
  return cachedHashes;
}

/**
 * Invalidate the cache (call after modifying keys).
 */
function invalidateCache(): void {
  cachedHashes = null;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Generate a new API key and store it.
 * Returns the raw key (only shown once - not stored).
 */
export function generateApiKey(label?: string): string {
  const rawKey = `adj_${randomBytes(32).toString("hex")}`;
  const hash = hashKey(rawKey);

  const store = loadStore();
  const newKey: StoredApiKey = {
    hash,
    createdAt: new Date().toISOString(),
  };
  if (label !== undefined) {
    newKey.label = label;
  }
  store.keys.push(newKey);
  saveStore(store);
  invalidateCache();

  logInfo("API key generated", { label, keyPrefix: rawKey.slice(0, 12) });
  return rawKey;
}

/**
 * Validate an API key.
 * Returns true if the key is valid and registered.
 */
export function validateApiKey(key: string): boolean {
  if (!key) return false;
  const hash = hashKey(key);
  return getCachedHashes().has(hash);
}

/**
 * List all registered API keys (metadata only, not the keys themselves).
 */
export function listApiKeys(): { label: string | undefined; createdAt: string; hashPrefix: string }[] {
  const store = loadStore();
  return store.keys.map((k) => ({
    label: k.label,
    createdAt: k.createdAt,
    hashPrefix: k.hash.slice(0, 8),
  }));
}

/**
 * Revoke an API key by its hash prefix.
 */
export function revokeApiKey(hashPrefix: string): boolean {
  const store = loadStore();
  const idx = store.keys.findIndex((k) => k.hash.startsWith(hashPrefix));
  if (idx === -1) {
    return false;
  }
  const removed = store.keys.splice(idx, 1)[0];
  saveStore(store);
  invalidateCache();

  logInfo("API key revoked", { label: removed?.label, hashPrefix });
  return true;
}

/**
 * Check if any API keys are configured.
 */
export function hasApiKeys(): boolean {
  return getCachedHashes().size > 0;
}
