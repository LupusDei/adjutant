/**
 * Session Bridge — public API.
 *
 * Re-exports the main entry points for the session management system.
 */

export {
  initSessionBridge,
  shutdownSessionBridge,
  registerClient,
  unregisterClient,
  handleSessionMessage,
  getAllSessions,
  getSession,
  discoverSessions,
  reconcileSessions,
} from "./session-bridge.js";

export type {
  ManagedSession,
  SessionClientMessage,
  SessionServerMessage,
  SessionMode,
  SessionStatus,
  WorkspaceType,
} from "../../types/session.js";
