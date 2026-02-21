# Tasks: Agent MCP Bridge

**Input**: Design documents from `/specs/008-agent-mcp-bridge/`
**Epic**: `adj-010`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1-US5)

---

## Phase 1: Setup — Database Infrastructure

**Purpose**: SQLite persistence layer for messages and state

- [ ] T001 [P] Install better-sqlite3 and @types/better-sqlite3 in backend/package.json
- [ ] T002 Create database singleton with WAL mode and PRAGMA tuning in backend/src/services/database.ts
- [ ] T003 Create migration runner and 001-initial.sql in backend/src/services/migrations/001-initial.sql
- [ ] T004 Create message-store service with insert, query, paginate, FTS5 search in backend/src/services/message-store.ts
- [ ] T005 Write tests for database singleton and message-store in backend/tests/unit/message-store.test.ts

**Checkpoint**: SQLite operational, messages can be stored and queried

---

## Phase 2: Foundational — MCP Server Core

**Purpose**: MCP protocol server that all tools depend on. BLOCKS all tool implementations.

- [ ] T006 [P] Install @modelcontextprotocol/sdk in backend/package.json
- [ ] T007 Create MCP server instance with SSE transport adapter in backend/src/services/mcp-server.ts
- [ ] T008 Create Express route for SSE connections at /mcp/sse in backend/src/routes/mcp.ts
- [ ] T009 Implement agent identity resolution from connection metadata in backend/src/services/mcp-server.ts
- [ ] T010 Add connection lifecycle tracking (connect/disconnect events) in backend/src/services/mcp-server.ts
- [ ] T011 Register MCP routes and init database on startup in backend/src/index.ts
- [ ] T012 Write tests for MCP server connection lifecycle in backend/tests/unit/mcp-server.test.ts

**Checkpoint**: Agents can connect via SSE and see empty tool catalog

---

## Phase 3: US1 — Agent-to-User Messaging (Priority: P1, MVP)

**Goal**: Agents send/receive messages via MCP, messages persist and show on dashboard
**Independent Test**: Agent calls send_message, message appears in dashboard chat

- [ ] T013 [US1] Implement send_message MCP tool (store + WebSocket broadcast) in backend/src/services/mcp-tools/messaging.ts
- [ ] T014 [US1] Implement read_messages MCP tool with pagination and thread filter in backend/src/services/mcp-tools/messaging.ts
- [ ] T015 [US1] Implement list_threads MCP tool with latest message preview in backend/src/services/mcp-tools/messaging.ts
- [ ] T016 [US1] Implement mark_read MCP tool in backend/src/services/mcp-tools/messaging.ts
- [ ] T017 [US1] Add WebSocket event broadcasting for chat_message events in backend/src/services/ws-server.ts
- [ ] T018 [US1] Add APNS push notification for agent messages in backend/src/services/mcp-tools/messaging.ts
- [ ] T019 [US1] Create /api/messages REST endpoints for frontend consumption in backend/src/routes/messages.ts
- [ ] T020 [US1] Write tests for all messaging MCP tools in backend/tests/unit/mcp-messaging.test.ts

**Checkpoint**: Full agent-to-user messaging pipeline working

---

## Phase 4: US2 — Agent Status & Progress (Priority: P1)

**Goal**: Agents report status and progress, dashboard shows real-time updates
**Independent Test**: Agent calls set_status, crew panel updates

- [ ] T021 [P] [US2] Implement set_status MCP tool (working/blocked/idle/done) in backend/src/services/mcp-tools/status.ts
- [ ] T022 [P] [US2] Implement report_progress MCP tool (task, percentage, description) in backend/src/services/mcp-tools/status.ts
- [ ] T023 [US2] Implement announce MCP tool (completion/blocker/question broadcast) in backend/src/services/mcp-tools/status.ts
- [ ] T024 [US2] Add WebSocket events for agent_status and announcement in backend/src/services/ws-server.ts
- [ ] T025 [US2] Store announcements in messages table with event_type=announcement in backend/src/services/mcp-tools/status.ts
- [ ] T026 [US2] Write tests for status MCP tools in backend/tests/unit/mcp-status.test.ts

**Checkpoint**: Agent status visible on dashboard in real-time

---

## Phase 5: US3 — Bead Operations via MCP (Priority: P2)

**Goal**: Agents create/update/close beads through MCP instead of bd CLI
**Independent Test**: Agent calls create_bead, bead appears on Kanban board

