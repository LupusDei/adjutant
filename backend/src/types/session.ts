/**
 * Session Bridge v2 types.
 *
 * Defines the core data model for managed tmux sessions
 * and the WebSocket v2 protocol message types.
 */

// ============================================================================
// Session Data Model
// ============================================================================

export type SessionMode = "standalone" | "swarm" | "gastown";
export type SessionStatus = "idle" | "working" | "waiting_permission" | "offline";
export type WorkspaceType = "primary" | "worktree" | "copy";

/** A managed tmux session tracked by the Session Bridge. */
export interface ManagedSession {
  id: string;
  name: string;
  tmuxSession: string;
  tmuxPane: string;
  projectPath: string;
  mode: SessionMode;
  status: SessionStatus;
  workspaceType: WorkspaceType;
  connectedClients: string[];
  pipeActive: boolean;
  createdAt: string;
  lastActivity: string;
}

/** Serialized form for file persistence (no Sets, no Dates). */
export interface SessionFile {
  sessions: ManagedSession[];
  savedAt: string;
}

// ============================================================================
// Ring Buffer for Output
// ============================================================================

export interface RingBufferOptions {
  maxLines: number;
}

// ============================================================================
// WebSocket v2 Protocol — Client → Server
// ============================================================================

export interface SessionListRequest {
  type: "session_list";
}

export interface SessionCreateRequest {
  type: "session_create";
  projectPath: string;
  mode: SessionMode;
  name?: string;
  workspaceType?: WorkspaceType;
}

export interface SessionConnectRequest {
  type: "session_connect";
  sessionId: string;
  replay?: boolean;
}

export interface SessionDisconnectRequest {
  type: "session_disconnect";
  sessionId: string;
}

export interface SessionInputRequest {
  type: "session_input";
  sessionId: string;
  text: string;
}

export interface SessionInterruptRequest {
  type: "session_interrupt";
  sessionId: string;
}

export interface SessionKillRequest {
  type: "session_kill";
  sessionId: string;
}

export interface SessionPermissionResponse {
  type: "session_permission";
  sessionId: string;
  requestId: string;
  approved: boolean;
}

export type SessionClientMessage =
  | SessionListRequest
  | SessionCreateRequest
  | SessionConnectRequest
  | SessionDisconnectRequest
  | SessionInputRequest
  | SessionInterruptRequest
  | SessionKillRequest
  | SessionPermissionResponse;

// ============================================================================
// WebSocket v2 Protocol — Server → Client
// ============================================================================

export interface SessionListResponse {
  type: "session_list";
  sessions: ManagedSession[];
}

export interface SessionCreatedEvent {
  type: "session_created";
  session: ManagedSession;
}

export interface SessionOutputEvent {
  type: "session_output";
  sessionId: string;
  events: import("../services/output-parser.js").OutputEvent[];
  raw: string;
}

export interface SessionRawEvent {
  type: "session_raw";
  sessionId: string;
  data: string;
}

export interface SessionStatusEvent {
  type: "session_status";
  sessionId: string;
  status: SessionStatus;
}

export interface SessionEndedEvent {
  type: "session_ended";
  sessionId: string;
  reason: string;
}

export interface SessionErrorEvent {
  type: "session_error";
  sessionId?: string;
  message: string;
}

export type SessionServerMessage =
  | SessionListResponse
  | SessionCreatedEvent
  | SessionOutputEvent
  | SessionRawEvent
  | SessionStatusEvent
  | SessionEndedEvent
  | SessionErrorEvent;
