/**
 * Device token service for Adjutant.
 *
 * This service manages APNs device token registration and storage.
 * Tokens are persisted to a JSON file for simplicity.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync, watch, type FSWatcher } from "fs";
import { dirname, join } from "path";
import { resolveTownRoot } from "./gastown-workspace.js";
import { logInfo, logError, logWarn, logDebug } from "../utils/index.js";
import type {
  DeviceToken,
  RegisterDeviceTokenRequest,
  RegisterDeviceTokenResponse,
  DevicePlatform,
} from "../types/apns.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Result type for device token service operations.
 */
export interface DeviceTokenServiceResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Internal storage format for device tokens.
 */
interface DeviceTokenStore {
  version: number;
  tokens: DeviceToken[];
}

// ============================================================================
// Storage Path
// ============================================================================

/**
 * Resolve the path to the device tokens file.
 */
function resolveTokensPath(): string {
  const townRoot = resolveTownRoot();
  return join(townRoot, ".gastown", "device-tokens.json");
}

// ============================================================================
// In-Memory Cache
// ============================================================================

let cachedStore: DeviceTokenStore | null = null;
let fileWatcher: FSWatcher | null = null;
let isWriting = false;

/**
 * Invalidate the cache, forcing next read to load from disk.
 */
function invalidateCache(): void {
  cachedStore = null;
  logDebug("Device token cache invalidated");
}

/**
 * Set up file watcher for cache invalidation on external changes.
 */
function setupFileWatcher(): void {
  if (fileWatcher) return;

  const tokensPath = resolveTokensPath();
  if (!existsSync(tokensPath)) return;

  try {
    fileWatcher = watch(tokensPath, (eventType) => {
      if (eventType === "change" && !isWriting) {
        invalidateCache();
      }
    });
    fileWatcher.on("error", () => {
      fileWatcher?.close();
      fileWatcher = null;
    });
  } catch {
    // File watching not available, cache will still work but won't detect external changes
  }
}

/**
 * Get the cached token store, loading from disk if needed.
 */
async function getTokenStore(): Promise<DeviceTokenStore> {
  if (cachedStore) {
    return cachedStore;
  }

  cachedStore = await loadTokensFromDisk();
  setupFileWatcher();
  return cachedStore;
}

/**
 * Update the cache and persist to disk asynchronously.
 */
async function updateTokenStore(store: DeviceTokenStore): Promise<void> {
  cachedStore = store;
  await persistToDisk(store);
}

// ============================================================================
// Storage Operations
// ============================================================================

/**
 * Load device tokens from disk (bypasses cache).
 */
