# Tasks: Idle Agent Proposal Generation

**Input**: Design documents from `/specs/035-idle-agent-proposals/`
**Epic**: `adj-057`

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs for this document
- **Bead IDs** (adj-057.N.M): Runtime tracking identifiers
- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1, US2, US3)

## Phase 1: Core Behavior (adj-057.1)

**Purpose**: Implement the idle-proposal-nudge behavior using scheduleCheck (no cron)

- [ ] T001 [US1] Write failing tests for idle detection: agent status changes to idle triggers scheduleCheck(5min), callback checks if still idle, debounce prevents duplicates in `backend/tests/unit/adjutant/behaviors/idle-proposal-nudge.test.ts`
- [ ] T002 [US1] Implement `createIdleProposalNudge()` behavior factory triggered by `agent:status_changed`. On idle: call `stimulusEngine.scheduleCheck(300000, ...)`. On callback: re-check status, send nudge via `comm.messageAgent()` in `backend/src/services/adjutant/behaviors/idle-proposal-nudge.ts`
- [ ] T003 [US2] Add tests for proposal context inclusion in nudge message (pending + dismissed summaries with titles, IDs, types) in `backend/tests/unit/adjutant/behaviors/idle-proposal-nudge.test.ts`
- [ ] T004 [US2] Implement `buildNudgeMessage()` that fetches existing proposals via ProposalStore and constructs context-rich message with dedup instructions in `backend/src/services/adjutant/behaviors/idle-proposal-nudge.ts`
- [ ] T005 [US3] Add tests for 12-proposal pending cap enforcement (>= 12 = improve-only, < 12 = create or improve) in `backend/tests/unit/adjutant/behaviors/idle-proposal-nudge.test.ts`
- [ ] T006 [US3] Implement pending cap logic — count pending proposals, switch message to "improve only" instructions when >= 12 in `backend/src/services/adjutant/behaviors/idle-proposal-nudge.ts`

**Checkpoint**: Core behavior complete with all three user stories covered

---

## Phase 2: Registration & Integration (adj-057.2)

**Purpose**: Wire behavior into the system (no new cron registrations)

- [ ] T007 [P] Register `createIdleProposalNudge()` in behavior registry, pass stimulusEngine + proposalStore dependencies in `backend/src/index.ts`
- [ ] T008 [P] Add edge case tests: disconnected agent skip, debounce reset after non-idle transition, agent leaves idle before 5min timer fires in `backend/tests/unit/adjutant/behaviors/idle-proposal-nudge.test.ts`

**Checkpoint**: Feature fully integrated, all tests green, build passes

---

## Dependencies

- Phase 1 tasks are sequential (TDD: test → implement for each user story)
- T003/T004 depend on T001/T002 (build on base behavior)
- T005/T006 depend on T003/T004 (extend message construction)
- Phase 2 depends on Phase 1 complete
- T007 and T008 can run in parallel [P]

## Parallel Opportunities

- T007 and T008 are independent (registration vs edge case tests)
