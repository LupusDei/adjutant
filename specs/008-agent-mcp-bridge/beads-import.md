# Agent MCP Bridge - Beads

**Feature**: 008-agent-mcp-bridge
**Generated**: 2026-02-21
**Source**: specs/008-agent-mcp-bridge/tasks.md

## Root Epic

- **ID**: adj-010
- **Title**: Agent MCP Bridge — Messaging, Status, Beads, and Query Tools
- **Type**: epic
- **Priority**: 1
- **Description**: Replace beads-mail and HTTP curl with an MCP server embedded in Adjutant backend. Provides typed tools for agent-to-user messaging, status reporting, bead operations, and dashboard queries. Includes Claude Code skills for auto-discovery.

## Epics

### Setup: Database Infrastructure
- **ID**: adj-010.1
- **Type**: epic
- **Priority**: 1
- **Description**: SQLite via better-sqlite3 at ~/.adjutant/adjutant.db. WAL mode, migration runner, message-store service.
- **Tasks**: 5

### Foundational: MCP Server Core
- **ID**: adj-010.2
- **Type**: epic
- **Priority**: 1
- **Description**: MCP protocol server with SSE transport, agent identity, connection lifecycle. Blocks all tool implementations.
- **Blocks**: US1, US2, US3, US4, US5
- **Tasks**: 7

### US1: Agent-to-User Messaging
- **ID**: adj-010.3
- **Type**: epic
- **Priority**: 1
- **MVP**: true
- **Description**: send_message, read_messages, list_threads, mark_read MCP tools. SQLite persistence + WebSocket broadcast + APNS push.
- **Tasks**: 8

### US2: Agent Status & Progress
- **ID**: adj-010.4
- **Type**: epic
- **Priority**: 1
- **Description**: set_status, report_progress, announce MCP tools. Real-time dashboard updates via WebSocket.
- **Tasks**: 6

### US3: Bead Operations via MCP
- **ID**: adj-010.5
- **Type**: epic
- **Priority**: 2
- **Description**: create_bead, update_bead, close_bead, list_beads, show_bead MCP tools. Wraps bd-client.ts with serialization.
- **Tasks**: 6

### US4: Dashboard Queries
- **ID**: adj-010.6
- **Type**: epic
- **Priority**: 2
- **Description**: list_agents, get_project_state, search_messages MCP tools. Read-only system introspection.
- **Tasks**: 4

### US5: Agent Skills
- **ID**: adj-010.7
- **Type**: epic
- **Priority**: 1
- **Description**: Claude Code skill suite + .claude/settings.json config for auto-connect. Agent identity injection.
- **Tasks**: 4

### Frontend Integration
- **ID**: adj-010.8
- **Type**: epic
- **Priority**: 2
- **Description**: useChatMessages and useAgentStatus hooks, persistent message rendering, announcement banner.
- **Tasks**: 5

### Polish: Cross-Cutting
- **ID**: adj-010.9
- **Type**: epic
- **Priority**: 3
- **Description**: Retry logic, pagination UI, search UI, remove legacy beads-mail, documentation.
- **Depends**: US1, US2, US3, US4, US5
- **Tasks**: 5

## Tasks

### Setup: Database Infrastructure

| ID | Title | Path | Bead |
|----|-------|------|------|
| T001 | Install better-sqlite3 dependency | backend/package.json | adj-010.1.1 |
| T002 | Create database singleton with WAL mode | backend/src/services/database.ts | adj-010.1.2 |
| T003 | Create migration runner and initial schema | backend/src/services/migrations/001-initial.sql | adj-010.1.3 |
| T004 | Create message-store service | backend/src/services/message-store.ts | adj-010.1.4 |
| T005 | Write database and message-store tests | backend/tests/unit/message-store.test.ts | adj-010.1.5 |

### Foundational: MCP Server Core

| ID | Title | Path | Bead |
|----|-------|------|------|
| T006 | Install @modelcontextprotocol/sdk | backend/package.json | adj-010.2.1 |
| T007 | Create MCP server with SSE transport | backend/src/services/mcp-server.ts | adj-010.2.2 |
| T008 | Create SSE Express route at /mcp/sse | backend/src/routes/mcp.ts | adj-010.2.3 |
| T009 | Implement agent identity resolution | backend/src/services/mcp-server.ts | adj-010.2.4 |
| T010 | Add connection lifecycle tracking | backend/src/services/mcp-server.ts | adj-010.2.5 |
| T011 | Register MCP routes and init DB on startup | backend/src/index.ts | adj-010.2.6 |
| T012 | Write MCP server connection tests | backend/tests/unit/mcp-server.test.ts | adj-010.2.7 |

### US1: Agent-to-User Messaging

| ID | Title | Path | Bead |
|----|-------|------|------|
| T013 | Implement send_message MCP tool | backend/src/services/mcp-tools/messaging.ts | adj-010.3.1 |
| T014 | Implement read_messages MCP tool | backend/src/services/mcp-tools/messaging.ts | adj-010.3.2 |
| T015 | Implement list_threads MCP tool | backend/src/services/mcp-tools/messaging.ts | adj-010.3.3 |
| T016 | Implement mark_read MCP tool | backend/src/services/mcp-tools/messaging.ts | adj-010.3.4 |
| T017 | Add WebSocket chat_message broadcasting | backend/src/services/ws-server.ts | adj-010.3.5 |
| T018 | Add APNS push for agent messages | backend/src/services/mcp-tools/messaging.ts | adj-010.3.6 |
| T019 | Create /api/messages REST endpoints | backend/src/routes/messages.ts | adj-010.3.7 |
| T020 | Write messaging MCP tool tests | backend/tests/unit/mcp-messaging.test.ts | adj-010.3.8 |

