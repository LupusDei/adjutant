# Data Model: Pip-Boy UI for Gastown

**Date**: 2026-01-11
**Feature**: 001-pipboy-ui
**Source**: spec.md entities + gastown CLI research

## Overview

The Adjutant UI is stateless - all data originates from gastown via CLI commands. This document defines the TypeScript types that represent gastown data in our application.

## Core Entities

### Message

Represents a mail message between the user and gastown agents (primarily the Mayor).

```typescript
/**
 * Priority levels for messages.
 * Lower number = higher priority.
 */
export type MessagePriority = 0 | 1 | 2 | 3 | 4;

/**
 * Message types indicating the purpose of the message.
 */
export type MessageType = 'notification' | 'task' | 'scavenge' | 'reply';

/**
 * A mail message in the gastown system.
 * Maps to gastown's internal/mail/types.go Message struct.
 */
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

/**
 * Request payload for sending a new message.
 */
export interface SendMessageRequest {
  /** Recipient address (default: "mayor/") */
  to?: string;

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
}
```

### GastownState

Represents the operational state of the gastown system.

```typescript
/**
 * Possible states for the gastown system.
 */
export type PowerState = 'stopped' | 'starting' | 'running' | 'stopping';

/**
 * Overall gastown system status.
 */
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

/**
 * Status of a single agent.
 */
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
  state?: 'stuck' | 'awaiting-gate' | 'idle' | 'working';
}

/**
 * Status of agents within a single rig (project).
 */
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
```

### CrewMember

Represents a participant in the gastown workspace (derived from AgentStatus for UI display).

```typescript
/**
 * Possible statuses for a crew member.
 */
export type CrewMemberStatus = 'idle' | 'working' | 'blocked' | 'stuck' | 'offline';

/**
 * A crew member displayed in the stats dashboard.
 * Simplified view of agent data for UI consumption.
 */
export interface CrewMember {
  /** Unique identifier (e.g., "greenplace/Toast") */
  id: string;

  /** Display name */
  name: string;

  /** Agent type for icon/styling */
  type: 'mayor' | 'deacon' | 'witness' | 'refinery' | 'crew' | 'polecat';

  /** Which rig this agent belongs to (null for town-level) */
  rig: string | null;

  /** Current operational status */
  status: CrewMemberStatus;

  /** Current task description (if working) */
  currentTask?: string;

  /** Number of unread messages */
  unreadMail: number;
}
```

## API Response Types

### Standard API Response Wrapper

```typescript
/**
 * Standard API response envelope.
 */
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

/**
 * Paginated list response.
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}
```

### Endpoint-Specific Response Types

```typescript
/** GET /api/status response */
export type StatusResponse = ApiResponse<GastownStatus>;

/** GET /api/mail response */
export type MailListResponse = ApiResponse<PaginatedResponse<Message>>;

/** GET /api/mail/:id response */
export type MailDetailResponse = ApiResponse<Message>;

/** POST /api/mail response */
export type SendMailResponse = ApiResponse<{ messageId: string }>;

/** POST /api/power/up or /api/power/down response */
export type PowerResponse = ApiResponse<{
  previousState: PowerState;
  newState: PowerState;
}>;

/** GET /api/agents response */
export type AgentsResponse = ApiResponse<CrewMember[]>;
```

## Validation Schemas (Zod)

Per constitution principle I (Type Safety First), all API boundary data must be validated.

```typescript
import { z } from 'zod';

export const MessageSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  subject: z.string(),
  body: z.string(),
  timestamp: z.string().datetime(),
  read: z.boolean(),
  priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  type: z.enum(['notification', 'task', 'scavenge', 'reply']),
  threadId: z.string(),
  replyTo: z.string().optional(),
  pinned: z.boolean(),
  cc: z.array(z.string()).optional(),
});

export const SendMessageRequestSchema = z.object({
  to: z.string().optional().default('mayor/'),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Message body is required'),
  priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  type: z.enum(['notification', 'task', 'scavenge', 'reply']).optional(),
  replyTo: z.string().optional(),
});

export const AgentStatusSchema = z.object({
  name: z.string(),
  running: z.boolean(),
  pinnedWork: z.array(z.string()).optional(),
  unreadMail: z.number(),
  firstMessageSubject: z.string().optional(),
  state: z.enum(['stuck', 'awaiting-gate', 'idle', 'working']).optional(),
});

export const PowerStateSchema = z.enum(['stopped', 'starting', 'running', 'stopping']);
```

## State Transitions

### PowerState Transitions

```
           ┌─────────┐
           │ stopped │
           └────┬────┘
                │ gt up
                ▼
           ┌──────────┐
           │ starting │
           └────┬─────┘
                │ agents ready
                ▼
           ┌─────────┐
      ┌────│ running │────┐
      │    └─────────┘    │
      │ gt down           │ gt up (idempotent)
      ▼                   │
┌──────────┐              │
│ stopping │              │
└────┬─────┘              │
     │ agents stopped     │
     ▼                    │
┌─────────┐               │
│ stopped │◄──────────────┘
└─────────┘
```

### Message State Transitions

```
┌──────────┐   mark-read   ┌────────┐
│  unread  │──────────────►│  read  │
└──────────┘               └───┬────┘
                               │ archive
                               ▼
                          ┌──────────┐
                          │ archived │
                          └──────────┘
```

## Relationships

```
GastownStatus
    │
    ├── town (1:1)
    ├── operator (1:1)
    ├── infrastructure
    │       ├── mayor (1:1 AgentStatus)
    │       ├── deacon (1:1 AgentStatus)
    │       └── daemon (1:1 AgentStatus)
    │
    └── rigs (1:N RigStatus)
            ├── witness (1:1 AgentStatus)
            ├── refinery (1:1 AgentStatus)
            ├── crew (1:N AgentStatus)
            ├── polecats (1:N AgentStatus)
            └── mergeQueue (1:1)

Message
    │
    ├── threadId ──► groups related messages
    └── replyTo ───► references parent message
```
