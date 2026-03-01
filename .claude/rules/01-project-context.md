# Project Context

## What is Adjutant?

A retro terminal themed web dashboard for multi-agent orchestration, backed by beads (issue tracking) and MCP (agent communication).

## Core Features

1. **Agent Messaging** - MCP-based persistent messaging between agents and user (SQLite store)
2. **Agent Status** - Real-time status, progress, and announcements via MCP tools
3. **Beads Management** - Issue tracker integration via MCP tools wrapping `bd` CLI
4. **Crew Stats** - Monitor agent activity and workload
5. **Session Terminal** - Live agent terminal streaming via WebSocket

## Architecture

- **Frontend**: React + TypeScript + Tailwind CSS + Vite
- **Backend**: Node.js + Express + TypeScript
- **Agent Protocol**: MCP via SSE transport (agents connect to `/mcp/sse`)
- **Real-time**: WebSocket `/ws/chat` with SSE fallback
- **Storage**: SQLite for persistent messages, full-text search
- The backend wraps `bd` CLI commands for beads operations (via mutex)

## Key Integration Points

### Agent MCP Bridge
- `GET /mcp/sse` - SSE endpoint for agent connections
- `POST /mcp/messages` - MCP JSON-RPC message routing
- Tools: send_message, read_messages, set_status, report_progress, announce, create_bead, close_bead, etc.
- Identity resolved server-side via session map (not client-supplied)

### Messaging REST API
- `GET /api/messages` - List messages (filter by agent, thread, pagination)
- `POST /api/messages` - User sends message
- `GET /api/messages/unread` - Unread counts per agent
- WebSocket broadcasts `chat_message` events in real-time

## Project Structure

```
backend/src/
├── routes/           # Express handlers (REST + MCP SSE)
├── services/
│   ├── mcp-server.ts     # MCP server + agent connection tracking
│   ├── mcp-tools/        # MCP tool handlers (messaging, status, beads, queries)
│   ├── message-store.ts  # SQLite persistent message store
│   ├── ws-server.ts      # WebSocket server for real-time chat
│   ├── database.ts       # SQLite database + migrations
│   ├── bd-client.ts      # Beads CLI wrapper
│   └── ...               # Other services
├── middleware/   # Error handling
├── types/        # TypeScript + Zod schemas
└── utils/        # Response helpers

frontend/src/
├── components/   # React components (chat/, beads/, crew/, shared/)
├── contexts/     # CommunicationContext (WS/SSE/polling)
├── hooks/        # Custom hooks (useChatMessages, useAgentStatus, usePolling)
├── services/     # API client
├── styles/       # Tailwind + retro terminal theme
└── types/        # Frontend types
```
