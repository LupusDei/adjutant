# Architecture Rules

## Layered Architecture

### Backend Layers

1. **Routes** (`backend/src/routes/`)
   - HTTP request/response handling
   - Input validation (Zod)
   - Call services, return responses

2. **Services** (`backend/src/services/`)
   - Business logic
   - Orchestrate GT commands
   - Transform data for API responses

3. **GT Executor** (`backend/src/services/gt-executor.ts`)
   - Single point for spawning `gt` commands
   - Parse JSON output
   - Handle command errors

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

4. **MCP Server** (`backend/src/services/mcp-server.ts`)
   - SSE-based MCP server agents connect to
   - Tracks agent connections (session ID to agent ID)
   - Server-side identity resolution via `getAgentBySession`

5. **MCP Tools** (`backend/src/services/mcp-tools/`)
   - `messaging.ts` - send_message, read_messages, list_threads, mark_read
   - `status.ts` - set_status, report_progress, announce
   - `beads.ts` - create_bead, update_bead, close_bead, list_beads, show_bead
   - `queries.ts` - query tools for agent context

6. **Message Store** (`backend/src/services/message-store.ts`)
   - SQLite-backed persistent message storage
   - Full-text search via FTS5
   - Cursor-based pagination

7. **WebSocket Server** (`backend/src/services/ws-server.ts`)
   - Real-time chat at `/ws/chat`
   - Auth handshake, sequence numbering, replay buffer
   - Session terminal streaming (v2)

## Data Flow

### Gastown Operations (CLI)
```
User Action → Component → Hook → API Service → Backend Route → Service → GT Executor → gt CLI
                                                                                         ↓
UI Update  ←  Component ←  Hook ←  API Service ←  Backend Route ←  Service ←  JSON output
```

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

## Key Decisions

1. **CLI Wrapper Pattern**: We spawn `gt` commands instead of integrating with Gastown internals
   - Simpler, loosely coupled
   - Uses Gastown's stable CLI interface
   - Works through tunnels (ngrok)

2. **MCP for Agent Communication**: Agents connect via MCP SSE and use tools for messaging, status, and beads
   - Server-side identity resolution (not client-supplied)
   - SQLite message store replaces old beads-based mail for agent chat
   - Real-time delivery via WebSocket broadcast

3. **Multi-Channel Frontend**: WebSocket with SSE and polling fallbacks
   - WebSocket `/ws/chat` preferred for real-time
   - SSE `/api/events` as fallback
   - Polling as last resort
   - Exponential backoff retry between channels

4. **SQLite for Messages**: Persistent message storage with full-text search
   - Replaces beads-based mail for agent-to-user messaging
   - Cursor-based pagination for history
   - Unread counts per agent

## Don't Do

- Don't bypass the GT executor to call `gt` directly
- Don't create complex state management (Redux, etc.)
- Don't use client-supplied metadata for agent identity (use server-side session resolution)
- Don't add `as any` casts for WebSocket message types (extend the union instead)
