# Quality Gate Distribution — Beads

**Feature**: 048-quality-gate-distribution
**Generated**: 2026-03-24
**Source**: specs/048-quality-gate-distribution/tasks.md

## Root Epic

- **ID**: adj-123
- **Title**: Quality Gate Distribution via Init & Upgrade
- **Type**: epic
- **Priority**: 1
- **Description**: Extend adjutant init, upgrade, doctor, and plugin hook to distribute the code quality system (testing rules, code review skill, verify script, CI template) into any Adjutant-managed project.

## Epics

### Phase 1 — Template Infrastructure
- **ID**: adj-123.1
- **Type**: epic
- **Priority**: 1
- **Tasks**: 3
- **Blocks**: All other phases

### Phase 2 — Extend Init
- **ID**: adj-123.2
- **Type**: epic
- **Priority**: 1
- **Tasks**: 2

### Phase 3 — Extend Upgrade
- **ID**: adj-123.3
- **Type**: epic
- **Priority**: 1
- **Tasks**: 2

### Phase 4 — Doctor Checks & Plugin Warning
- **ID**: adj-123.4
- **Type**: epic
- **Priority**: 2
- **Tasks**: 3

## Tasks

### Phase 1 — Template Infrastructure

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Create quality file templates | cli/templates/quality/ | adj-123.1.1 |
| T002 | Create template registry module | cli/lib/quality-templates.ts | adj-123.1.2 |
| T003 | Template infrastructure tests | backend/tests/unit/quality-templates.test.ts | adj-123.1.3 |

### Phase 2 — Extend Init

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T004 | Add quality scaffolding to init | cli/commands/init.ts | adj-123.2.1 |
| T005 | Init quality scaffolding tests | backend/tests/unit/init-quality.test.ts | adj-123.2.2 |

### Phase 3 — Extend Upgrade

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T006 | Add quality syncing to upgrade | cli/commands/upgrade.ts | adj-123.3.1 |
| T007 | Upgrade quality syncing tests | backend/tests/unit/upgrade-quality.test.ts | adj-123.3.2 |

### Phase 4 — Doctor Checks & Plugin Warning

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T008 | Add quality checks to doctor | cli/commands/doctor.ts | adj-123.4.1 |
| T009 | Add prime quality file warning | cli/lib/prime.ts | adj-123.4.2 |
| T010 | Doctor and prime quality tests | backend/tests/unit/doctor-quality.test.ts | adj-123.4.3 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Template Infrastructure | 3 | 1 | adj-123.1 |
| 2: Extend Init | 2 | 1 | adj-123.2 |
| 3: Extend Upgrade | 2 | 1 | adj-123.3 |
| 4: Doctor & Plugin | 3 | 2 | adj-123.4 |
| **Total** | **10** | | |

## Dependency Graph

```
Phase 1: Template Infrastructure (adj-123.1)
    |
    +--- blocks all --->
    |                   |                    |
Phase 2: Init        Phase 3: Upgrade     Phase 4: Doctor & Plugin
(adj-123.2)          (adj-123.3)          (adj-123.4)
[parallel]           [parallel]           [parallel]
```

## Improvements

Improvements (Level 4: adj-123.N.M.P) are NOT pre-planned here. They are created
during implementation when bugs, refactors, or extra tests are discovered.
