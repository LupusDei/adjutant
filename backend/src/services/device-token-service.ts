/**
 * Device token service for Adjutant.
 *
 * This service manages APNs device token registration and storage.
 * Tokens are persisted to SQLite via the shared database.
 */

import { getDatabase } from "./database.js";
import { logInfo, logError } from "../utils/index.js";
import type Database from "better-sqlite3";
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

/** Raw row shape from SQLite before camelCase mapping */
interface DeviceTokenRow {
  token: string;
  platform: string;
  agent_id: string | null;
  bundle_id: string;
  registered_at: string;
  last_seen_at: string;
}

function rowToDeviceToken(row: DeviceTokenRow): DeviceToken {
  return {
    token: row.token,
    platform: row.platform as DevicePlatform,
    agentId: row.agent_id ?? undefined,
    bundleId: row.bundle_id,
    registeredAt: row.registered_at,
    lastSeenAt: row.last_seen_at,
  };
}

// ============================================================================
// Factory (for testing with custom DB instance)
// ============================================================================

export interface DeviceTokenService {
  registerDeviceToken(
    request: RegisterDeviceTokenRequest
  ): DeviceTokenServiceResult<RegisterDeviceTokenResponse>;
  unregisterDeviceToken(token: string): DeviceTokenServiceResult<void>;
  getAllDeviceTokens(): DeviceTokenServiceResult<DeviceToken[]>;
  getDeviceTokensByPlatform(
    platform: DevicePlatform
  ): DeviceTokenServiceResult<DeviceToken[]>;
  getDeviceTokensByAgent(
    agentId: string
  ): DeviceTokenServiceResult<DeviceToken[]>;
  cleanupStaleTokens(
    maxAgeDays?: number
  ): DeviceTokenServiceResult<{ removed: number }>;
}

