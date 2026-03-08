# Persistent Self-Correcting Memory System - Beads

**Feature**: 033-persistent-memory
**Generated**: 2026-03-08
**Source**: specs/033-persistent-memory/tasks.md

## Root Epic

- **ID**: adj-053
- **Title**: Persistent Self-Correcting Memory System
- **Type**: epic
- **Priority**: 1
- **Description**: Give the Adjutant persistent, self-correcting memory: SQLite-backed learnings, session retrospectives, correction tracking, startup review, self-improvement proposals, and auto-memory file sync. Supersedes adj-052.4.5 (retrospective behavior).

## Epics

### Phase 1 — Foundation: Memory Store
- **ID**: adj-053.1
- **Type**: epic
- **Priority**: 1
- **Tasks**: 3

### Phase 2 — Capture: Memory Collector
- **ID**: adj-053.2
- **Type**: epic
- **Priority**: 1
- **Blocks**: Phases 3, 4 (reviewer), 5
- **Tasks**: 3

### Phase 3 — Analysis: Session Retrospective
- **ID**: adj-053.3
- **Type**: epic
- **Priority**: 1
- **MVP**: true (with Phase 1+2, delivers core learning loop)
- **Tasks**: 2

### Phase 4 — Maintenance & API: Memory Reviewer & Query
- **ID**: adj-053.4
- **Type**: epic
- **Priority**: 2
- **Tasks**: 3

### Phase 5 — Meta-Learning: Self-Improver & File Sync
- **ID**: adj-053.5
- **Type**: epic
- **Priority**: 2
- **Depends**: Phases 1, 2
- **Tasks**: 3

## Tasks

### Phase 1 — Foundation: Memory Store

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | SQLite migration for memory tables | `backend/src/services/migrations/011-memory-store.sql` | adj-053.1.1 |
| T002 | Memory store typed interface + CRUD | `backend/src/services/adjutant/memory-store.ts` | adj-053.1.2 |
| T003 | Add correction:detected and learning:created events | `backend/src/services/event-bus.ts` | adj-053.1.3 |

### Phase 2 — Capture: Memory Collector

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T004 | Create memory-collector behavior with correction detection | `backend/src/services/adjutant/behaviors/memory-collector.ts` | adj-053.2.1 |
| T005 | Add bead outcome capture to collector | `backend/src/services/adjutant/behaviors/memory-collector.ts` | adj-053.2.2 |
| T006 | Deduplication + confidence scoring logic | `backend/src/services/adjutant/memory-store.ts` | adj-053.2.3 |

### Phase 3 — Analysis: Session Retrospective

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T007 | Create session-retrospective behavior | `backend/src/services/adjutant/behaviors/session-retrospective.ts` | adj-053.3.1 |
| T008 | Retro analysis + generation logic | `backend/src/services/adjutant/behaviors/session-retrospective.ts` | adj-053.3.2 |

### Phase 4 — Maintenance & API: Memory Reviewer & Query

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T009 | Create memory-reviewer behavior (startup + weekly) | `backend/src/services/adjutant/behaviors/memory-reviewer.ts` | adj-053.4.1 |
| T010 | MCP memory tools (query_memories, get_session_retros) | `backend/src/services/mcp-tools/memory.ts` | adj-053.4.2 |
| T011 | REST endpoints for dashboard memory views | `backend/src/routes/memory.ts` | adj-053.4.3 |

### Phase 5 — Meta-Learning: Self-Improver & File Sync

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T012 | Create self-improver behavior | `backend/src/services/adjutant/behaviors/self-improver.ts` | adj-053.5.1 |
| T013 | Memory file sync to auto-memory .md files | `backend/src/services/adjutant/memory-file-sync.ts` | adj-053.5.2 |
| T014 | Register behaviors + integration test | `backend/src/index.ts` | adj-053.5.3 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Foundation | 3 | 1 | adj-053.1 |
| 2: Capture | 3 | 1 | adj-053.2 |
| 3: Analysis (MVP) | 2 | 1 | adj-053.3 |
| 4: Maintenance & API | 3 | 2 | adj-053.4 |
| 5: Meta-Learning | 3 | 2 | adj-053.5 |
| **Total** | **14** | | |

## Dependency Graph

```
Phase 1: Foundation (adj-053.1)
    |
    +---blocks-all--->  Phase 2: Capture (adj-053.2)
    |                       |
    |                       +---> Phase 3: Analysis (adj-053.3) [MVP with 1+2]
    |                       |
    |                       +---> Phase 4: Reviewer (adj-053.4.1)
    |                       |
    |                       +---> Phase 5: Self-Improver (adj-053.5)
    |
    +---parallel--->  Phase 4: API (adj-053.4.2, adj-053.4.3)
                     (MCP/REST can be built against store directly)

Phase 5 last task (adj-053.5.3) depends on ALL prior phases
```

### Intra-Phase Dependencies

```
Phase 1:
  adj-053.1.1 (migration) ──blocks──> adj-053.1.2 (store interface)
  adj-053.1.3 (events) ──parallel──  adj-053.1.1

Phase 2:
  adj-053.2.1 (collector) ──blocks──> adj-053.2.2 (bead outcomes)
  adj-053.2.1 ──blocks──> adj-053.2.3 (dedup)

Phase 3:
  adj-053.3.1 (behavior) ──blocks──> adj-053.3.2 (analysis logic)

Phase 4:
  adj-053.4.1 (reviewer) ──parallel──  adj-053.4.2 (MCP tools)
  adj-053.4.1 ──parallel──  adj-053.4.3 (REST endpoints)

Phase 5:
  adj-053.5.1 (improver) ──parallel──  adj-053.5.2 (file sync)
  adj-053.5.1 + adj-053.5.2 ──block──> adj-053.5.3 (integration)
```

## Improvements

Improvements (Level 4: adj-053.N.M.P) are NOT pre-planned here. They are created
during implementation when bugs, refactors, or extra tests are discovered. See
SKILL.md "Improvements (Post-Planning)" section for the workflow.
