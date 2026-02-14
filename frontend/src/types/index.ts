// ============================================================================
// Enums and Primitives
// ============================================================================

/** Priority levels for messages. Lower number = higher priority. */
export type MessagePriority = 0 | 1 | 2 | 3 | 4;

/** Message types indicating the purpose of the message. */
export type MessageType = "notification" | "task" | "scavenge" | "reply";

/** Possible states for the gastown system. */
export type PowerState = "stopped" | "starting" | "running" | "stopping";

/** Communication priority levels for connection management. */
export type CommunicationPriority = 'real-time' | 'efficient' | 'polling-only';

/** Deployment mode for the system. */
export type DeploymentMode = 'gastown' | 'standalone' | 'swarm' | 'unknown';

/** Connection status for the communication indicator. */
export type ConnectionStatus = 'websocket' | 'sse' | 'polling' | 'reconnecting' | 'disconnected';

/** Possible statuses for a crew member. */
export type CrewMemberStatus =
  | "idle"
  | "working"
  | "blocked"
  | "stuck"
  | "offline";

/**
 * Agent types in the system.
 *
 * Gas Town roles: mayor, deacon, witness, refinery, crew, polecat
 * Standalone roles: user, agent
 */
export type AgentType =
  // Gas Town infrastructure
  | "mayor"
  | "deacon"
  | "witness"
  | "refinery"
  // Gas Town workers
  | "crew"
  | "polecat"
  // Standalone/swarm mode
  | "user"
  | "agent";

// ============================================================================
// Message Types
// ============================================================================

/** A mail message in the gastown system. */
export interface Message {
  /** Unique identifier (beads issue ID format) */
  id: string;
  /** Sender address (e.g., "mayor/", "greenplace/Toast") */
  from: string;
  /** Recipient address */
  to: string;
  /** Message subject line */
  subject: string;
  /** Full message body content */
  body: string;
  /** ISO 8601 timestamp when message was sent */
  timestamp: string;
  /** Whether the message has been read */
  read: boolean;
  /** Priority level: 0=urgent, 1=high, 2=normal (default), 3=low, 4=lowest */
  priority: MessagePriority;
  /** Type indicating message purpose */
  type: MessageType;
  /** Thread ID for grouping related messages */
  threadId: string;
  /** ID of message being replied to (if type is 'reply') */
  replyTo?: string;
  /** If true, message won't be auto-archived */
  pinned: boolean;
  /** Additional recipient addresses */
  cc?: string[];
}

/** Request payload for sending a new message. */
export interface SendMessageRequest {
  /** Recipient address (default: "mayor/") */
  to?: string;
  /** Sender address (default: resolved from environment) */
  from?: string;
  /** Message subject (required) */
  subject: string;
  /** Message body (required) */
  body: string;
  /** Priority level (default: 2) */
  priority?: MessagePriority;
  /** Message type (default: 'task') */
  type?: MessageType;
  /** ID of message being replied to */
  replyTo?: string;
  /** If true, append reply instructions with message ID to body */
  includeReplyInstructions?: boolean;
}

// ============================================================================
// Gastown Status Types
// ============================================================================

/** Status of a single agent. */
export interface AgentStatus {
  /** Agent identifier */
  name: string;
  /** Whether the agent is currently running */
  running: boolean;
  /** Work items pinned to this agent */
  pinnedWork?: string[];
  /** Number of unread messages */
  unreadMail: number;
  /** First unread message subject (for preview) */
  firstMessageSubject?: string;
  /** Special states like 'stuck' or 'awaiting-gate' */
  state?: "stuck" | "awaiting-gate" | "idle" | "working";
}

/** Status of agents within a single rig (project). */
export interface RigStatus {
  /** Rig name */
  name: string;
  /** Rig root path */
  path: string;
  /** Witness agent for this rig */
  witness: AgentStatus;
  /** Refinery agent for this rig */
  refinery: AgentStatus;
  /** Crew workers for this rig */
  crew: AgentStatus[];
  /** Active polecats (ephemeral workers) */
  polecats: AgentStatus[];
  /** Merge queue summary */
  mergeQueue: {
    pending: number;
    inFlight: number;
    blocked: number;
  };
}