- [ ] T027 [P] [US3] Implement create_bead MCP tool wrapping bd-client.ts in backend/src/services/mcp-tools/beads.ts
- [ ] T028 [P] [US3] Implement update_bead MCP tool wrapping bd-client.ts in backend/src/services/mcp-tools/beads.ts
- [ ] T029 [P] [US3] Implement close_bead MCP tool wrapping bd-client.ts in backend/src/services/mcp-tools/beads.ts
- [ ] T030 [US3] Implement list_beads and show_bead MCP tools in backend/src/services/mcp-tools/beads.ts
- [ ] T031 [US3] Add serialization layer to prevent concurrent bd CLI access in backend/src/services/mcp-tools/beads.ts
- [ ] T032 [US3] Write tests for bead MCP tools in backend/tests/unit/mcp-beads.test.ts

**Checkpoint**: Agents can manage beads without bd CLI, zero SIGSEGV risk

---

## Phase 6: US4 — Dashboard Queries (Priority: P2)

**Goal**: Agents query system state through MCP
**Independent Test**: Agent calls list_agents, receives accurate agent list

- [ ] T033 [P] [US4] Implement list_agents MCP tool using session registry in backend/src/services/mcp-tools/queries.ts
- [ ] T034 [P] [US4] Implement get_project_state MCP tool (summary stats) in backend/src/services/mcp-tools/queries.ts
- [ ] T035 [US4] Implement search_messages MCP tool using FTS5 in backend/src/services/mcp-tools/queries.ts
- [ ] T036 [US4] Write tests for query MCP tools in backend/tests/unit/mcp-queries.test.ts

**Checkpoint**: Agents can introspect the full system state

---

## Phase 7: US5 — Claude Code Agent Skills (Priority: P1)

**Goal**: Agents auto-discover and use MCP tools without manual setup
**Independent Test**: New agent session auto-connects to MCP server

- [ ] T037 [P] [US5] Create adjutant-agent skill SKILL.md with tool usage guide in .claude/skills/adjutant-agent/SKILL.md
- [ ] T038 [P] [US5] Create skill references: tool catalog and message format examples in .claude/skills/adjutant-agent/references/
- [ ] T039 [US5] Configure MCP server in .claude/settings.json for auto-connect
- [ ] T040 [US5] Add agent identity env var injection to session creation in backend/src/services/session-bridge.ts

**Checkpoint**: New agents auto-connect and can use all MCP tools

---

## Phase 8: Frontend Integration

**Purpose**: Web dashboard displays MCP-sourced messages and status

- [ ] T041 [P] Create useChatMessages hook (fetch + WebSocket subscription) in frontend/src/hooks/useChatMessages.ts
- [ ] T042 [P] Create useAgentStatus hook for real-time status in frontend/src/hooks/useAgentStatus.ts
- [ ] T043 Update chat components to render persistent messages in frontend/src/components/chat/
- [ ] T044 Create announcement toast/banner component in frontend/src/components/shared/AnnouncementBanner.tsx
- [ ] T045 Write tests for useChatMessages hook in frontend/tests/unit/useChatMessages.test.ts

**Checkpoint**: Dashboard shows persistent messages and agent status

---

## Phase 9: Polish & Cross-Cutting

**Purpose**: Quality, error handling, documentation

- [ ] T046 [P] Add MCP connection retry with exponential backoff in backend/src/services/mcp-server.ts
- [ ] T047 [P] Add message pagination to chat view in frontend/src/components/chat/
- [ ] T048 [P] Add full-text search UI to chat view in frontend/src/components/chat/
- [ ] T049 Remove beads-mail code paths for swarm mode in backend/src/services/transport/
- [ ] T050 Update CLAUDE.md and project docs with MCP messaging instructions in CLAUDE.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Database)** + **Phase 2 (MCP Server)**: No dependencies, can start in parallel
- **Phase 3 (Messaging)**: Depends on BOTH Phase 1 and Phase 2
- **Phases 4, 5, 6**: Each depends on Phase 2 only (MCP server core)
- **Phase 7 (Skills)**: Depends on Phase 2 (needs MCP server to exist)
- **Phase 8 (Frontend)**: Depends on Phase 3 (needs messages API)
- **Phase 9 (Polish)**: Depends on all prior phases

### Parallel Opportunities

- T001 + T006: Install deps in parallel
- T002-T005 (database) + T007-T012 (MCP server) — fully parallel
- After Phase 2: Phases 4, 5, 6, 7 can ALL run in parallel
- T021 + T022, T027 + T028 + T029, T033 + T034: Parallel within phases
- T037 + T038, T041 + T042: Parallel within phases

### Critical Path

```
T002 (database) + T007 (MCP server) → T013 (send_message) → T017 (WebSocket) → T041 (frontend hook) → T043 (UI)
```
