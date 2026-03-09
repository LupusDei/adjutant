# Tasks: Spawn Verification Pipeline

**Input**: Design documents from `/specs/038-spawn-verification/`
**Epic**: `adj-061`

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs for this document
- **Bead IDs** (adj-061.N.M): Assigned in beads-import.md after bead creation
- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1, US2)

## Phase 1: US1 - Spawn Health Detection (Priority: P1, MVP)

**Goal**: Detect agents that fail to connect via MCP after being spawned
**Independent Test**: Spawn agent, verify health check timer fires on timeout or cancels on MCP connect

- [ ] T001 [US1] Add SpawnFailedEvent type and agent:spawn_failed to EventMap in `backend/src/services/event-bus.ts`
- [ ] T002 [US1] Implement spawn health check timer in `backend/src/services/agent-spawner-service.ts` — schedule 30s timer after successful spawn, store in Map, emit spawn_failed on expiry
- [ ] T003 [US1] Wire mcp:agent_connected listener to cancel pending health check timer in `backend/src/services/agent-spawner-service.ts`
- [ ] T004 [US1] Write tests for spawn health check lifecycle (schedule, cancel, expire) in `backend/tests/unit/spawn-health-check.test.ts`

**Checkpoint**: Spawn failures detected and events emitted

---

## Phase 2: US2 - Spawn Failure Recovery (Priority: P2)

**Goal**: Route spawn failure events to coordinator via signal aggregator

- [ ] T005 [US2] Add agent:spawn_failed CRITICAL classification in `backend/src/services/adjutant/signal-aggregator.ts`
- [ ] T006 [US2] Write tests for spawn_failed signal classification in `backend/tests/unit/signal-aggregator.test.ts`

---

## Dependencies

- Phase 1 tasks are sequential: T001 → T002 → T003 → T004
- Phase 2 depends on Phase 1 (needs SpawnFailedEvent type from T001)
- T005 and T006 can run in parallel within Phase 2

## Parallel Opportunities

- T005 and T006 touch different files and can run simultaneously
- Phase 1 and Phase 2 are sequential (Phase 2 depends on the event type from Phase 1)
