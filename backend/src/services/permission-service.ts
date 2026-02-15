/**
 * PermissionService — per-agent permission configuration and auto-handling.
 *
 * Integrates with the OutputParser to detect permission prompts in session output.
 * Based on per-agent config, either auto-accepts or routes the permission request
 * to iOS clients via the EventBus.
 *
 * Config levels:
 * - "auto_accept": Automatically approve all permission prompts
 * - "auto_deny": Automatically deny all permission prompts
 * - "manual": Route to iOS for human approval (default)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { logInfo, logWarn } from "../utils/index.js";
import { OutputParser, type OutputEvent } from "./output-parser.js";
import { getEventBus } from "./event-bus.js";

// ============================================================================
// Types
// ============================================================================

export type PermissionMode = "auto_accept" | "auto_deny" | "manual";

export interface PermissionConfig {
  /** Default mode for all sessions */
  defaultMode: PermissionMode;
  /** Per-session overrides keyed by session ID */
  sessions: Record<string, PermissionMode>;
  /** Tool-level overrides: e.g., always auto-accept "Read" */
  toolOverrides: Record<string, PermissionMode>;
}

export interface PermissionEvent {
  sessionId: string;
  requestId: string;
  action: string;
  details: string;
  autoHandled: boolean;
  response?: "approved" | "denied";
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_CONFIG: PermissionConfig = {
  defaultMode: "manual",
  sessions: {},
  toolOverrides: {},
};

// ============================================================================
// PermissionService
// ============================================================================

const parsers = new Map<string, OutputParser>();
let config: PermissionConfig = { ...DEFAULT_CONFIG };
let configPath: string | null = null;
let onPermissionCallback: ((event: PermissionEvent) => void) | null = null;

/**
 * Initialize the permission service and load config.
 */
export function initPermissionService(customPath?: string): void {
  const dir = customPath ?? join(homedir(), ".adjutant");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  configPath = join(dir, "permissions.json");

  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf8");
      const loaded = JSON.parse(raw) as Partial<PermissionConfig>;
      config = {
        defaultMode: loaded.defaultMode ?? "manual",
        sessions: loaded.sessions ?? {},
        toolOverrides: loaded.toolOverrides ?? {},
      };
    } catch (err) {
      logWarn("Failed to load permission config", { error: String(err) });
    }
  }

  logInfo("Permission service initialized", { defaultMode: config.defaultMode });
}

/**
 * Save current config to disk.
 */
export function savePermissionConfig(): void {
  if (!configPath) return;
  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
  } catch (err) {
    logWarn("Failed to save permission config", { error: String(err) });
  }
}

/**
 * Get the current permission config.
 */
export function getPermissionConfig(): PermissionConfig {
  return { ...config };
}

/**
 * Update permission config.
 */
export function updatePermissionConfig(update: Partial<PermissionConfig>): PermissionConfig {
  if (update.defaultMode) config.defaultMode = update.defaultMode;
  if (update.sessions) config.sessions = { ...config.sessions, ...update.sessions };
  if (update.toolOverrides) config.toolOverrides = { ...config.toolOverrides, ...update.toolOverrides };
  savePermissionConfig();
  return { ...config };
}

/**
 * Get the effective permission mode for a session/tool combination.
 */
export function getEffectiveMode(sessionId: string, tool?: string): PermissionMode {
  // Tool override takes highest priority
  if (tool && config.toolOverrides[tool]) {
    return config.toolOverrides[tool];
  }
  // Session override
  if (config.sessions[sessionId]) {
    return config.sessions[sessionId];
  }
  // Default
  return config.defaultMode;
}

/**
 * Register a callback for permission events (for WebSocket routing).
 */
export function onPermission(callback: (event: PermissionEvent) => void): void {
  onPermissionCallback = callback;
}

/**
 * Process a line of session output through the permission system.
 * Returns any OutputEvents parsed, with permission events auto-handled or routed.
 */
export function processOutputLine(
  sessionId: string,
  line: string
): { events: OutputEvent[]; permissionHandled: boolean } {
  // Get or create parser for this session
  if (!parsers.has(sessionId)) {
    parsers.set(sessionId, new OutputParser());
  }
  const parser = parsers.get(sessionId)!;

  const events = parser.parseLine(line);
  let permissionHandled = false;

  for (const event of events) {
    if (event.type === "permission_request") {
      const mode = getEffectiveMode(sessionId);

      const permEvent: PermissionEvent = {
        sessionId,
        requestId: event.requestId,
        action: event.action,
        details: event.details,
        autoHandled: mode !== "manual",
      };

      if (mode === "auto_accept") {
        permEvent.response = "approved";
        permissionHandled = true;
        logInfo("Permission auto-accepted", { sessionId, action: event.action });
      } else if (mode === "auto_deny") {
        permEvent.response = "denied";
        permissionHandled = true;
        logInfo("Permission auto-denied", { sessionId, action: event.action });
      } else {
        // Manual mode — route to iOS via EventBus
        getEventBus().emit("session:permission", {
          sessionId,
          requestId: event.requestId,
          action: event.action,
          details: event.details,
        });
        logInfo("Permission routed to client", { sessionId, action: event.action });
      }

      // Notify callback
      onPermissionCallback?.(permEvent);
    }
  }

  return { events, permissionHandled };
}

/**
 * Remove parser state for a session (call on session kill).
 */
export function removeSessionParser(sessionId: string): void {
  parsers.delete(sessionId);
}

/**
 * Reset all state (for testing).
 */
export function resetPermissionService(): void {
  parsers.clear();
  config = { ...DEFAULT_CONFIG };
  configPath = null;
  onPermissionCallback = null;
}
