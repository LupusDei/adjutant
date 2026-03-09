# Tasks: Idle Agent Proposal Generation

**Input**: Design documents from `/specs/035-idle-agent-proposals/`
**Epic**: `adj-057`

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs for this document
- **Bead IDs** (adj-057.N.M): Runtime tracking identifiers
- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1, US2, US3)

## Phase 1: Core Behavior (adj-057.1)

**Purpose**: Implement the idle-proposal-nudge behavior — coordinator-mediated via scheduleCheck (no cron, no direct agent messaging)

- [ ] T001 [US1] Write failing tests: agent status changes to idle triggers `scheduleCheck(300000, ...)`, working/disconnected agents skipped, debounce prevents duplicate checks in `backend/tests/unit/adjutant/behaviors/idle-proposal-nudge.test.ts`
- [ ] T002 [US1] Implement `createIdleProposalNudge()` behavior factory triggered by `agent:status_changed`. On idle: build context, call `stimulusEngine.scheduleCheck(300000, reason)`. No direct agent messaging. in `backend/src/services/adjutant/behaviors/idle-proposal-nudge.ts`
- [ ] T003 [US2] Add tests: scheduleCheck reason string includes pending + dismissed proposal summaries (titles, IDs, types, counts) in `backend/tests/unit/adjutant/behaviors/idle-proposal-nudge.test.ts`
- [ ] T004 [US2] Implement `buildScheduleReason()` that queries ProposalStore for pending/dismissed proposals and formats them into the reason string for the coordinator's situation prompt in `backend/src/services/adjutant/behaviors/idle-proposal-nudge.ts`
- [ ] T005 [US3] Add tests: reason string includes cap-reached instruction when >= 12 pending proposals, allows creation when < 12 in `backend/tests/unit/adjutant/behaviors/idle-proposal-nudge.test.ts`
- [ ] T006 [US3] Implement pending cap logic in `buildScheduleReason()` — when >= 12 pending, reason includes "PENDING CAP REACHED — agent must improve existing proposal" in `backend/src/services/adjutant/behaviors/idle-proposal-nudge.ts`

**Checkpoint**: Core behavior complete — schedules coordinator wakes with full proposal context

---

## Phase 2: Registration & Integration (adj-057.2)

**Purpose**: Wire behavior into the system (no new cron registrations, no CommunicationManager dependency)

- [ ] T007 [P] Register `createIdleProposalNudge(stimulusEngine, proposalStore)` in behavior registry in `backend/src/index.ts`
- [ ] T008 [P] Add edge case tests: disconnected agent skip, debounce reset after non-idle transition, verify behavior never calls comm.messageAgent() in `backend/tests/unit/adjutant/behaviors/idle-proposal-nudge.test.ts`

**Checkpoint**: Feature fully integrated, all tests green, build passes

---

## Dependencies

- Phase 1 tasks are sequential (TDD: test → implement for each user story)
- T003/T004 depend on T001/T002 (build on base behavior)
- T005/T006 depend on T003/T004 (extend reason string construction)
- Phase 2 depends on Phase 1 complete
- T007 and T008 can run in parallel [P]

## Parallel Opportunities

- T007 and T008 are independent (registration vs edge case tests)
