# Project Context

## What is Adjutant?

A retro terminal themed web UI for interacting with Gastown, a multi-agent orchestration system.

**CRITICAL**: Adjutant is the DASHBOARD for ALL of Gas Town. It runs from `~/gt` and displays:
- **All beads** from `~/gt/.beads/` (town beads, hq-* prefix)
- **All agents** across all rigs (gastown, adjutant, etc.)
- **All mail, convoys, and system state**

The UI is NOT just for the adjutant rig - it's the Mayor's command center for the entire town.
See `00-critical-scope.md` for the full explanation.

## Core Features

1. **Agent Messaging** - MCP-based persistent messaging between agents and user (SQLite store)
2. **Agent Status** - Real-time status, progress, and announcements via MCP tools
3. **Beads Management** - Issue tracker integration via MCP tools wrapping `bd` CLI
4. **Mail Interface** - Split-view inbox/outbox for Mayor communication (legacy gt mail)
5. **Power Controls** - Start/stop Gastown with visual state indication
6. **Crew Stats** - Monitor agent activity and workload
7. **Session Terminal** - Live agent terminal streaming via WebSocket

## Architecture

- **Frontend**: React + TypeScript + Tailwind CSS + Vite
- **Backend**: Node.js + Express + TypeScript
- **Agent Protocol**: MCP via SSE transport (agents connect to `/mcp/sse`)
- **Real-time**: WebSocket `/ws/chat` with SSE fallback
- **Storage**: SQLite for persistent messages, full-text search
- The backend wraps `gt` CLI commands for Gastown operations
- The backend wraps `bd` CLI commands for beads operations (via mutex)

## Key Integration Points

### Gastown (CLI)
- `gt up` / `gt down` - power control
- `gt status --json` - system state
- `gt agents list --all` - crew info

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
│   └── ...               # GT executor, mail, transport, etc.
├── middleware/   # Error handling
├── types/        # TypeScript + Zod schemas
└── utils/        # Response helpers

frontend/src/
├── components/   # React components (chat/, beads/, power/, crew/, shared/)
├── contexts/     # CommunicationContext (WS/SSE/polling), ModeContext
├── hooks/        # Custom hooks (useChatMessages, useAgentStatus, usePolling)
├── services/     # API client
├── styles/       # Tailwind + Pip-Boy theme
└── types/        # Frontend types
```
