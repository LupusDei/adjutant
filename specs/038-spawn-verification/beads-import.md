# Spawn Verification Pipeline - Beads

**Feature**: 038-spawn-verification
**Generated**: 2026-03-09
**Source**: specs/038-spawn-verification/tasks.md

## Root Epic

- **ID**: adj-061
- **Title**: Spawn Verification Pipeline
- **Type**: epic
- **Priority**: 1
- **Description**: Detect and report agent spawn failures by verifying MCP connection within a timeout window after spawn_worker succeeds. Addresses 50% spawn failure rate observed in production (adj-058).

## Epics

### Phase 1 — US1: Spawn Health Detection
- **ID**: adj-061.1
- **Type**: epic
- **Priority**: 1
- **MVP**: true
- **Tasks**: 4

### Phase 2 — US2: Spawn Failure Recovery
- **ID**: adj-061.2
- **Type**: epic
- **Priority**: 2
- **Depends**: Phase 1
- **Tasks**: 2

## Tasks

### Phase 1 — US1: Spawn Health Detection

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Add SpawnFailedEvent type to event bus | `backend/src/services/event-bus.ts` | adj-061.1.1 |
| T002 | Implement spawn health check timer | `backend/src/services/agent-spawner-service.ts` | adj-061.1.2 |
| T003 | Wire MCP agent_connected to cancel timer | `backend/src/services/agent-spawner-service.ts` | adj-061.1.3 |
| T004 | Tests for spawn health check lifecycle | `backend/tests/unit/spawn-health-check.test.ts` | adj-061.1.4 |

### Phase 2 — US2: Spawn Failure Recovery

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T005 | Classify spawn_failed as CRITICAL signal | `backend/src/services/adjutant/signal-aggregator.ts` | adj-061.2.1 |
| T006 | Tests for spawn_failed signal classification | `backend/tests/unit/signal-aggregator.test.ts` | adj-061.2.2 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: US1 - Spawn Health Detection (MVP) | 4 | 1 | adj-061.1 |
| 2: US2 - Spawn Failure Recovery | 2 | 2 | adj-061.2 |
| **Total** | **6** | | |

## Dependency Graph

```
Phase 1: US1 - Spawn Health Detection (adj-061.1, MVP)
    T001 → T002 → T003 → T004
                |
Phase 2: US2 - Spawn Failure Recovery (adj-061.2)
    T005 [P]  T006 [P]
```

## Improvements

Improvements (Level 4: adj-061.N.M.P) are NOT pre-planned here. They are created
during implementation when bugs, refactors, or extra tests are discovered.
