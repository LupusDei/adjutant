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

### Question Triage (adj-181)

A first-class, triageable agent question/answer system. Agents file anything they need
from the General — both questions that require a decision/answer AND blocking
tasks/actions only the General can complete — via `file_question` (Rule 5 mandate).

**Data model** (migration `034-agent-questions.sql`):
- `agent_questions(id, project_id, agent_id, body, context, category, suggested_options,
  urgency, status, answer_body, chosen_option, answered_by, bead_id, conversation_id,
  created_at, answered_at, updated_at)`
- `category`: `decision|clarification|approval|action_required|other`
  — `action_required` marks a blocking task the General must DO (not just answer).
- `urgency`: `blocking|high|normal|low` — sort order for the triage view.
- `suggested_options`: JSON string array of agent-proposed answer choices (nullable).
- `conversation_id`: set after DM mirror (adj-i8epe fix); links the question row to the
  asker's existing DM conversation so nothing about today's flow is lost.

**Service**: `backend/src/services/question-service.ts` — the single orchestration point
so BOTH REST (Phase 3) and MCP (Phase 2) trigger identical broadcast + push behaviour.
Routes and MCP tools NEVER call the store, ws-server, or apns-service directly.

**Orchestration per operation**:
```
fileQuestion:
  1. questionStore.fileQuestion — persist the record
  2. conversationStore.getOrCreateDm(asker, "user") — reuse existing DM (Rule 9)
  3. messageStore.insertMessage — mirror question into the DM conversation
  4. questionStore.setConversationId — persist conversationId back to the row (adj-i8epe)
  5. wsBroadcast({ type: "question:new", ... })
  6. sendNotificationToAll — APNS push (blocking/high always; normal/low suppressed, adj-96rtr)

answerQuestion:
  1. questionStore.answerQuestion — persist answer (chosenOption XOR/AND answerBody, ≥1 required)
  2. messageStore.insertMessage — mirror answer into asker's DM
  3. wsBroadcast({ type: "question:answered", ... })
  (no APNS push on answer)

dismissQuestion:
  1. questionStore.dismissQuestion — update status
  2. wsBroadcast({ type: "question:dismissed", ... })
  (no APNS push on dismiss)
```

**Key design decisions**:
- **Reuse DM delivery** (Rule 9): filing a question also writes a normal message into
  the existing DM conversation — the triage system adds structure without replacing chat.
- **single orchestration point**: `question-service.ts` is the only caller of the store,
  WS broadcast, and APNS. This ensures REST and MCP paths are always identical.
- **projectId scoping**: every row stores `project_id` (UUID). All queries, events, and
  API filters use `projectId` — never `projectName` or `projectPath`.
- **Server-side asker identity**: `file_question` resolves the calling agent from the MCP
  session via `getAgentBySession` — never client-supplied.
- **answer-contract**: at least one of `answerBody` or `chosenOption` required. When
  `chosenOption` is present and `suggested_options` are stored, the option MUST be in
  the stored list (validated at the store layer).
- **APNS urgency gating** (adj-96rtr): `blocking` and `high` always push when APNS is
  configured; `normal` and `low` do NOT push (suppressed until a user-pref API exists).
- **file_question mandate** (Constitution Rule 5): `file_question` is the REQUIRED channel
  for ANYTHING an agent needs from the General — both questions AND blocking actions.
  `send_message` is for general comms; it is NOT a substitute for the question queue.

**Routes**: `GET /api/questions` (list with `status|projectId|category|agentId|urgency` filters,
default `status=open`), `POST /api/questions/:id/answer`, `POST /api/questions/:id/dismiss`.
Sort: blocking → high → normal → low, then oldest-first within each tier.

**MCP tools** (`mcp-tools/questions.ts`): `file_question`, `answer_question`, `list_questions`.
Cross-project override via the adj-146 `resolveToolProjectContext` pattern.

**WS events**: `question:new`, `question:answered`, `question:dismissed` — part of the
`WsServerMessage` union in `ws-server.ts`. Broadcast to ALL authenticated clients (same
pattern as DM broadcasts).

**APNS push payload** on `question:new`: title `[URGENCY] Question from <agentId>`,
truncated body, `data.screen = "open_questions"` for iOS deep-link.

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
