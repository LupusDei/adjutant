# Tasks: Agent-Scoped Scheduling

**Input**: Design documents from `/specs/053-agent-scoped-scheduling/`
**Epic**: `adj-163`

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Schema & Store

**Purpose**: Add target_agent to schedules. Foundation for all other phases.

- [ ] T001 [US1] Create migration 032: add target_agent, target_tmux_session columns with coordinator defaults in `backend/src/services/migrations/032-agent-scoped-schedules.sql`
- [ ] T002 [US1] Update CronScheduleStore: accept targetAgent/targetTmuxSession in create(), include in queries in `backend/src/services/adjutant/cron-schedule-store.ts`
- [ ] T003 [US2] Add listByAgent() and disableByAgent() methods to CronScheduleStore in `backend/src/services/adjutant/cron-schedule-store.ts`
- [ ] T004 [P] [US1] Tests for store changes — create with target, listByAgent, disableByAgent in `backend/tests/unit/`

**Checkpoint**: Store supports agent-scoped schedules. Build passes.

---

## Phase 2: Wake Routing

**Purpose**: Deliver wakes to the correct agent's tmux session.

- [ ] T005 [US4] Add targetAgent, targetTmuxSession, scheduleId to WakeReason in StimulusEngine. Pass through from recurring schedule fire in `backend/src/services/adjutant/stimulus-engine.ts`
- [ ] T006 [US4] Refactor onWake callback: route by targetAgent, coordinator gets rich prompt, others get simple reminder in `backend/src/index.ts`
- [ ] T007 [US4] Auto-disable schedule on delivery failure (target session not found) in `backend/src/index.ts`
- [ ] T008 [P] [US4] Tests for wake routing — coordinator path, agent path, dead session path in `backend/tests/unit/`

**Checkpoint**: Wakes route to correct agent. Coordinator unchanged.

---

## Phase 3: Session Death Cleanup

**Purpose**: Invalidate schedules and watches when an agent's tmux session dies.

- [ ] T009 [US2] Add cancelWatchesByAgent() to StimulusEngine in `backend/src/services/adjutant/stimulus-engine.ts`
- [ ] T010 [US2] Hook destroySession → disableByAgent + cancelWatchesByAgent in `backend/src/services/lifecycle-manager.ts`
- [ ] T011 [P] [US2] Tests for session cleanup — destroy session, verify schedules disabled and watches cancelled in `backend/tests/unit/`

**Checkpoint**: Session death cleans up all associated resources.

---

## Phase 4: MCP Tool Access

**Purpose**: Open scheduling tools to all agents with ownership enforcement.

- [ ] T012 [US3] Relax access control on create_schedule, cancel_schedule, pause_schedule, resume_schedule, list_schedules — any MCP agent can call in `backend/src/services/mcp-tools/coordination.ts`
- [ ] T013 [US3] Add ownership filtering: list_schedules returns caller's only, management tools check ownership. Coordinator exempt in `backend/src/services/mcp-tools/coordination.ts`
- [ ] T014 [US1] Add targetAgent param to create_schedule (defaults to caller, coordinator can target others) in `backend/src/services/mcp-tools/coordination.ts`
- [ ] T015 [P] [US3] Tests for access control — self-scheduling, ownership filtering, coordinator admin in `backend/tests/unit/`

**Checkpoint**: Any agent can self-schedule. Ownership enforced.

---

## Phase 5: Coordinator Migration & Verification

**Purpose**: Ensure zero regression. Coordinator is "just another agent" with admin.

- [ ] T016 [US4] Migrate auto-develop scheduleCheck to pass targetAgent (defaults to coordinator) in `backend/src/services/adjutant/behaviors/auto-develop-loop.ts`
- [ ] T017 End-to-end: create schedules for multiple agents, verify routing, kill session, verify cleanup
- [ ] T018 [P] Update database.test.ts migration count, verify all existing tests pass

---

## Dependencies

- Phase 1 → blocks Phase 2, 3, 4
- Phase 2, 3, 4 can run in PARALLEL after Phase 1
- Phase 5 depends on all phases complete

## Parallel Opportunities

- T004, T008, T011, T015 (tests) can be written in parallel with their implementation tasks
- Phases 2, 3, 4 are independent after Phase 1
