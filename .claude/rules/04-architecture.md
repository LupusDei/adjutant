# Architecture Rules

## Layered Architecture

### Backend Layers

1. **Routes** (`backend/src/routes/`)
   - HTTP request/response handling
   - Input validation (Zod)
   - Call services, return responses

2. **Services** (`backend/src/services/`)
   - Business logic
   - Orchestrate beads operations via bd-client
   - Transform data for API responses

3. **MCP Server** (`backend/src/services/mcp-server.ts`)
   - SSE-based MCP server agents connect to
   - Tracks agent connections (session ID to agent ID)
   - Server-side identity resolution via `getAgentBySession`

4. **MCP Tools** (`backend/src/services/mcp-tools/`)
   - `messaging.ts` - send_message, read_messages, list_threads, mark_read
   - `status.ts` - set_status, report_progress, announce
   - `beads.ts` - create_bead, update_bead, close_bead, list_beads, show_bead
   - `queries.ts` - query tools for agent context

5. **Message Store** (`backend/src/services/message-store.ts`)
   - SQLite-backed persistent message storage
   - Full-text search via FTS5
   - Cursor-based pagination

6. **WebSocket Server** (`backend/src/services/ws-server.ts`)
   - Real-time chat at `/ws/chat`
   - Auth handshake, sequence numbering, replay buffer
   - Session terminal streaming (v2)

### Frontend Layers

1. **Components** (`frontend/src/components/`)
   - UI rendering
   - Event handling
   - Use hooks for data

2. **Hooks** (`frontend/src/hooks/`)
   - State management
   - API calls via api service
   - Polling logic

3. **API Service** (`frontend/src/services/api.ts`)
   - HTTP requests to backend
   - Response typing

## Data Flow

### Agent Messaging (MCP)
```
Agent → MCP SSE Transport → MCP Tool Handler → Message Store (SQLite)
                                                      ↓
Frontend  ←  WebSocket broadcast  ←  wsBroadcast  ←  chat_message event
```

### User Messaging (REST + WS)
```
User → POST /api/messages → Message Store (SQLite) → wsBroadcast → WebSocket clients
```

### Conversation Model & Channels (adj-164)

The unified chat model. One first-class `conversation` entity backs BOTH 1:1 DMs and
multi-party channels — never build them as two systems (Rule 9).

**Schema** (migration `033-conversations.sql`):
- `conversations(id, kind['dm'|'channel'], title, archived, created_at, updated_at)`
- `conversation_members(conversation_id, member_id, member_kind['user'|'agent'], role, joined_at, last_read_at)` — PK `(conversation_id, member_id)`
- `messages.conversation_id` — every new message sets it; the single scoping key.

**Service**: `backend/src/services/conversation-store.ts`
- `getOrCreateDm(a, b)` / `dmConversationId(a, b)` — deterministic `dm_<sha1(sorted pair)>`
  id (order-independent), so a pair maps to the same conversation across REST/WS/MCP.
- Channel methods: `createChannel`, `listChannels`, `joinChannel`, `leaveChannel`,
  `postToChannel` (enforces membership), unread via `last_read_at` watermark.

**Routes**: `routes/conversations.ts` (`GET /api/conversations`, `/dm/:agentId`,
`/:id/messages`) and `routes/channels.ts` (`POST /api/channels`, `GET /api/channels`,
`/:id/join`, `/:id/leave`, `/:id/messages`).

**MCP tools**: `mcp-tools/channels.ts` (`create_channel`, `list_channels`, `join_channel`,
`leave_channel`); `send_message` accepts `conversationId` to post to a channel.

**Real-time fan-out** (`ws-server.ts`):
```
DM:      wsBroadcast → ALL authenticated clients (scoped client-side by conversationId)
Channel: wsBroadcastToConversation(id) → ONLY members who are subscribed (fail-closed)
```
- WS sync/replay (`clientMayReceive`) gates ONLY channel-kind conversations on membership;
  DMs replay freely (they are broadcast + client-scoped). This closes the channel
  sync-replay leak (adj-2jy4u) without dropping DM history.
- `wsBroadcastToConversation` resolves membership via the conversation store and delivers
  only to member + subscribed clients. Non-members never receive channel traffic.

**Bleed-free contract**: `getMessages({conversationId})` and `searchMessages({conversationId})`
scope STRICTLY to one conversation — no agent/recipient widening. Both web and iOS scope
all reads/writes/real-time by `conversationId`.

## Key Decisions

1. **MCP for Agent Communication**: Agents connect via MCP SSE and use tools for messaging, status, and beads
   - Server-side identity resolution (not client-supplied)
   - SQLite message store for persistent agent chat
   - Real-time delivery via WebSocket broadcast

2. **Multi-Channel Frontend**: WebSocket with SSE and polling fallbacks
   - WebSocket `/ws/chat` preferred for real-time
   - SSE `/api/events` as fallback
   - Polling as last resort
   - Exponential backoff retry between channels

3. **SQLite for Messages**: Persistent message storage with full-text search
   - Cursor-based pagination for history
   - Unread counts per agent

4. **bd CLI for Beads**: Issue tracking via `bd` CLI wrapper
   - Serialized through mutex to prevent concurrent access
   - Supports epics, tasks, bugs with hierarchical dependencies

## Project Identity

The system uses three project identifiers with distinct roles:

1. **projectId** (UUID) — The canonical identifier for all backend operations
   - Store in databases, emit in events, pass in API calls, use in filters
   - Example: `"a1b2c3d4-e5f6-7890-abcd-ef1234567890"`
   - All MCP tools, services, and event emissions MUST use projectId

2. **projectName** (string) — Display-only, for frontend and iOS
   - Never use as a database key, filter value, or event field
   - Never store as a foreign reference in other tables
   - Example: `"adjutant"`

3. **projectPath** (filesystem path) — Agent CWD and beads resolution only
   - Used to set working directory when spawning agents
   - Used to locate `.beads/` directory for bd CLI operations
   - Never use to query project information

### Don't Do

- Don't pass `projectName` where `projectId` is expected
- Don't use `[projectId, projectName]` arrays for dual-matching (legacy shim, being removed)
- Don't store `projectName` in proposal, event, or bead records — always store UUID
- Don't use `projectPath` to identify a project — use `projectId`

## Don't Do

- Don't create complex state management (Redux, etc.)
- Don't use client-supplied metadata for agent identity (use server-side session resolution)
- Don't add `as any` casts for WebSocket message types (extend the union instead)
