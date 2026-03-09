# Tasks: Agent Role Taxonomy

**Input**: Design documents from `/specs/039-agent-role-taxonomy/`
**Epic**: `adj-062`

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs for this document
- **Bead IDs** (adj-062.N.M): Assigned in beads-import.md after bead creation
- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1, US2, etc.)

## Phase 1: Foundational — Role type + state store

**Purpose**: Add AgentRole type, role field to AgentProfile, and role query methods

- [ ] T001 [US2] Add AgentRole type and role field to AgentProfile interface + SQLite migration in `backend/src/services/adjutant/state-store.ts`
- [ ] T002 [US2] Add isCoordinator() and getAgentsByRole() methods to state store + tests in `backend/src/services/adjutant/state-store.ts` and `backend/tests/unit/adjutant/state-store.test.ts`
- [ ] T003 [US2] Infer role on agent connect — set role="coordinator" for known IDs in agent-lifecycle behavior in `backend/src/services/adjutant/behaviors/agent-lifecycle.ts`

**Checkpoint**: Role infrastructure ready — behaviors can query agent roles

---

## Phase 2: Registry integration — excludeRoles guard

**Purpose**: Add excludeRoles to behavior interface and enforce in dispatch

- [ ] T004 [US1] Add excludeRoles field to AdjutantBehavior interface in `backend/src/services/adjutant/behavior-registry.ts`
- [ ] T005 [US1] Enforce excludeRoles in adjutant-core dispatchEvent — skip behaviors when event agent has excluded role + tests in `backend/src/services/adjutant/adjutant-core.ts` and `backend/tests/unit/adjutant/adjutant-core.test.ts`

**Checkpoint**: excludeRoles enforcement works — behaviors with excludeRoles skip coordinator events

---

## Phase 3: Migration — Replace hardcoded coordinator IDs

**Purpose**: Remove all ad-hoc coordinator ID sets, use role system instead

- [ ] T006 [P] [US2] Migrate idle-proposal-nudge: remove COORDINATOR_IDS constant, add excludeRoles: ["coordinator"], remove manual coordinator guard in act(), update tests in `backend/src/services/adjutant/behaviors/idle-proposal-nudge.ts` and `backend/tests/unit/adjutant/behaviors/idle-proposal-nudge.test.ts`
- [ ] T007 [P] [US2] Migrate signal-aggregator: replace ADJUTANT_IDS with state.isCoordinator() call, pass state store reference in `backend/src/services/adjutant/signal-aggregator.ts`
- [ ] T008 [P] [US2] Migrate communication.ts: replace hardcoded ADJUTANT_AGENT_ID with role-based lookup in `backend/src/services/adjutant/communication.ts`

---

## Dependencies

- Phase 1 (T001-T003) → sequential: T002 depends on T001, T003 depends on T002
- Phase 2 (T004-T005) → sequential: T005 depends on T004; Phase 2 depends on Phase 1
- Phase 3 (T006-T008) → all [P] parallel after Phase 1+2 complete

## Parallel Opportunities

- T006, T007, T008 can all run simultaneously (different files, no deps between them)
- After Phase 1+2, all 3 migration tasks can be assigned to separate agents