export function createDeviceTokenService(db: Database.Database): DeviceTokenService {
  const upsertStmt = db.prepare(`
    INSERT INTO device_tokens (token, platform, agent_id, bundle_id, registered_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(token) DO UPDATE SET
      platform = excluded.platform,
      agent_id = excluded.agent_id,
      bundle_id = excluded.bundle_id,
      last_seen_at = excluded.last_seen_at
  `);

  const deleteStmt = db.prepare("DELETE FROM device_tokens WHERE token = ?");
  const selectAllStmt = db.prepare("SELECT * FROM device_tokens");
  const selectByPlatformStmt = db.prepare("SELECT * FROM device_tokens WHERE platform = ?");
  const selectByAgentStmt = db.prepare("SELECT * FROM device_tokens WHERE agent_id = ?");
  const selectByTokenStmt = db.prepare("SELECT * FROM device_tokens WHERE token = ?");
  const cleanupStmt = db.prepare("DELETE FROM device_tokens WHERE last_seen_at < ?");

  return {
    registerDeviceToken(
      request: RegisterDeviceTokenRequest
    ): DeviceTokenServiceResult<RegisterDeviceTokenResponse> {
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

        const now = new Date().toISOString();
        const bundleId =
          request.bundleId ?? process.env["APNS_BUNDLE_ID"] ?? "com.jmm.adjutant";

        // Check if token already exists
        const existing = selectByTokenStmt.get(request.token) as
          | DeviceTokenRow
          | undefined;
        const isNew = existing === undefined;

        upsertStmt.run(
          request.token,
          request.platform,
          request.agentId ?? null,
          bundleId,
          isNew ? now : existing.registered_at,
          now
        );

        const row = selectByTokenStmt.get(request.token) as DeviceTokenRow;
        const deviceToken = rowToDeviceToken(row);

        logInfo(isNew ? "Device token registered" : "Device token updated", {
          platform: request.platform,
          agentId: request.agentId,
          tokenPrefix: request.token.substring(0, 8),
        });

        return {
          success: true,
          data: { isNew, token: deviceToken },
        };
      } catch (err) {
        logError("Failed to register device token", {
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          success: false,
          error: {
            code: "REGISTRATION_ERROR",
            message:
              err instanceof Error
                ? err.message
                : "Failed to register device token",
          },
        };
      }
    },

    unregisterDeviceToken(token: string): DeviceTokenServiceResult<void> {
      try {
        const result = deleteStmt.run(token);

        if (result.changes === 0) {
          return {
            success: false,
            error: {
              code: "TOKEN_NOT_FOUND",
              message: "Device token not found",
            },
          };
        }

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
            message:
              err instanceof Error
                ? err.message
                : "Failed to unregister device token",
          },
        };
      }
    },

    getAllDeviceTokens(): DeviceTokenServiceResult<DeviceToken[]> {
      try {
        const rows = selectAllStmt.all() as DeviceTokenRow[];
        return { success: true, data: rows.map(rowToDeviceToken) };
      } catch (err) {
        logError("Failed to get device tokens", {
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          success: false,
          error: {
            code: "LIST_ERROR",
            message:
              err instanceof Error
                ? err.message
                : "Failed to list device tokens",
          },
        };
      }
    },

    getDeviceTokensByPlatform(
      platform: DevicePlatform
    ): DeviceTokenServiceResult<DeviceToken[]> {
      try {
        const rows = selectByPlatformStmt.all(platform) as DeviceTokenRow[];
        return { success: true, data: rows.map(rowToDeviceToken) };
      } catch (err) {
        return {
          success: false,
          error: {
            code: "LIST_ERROR",
            message:
              err instanceof Error
                ? err.message
                : "Failed to list device tokens",
          },
        };
      }
    },

    getDeviceTokensByAgent(
      agentId: string
    ): DeviceTokenServiceResult<DeviceToken[]> {
      try {
        const rows = selectByAgentStmt.all(agentId) as DeviceTokenRow[];
        return { success: true, data: rows.map(rowToDeviceToken) };
      } catch (err) {
        return {
          success: false,
          error: {
            code: "LIST_ERROR",
            message:
              err instanceof Error
                ? err.message
                : "Failed to list device tokens",
          },
        };
      }
    },

    cleanupStaleTokens(
      maxAgeDays: number = 30
    ): DeviceTokenServiceResult<{ removed: number }> {
      try {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - maxAgeDays);
        const cutoffStr = cutoff.toISOString();

        const result = cleanupStmt.run(cutoffStr);
        const removed = result.changes;

        if (removed > 0) {
          logInfo("Cleaned up stale device tokens", { removed, maxAgeDays });
        }

        return { success: true, data: { removed } };
      } catch (err) {
        return {
          success: false,
          error: {
            code: "CLEANUP_ERROR",
            message:
              err instanceof Error
                ? err.message
                : "Failed to cleanup stale tokens",
          },
        };
      }
    },
  };
}

// ============================================================================
// Standalone functions (use singleton DB, called by routes + apns-service)
// ============================================================================

let _singleton: DeviceTokenService | null = null;

function getSingleton(): DeviceTokenService {
  if (_singleton === null) {
    _singleton = createDeviceTokenService(getDatabase());
  }
  return _singleton;
}

export async function registerDeviceToken(
  request: RegisterDeviceTokenRequest
): Promise<DeviceTokenServiceResult<RegisterDeviceTokenResponse>> {
  return getSingleton().registerDeviceToken(request);
}

export async function unregisterDeviceToken(
  token: string
): Promise<DeviceTokenServiceResult<void>> {
  return getSingleton().unregisterDeviceToken(token);
}

export async function getAllDeviceTokens(): Promise<
  DeviceTokenServiceResult<DeviceToken[]>
> {
  return getSingleton().getAllDeviceTokens();
}

export async function getDeviceTokensByPlatform(
  platform: DevicePlatform
): Promise<DeviceTokenServiceResult<DeviceToken[]>> {
  return getSingleton().getDeviceTokensByPlatform(platform);
}

export async function getDeviceTokensByAgent(
  agentId: string
): Promise<DeviceTokenServiceResult<DeviceToken[]>> {
  return getSingleton().getDeviceTokensByAgent(agentId);
}

export async function cleanupStaleTokens(
  maxAgeDays: number = 30
): Promise<DeviceTokenServiceResult<{ removed: number }>> {
  return getSingleton().cleanupStaleTokens(maxAgeDays);
}
