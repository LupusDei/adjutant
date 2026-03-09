# Idle Agent Proposal Generation - Beads

**Feature**: 035-idle-agent-proposals
**Generated**: 2026-03-09
**Source**: specs/035-idle-agent-proposals/tasks.md

## Root Epic

- **ID**: adj-057
- **Title**: Idle Agent Proposal Generation
- **Type**: epic
- **Priority**: 2
- **Description**: Adjutant coordinator behavior that detects idle agents (5min threshold via scheduleCheck) and nudges them to generate improvement proposals, with deduplication review and 12-proposal pending cap. No cron jobs.

## Epics

### Phase 1 — Core Behavior
- **ID**: adj-057.1
- **Type**: epic
- **Priority**: 2
- **Tasks**: 6

### Phase 2 — Registration & Integration
- **ID**: adj-057.2
- **Type**: epic
- **Priority**: 2
- **Depends**: Phase 1 (adj-057.1)
- **Tasks**: 2

## Tasks

### Phase 1 — Core Behavior (adj-057.1)

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Tests: idle detection + nudge trigger via scheduleCheck | backend/tests/unit/adjutant/behaviors/idle-proposal-nudge.test.ts | adj-057.1.1 |
| T002 | Impl: createIdleProposalNudge behavior | backend/src/services/adjutant/behaviors/idle-proposal-nudge.ts | adj-057.1.2 |
| T003 | Tests: proposal context in nudge message | backend/tests/unit/adjutant/behaviors/idle-proposal-nudge.test.ts | adj-057.1.3 |
| T004 | Impl: buildNudgeMessage with proposal context | backend/src/services/adjutant/behaviors/idle-proposal-nudge.ts | adj-057.1.4 |
| T005 | Tests: 12-proposal pending cap | backend/tests/unit/adjutant/behaviors/idle-proposal-nudge.test.ts | adj-057.1.5 |
| T006 | Impl: pending cap "improve only" mode | backend/src/services/adjutant/behaviors/idle-proposal-nudge.ts | adj-057.1.6 |

### Phase 2 — Registration & Integration (adj-057.2)

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T007 | Register behavior in index.ts | backend/src/index.ts | adj-057.2.1 |
| T008 | Edge case tests: disconnect, debounce reset, cancel on non-idle | backend/tests/unit/adjutant/behaviors/idle-proposal-nudge.test.ts | adj-057.2.2 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Core Behavior | 6 | 2 | adj-057.1 |
| 2: Registration & Integration | 2 | 2 | adj-057.2 |
| **Total** | **8** | | |

## Dependency Graph

```
adj-057 (Root Epic)
    |
adj-057.1: Phase 1 — Core Behavior
    |
    adj-057.1.1 → adj-057.1.2 → adj-057.1.3 → adj-057.1.4 → adj-057.1.5 → adj-057.1.6
    (T001)        (T002)         (T003)         (T004)         (T005)         (T006)
    |
adj-057.2: Phase 2 — Registration & Integration
    |
    adj-057.2.1 [P]  adj-057.2.2 [P]
    (T007)            (T008)
```

## Improvements

Improvements (Level 4: adj-057.N.M.P) are NOT pre-planned here. They are created
during implementation when bugs, refactors, or extra tests are discovered.