### US2: Agent Status & Progress

| ID | Title | Path | Bead |
|----|-------|------|------|
| T021 | Implement set_status MCP tool | backend/src/services/mcp-tools/status.ts | adj-010.4.1 |
| T022 | Implement report_progress MCP tool | backend/src/services/mcp-tools/status.ts | adj-010.4.2 |
| T023 | Implement announce MCP tool | backend/src/services/mcp-tools/status.ts | adj-010.4.3 |
| T024 | Add WebSocket agent_status and announcement events | backend/src/services/ws-server.ts | adj-010.4.4 |
| T025 | Store announcements in messages table | backend/src/services/mcp-tools/status.ts | adj-010.4.5 |
| T026 | Write status MCP tool tests | backend/tests/unit/mcp-status.test.ts | adj-010.4.6 |

### US3: Bead Operations via MCP

| ID | Title | Path | Bead |
|----|-------|------|------|
| T027 | Implement create_bead MCP tool | backend/src/services/mcp-tools/beads.ts | adj-010.5.1 |
| T028 | Implement update_bead MCP tool | backend/src/services/mcp-tools/beads.ts | adj-010.5.2 |
| T029 | Implement close_bead MCP tool | backend/src/services/mcp-tools/beads.ts | adj-010.5.3 |
| T030 | Implement list_beads and show_bead MCP tools | backend/src/services/mcp-tools/beads.ts | adj-010.5.4 |
| T031 | Add serialization for concurrent bd access | backend/src/services/mcp-tools/beads.ts | adj-010.5.5 |
| T032 | Write bead MCP tool tests | backend/tests/unit/mcp-beads.test.ts | adj-010.5.6 |

### US4: Dashboard Queries

| ID | Title | Path | Bead |
|----|-------|------|------|
| T033 | Implement list_agents MCP tool | backend/src/services/mcp-tools/queries.ts | adj-010.6.1 |
| T034 | Implement get_project_state MCP tool | backend/src/services/mcp-tools/queries.ts | adj-010.6.2 |
| T035 | Implement search_messages MCP tool | backend/src/services/mcp-tools/queries.ts | adj-010.6.3 |
| T036 | Write query MCP tool tests | backend/tests/unit/mcp-queries.test.ts | adj-010.6.4 |

### US5: Agent Skills

| ID | Title | Path | Bead |
|----|-------|------|------|
| T037 | Create adjutant-agent skill SKILL.md | .claude/skills/adjutant-agent/SKILL.md | adj-010.7.1 |
| T038 | Create skill references and tool catalog | .claude/skills/adjutant-agent/references/ | adj-010.7.2 |
| T039 | Configure MCP server in .claude/settings.json | .claude/settings.json | adj-010.7.3 |
| T040 | Add agent identity env var to session creation | backend/src/services/session-bridge.ts | adj-010.7.4 |

### Frontend Integration

| ID | Title | Path | Bead |
|----|-------|------|------|
| T041 | Create useChatMessages hook | frontend/src/hooks/useChatMessages.ts | adj-010.8.1 |
| T042 | Create useAgentStatus hook | frontend/src/hooks/useAgentStatus.ts | adj-010.8.2 |
| T043 | Update chat components for persistent messages | frontend/src/components/chat/ | adj-010.8.3 |
| T044 | Create announcement banner component | frontend/src/components/shared/AnnouncementBanner.tsx | adj-010.8.4 |
| T045 | Write useChatMessages tests | frontend/tests/unit/useChatMessages.test.ts | adj-010.8.5 |

### Polish: Cross-Cutting

| ID | Title | Path | Bead |
|----|-------|------|------|
| T046 | Add MCP connection retry with backoff | backend/src/services/mcp-server.ts | adj-010.9.1 |
| T047 | Add message pagination to chat view | frontend/src/components/chat/ | adj-010.9.2 |
| T048 | Add full-text search UI | frontend/src/components/chat/ | adj-010.9.3 |
| T049 | Remove legacy beads-mail swarm code paths | backend/src/services/transport/ | adj-010.9.4 |
| T050 | Update project docs with MCP messaging | CLAUDE.md | adj-010.9.5 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| Setup (Database) | 5 | 1 | adj-010.1 |
| Foundational (MCP Server) | 7 | 1 | adj-010.2 |
| US1: Messaging (MVP) | 8 | 1 | adj-010.3 |
| US2: Status | 6 | 1 | adj-010.4 |
| US3: Beads | 6 | 2 | adj-010.5 |
| US4: Queries | 4 | 2 | adj-010.6 |
| US5: Skills | 4 | 1 | adj-010.7 |
| Frontend | 5 | 2 | adj-010.8 |
| Polish | 5 | 3 | adj-010.9 |
| **Total** | **50** | | |

## Dependency Graph

```
Setup (adj-010.1) ──────────────────┐
                                     ├──► US1: Messaging (adj-010.3) ──► Frontend (adj-010.8)
Foundational (adj-010.2) ───────────┤
  │                                  │
  ├──► US2: Status (adj-010.4) ─────┤
  ├──► US3: Beads (adj-010.5) ──────┤
  ├──► US4: Queries (adj-010.6) ────┘
  └──► US5: Skills (adj-010.7)       ──► Polish (adj-010.9)

Critical Path: Setup + MCP Server → Messaging → Frontend → Polish
```

## MVP Scope

- Setup: 5 tasks
- Foundational: 7 tasks
- US1 (Messaging): 8 tasks
- **Total MVP**: 20 tasks
