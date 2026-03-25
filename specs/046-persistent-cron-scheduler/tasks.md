# Tasks: Persistent Cron Scheduler

**Input**: Design documents from `/specs/046-persistent-cron-scheduler/`
**Epic**: `adj-121`

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs for this document
- **Bead IDs** (adj-121.N.M): Assigned in beads-import.md after bead creation
- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1, US2, etc.)

## Phase 1: Migration & Schedule Store

**Purpose**: SQLite table and data access layer for recurring schedules

- [ ] T001 [US1] Create migration 024-cron-schedules.sql with cron_schedules table schema in `backend/src/services/migrations/024-cron-schedules.sql`
- [ ] T002 [US1] Implement CronScheduleStore service with CRUD operations + next-fire computation in `backend/src/services/adjutant/cron-schedule-store.ts` (TDD: write tests first in `backend/tests/unit/adjutant/cron-schedule-store.test.ts`)

**Checkpoint**: Schedule store operational — can create, read, update, delete schedules in SQLite

---

## Phase 2: StimulusEngine Integration

**Purpose**: Wire recurring schedules into the existing wake system

- [ ] T003 [US1] Extend StimulusEngine with recurring schedule support: loadRecurringSchedules(), recurring timers, "recurring" WakeReason type in `backend/src/services/adjutant/stimulus-engine.ts` (TDD: write tests first in `backend/tests/unit/adjutant/stimulus-engine-recurring.test.ts`)
- [ ] T004 [US3] Extend getPendingSchedule() and buildSituationPrompt() to include recurring schedules in `backend/src/services/adjutant/stimulus-engine.ts`

**Checkpoint**: StimulusEngine loads schedules from DB, fires recurring wakes, includes them in situation prompts

---

## Phase 3: MCP Tools

**Goal**: Coordinator can manage schedules via MCP
**Independent Test**: Call each tool via MCP, verify DB state changes

- [ ] T005 [P] [US1] Add create_schedule + list_schedules MCP tools in `backend/src/services/mcp-tools/coordination.ts` (TDD: `backend/tests/unit/mcp-tools/coordination-schedules.test.ts`)
- [ ] T006 [P] [US1] Add cancel_schedule + pause_schedule + resume_schedule MCP tools in `backend/src/services/mcp-tools/coordination.ts`

**Checkpoint**: All 5 MCP tools operational with coordinator access control

---

## Phase 4: REST API & Polish

**Goal**: Dashboard visibility and startup reload

- [ ] T007 [P] [US2] Create GET /api/schedules + DELETE /api/schedules/:id routes in `backend/src/routes/schedules.ts` and register in `backend/src/routes/index.ts`
- [ ] T008 [US1] Wire startup reload: initAdjutantCore calls loadRecurringSchedules + overdue fire logic in `backend/src/services/adjutant/adjutant-core.ts`

**Checkpoint**: Schedules visible on dashboard, survive restarts

---

## Dependencies

- Phase 1 (T001, T002) → Phase 2 (T003, T004) → Phase 3 + Phase 4
- T003 depends on T002 (store needed)
- T004 depends on T003 (recurring type needed)
- T005, T006 depend on T003 (engine integration needed)
- T007 depends on T002 (store needed for queries)
- T008 depends on T003 (engine load method needed)
- T005 and T006 can run in parallel
- T007 can run in parallel with T005/T006 (after T002)

## Parallel Opportunities

- Tasks marked [P] within Phase 3 can run simultaneously (different tool registrations)
- T007 (REST routes) can run parallel with T005/T006 (MCP tools) after Phase 2
- Phase 3 and Phase 4 have partial parallelism after Phase 2 completes
