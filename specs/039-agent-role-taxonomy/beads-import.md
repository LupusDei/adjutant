# Agent Role Taxonomy - Beads

**Feature**: 039-agent-role-taxonomy
**Generated**: 2026-03-09
**Source**: specs/039-agent-role-taxonomy/tasks.md

## Root Epic

- **ID**: adj-062
- **Title**: Agent role taxonomy — first-class coordinator vs worker distinction
- **Type**: epic
- **Priority**: 1
- **Description**: Add role field to AgentProfile, excludeRoles to BehaviorRegistry, and migrate 3 hardcoded coordinator ID sets to centralized role system.

## Epics

### Phase 1 — Foundational: Role type + state store
- **ID**: adj-062.1
- **Type**: epic
- **Priority**: 1
- **Tasks**: 3

### Phase 2 — Registry: excludeRoles guard
- **ID**: adj-062.2
- **Type**: epic
- **Priority**: 1
- **Blocks**: Phase 3
- **Tasks**: 2

### Phase 3 — Migration: Replace hardcoded IDs
- **ID**: adj-062.3
- **Type**: epic
- **Priority**: 1
- **Depends**: Phase 1, Phase 2
- **Tasks**: 3

## Tasks

### Phase 1 — Foundational

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Add AgentRole type + role field + SQLite migration | state-store.ts | adj-062.1.1 |
| T002 | Add isCoordinator() + getAgentsByRole() + tests | state-store.ts | adj-062.1.2 |
| T003 | Infer role on agent connect in agent-lifecycle | agent-lifecycle.ts | adj-062.1.3 |

### Phase 2 — Registry

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T004 | Add excludeRoles to AdjutantBehavior interface | behavior-registry.ts | adj-062.2.1 |
| T005 | Enforce excludeRoles in adjutant-core dispatch + tests | adjutant-core.ts | adj-062.2.2 |

### Phase 3 — Migration

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T006 | Migrate idle-proposal-nudge to excludeRoles | idle-proposal-nudge.ts | adj-062.3.1 |
| T007 | Migrate signal-aggregator to state.isCoordinator() | signal-aggregator.ts | adj-062.3.2 |
| T008 | Migrate communication.ts ADJUTANT_AGENT_ID | communication.ts | adj-062.3.3 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Foundational | 3 | 1 | adj-062.1 |
| 2: Registry | 2 | 1 | adj-062.2 |
| 3: Migration | 3 | 1 | adj-062.3 |
| **Total** | **8** | | |

## Dependency Graph

Phase 1: Foundational (adj-062.1)
    |
Phase 2: Registry (adj-062.2)
    |
Phase 3: Migration (adj-062.3) [T006, T007, T008 parallel]

## Improvements

Improvements (Level 4: adj-062.N.M.P) are NOT pre-planned here. They are created
during implementation when bugs, refactors, or extra tests are discovered.
