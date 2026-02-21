# Implementation Plan: Agent MCP Bridge

**Branch**: `008-agent-mcp-bridge` | **Date**: 2026-02-21
**Epic**: `adj-010` | **Priority**: P1

## Summary

Embed an MCP server in the Adjutant Express backend that exposes messaging, status, bead, and query tools to Claude Code agents. Persist messages in SQLite. Broadcast events to web/iOS frontends via WebSocket. Provide a Claude Code skill suite that auto-configures agent MCP connections.

## Bead Map

- `adj-010` - Root: Agent MCP Bridge
  - `adj-010.1` - Setup: Database Infrastructure (5 tasks)
  - `adj-010.2` - Foundational: MCP Server Core (7 tasks)
  - `adj-010.3` - US1: Agent-to-User Messaging (8 tasks, MVP)
    - `adj-010.3.1` - send_message MCP tool
    - `adj-010.3.2` - read_messages MCP tool
    - `adj-010.3.3` - list_threads MCP tool
    - `adj-010.3.4` - mark_read MCP tool
    - `adj-010.3.5` - WebSocket chat_message broadcasting
    - `adj-010.3.6` - APNS push for agent messages
    - `adj-010.3.7` - /api/messages REST endpoints
    - `adj-010.3.8` - Messaging MCP tool tests
  - `adj-010.4` - US2: Agent Status & Progress (6 tasks)
  - `adj-010.5` - US3: Bead Operations via MCP (6 tasks)
  - `adj-010.6` - US4: Dashboard Queries (4 tasks)
  - `adj-010.7` - US5: Claude Code Agent Skills (4 tasks)
  - `adj-010.8` - Frontend Integration (5 tasks)
  - `adj-010.9` - Polish: Cross-Cutting (5 tasks)

## Technical Context

**Stack**: TypeScript, Node.js, Express
**MCP SDK**: `@modelcontextprotocol/sdk` (Node.js MCP server SDK)
**Storage**: SQLite via `better-sqlite3` at `~/.adjutant/adjutant.db`
**Testing**: Vitest
**Transport**: SSE (Server-Sent Events) for MCP, WebSocket for frontend
**Constraints**: Must work through ngrok tunnels, localhost-first, no auth

## Architecture Decision

### Why MCP over HTTP API

| Dimension | HTTP API (curl) | MCP Server |
|-----------|----------------|------------|
| Agent discovery | None — agents must be told endpoints | Auto-discovery via `.claude/settings.json` |
| Type safety | None — string templating | Full tool schemas with Zod validation |
| Bidirectional | No — agent can only push | Yes — server can push notifications to agent |
| Tool catalog | Manual documentation | Programmatic — agents see all available tools |
| Auth/identity | Manual header management | Connection-level identity |

### Why SSE transport (not stdio)

The MCP server runs inside the already-running Express process. Agents connect via `http://localhost:4201/mcp/sse`. This means:
- Single process — shares SQLite connection, WebSocket bus, session registry
- No child process spawning per agent
- Works through ngrok (HTTP-based)
- Multiple agents connect to the same server

### Data flow

```
Agent (Claude Code)
  ↓ MCP SSE connection
Adjutant Backend (Express + MCP Server)
  ├── SQLite (message persistence)
  ├── WebSocket server (→ web frontend)
  ├── APNS service (→ iOS push)
  └── bd CLI (→ .beads/ for bead ops)
```

## Files Changed

| File | Change |
|------|--------|
| `backend/src/services/mcp-server.ts` | NEW: MCP server setup, SSE transport, tool registration |
| `backend/src/services/mcp-tools/messaging.ts` | NEW: send_message, read_messages, list_threads, mark_read |
| `backend/src/services/mcp-tools/status.ts` | NEW: set_status, report_progress, announce |
| `backend/src/services/mcp-tools/beads.ts` | NEW: create_bead, update_bead, close_bead, list_beads, show_bead |
| `backend/src/services/mcp-tools/queries.ts` | NEW: list_agents, get_project_state, search_messages |
| `backend/src/services/database.ts` | NEW: SQLite singleton (open, migrate, WAL mode) |
| `backend/src/services/message-store.ts` | NEW: Message CRUD with SQLite |
| `backend/src/services/migrations/001-initial.sql` | NEW: messages, threads, agent_connections tables |
| `backend/src/routes/mcp.ts` | NEW: SSE endpoint at /mcp/sse |
| `backend/src/index.ts` | MODIFY: Register MCP routes, init database |
| `backend/src/services/ws-server.ts` | MODIFY: Broadcast message events |
| `.claude/skills/adjutant-agent/SKILL.md` | NEW: Agent skill for MCP tools |
| `.claude/settings.json` | MODIFY: Add MCP server config |
| `frontend/src/components/chat/` | MODIFY: Display MCP-sourced messages |
| `frontend/src/hooks/useChatMessages.ts` | NEW: Hook for persistent messages |
| `ios/AdjutantKit/Sources/AdjutantKit/Models/Message.swift` | MODIFY: Add new message types |

