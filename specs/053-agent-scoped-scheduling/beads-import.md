# Agent-Scoped Scheduling - Beads

**Feature**: 053-agent-scoped-scheduling
**Generated**: 2026-04-17
**Source**: specs/053-agent-scoped-scheduling/tasks.md

## Root Epic

- **ID**: adj-163
- **Title**: Agent-scoped scheduling — any agent can self-schedule
- **Type**: epic
- **Priority**: 1
- **Description**: Generalize scheduling from coordinator-only to agent-scoped. Any agent can create schedules for itself, wakes route to the correct tmux session, session death invalidates schedules.

## Epics

### Phase 1 — Schema & Store
- **ID**: adj-163.1
- **Type**: epic
- **Priority**: 1
- **Tasks**: 4

### Phase 2 — Wake Routing
- **ID**: adj-163.2
- **Type**: epic
- **Priority**: 1
- **Blocks**: Phase 5
- **Tasks**: 4

### Phase 3 — Session Death Cleanup
- **ID**: adj-163.3
- **Type**: epic
- **Priority**: 1
- **Blocks**: Phase 5
- **Tasks**: 3

### Phase 4 — MCP Tool Access
- **ID**: adj-163.4
- **Type**: epic
- **Priority**: 2
- **Blocks**: Phase 5
- **Tasks**: 4

### Phase 5 — Coordinator Migration & Verification
- **ID**: adj-163.5
- **Type**: epic
- **Priority**: 1
- **Depends**: Phase 2, Phase 3, Phase 4
- **Tasks**: 3

## Tasks

### Phase 1 — Schema & Store

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Migration 032: add target_agent columns | `backend/src/services/migrations/` | adj-163.1.1 |
| T002 | Update CronScheduleStore create/query | `backend/src/services/adjutant/cron-schedule-store.ts` | adj-163.1.2 |
| T003 | Add listByAgent() and disableByAgent() | `backend/src/services/adjutant/cron-schedule-store.ts` | adj-163.1.3 |
| T004 | Tests for store changes | `backend/tests/unit/` | adj-163.1.4 |

### Phase 2 — Wake Routing

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T005 | Add targetAgent to WakeReason + schedule fire | `backend/src/services/adjutant/stimulus-engine.ts` | adj-163.2.1 |
| T006 | Refactor onWake: route by targetAgent | `backend/src/index.ts` | adj-163.2.2 |
| T007 | Auto-disable on delivery failure | `backend/src/index.ts` | adj-163.2.3 |
| T008 | Tests for wake routing | `backend/tests/unit/` | adj-163.2.4 |

### Phase 3 — Session Death Cleanup

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T009 | cancelWatchesByAgent() in StimulusEngine | `backend/src/services/adjutant/stimulus-engine.ts` | adj-163.3.1 |
| T010 | Hook destroySession → cleanup | `backend/src/services/lifecycle-manager.ts` | adj-163.3.2 |
| T011 | Tests for session cleanup | `backend/tests/unit/` | adj-163.3.3 |

### Phase 4 — MCP Tool Access

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T012 | Relax access control on scheduling tools | `backend/src/services/mcp-tools/coordination.ts` | adj-163.4.1 |
| T013 | Ownership filtering (list own, manage own) | `backend/src/services/mcp-tools/coordination.ts` | adj-163.4.2 |
| T014 | Add targetAgent param to create_schedule | `backend/src/services/mcp-tools/coordination.ts` | adj-163.4.3 |
| T015 | Tests for access control + ownership | `backend/tests/unit/` | adj-163.4.4 |

### Phase 5 — Coordinator Migration & Verification

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T016 | Migrate auto-develop scheduleCheck | `backend/src/services/adjutant/behaviors/auto-develop-loop.ts` | adj-163.5.1 |
| T017 | E2E verification + regression tests | All | adj-163.5.2 |
| T018 | Update migration count + verify suite | `backend/tests/unit/database.test.ts` | adj-163.5.3 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Schema & Store | 4 | 1 | adj-163.1 |
| 2: Wake Routing | 4 | 1 | adj-163.2 |
| 3: Session Cleanup | 3 | 1 | adj-163.3 |
| 4: MCP Tool Access | 4 | 2 | adj-163.4 |
| 5: Migration & Verify | 3 | 1 | adj-163.5 |
| **Total** | **18** | | |

## Dependency Graph

```
Phase 1: Schema & Store (adj-163.1)
    |
    ├── Phase 2: Wake Routing (adj-163.2)      ──→ Phase 5: Verify (adj-163.5)
    ├── Phase 3: Session Cleanup (adj-163.3)    ──↗
    └── Phase 4: MCP Tool Access (adj-163.4)    ──↗
```
