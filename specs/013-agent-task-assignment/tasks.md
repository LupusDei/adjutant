# Tasks: Agent Task Assignment

**Input**: Design documents from `/specs/013-agent-task-assignment/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.yaml

**Tests**: TDD is mandatory per project constitution. Tests are included.

**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Types and API methods shared across all user stories

- [ ] T001 [P] Add AgentInfo type to frontend in frontend/src/types/index.ts
- [ ] T002 [P] Add AgentInfo type and BeadAssignRequest Zod schema to backend in backend/src/types/index.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Backend endpoints that ALL user stories depend on

**CRITICAL**: No user story work can begin until this phase is complete

### Tests

- [ ] T003 [P] Write unit tests for GET /api/agents endpoint in backend/tests/unit/agents-route.test.ts
- [ ] T004 [P] Write unit tests for assignBead service function in backend/tests/unit/beads-assign.test.ts

### Implementation

- [ ] T005 Create GET /api/agents route with status filter query param in backend/src/routes/agents.ts
- [ ] T006 Register agents route in backend/src/index.ts or app setup file
- [ ] T007 Add assignBead() function to beads-service that calls bd update --assignee, auto-transitions open→in_progress, sends notification via message-store, and broadcasts via WebSocket in backend/src/services/beads-service.ts
- [ ] T008 Extend PATCH /api/beads/:id to accept assignee field in request body using Zod validation in backend/src/routes/beads.ts
- [ ] T009 Add api.agents.list(status?) method to frontend API service in frontend/src/services/api.ts
- [ ] T010 Add api.beads.assign(id, agentId) method to frontend API service in frontend/src/services/api.ts

**Checkpoint**: Backend endpoints ready. Frontend can call assign API and fetch agents. All user stories can now proceed.

---

## Phase 3: User Story 1 - Assign a Task from Beads View (Priority: P1) MVP

**Goal**: Mayor can assign beads to agents from KanbanCard and BeadsList views.

**Independent Test**: Open Beads view, click assign on an open bead, select an agent, verify bead moves to in_progress and agent is notified.

### Tests

- [ ] T011 [US1] Write unit tests for AgentAssignDropdown component (renders agents, calls onAssign, shows loading/error) in frontend/tests/unit/agent-assign-dropdown.test.ts

### Implementation

- [ ] T012 [US1] Create AgentAssignDropdown shared component that fetches agents on open, filters to idle/working, shows current assignee, calls assign API on selection, with Pip-Boy themed styling in frontend/src/components/shared/AgentAssignDropdown.tsx
- [ ] T013 [US1] Integrate AgentAssignDropdown into KanbanCard component, passing bead id and current assignee, handling post-assign refresh in frontend/src/components/beads/KanbanCard.tsx
- [ ] T014 [US1] Integrate AgentAssignDropdown into BeadsList component for list view assignment in frontend/src/components/beads/BeadsList.tsx
- [ ] T015 [US1] Add onAssign callback prop to BeadsView to trigger data refresh after assignment in frontend/src/components/beads/BeadsView.tsx

**Checkpoint**: Beads view (Kanban + list) supports agent assignment. MVP complete.

---

## Phase 4: User Story 2 - Assign a Task from Epics View (Priority: P1)

**Goal**: Mayor can assign epic subtasks and epics to agents from EpicDetailView.

**Independent Test**: Open Epics view, expand an epic, click assign on a subtask, select agent, verify bead updates and agent notified.

### Implementation

- [ ] T016 [US2] Integrate AgentAssignDropdown into EpicDetailView subtask rows, passing subtask bead id and current assignee in frontend/src/components/epics/EpicDetailView.tsx
- [ ] T017 [US2] Integrate AgentAssignDropdown into EpicCard for epic-level assignment in frontend/src/components/epics/EpicCard.tsx
- [ ] T018 [US2] Add onAssign callback to EpicsView to trigger data refresh after assignment in frontend/src/components/epics/EpicsView.tsx

**Checkpoint**: Epics view supports agent assignment on both epics and subtasks.

---

## Phase 5: User Story 3 - Agent Availability Filtering (Priority: P2)

**Goal**: Assignment dropdown only shows idle/working agents, refreshes on open, shows empty state.

**Independent Test**: With agents in mixed statuses, open dropdown and verify only idle/working agents appear. With no eligible agents, verify empty state message.

### Tests

- [ ] T019 [US3] Write unit tests for agent filtering logic (only idle/working shown, empty state) in frontend/tests/unit/agent-assign-dropdown.test.ts

### Implementation

- [ ] T020 [US3] Ensure AgentAssignDropdown filters to idle/working status on each open, displays "No agents available" empty state in frontend/src/components/shared/AgentAssignDropdown.tsx
- [ ] T021 [US3] Add loading spinner and error toast for failed agent fetch in frontend/src/components/shared/AgentAssignDropdown.tsx

**Checkpoint**: Agent filtering is complete. Only eligible agents appear.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Error handling, edge cases, documentation

- [ ] T022 [P] Add error handling for bd CLI failures in assignBead (return structured error, refresh bead state) in backend/src/services/beads-service.ts
- [ ] T023 [P] Add JSDoc comments to all new public functions and components
- [ ] T024 Run quickstart.md validation (manual test of all endpoints and UI flows)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 types — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 — creates shared AgentAssignDropdown component
- **US2 (Phase 4)**: Depends on Phase 2 + Phase 3 (reuses AgentAssignDropdown from US1)
- **US3 (Phase 5)**: Depends on Phase 3 (enhances AgentAssignDropdown from US1)
- **Polish (Phase 6)**: Depends on all user stories being complete

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Shared component (T012) before integration tasks (T013-T015)
- Backend must be ready (Phase 2) before frontend integration

### Parallel Opportunities

- T001 + T002: Type definitions in parallel (different files)
- T003 + T004: Backend tests in parallel (different files)
- T009 + T010: Frontend API methods in parallel (same file but independent functions)
- T013 + T014: Kanban + List integration in parallel (different files)
- T016 + T017: EpicDetail + EpicCard integration in parallel (different files)
- T022 + T023: Polish tasks in parallel

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T002)
2. Complete Phase 2: Foundational (T003-T010)
3. Complete Phase 3: User Story 1 (T011-T015)
4. **STOP and VALIDATE**: Test assignment from Beads view
5. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → Backend ready
2. User Story 1 → Beads view assignment (MVP!)
3. User Story 2 → Epics view assignment
4. User Story 3 → Agent filtering polish
5. Polish → Error handling, docs

### Parallel Team Strategy

With 2 developers after Phase 2:
- Developer A: US1 (creates shared component) → US3 (enhances it)
- Developer B: Waits for US1's T012 → US2 (integrates shared component into Epics)

---

## Summary

- **Total tasks**: 24
- **US1 tasks**: 5 (T011-T015)
- **US2 tasks**: 3 (T016-T018)
- **US3 tasks**: 3 (T019-T021)
- **Setup/Foundational**: 10 (T001-T010)
- **Polish**: 3 (T022-T024)
- **Parallel opportunities**: 6 groups identified
- **MVP scope**: Phase 1 + Phase 2 + Phase 3 (US1) = 15 tasks