async function loadTokensFromDisk(): Promise<DeviceTokenStore> {
  const tokensPath = resolveTokensPath();

  if (!existsSync(tokensPath)) {
    return { version: 1, tokens: [] };
  }

  try {
    const content = await readFile(tokensPath, "utf-8");
    const store = JSON.parse(content) as DeviceTokenStore;
    logDebug("Device tokens loaded from disk", { count: store.tokens.length });
    return store;
  } catch (err) {
    logWarn("Failed to load device tokens, starting fresh", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { version: 1, tokens: [] };
  }
}

/**
 * Persist device tokens to disk.
 */
async function persistToDisk(store: DeviceTokenStore): Promise<void> {
  const tokensPath = resolveTokensPath();
  const dir = dirname(tokensPath);

  // Ensure directory exists
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  isWriting = true;
  try {
    await writeFile(tokensPath, JSON.stringify(store, null, 2), "utf-8");
    setupFileWatcher();
  } finally {
    isWriting = false;
  }
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Register a device token for push notifications.
 * If the token already exists, updates it. Otherwise creates a new entry.
 */
export async function registerDeviceToken(
  request: RegisterDeviceTokenRequest
): Promise<DeviceTokenServiceResult<RegisterDeviceTokenResponse>> {
  try {
    // Validate token format (should be hex string, typically 64 chars for APNs)
    if (!/^[0-9a-fA-F]+$/.test(request.token)) {
      return {
        success: false,
        error: {
          code: "INVALID_TOKEN_FORMAT",
          message: "Device token must be a valid hex string",
        },
      };
    }

    const store = await getTokenStore();
    const now = new Date().toISOString();
    const bundleId = request.bundleId ?? process.env["APNS_BUNDLE_ID"] ?? "com.gastown.adjutant";

    // Check if token already exists
    const existingIndex = store.tokens.findIndex((t) => t.token === request.token);
    const isNew = existingIndex === -1;

    const deviceToken: DeviceToken = {
      token: request.token,
      platform: request.platform,
      agentId: request.agentId,
      bundleId,
      registeredAt: isNew ? now : store.tokens[existingIndex]!.registeredAt,
      lastSeenAt: now,
    };

    if (isNew) {
      store.tokens.push(deviceToken);
      logInfo("Device token registered", {
        platform: request.platform,
        agentId: request.agentId,
        tokenPrefix: request.token.substring(0, 8),
      });
    } else {
      store.tokens[existingIndex] = deviceToken;
      logInfo("Device token updated", {
        platform: request.platform,
        agentId: request.agentId,
        tokenPrefix: request.token.substring(0, 8),
      });
    }

    await updateTokenStore(store);

    return {
      success: true,
      data: {
        isNew,
        token: deviceToken,
      },
    };
  } catch (err) {
    logError("Failed to register device token", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      error: {
        code: "REGISTRATION_ERROR",
        message: err instanceof Error ? err.message : "Failed to register device token",
      },
    };
  }
}

/**
 * Unregister a device token.
 */
export async function unregisterDeviceToken(
  token: string
): Promise<DeviceTokenServiceResult<void>> {
  try {
    const store = await getTokenStore();
    const initialCount = store.tokens.length;

    store.tokens = store.tokens.filter((t) => t.token !== token);

    if (store.tokens.length === initialCount) {
      return {
        success: false,
        error: {
          code: "TOKEN_NOT_FOUND",
          message: "Device token not found",
        },
      };
    }

    await updateTokenStore(store);

    logInfo("Device token unregistered", {
      tokenPrefix: token.substring(0, 8),
    });

    return { success: true };
  } catch (err) {
    logError("Failed to unregister device token", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      error: {
        code: "UNREGISTER_ERROR",
        message: err instanceof Error ? err.message : "Failed to unregister device token",
      },
    };
  }
}

/**
 * Get all registered device tokens.
 */
export async function getAllDeviceTokens(): Promise<
  DeviceTokenServiceResult<DeviceToken[]>
> {
  try {
    const store = await getTokenStore();
    return { success: true, data: store.tokens };
  } catch (err) {
    logError("Failed to get device tokens", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      error: {
        code: "LIST_ERROR",
        message: err instanceof Error ? err.message : "Failed to list device tokens",
      },
    };
  }
}

/**
 * Get device tokens for a specific platform.
 */
export async function getDeviceTokensByPlatform(
  platform: DevicePlatform
): Promise<DeviceTokenServiceResult<DeviceToken[]>> {
  try {
    const store = await getTokenStore();
    const filtered = store.tokens.filter((t) => t.platform === platform);
    return { success: true, data: filtered };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "LIST_ERROR",
        message: err instanceof Error ? err.message : "Failed to list device tokens",
      },
    };
  }
}

/**
 * Get device tokens for a specific agent.
 */
export async function getDeviceTokensByAgent(
  agentId: string
): Promise<DeviceTokenServiceResult<DeviceToken[]>> {
  try {
    const store = await getTokenStore();
    const filtered = store.tokens.filter((t) => t.agentId === agentId);
    return { success: true, data: filtered };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "LIST_ERROR",
        message: err instanceof Error ? err.message : "Failed to list device tokens",
      },
    };
  }
}

/**
 * Clean up stale device tokens (not seen in X days).
 */
export async function cleanupStaleTokens(
  maxAgeDays: number = 30
): Promise<DeviceTokenServiceResult<{ removed: number }>> {
  try {
    const store = await getTokenStore();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxAgeDays);

    const initialCount = store.tokens.length;
    store.tokens = store.tokens.filter((t) => {
      const lastSeen = new Date(t.lastSeenAt);
      return lastSeen > cutoff;
    });

    const removed = initialCount - store.tokens.length;

    if (removed > 0) {
      await updateTokenStore(store);
      logInfo("Cleaned up stale device tokens", { removed, maxAgeDays });
    }

    return { success: true, data: { removed } };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "CLEANUP_ERROR",
        message: err instanceof Error ? err.message : "Failed to cleanup stale tokens",
      },
    };
  }
}