/** Overall gastown system status. */
export interface GastownStatus {
  /** Current power state */
  powerState: PowerState;
  /** Town metadata */
  town: {
    name: string;
    root: string;
  };
  /** Operator (human user) information */
  operator: {
    name: string;
    email: string;
    unreadMail: number;
  };
  /** Infrastructure agent statuses */
  infrastructure: {
    mayor: AgentStatus;
    deacon: AgentStatus;
    daemon: AgentStatus;
  };
  /** Per-rig agent information */
  rigs: RigStatus[];
  /** Timestamp of this status snapshot */
  fetchedAt: string;
}

// ============================================================================
// Crew Member Types
// ============================================================================

/** A crew member displayed in the stats dashboard. */
export interface CrewMember {
  /** Unique identifier (e.g., "greenplace/Toast") */
  id: string;
  /** Display name */
  name: string;
  /** Agent type for icon/styling */
  type: AgentType;
  /** Which rig this agent belongs to (null for town-level) */
  rig: string | null;
  /** Current operational status */
  status: CrewMemberStatus;
  /** Current task description (if working) */
  currentTask?: string;
  /** Number of unread messages */
  unreadMail: number;
  /** First unread message subject (for preview) */
  firstSubject?: string;
  /** Sender of first unread message (for preview) */
  firstFrom?: string;
  /** Current git branch (for polecats) */
  branch?: string;
}

// ============================================================================
// Bead Types
// ============================================================================

/** Bead display info for the UI. */
export interface BeadInfo {
  /** Bead ID (e.g., "gb-53tj") */
  id: string;
  /** Bead title */
  title: string;
  /** Status (open, closed, etc.) */
  status: string;
  /** Priority (0-4, lower = higher priority) */
  priority: number;
  /** Issue type (feature, bug, task, etc.) */
  type: string;
  /** Assignee address or null */
  assignee: string | null;
  /** Rig name extracted from assignee (e.g., "gastown_boy") or null for town-level */
  rig: string | null;
  /** Source database: "town" for hq-*, or rig name for rig-specific beads */
  source: string;
  /** Labels attached to the bead */
  labels: string[];
  /** Creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string | null;
}

/** Extended bead info with full details for detail view. */
export interface BeadDetail extends BeadInfo {
  /** Full description (markdown) */
  description: string;
  /** Timestamp when bead was closed */
  closedAt: string | null;
  /** Hooked bead ID */
  hookBead: string | null;
  /** Role bead ID */
  roleBead: string | null;
  /** Agent state (working, idle, stuck, stale) */
  agentState: string | null;
  /** Whether bead is pinned */
  pinned: boolean;
  /** Dependency relationships */
  dependencies: BeadDependency[];
}

/** Bead dependency relationship. */
export interface BeadDependency {
  /** The bead that has this dependency */
  issueId: string;
  /** The bead it depends on */
  dependsOnId: string;
  /** Dependency type (blocks, blocked_by, etc.) */
  type: string;
}

// ============================================================================
// API Response Types
// ============================================================================

/** Standard API response envelope. */
export interface ApiResponse<T> {
  /** Whether the request succeeded */
  success: boolean;
  /** Response data (present if success=true) */
  data?: T;
  /** Error information (present if success=false) */
  error?: {
    code: string;
    message: string;
    details?: string;
  };
  /** Response timestamp */
  timestamp: string;
}

/** Paginated list response. */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

// Endpoint-specific response types
export type StatusResponse = ApiResponse<GastownStatus>;
export type MailListResponse = ApiResponse<PaginatedResponse<Message>>;
export type MailDetailResponse = ApiResponse<Message>;
export type SendMailResponse = ApiResponse<{ messageId: string }>;
export type PowerResponse = ApiResponse<{
  previousState: PowerState;
  newState: PowerState;
}>;
export type AgentsResponse = ApiResponse<CrewMember[]>;

export * from './epics';
export * from './kanban';
