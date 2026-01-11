import { z } from "zod";

// ============================================================================
// Enums and Primitives
// ============================================================================

/** Priority levels for messages. Lower number = higher priority. */
export type MessagePriority = 0 | 1 | 2 | 3 | 4;

/** Message types indicating the purpose of the message. */
export type MessageType = "notification" | "task" | "scavenge" | "reply";

/** Possible states for the gastown system. */
export type PowerState = "stopped" | "starting" | "running" | "stopping";

/** Possible statuses for a crew member. */
export type CrewMemberStatus =
  | "idle"
  | "working"
  | "blocked"
  | "stuck"
  | "offline";

/** Agent types in gastown. */
export type AgentType =
  | "mayor"
  | "deacon"
  | "witness"
  | "refinery"
  | "crew"
  | "polecat";

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
  to?: string | undefined;
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

export const PowerStateSchema = z.enum([
  "stopped",
  "starting",
  "running",
  "stopping",
]);

export const CrewMemberStatusSchema = z.enum([
  "idle",
  "working",
  "blocked",
  "stuck",
  "offline",
]);

export const AgentTypeSchema = z.enum([
  "mayor",
  "deacon",
  "witness",
  "refinery",
  "crew",
  "polecat",
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
});

export const SendMessageRequestSchema = z.object({
  to: z.string().optional().default("mayor/"),
  subject: z.string().min(1, "Subject is required"),
  body: z.string().min(1, "Message body is required"),
  priority: MessagePrioritySchema.optional(),
  type: MessageTypeSchema.optional(),
  replyTo: z.string().optional(),
});

export const AgentStatusSchema = z.object({
  name: z.string(),
  running: z.boolean(),
  pinnedWork: z.array(z.string()).optional(),
  unreadMail: z.number(),
  firstMessageSubject: z.string().optional(),
  state: z.enum(["stuck", "awaiting-gate", "idle", "working"]).optional(),
});

export const RigStatusSchema = z.object({
  name: z.string(),
  path: z.string(),
  witness: AgentStatusSchema,
  refinery: AgentStatusSchema,
  crew: z.array(AgentStatusSchema),
  polecats: z.array(AgentStatusSchema),
  mergeQueue: z.object({
    pending: z.number(),
    inFlight: z.number(),
    blocked: z.number(),
  }),
});

export const GastownStatusSchema = z.object({
  powerState: PowerStateSchema,
  town: z.object({
    name: z.string(),
    root: z.string(),
  }),
  operator: z.object({
    name: z.string(),
    email: z.string(),
    unreadMail: z.number(),
  }),
  infrastructure: z.object({
    mayor: AgentStatusSchema,
    deacon: AgentStatusSchema,
    daemon: AgentStatusSchema,
  }),
  rigs: z.array(RigStatusSchema),
  fetchedAt: z.string(),
});

export const CrewMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: AgentTypeSchema,
  rig: z.string().nullable(),
  status: CrewMemberStatusSchema,
  currentTask: z.string().optional(),
  unreadMail: z.number(),
});