## Phase 1: Database & Storage (Setup)

SQLite infrastructure from adj-010 design. Single file at `~/.adjutant/adjutant.db`.

- `database.ts` — Singleton: open, WAL mode, PRAGMA tuning, migration runner
- `001-initial.sql` — messages, threads tables (subset of adj-010 schema)
- `message-store.ts` — Insert, query, paginate, full-text search, mark read

## Phase 2: MCP Server Core (Foundational)

The MCP server that all tools depend on.

- Install `@modelcontextprotocol/sdk`
- `mcp-server.ts` — Create MCP server instance, SSE transport adapter
- `routes/mcp.ts` — Express route at `/mcp/sse` for SSE connections
- Agent identity derived from connection metadata (session name header or query param)
- Connection lifecycle: track connected agents, emit connect/disconnect events

## Phase 3: Messaging Tools (US1 — MVP)

Core messaging via MCP tools.

- `mcp-tools/messaging.ts`:
  - `send_message` — Store in SQLite + broadcast via WebSocket + APNS push
  - `read_messages` — Query by thread, session, or agent with pagination
  - `list_threads` — List conversation threads with latest message preview
  - `mark_read` — Update delivery status
- Bridge: WebSocket events `chat_message` for real-time frontend delivery
- Bridge: APNS notification for iOS offline delivery

## Phase 4: Status & Announcements (US2)

Structured status reporting tools.

- `mcp-tools/status.ts`:
  - `set_status` — Update agent status (working/blocked/idle/done) + current task
  - `report_progress` — Task progress with percentage and description
  - `announce` — Broadcast announcement (completion/blocker/question)
- Bridge: WebSocket events `agent_status`, `announcement` for dashboard
- Bridge: Store announcements in messages table with special event_type

## Phase 5: Bead Operations (US3)

Type-safe bead operations replacing `bd` CLI for agents.

- `mcp-tools/beads.ts`:
  - `create_bead` — Create via bd-client.ts (existing service)
  - `update_bead` — Update status/fields via bd-client.ts
  - `close_bead` — Close via bd-client.ts
  - `list_beads` — List with filters via bd-client.ts
  - `show_bead` — Get details via bd-client.ts
- Wraps existing `bd-client.ts` service — serializes concurrent access to avoid SIGSEGV

## Phase 6: Dashboard Queries (US4)

Read-only tools for agents to understand system state.

- `mcp-tools/queries.ts`:
  - `list_agents` — Active agents with status, task, session info
  - `get_project_state` — Summary: open beads, active agents, recent messages
  - `search_messages` — Full-text search via FTS5

## Phase 7: Agent Skills (US5)

Claude Code skill and configuration.

- `.claude/skills/adjutant-agent/SKILL.md` — Skill with tool usage guide
- `.claude/settings.json` — MCP server configuration (auto-connect)
- References: tool catalog, message format examples

## Phase 8: Frontend Integration

Web dashboard displays MCP-sourced messages.

- `useChatMessages.ts` — Hook: fetch from `/api/messages` + WebSocket subscription
- Update chat components to render persistent messages alongside streaming output
- Announcement toast/banner component

## Phase 9: Polish

- Full-text search UI
- Message pagination in chat view
- Error handling and retry logic for MCP connections
- Tests for all MCP tools
- Documentation updates

## Parallel Execution

```
Phase 1 (Database) ──────────────────┐
                                      ├──► Phase 3 (Messaging) ──┐
Phase 2 (MCP Server) ────────────────┘                           │
                                                                  ├──► Phase 8 (Frontend)
Phase 4 (Status) ─────── [after Phase 2] ────────────────────────┤
Phase 5 (Beads) ──────── [after Phase 2] ────────────────────────┤
Phase 6 (Queries) ─────── [after Phase 2, 1] ───────────────────┘
Phase 7 (Skills) ──────── [after Phase 2] (independent)
Phase 9 (Polish) ──────── [after all]
```

- Phases 1 & 2 can run in parallel (different files, no deps)
- After Phase 2, Phases 4, 5, 6, 7 can all run in parallel
- Phase 3 needs both Phase 1 (SQLite) and Phase 2 (MCP server)
- Phase 8 needs Phase 3 (messages to display)

## Verification Steps

- [ ] Agent connects to MCP via SSE and tool list is returned
- [ ] `send_message` creates SQLite row and WebSocket event fires
- [ ] Message appears in web dashboard within 2 seconds
- [ ] APNS push received on iOS for agent messages
- [ ] `create_bead` creates bead in .beads/issues.jsonl
- [ ] Agent skill auto-connects new Claude Code sessions
- [ ] Messages persist across backend restart
- [ ] Full-text search returns correct results
- [ ] No SIGSEGV from concurrent bead operations through MCP
