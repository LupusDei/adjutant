/**
 * SessionBridge — main coordinator for session management.
 *
 * Wires together SessionRegistry, SessionConnector, InputRouter,
 * and LifecycleManager. Handles WebSocket v2 session_* messages.
 */

import {
  getAllSessions,
  getSession,
  getOutputBuffer,
  addClient,
  removeClient,
  removeClientFromAll,
  loadFromDisk,
  forceSave,
} from "./session-registry.js";
import {
  setOutputHandler,
  startCapture,
  stopCapture,
  stopAllCaptures,
  isCapturing,
} from "./session-connector.js";
import { sendInput, sendInterrupt, sendPermissionResponse } from "./input-router.js";
import {
  launchSession,
  killSession,
  discoverSessions,
  reconcileSessions,
  startReconciliation,
  stopReconciliation,
  type LaunchOptions,
} from "./lifecycle-manager.js";
import type {
  SessionClientMessage,
  SessionServerMessage,
} from "../../types/session.js";
import { logInfo } from "../../utils/index.js";

// ============================================================================
// State
// ============================================================================

/** Map of WS client IDs to their send functions */
const clientSenders = new Map<string, (msg: SessionServerMessage) => void>();

/** Map of WS client IDs to which sessions they're watching */
const clientSubscriptions = new Map<string, Set<string>>();

let initialized = false;

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the Session Bridge.
 * Loads persisted sessions, discovers existing tmux sessions,
 * and starts periodic reconciliation.
 */
export async function initSessionBridge(): Promise<void> {
  if (initialized) return;

  // Load previously persisted sessions
  await loadFromDisk();

  // Set up output handler to relay to subscribed clients
  setOutputHandler((sessionId, data) => {
    broadcastToSession(sessionId, {
      type: "session_raw",
      sessionId,
      data,
    });
  });

  // Discover existing tmux sessions
  await discoverSessions();

  // Reconcile state
  await reconcileSessions();

  // Start periodic health checks
  startReconciliation(10_000);

  initialized = true;
  logInfo("session bridge initialized", { sessions: getAllSessions().length });
}

/**
 * Shut down the Session Bridge.
 */
export async function shutdownSessionBridge(): Promise<void> {
  stopReconciliation();
  stopAllCaptures();
  await forceSave();
  initialized = false;
  logInfo("session bridge shut down");
}

// ============================================================================
// Client Management
// ============================================================================

/**
 * Register a WebSocket client with the session bridge.
 */
export function registerClient(
  clientId: string,
  sender: (msg: SessionServerMessage) => void,
): void {
  clientSenders.set(clientId, sender);
  clientSubscriptions.set(clientId, new Set());
}

/**
 * Unregister a WebSocket client (on disconnect).
 */
export function unregisterClient(clientId: string): void {
  const subs = clientSubscriptions.get(clientId);
  if (subs) {
    for (const sessionId of subs) {
      removeClient(sessionId, clientId);
      // If no clients left watching, stop capture to save resources
      const session = getSession(sessionId);
      if (session && session.connectedClients.length === 0 && isCapturing(sessionId)) {
        stopCapture(sessionId);
      }
    }
  }
  clientSenders.delete(clientId);
  clientSubscriptions.delete(clientId);
  removeClientFromAll(clientId);
}

// ============================================================================
// Message Handling
// ============================================================================

/**
 * Handle an incoming session_* message from a WebSocket client.
 */
export async function handleSessionMessage(
  clientId: string,
  msg: SessionClientMessage,
): Promise<void> {
  const sender = clientSenders.get(clientId);
  if (!sender) return;

  try {
    switch (msg.type) {
      case "session_list":
        sender({
          type: "session_list",
          sessions: getAllSessions(),
        });
        break;

      case "session_create":
        await handleCreate(clientId, sender, msg);
        break;

      case "session_connect":
        await handleConnect(clientId, sender, msg);
        break;

      case "session_disconnect":
        handleDisconnect(clientId, msg);
        break;

      case "session_input":
        await sendInput(msg.sessionId, msg.text);
        break;

      case "session_interrupt":
        await sendInterrupt(msg.sessionId);
        break;

      case "session_kill":
        await handleKill(clientId, sender, msg);
        break;

      case "session_permission":
        await sendPermissionResponse(msg.sessionId, msg.approved);
        break;
    }
  } catch (err) {
    const sid = "sessionId" in msg ? (msg as { sessionId: string }).sessionId : undefined;
    const errMsg: SessionServerMessage = {
      type: "session_error",
      message: String(err instanceof Error ? err.message : err),
    };
    if (sid) (errMsg as { sessionId?: string }).sessionId = sid;
    sender(errMsg);
  }
}

