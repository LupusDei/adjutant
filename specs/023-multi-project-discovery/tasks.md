# Tasks: Multi-Project Discovery & Agent Spawning

**Input**: Design documents from `/specs/023-multi-project-discovery/`
**Epic**: `adj-023`

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs for this document
- **Bead IDs** (adj-023.N.M): Assigned in beads-import.md after bead creation
- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1, US2, etc.)

## Phase 1: Foundational

**Purpose**: Shared types and MCP project context threading

- [ ] T001 Add ProjectContext type and hasBeads field to Project in `backend/src/types/index.ts`
- [ ] T002 Thread projectId/projectPath into MCP session map in `backend/src/services/mcp-server.ts`
- [ ] T003 Create getProjectContextForSession resolver in `backend/src/services/mcp-server.ts`

**Checkpoint**: MCP sessions can carry and resolve project context

---

## Phase 2: US1 - MCP Project-Scoped Beads (Priority: P1, MVP)

**Goal**: Agent bead operations automatically scope to their project's .beads/ directory
**Independent Test**: Two agents in different projects see isolated bead sets

- [ ] T004 [US1] Update create_bead tool to resolve beadsDir from session project context in `backend/src/services/mcp-tools/beads.ts`
- [ ] T005 [US1] Update list_beads, show_bead, update_bead, close_bead tools with project scoping in `backend/src/services/mcp-tools/beads.ts`
- [ ] T006 [P] [US1] Add project metadata to set_status and announce tools in `backend/src/services/mcp-tools/status.ts`
- [ ] T007 [US1] Write integration tests for multi-project MCP bead isolation in `backend/tests/unit/mcp-project-scoping.test.ts`

**Checkpoint**: US1 independently functional — agents are project-scoped

---

## Phase 3: US2 - Enhanced Project Discovery (Priority: P1)

**Goal**: Discover git repos + beads repos with depth scanning and health checks
**Independent Test**: Scan a directory with mixed repos, all detected with correct metadata

- [ ] T008 [US2] Enhance discoverLocalProjects with .beads/ detection and configurable depth in `backend/src/services/projects-service.ts`
- [ ] T009 [P] [US2] Add project health check (stale paths, missing .beads/) in `backend/src/services/projects-service.ts`
- [ ] T010 [US2] Add POST /api/projects/rediscover endpoint for incremental updates in `backend/src/routes/projects.ts`
- [ ] T011 [US2] Write tests for enhanced discovery and health checks in `backend/tests/unit/projects-discovery.test.ts`

**Checkpoint**: US2 independently functional — discovery finds all project types

---

## Phase 4: US3 - Frontend Project Navigation (Priority: P2)

**Goal**: Project switcher in dashboard, beads/epics views scoped to selected project
**Independent Test**: Switch between projects in UI, verify beads filter correctly

- [ ] T012 [US3] Create ProjectContext and useProjects hook in `frontend/src/contexts/ProjectContext.tsx` and `frontend/src/hooks/useProjects.ts`
- [ ] T013 [US3] Create ProjectSelector component with Pip-Boy styling in `frontend/src/components/shared/ProjectSelector.tsx`
- [ ] T014 [US3] Wire BeadsView to accept project filter from ProjectContext in `frontend/src/components/beads/BeadsView.tsx`
- [ ] T015 [P] [US3] Wire EpicsView to accept project filter from ProjectContext in `frontend/src/components/epics/EpicsView.tsx`
- [ ] T016 [US3] Add project overview panel showing bead stats in `frontend/src/components/projects/ProjectOverview.tsx`

**Checkpoint**: US3 independently functional — frontend navigates between projects

---

## Phase 5: US4 - Cross-Project Agent Spawning (Priority: P2)

**Goal**: Spawn agents from dashboard targeting any registered project with full context
**Independent Test**: Spawn agent for project X from UI, verify MCP session scoped to X

- [ ] T017 [US4] Update spawn-polecat to accept projectId and set MCP context in `backend/src/routes/agents.ts`
- [ ] T018 [US4] Update SendToAgentModal to use ProjectContext for target selection in `frontend/src/components/proposals/SendToAgentModal.tsx`
- [ ] T019 [US4] Write end-to-end test: spawn, connect, create bead in target project in `backend/tests/unit/cross-project-spawn.test.ts`

---

## Dependencies

- Phase 1 (Foundational) -> blocks all user stories
- US1 (Phase 2), US2 (Phase 3) can run in parallel after Phase 1
- US3 (Phase 4) depends on Phase 1 types, benefits from Phase 2 for scoped APIs
- US4 (Phase 5) depends on Phases 2 + 4

## Parallel Opportunities

- Tasks marked [P] within a phase can run simultaneously
- After Phase 1, Phases 2 and 3 can run in parallel (backend-only, different files)
- T014 and T015 can run in parallel (different view components)
- T006 runs parallel to T004/T005 (different MCP tool files)
