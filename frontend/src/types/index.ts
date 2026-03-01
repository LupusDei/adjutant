// ============================================================================
// Enums and Primitives
// ============================================================================

/** Communication priority levels for connection management. */
export type CommunicationPriority = 'real-time' | 'efficient' | 'polling-only';

/** Connection status for the communication indicator. */
export type ConnectionStatus = 'websocket' | 'sse' | 'polling' | 'reconnecting' | 'disconnected';

/** Possible statuses for a crew member. */
export type CrewMemberStatus =
  | "idle"
  | "working"
  | "blocked"
  | "stuck"
  | "offline";

/** Agent types in the system. */
export type AgentType =
  | "user"
  | "agent";

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
  /** Which project this agent belongs to (null for unscoped) */
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
  /** Session ID for linking to session chat (swarm) */
  sessionId?: string;
  /** ISO timestamp of last activity (from session registry) */
  lastActivity?: string;
  /** Git worktree path (swarm agents working in worktrees) */
  worktreePath?: string;
  /** Task progress for this agent (completed/total from assigned beads) */
  progress?: { completed: number; total: number };
  /** Which swarm this agent belongs to (swarm mode) */
  swarmId?: string;
  /** Whether this agent is the merge coordinator (swarm mode) */
  isCoordinator?: boolean;
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

/** Epic with server-computed progress from dependency graph. */
export interface EpicWithProgressResponse {
  /** The epic bead info */
  epic: BeadInfo;
  /** Child beads (empty in list view, populated in detail view) */
  children: BeadInfo[];
  /** Total number of children */
  totalCount: number;
  /** Number of closed children */
  closedCount: number;
  /** Progress as a decimal (0-1) */
  progress: number;
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
export type AgentsResponse = ApiResponse<CrewMember[]>;

// ============================================================================
// Chat Message Types (SQLite-backed persistent messages)
// ============================================================================

/** A persistent chat message from the message store. */
export interface ChatMessage {
  id: string;
  sessionId: string | null;
  agentId: string;
  recipient: string | null;
  role: 'user' | 'agent' | 'system' | 'announcement';
  body: string;
  metadata: Record<string, unknown> | null;
  deliveryStatus: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  eventType: string | null;
  threadId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Thread summary from the messages API. */
export interface ChatThread {
  threadId: string;
  messageCount: number;
  latestBody: string;
  latestCreatedAt: string;
  agentId: string;
}

/** Unread count per agent. */
export interface UnreadCount {
  agentId: string;
  count: number;
}

export type ProposalType = 'product' | 'engineering';
export type ProposalStatus = 'pending' | 'accepted' | 'dismissed' | 'completed';

export interface Proposal {
  id: string;
  author: string;
  title: string;
  description: string;
  project: string;
  type: ProposalType;
  status: ProposalStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SessionInfo {
  id: string;
  name: string;
  tmuxSession: string;
  tmuxPane: string;
  projectPath: string;
  status: string;
  workspaceType: string;
  connectedClients: string[];
  pipeActive: boolean;
  createdAt: string;
  lastActivity: string;
}

// ============================================================================
// Project Types
// ============================================================================

/** A registered project in the system. */
export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  gitRemote?: string;
  sessions: string[];
  createdAt: string;
  active: boolean;
  hasBeads?: boolean;
}

/** Health check result for a project. */
export interface ProjectHealth {
  projectId: string;
  pathExists: boolean;
  hasGit: boolean;
  hasBeads: boolean;
  gitRemote?: string;
  status: 'healthy' | 'degraded' | 'stale';
}

export * from './epics';
export * from './kanban';
export * from './beads-graph';
