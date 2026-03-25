# Persistent Cron Scheduler - Beads

**Feature**: 046-persistent-cron-scheduler
**Generated**: 2026-03-25
**Source**: specs/046-persistent-cron-scheduler/tasks.md

## Root Epic

- **ID**: adj-121
- **Title**: Persistent Cron Scheduler
- **Type**: epic
- **Priority**: 2
- **Description**: Add persistent recurring schedules to the Adjutant StimulusEngine. SQLite-backed cron_schedules table, 4th wake source, MCP tools for CRUD, REST API for dashboard visibility.

## Epics

### Phase 1 — Migration & Schedule Store
- **ID**: adj-121.1
- **Type**: epic
- **Priority**: 1
- **Tasks**: 2

### Phase 2 — StimulusEngine Integration
- **ID**: adj-121.2
- **Type**: epic
- **Priority**: 1
- **Blocks**: Phase 3, Phase 4
- **Tasks**: 2

### Phase 3 — MCP Tools
- **ID**: adj-121.3
- **Type**: epic
- **Priority**: 2
- **Tasks**: 2

### Phase 4 — REST API & Polish
- **ID**: adj-121.4
- **Type**: epic
- **Priority**: 2
- **Tasks**: 2

## Tasks

### Phase 1 — Migration & Schedule Store

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | SQLite migration for cron_schedules table | `backend/src/services/migrations/024-cron-schedules.sql` | adj-121.1.1 |
| T002 | CronScheduleStore service (CRUD + next-fire) | `backend/src/services/adjutant/cron-schedule-store.ts` | adj-121.1.2 |

### Phase 2 — StimulusEngine Integration

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T003 | Recurring wake source in StimulusEngine | `backend/src/services/adjutant/stimulus-engine.ts` | adj-121.2.1 |
| T004 | Extend getPendingSchedule + situation prompt | `backend/src/services/adjutant/stimulus-engine.ts` | adj-121.2.2 |

### Phase 3 — MCP Tools

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T005 | create_schedule + list_schedules MCP tools | `backend/src/services/mcp-tools/coordination.ts` | adj-121.3.1 |
| T006 | cancel + pause + resume schedule MCP tools | `backend/src/services/mcp-tools/coordination.ts` | adj-121.3.2 |

### Phase 4 — REST API & Polish

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T007 | GET + DELETE /api/schedules routes | `backend/src/routes/schedules.ts` | adj-121.4.1 |
| T008 | Startup reload + overdue fire logic | `backend/src/services/adjutant/adjutant-core.ts` | adj-121.4.2 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Migration & Store | 2 | 1 | adj-121.1 |
| 2: Engine Integration | 2 | 1 | adj-121.2 |
| 3: MCP Tools | 2 | 2 | adj-121.3 |
| 4: REST API & Polish | 2 | 2 | adj-121.4 |
| **Total** | **8** | | |

## Dependency Graph

```
Phase 1: Migration & Store (adj-121.1)
    |
Phase 2: Engine Integration (adj-121.2)
    |
    +-------------------+
    |                   |
Phase 3: MCP Tools    Phase 4: REST API & Polish
(adj-121.3)           (adj-121.4)              [parallel]
```

## Improvements

Improvements (Level 4: adj-121.N.M.P) are NOT pre-planned here. They are created
during implementation when bugs, refactors, or extra tests are discovered.
