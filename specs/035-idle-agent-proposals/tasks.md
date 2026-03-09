# Tasks: Idle Agent Proposal Generation

**Input**: Design documents from `/specs/035-idle-agent-proposals/`
**Epic**: `adj-2hwz`

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs for this document
- **Bead IDs** (adj-XXX.N.M): Assigned in beads-import.md after bead creation
- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1, US2, etc.)

## Phase 1: Core Behavior

**Purpose**: Implement the idle-proposal-nudge behavior

- [ ] T001 [US1] Write failing tests for idle detection and nudge trigger in `backend/tests/unit/adjutant/behaviors/idle-proposal-nudge.test.ts`
- [ ] T002 [US1] Implement `createIdleProposalNudge()` behavior factory with idle detection, debounce, and message sending in `backend/src/services/adjutant/behaviors/idle-proposal-nudge.ts`
- [ ] T003 [US2] Add tests for proposal context inclusion in nudge message (pending + dismissed summaries) in `backend/tests/unit/adjutant/behaviors/idle-proposal-nudge.test.ts`
- [ ] T004 [US2] Implement `buildNudgeMessage()` that fetches existing proposals and constructs context-rich message in `backend/src/services/adjutant/behaviors/idle-proposal-nudge.ts`
- [ ] T005 [US3] Add tests for 12-proposal pending cap enforcement in `backend/tests/unit/adjutant/behaviors/idle-proposal-nudge.test.ts`
- [ ] T006 [US3] Implement pending cap logic — when >= 12 pending, message switches to "improve only" mode in `backend/src/services/adjutant/behaviors/idle-proposal-nudge.ts`

**Checkpoint**: Core behavior complete with all three user stories covered

---

## Phase 2: Registration & Integration

**Purpose**: Wire behavior into the system

- [ ] T007 Register `createIdleProposalNudge()` in behavior registry in `backend/src/index.ts`
- [ ] T008 Add edge case tests: disconnected agent skip, debounce reset after non-idle transition, already-nudged skip in `backend/tests/unit/adjutant/behaviors/idle-proposal-nudge.test.ts`

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
- Within Phase 1, each US pair (test+impl) is sequential but US pairs could theoretically be parallel if behavior skeleton exists first
