# Idle Agent Proposal Generation - Beads

**Feature**: 035-idle-agent-proposals
**Generated**: 2026-03-09
**Source**: specs/035-idle-agent-proposals/tasks.md

## Root Epic

- **ID**: adj-2hwz
- **Title**: Idle Agent Proposal Generation
- **Type**: epic
- **Priority**: 2
- **Description**: Adjutant coordinator behavior that detects idle agents and nudges them to generate improvement proposals, with deduplication review and a 12-proposal pending cap.

## Epics

### Phase 1 — Core Behavior
- **ID**: adj-1kyh
- **Type**: epic
- **Priority**: 2
- **Tasks**: 6

### Phase 2 — Registration & Integration
- **ID**: adj-ec47
- **Type**: epic
- **Priority**: 2
- **Depends**: Phase 1 (adj-1kyh)
- **Tasks**: 2

## Tasks

### Phase 1 — Core Behavior (adj-1kyh)

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Tests: idle detection + nudge trigger | backend/tests/unit/adjutant/behaviors/idle-proposal-nudge.test.ts | adj-9cb8 |
| T002 | Impl: createIdleProposalNudge behavior | backend/src/services/adjutant/behaviors/idle-proposal-nudge.ts | adj-wkxm |
| T003 | Tests: proposal context in nudge message | backend/tests/unit/adjutant/behaviors/idle-proposal-nudge.test.ts | adj-yf8j |
| T004 | Impl: buildNudgeMessage with proposal context | backend/src/services/adjutant/behaviors/idle-proposal-nudge.ts | adj-in4g |
| T005 | Tests: 12-proposal pending cap | backend/tests/unit/adjutant/behaviors/idle-proposal-nudge.test.ts | adj-9fz0 |
| T006 | Impl: pending cap "improve only" mode | backend/src/services/adjutant/behaviors/idle-proposal-nudge.ts | adj-evu0 |

### Phase 2 — Registration & Integration (adj-ec47)

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T007 | Register behavior in index.ts | backend/src/index.ts | adj-873k |
| T008 | Edge case tests: disconnect, debounce reset | backend/tests/unit/adjutant/behaviors/idle-proposal-nudge.test.ts | adj-ju2o |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Core Behavior | 6 | 2 | adj-1kyh |
| 2: Registration & Integration | 2 | 2 | adj-ec47 |
| **Total** | **8** | | |

## Dependency Graph

```
adj-2hwz (Root Epic)
    |
adj-1kyh: Phase 1 — Core Behavior
    |
    adj-9cb8 → adj-wkxm → adj-yf8j → adj-in4g → adj-9fz0 → adj-evu0
    (T001)     (T002)      (T003)     (T004)      (T005)     (T006)
    |
adj-ec47: Phase 2 — Registration & Integration
    |
    adj-873k [P]  adj-ju2o [P]
    (T007)        (T008)
```

## Improvements

Improvements (Level 4: adj-2hwz.*.*.P) are NOT pre-planned here. They are created
during implementation when bugs, refactors, or extra tests are discovered.
