# Code Quality & Testing Guarantees - Beads

**Feature**: 045-code-quality-testing-guarantees
**Generated**: 2026-03-24
**Source**: specs/045-code-quality-testing-guarantees/tasks.md

## Root Epic

- **ID**: adj-120
- **Title**: Code Quality & Testing Guarantees
- **Type**: epic
- **Priority**: 1
- **Description**: Harden the Adjutant development pipeline so untested, unlinted, or unreviewed code cannot reach main. Enforced coverage thresholds, pre-push hooks, automated code review, integration tests, and CI hardening.

## Epics

### Phase 1 — Build & Script Infrastructure
- **ID**: adj-120.1
- **Type**: epic
- **Priority**: 1
- **Tasks**: 6
- **Blocks**: All other phases

### Phase 2 — Git Hook Enforcement
- **ID**: adj-120.2
- **Type**: epic
- **Priority**: 1
- **Tasks**: 3

### Phase 3 — Testing Constitution & Agent Rules
- **ID**: adj-120.3
- **Type**: epic
- **Priority**: 1
- **Tasks**: 4

### Phase 4 — Automated Code Review
- **ID**: adj-120.4
- **Type**: epic
- **Priority**: 1
- **Tasks**: 3

### Phase 5 — Integration Test Infrastructure
- **ID**: adj-120.5
- **Type**: epic
- **Priority**: 2
- **Tasks**: 6

### Phase 6 — CI Pipeline Hardening
- **ID**: adj-120.6
- **Type**: epic
- **Priority**: 2
- **Tasks**: 3

## Tasks

### Phase 1 — Build & Script Infrastructure

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Root-level test/lint/coverage scripts | package.json | adj-120.1.1 |
| T002 | Backend build includes lint | backend/package.json | adj-120.1.2 |
| T003 | Frontend build includes lint | frontend/package.json | adj-120.1.3 |
| T004 | Backend coverage thresholds | backend/vitest.config.ts | adj-120.1.4 |
| T005 | Frontend coverage thresholds | frontend/vitest.config.ts | adj-120.1.5 |
| T006 | Build infrastructure tests | backend/tests/unit/build-infrastructure.test.ts | adj-120.1.6 |

### Phase 2 — Git Hook Enforcement

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T007 | Pre-push hook script | .git/hooks/pre-push | adj-120.2.1 |
| T008 | Hook installation docs | CLAUDE.md | adj-120.2.2 |
| T009 | Hook logic tests | backend/tests/unit/pre-push-hook.test.ts | adj-120.2.3 |

### Phase 3 — Testing Constitution & Agent Rules

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T010 | Rewrite testing rules | .claude/rules/03-testing.md | adj-120.3.1 |
| T011 | Code review protocol rules | .claude/rules/08-code-review.md | adj-120.3.2 |
| T012 | Update spawn prompt testing block | PRIME.md | adj-120.3.3 |
| T013 | Update squad-execute testing reqs | .claude/skills/squad-execute/SKILL.md | adj-120.3.4 |

### Phase 4 — Automated Code Review

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T014 | Code review skill | .claude/skills/code-review/SKILL.md | adj-120.4.1 |
| T015 | Integrate review into squad-execute | .claude/skills/squad-execute/SKILL.md | adj-120.4.2 |
| T016 | Code review skill tests | backend/tests/unit/code-review-skill.test.ts | adj-120.4.3 |

### Phase 5 — Integration Test Infrastructure

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T017 | Integration test harness | backend/tests/integration/helpers/test-harness.ts | adj-120.5.1 |
| T018 | Integration vitest config | backend/vitest.integration.config.ts | adj-120.5.2 |
| T019 | REST API integration tests | backend/tests/integration/api-routes.test.ts | adj-120.5.3 |
| T020 | MCP tool integration tests | backend/tests/integration/mcp-tools.test.ts | adj-120.5.4 |
| T021 | WebSocket integration tests | backend/tests/integration/ws-chat.test.ts | adj-120.5.5 |
| T022 | test:integration script | backend/package.json | adj-120.5.6 |

### Phase 6 — CI Pipeline Hardening

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T023 | CI: blocking lint + tests | .github/workflows/ci.yml | adj-120.6.1 |
| T024 | CI: coverage artifact upload | .github/workflows/ci.yml | adj-120.6.2 |
| T025 | Verify CI catches failures | .github/workflows/ci.yml | adj-120.6.3 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Build & Script Infrastructure | 6 | 1 | adj-120.1 |
| 2: Git Hook Enforcement | 3 | 1 | adj-120.2 |
| 3: Testing Constitution & Agent Rules | 4 | 1 | adj-120.3 |
| 4: Automated Code Review | 3 | 1 | adj-120.4 |
| 5: Integration Test Infrastructure | 6 | 2 | adj-120.5 |
| 6: CI Pipeline Hardening | 3 | 2 | adj-120.6 |
| **Total** | **25** | | |

## Dependency Graph

```
Phase 1: Build & Script Infrastructure (adj-120.1)
    |
    +--- blocks all --->
    |                   |                    |                   |                    |
Phase 2: Hooks      Phase 3: Constitution  Phase 4: Review    Phase 5: Integration  Phase 6: CI
(adj-120.2)         (adj-120.3)            (adj-120.4)        (adj-120.5)           (adj-120.6)
[parallel]          [parallel]             [parallel]         [parallel]            [parallel]
```

Within Phase 5:
```
T017 (harness) + T018 (config)
    |
    +---> T019, T020, T021 [parallel]
              |
              +---> T022 (script)
```

## Improvements

Improvements (Level 4: adj-120.N.M.P) are NOT pre-planned here. They are created
during implementation when bugs, refactors, or extra tests are discovered. See
SKILL.md "Improvements (Post-Planning)" section for the workflow.