async function handleCreate(
  _clientId: string,
  sender: (msg: SessionServerMessage) => void,
  msg: { projectPath: string; mode: string; name?: string; workspaceType?: string },
): Promise<void> {
  const opts: LaunchOptions = {
    name: msg.name ?? `session-${Date.now()}`,
    projectPath: msg.projectPath,
    mode: msg.mode as LaunchOptions["mode"],
    workspaceType: (msg.workspaceType as LaunchOptions["workspaceType"]) ?? undefined,
  };

  const session = await launchSession(opts);

  // Notify the creating client
  sender({
    type: "session_created",
    session,
  });

  // Also broadcast to all clients
  broadcastToAll({
    type: "session_status",
    sessionId: session.id,
    status: session.status,
  });
}

async function handleConnect(
  clientId: string,
  sender: (msg: SessionServerMessage) => void,
  msg: { sessionId: string; replay?: boolean },
): Promise<void> {
  const session = getSession(msg.sessionId);
  if (!session) {
    sender({
      type: "session_error",
      sessionId: msg.sessionId,
      message: "Session not found",
    });
    return;
  }

  // Subscribe client to this session
  addClient(msg.sessionId, clientId);
  const subs = clientSubscriptions.get(clientId);
  if (subs) subs.add(msg.sessionId);

  // Start capture if not already running
  if (!isCapturing(msg.sessionId) && session.status !== "offline") {
    await startCapture(msg.sessionId);
  }

  // Replay buffer if requested
  if (msg.replay) {
    const buffer = getOutputBuffer(msg.sessionId);
    if (buffer) {
      const lines = buffer.getAll();
      if (lines.length > 0) {
        sender({
          type: "session_raw",
          sessionId: msg.sessionId,
          data: lines.join("\n"),
        });
      }
    }
  }

  // Send current status
  sender({
    type: "session_status",
    sessionId: msg.sessionId,
    status: session.status,
  });

  logInfo("client connected to session", { clientId, sessionId: msg.sessionId });
}

function handleDisconnect(
  clientId: string,
  msg: { sessionId: string },
): void {
  removeClient(msg.sessionId, clientId);
  const subs = clientSubscriptions.get(clientId);
  if (subs) subs.delete(msg.sessionId);

  // Stop capture if no clients remaining
  const session = getSession(msg.sessionId);
  if (session && session.connectedClients.length === 0 && isCapturing(msg.sessionId)) {
    stopCapture(msg.sessionId);
  }

  logInfo("client disconnected from session", { clientId, sessionId: msg.sessionId });
}

async function handleKill(
  _clientId: string,
  _sender: (msg: SessionServerMessage) => void,
  msg: { sessionId: string },
): Promise<void> {
  await killSession(msg.sessionId);

  // Notify all clients
  broadcastToAll({
    type: "session_ended",
    sessionId: msg.sessionId,
    reason: "killed",
  });
}

// ============================================================================
// Broadcasting
// ============================================================================

/**
 * Send a message to all clients subscribed to a specific session.
 */
function broadcastToSession(sessionId: string, msg: SessionServerMessage): void {
  const session = getSession(sessionId);
  if (!session) return;

  for (const clientId of session.connectedClients) {
    const sender = clientSenders.get(clientId);
    if (sender) sender(msg);
  }
}

/**
 * Send a message to all registered clients.
 */
function broadcastToAll(msg: SessionServerMessage): void {
  for (const sender of clientSenders.values()) {
    sender(msg);
  }
}

// ============================================================================
// Public API for programmatic use
// ============================================================================

export { getAllSessions, getSession } from "./session-registry.js";
export { discoverSessions, reconcileSessions } from "./lifecycle-manager.js";
