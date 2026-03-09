# Implementation Plan: Agent Role Taxonomy

**Branch**: `039-agent-role-taxonomy` | **Date**: 2026-03-09
**Epic**: `adj-062` | **Priority**: P1

## Summary

Add a first-class `role` field to AgentProfile (coordinator/worker/qa), enforce role-based guards in BehaviorRegistry via `excludeRoles`, and migrate 3 hardcoded coordinator ID sets to use the centralized role system.

## Bead Map

- `adj-062` - Root: Agent role taxonomy
  - `adj-062.1` - Foundational: Role type + state store
    - `adj-062.1.1` - Add AgentRole type and role field to AgentProfile
    - `adj-062.1.2` - Add isCoordinator() and getAgentsByRole() to state store
    - `adj-062.1.3` - Infer role on agent connect in agent-lifecycle behavior
  - `adj-062.2` - Registry integration: excludeRoles guard
    - `adj-062.2.1` - Add excludeRoles to AdjutantBehavior interface
    - `adj-062.2.2` - Enforce excludeRoles in adjutant-core dispatch
  - `adj-062.3` - Migration: Replace hardcoded coordinator IDs
    - `adj-062.3.1` - Migrate idle-proposal-nudge to use excludeRoles
    - `adj-062.3.2` - Migrate signal-aggregator to use state.isCoordinator()
    - `adj-062.3.3` - Migrate communication.ts ADJUTANT_AGENT_ID

## Technical Context

**Stack**: TypeScript 5.x strict, SQLite (better-sqlite3), Vitest
**Storage**: SQLite `adjutant_agent_profiles` table — needs ALTER TABLE for `role` column
**Testing**: Vitest unit tests for state-store, behavior-registry, and each migrated file
**Constraints**: Backward compatible — existing agents without role default to "worker"

## Architecture Decision

Role is stored on the AgentProfile (SQLite) rather than as a runtime-only concept because:
1. Profiles persist across server restarts — role should too
2. Future role-based queries (dashboard filtering) need SQL support
3. Role inference from known IDs happens once on connect, not on every event

The `excludeRoles` guard lives in adjutant-core's dispatch loop (not in BehaviorRegistry) because the dispatch logic already has access to the event's agent ID and the state store for role lookup.

## Files Changed

| File | Change |
|------|--------|
| `backend/src/services/adjutant/state-store.ts` | Add `role` to AgentProfile, `isCoordinator()`, `getAgentsByRole()`, SQLite migration |
| `backend/src/services/adjutant/behavior-registry.ts` | Add `excludeRoles?: AgentRole[]` to AdjutantBehavior interface |
| `backend/src/services/adjutant/adjutant-core.ts` | Enforce excludeRoles in dispatchEvent |
| `backend/src/services/adjutant/behaviors/agent-lifecycle.ts` | Infer role on connect |
| `backend/src/services/adjutant/behaviors/idle-proposal-nudge.ts` | Replace COORDINATOR_IDS with excludeRoles |
| `backend/src/services/adjutant/signal-aggregator.ts` | Replace ADJUTANT_IDS with state.isCoordinator() |
| `backend/src/services/adjutant/communication.ts` | Use role-based lookup for ADJUTANT_AGENT_ID |
| `backend/tests/unit/adjutant/state-store.test.ts` | Tests for role field, isCoordinator, getAgentsByRole |
| `backend/tests/unit/adjutant/adjutant-core.test.ts` | Tests for excludeRoles enforcement |
| `backend/tests/unit/adjutant/behaviors/idle-proposal-nudge.test.ts` | Update tests for excludeRoles migration |

## Phase 1: Foundational — Role type + state store

Add `AgentRole` type, `role` column to SQLite, `isCoordinator()` and `getAgentsByRole()` methods. Wire role inference into agent-lifecycle on connect.

## Phase 2: Registry integration — excludeRoles guard

Add `excludeRoles` to the behavior interface and enforce it in adjutant-core's dispatch loop before calling shouldAct().

## Phase 3: Migration — Replace hardcoded coordinator IDs

Migrate idle-proposal-nudge (remove COORDINATOR_IDS, add excludeRoles), signal-aggregator (replace ADJUTANT_IDS), and communication.ts (replace ADJUTANT_AGENT_ID).

## Parallel Execution

- Phase 1 tasks T001-T003 are sequential (T002 depends on T001, T003 depends on T002)
- Phase 2 tasks T004-T005 are sequential
- Phase 3 tasks T006-T008 can run in parallel [P] after Phase 1+2 complete

## Verification Steps

- [ ] `npx vitest run backend/tests/` passes with zero regressions
- [ ] `npm run build` succeeds
- [ ] `state.isCoordinator("adjutant-core")` returns true
- [ ] Behavior with `excludeRoles: ["coordinator"]` skips coordinator events
- [ ] No grep results for `COORDINATOR_IDS` in behavior files
- [ ] No grep results for `ADJUTANT_IDS` in signal-aggregator (replaced by state call)
