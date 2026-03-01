import { z } from "zod";

// ============================================================================
// Enums and Primitives
// ============================================================================

/** Priority levels for messages. Lower number = higher priority. */
export type MessagePriority = 0 | 1 | 2 | 3 | 4;

/** Message types indicating the purpose of the message. */
export type MessageType = "notification" | "task" | "scavenge" | "reply";

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
 * Swarm roles: user, agent
 * Extensible via string for custom deployments.
 */
export type AgentType =
  | "user"
  | "agent"
  // Extensibility for custom deployments
  | (string & {});

// ============================================================================
// Message Types
// ============================================================================

/** A mail message in the system. */
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
  /** True if this is an infrastructure/coordination message */
  isInfrastructure: boolean;
}

/** Request payload for sending a new message. */
export interface SendMessageRequest {
  /** Recipient address (default: "mayor/") */
  to?: string | undefined;
  /** Sender address (default: resolved from environment) */
  from?: string | undefined;
  /** Message subject (required) */
  subject: string;
  /** Message body (required) */
  body: string;
  /** Priority level (default: 2) */
  priority?: MessagePriority | undefined;
  /** Message type (default: 'task') */
  type?: MessageType | undefined;
  /** ID of message being replied to */
  replyTo?: string | undefined;
  /** If true, append reply instructions with message ID to body */
  includeReplyInstructions?: boolean | undefined;
}

// ============================================================================
// Agent Status Types
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
  unreadMail?: number;
  /** First unread message subject (for preview) */
  firstSubject?: string;
  /** Sender of first unread message (for preview) */
  firstFrom?: string;
  /** Current git branch */
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
// Project Context Types
// ============================================================================

/**
 * Project context carried through MCP sessions.
 * Enables project-scoped bead operations for multi-project support.
 * Null/undefined means legacy agent — fall back to workspace singleton.
 */
export interface ProjectContext {
  /** Registered project ID */
  projectId: string;
  /** Absolute path to project root */
  projectPath: string;
  /** Resolved .beads/ directory for this project */
  beadsDir: string;
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
// Zod Schemas (for runtime validation)
// ============================================================================

export const MessagePrioritySchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

export const MessageTypeSchema = z.enum([
  "notification",
  "task",
  "scavenge",
  "reply",
]);

export const CrewMemberStatusSchema = z.enum([
  "idle",
  "working",
  "blocked",
  "stuck",
  "offline",
]);

export const AgentTypeSchema = z.union([
  z.enum([
    "user",
    "agent",
  ]),
  // Allow any string for extensibility
  z.string(),
]);

export const MessageSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  subject: z.string(),
  body: z.string(),
  timestamp: z.string(),
  read: z.boolean(),
  priority: MessagePrioritySchema,
  type: MessageTypeSchema,
  threadId: z.string(),
  replyTo: z.string().optional(),
  pinned: z.boolean(),
  cc: z.array(z.string()).optional(),
  isInfrastructure: z.boolean(),
});

export const SendMessageRequestSchema = z.object({
  to: z.string().optional().default("user"),
  from: z.string().optional(),
  subject: z.string().min(1, "Subject is required"),
  body: z.string().min(1, "Message body is required"),
  priority: MessagePrioritySchema.optional(),
  type: MessageTypeSchema.optional(),
  replyTo: z.string().optional(),
  includeReplyInstructions: z.boolean().optional(),
});

export const AgentStatusSchema = z.object({
  name: z.string(),
  running: z.boolean(),
  pinnedWork: z.array(z.string()).optional(),
  unreadMail: z.number(),
  firstMessageSubject: z.string().optional(),
  state: z.enum(["stuck", "awaiting-gate", "idle", "working"]).optional(),
});

export const CrewMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: AgentTypeSchema,
  rig: z.string().nullable(),
  status: CrewMemberStatusSchema,
  currentTask: z.string().optional(),
  unreadMail: z.number().optional(),
  firstSubject: z.string().optional(),
  firstFrom: z.string().optional(),
  branch: z.string().optional(),
  sessionId: z.string().optional(),
  lastActivity: z.string().optional(),
  worktreePath: z.string().optional(),
  progress: z
    .object({ completed: z.number(), total: z.number() })
    .optional(),
  swarmId: z.string().optional(),
  isCoordinator: z.boolean().optional(),
});

export const ProjectContextSchema = z.object({
  projectId: z.string(),
  projectPath: z.string(),
  beadsDir: z.string(),
});
