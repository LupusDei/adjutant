# Speckit-Compatible Templates

Templates for the four epic-planner artifacts. Fill sections from user input; delete unused optional sections. Mark unknowns with `[NEEDS CLARIFICATION]`.

Use the project's beads prefix throughout (e.g. `adj-` for adjutant, `gt-` for gastown). Shown here as `bd-` generically.

## ID Conventions

- **T-IDs** (`T001`, `T002`): Authoring-time identifiers in tasks.md. Human-readable, sequential across all phases.
- **Bead IDs** (`bd-xxx.N.M`): Runtime tracking identifiers created via `bd` CLI. Replace T-IDs as the source of truth once beads exist.
- **beads-import.md** maps between them: each task row has both a T-ID and a Bead ID column.

---

## spec.md

```markdown
# Feature Specification: [FEATURE NAME]

**Feature Branch**: `[###-feature-name]`
**Created**: [DATE]
**Status**: Draft

## User Scenarios & Testing

### User Story 1 - [Title] (Priority: P1)

[Plain language description of this user journey]

**Why this priority**: [Value justification]

**Independent Test**: [How to verify this story works alone]

**Acceptance Scenarios**:

1. **Given** [state], **When** [action], **Then** [outcome]
2. **Given** [state], **When** [action], **Then** [outcome]

---

### User Story 2 - [Title] (Priority: P2)

[Description]

**Why this priority**: [Justification]

**Independent Test**: [Verification approach]

**Acceptance Scenarios**:

1. **Given** [state], **When** [action], **Then** [outcome]

---

### Edge Cases

- What happens when [boundary condition]?
- How does system handle [error scenario]?

## Requirements

### Functional Requirements

- **FR-001**: System MUST [capability]
- **FR-002**: System MUST [capability]

### Key Entities (if data involved)

- **[Entity]**: [What it represents, key attributes]

## Success Criteria

- **SC-001**: [Measurable metric]
- **SC-002**: [Measurable metric]
```

---

## plan.md

```markdown
# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE]
**Epic**: `bd-xxx` | **Priority**: P[N]

## Summary

[Primary requirement + technical approach, 2-3 sentences]

## Bead Map

- `bd-xxx` - Root: [Feature title]
  - `bd-xxx.1` - Setup: [purpose]
  - `bd-xxx.2` - Foundational: [purpose]
  - `bd-xxx.3` - US1: [title]
    - `bd-xxx.3.1` - [task]
    - `bd-xxx.3.2` - [task]
  - `bd-xxx.4` - US2: [title]

## Technical Context

**Stack**: [Language, framework, deps]
**Storage**: [DB/file/N/A]
**Testing**: [Framework]
**Constraints**: [Performance, platform, etc.]

## Architecture Decision

[Why this approach over alternatives]

## Files Changed

| File | Change |
|------|--------|
| `path/to/file.ts` | [What changes] |

## Phase 1: Setup
[Setup tasks and rationale]

## Phase 2: Foundational
[Core infrastructure needed before user stories]

## Phase 3: US1 - [Title] (MVP)
[Implementation approach for MVP story]

## Phase 4: US2 - [Title]
[Implementation approach]

## Parallel Execution

[Which tracks/tasks can run simultaneously]

## Verification Steps

- [ ] [Manual test step]
- [ ] [Manual test step]
```

**Phase numbering must match sub-epic numbering.** Phase 1 = bead `.1`, Phase 2 = bead `.2`, etc. If you skip a phase, skip the corresponding sub-epic number.

---

## tasks.md

```markdown
# Tasks: [FEATURE NAME]

**Input**: Design documents from `/specs/[###-feature-name]/`
**Epic**: `bd-xxx`

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs for this document
- **Bead IDs** (bd-xxx.N.M): Assigned in beads-import.md after bead creation
- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1, US2, etc.)

## Phase 1: Setup

**Purpose**: Project initialization

- [ ] T001 [Description] in [path/to/file]
- [ ] T002 [P] [Description] in [path/to/file]

---

## Phase 2: Foundational

**Purpose**: Core infrastructure blocking all user stories

- [ ] T003 [Description] in [path/to/file]
- [ ] T004 [P] [Description] in [path/to/file]

**Checkpoint**: Foundation ready - user stories can begin

---

## Phase 3: US1 - [Title] (Priority: P1, MVP)

**Goal**: [What this story delivers]
**Independent Test**: [Verification approach]

- [ ] T005 [US1] [Description] in [path/to/file]
- [ ] T006 [P] [US1] [Description] in [path/to/file]
- [ ] T007 [US1] [Description] in [path/to/file]

**Checkpoint**: US1 independently functional

---

## Phase 4: US2 - [Title] (Priority: P2)

**Goal**: [What this story delivers]

- [ ] T008 [US2] [Description] in [path/to/file]
- [ ] T009 [US2] [Description] in [path/to/file]

---

## Phase N: Polish & Cross-Cutting

- [ ] TXXX [P] [Description]
- [ ] TXXX [Description]

---

## Dependencies

- Setup (Phase 1) -> Foundational (Phase 2) -> blocks all user stories
- US1, US2, US3 can run in parallel after Foundational
- Polish depends on all desired user stories complete

## Parallel Opportunities

- Tasks marked [P] within a phase can run simultaneously
- After Foundational, all user stories can run in parallel
```

---

## beads-import.md

```markdown
# [FEATURE NAME] - Beads

**Feature**: [###-feature-name]
**Generated**: [DATE]
**Source**: specs/[###-feature-name]/tasks.md

## Root Epic

- **ID**: bd-xxx
- **Title**: [Feature Name]
- **Type**: epic
- **Priority**: [0-4]
- **Description**: [Feature summary]

## Epics

### Phase 1 — Setup: [Purpose]
- **ID**: bd-xxx.1
- **Type**: epic
- **Priority**: 1
- **Tasks**: [N]

### Phase 2 — Foundational: [Purpose]
- **ID**: bd-xxx.2
- **Type**: epic
- **Priority**: 1
- **Blocks**: US1, US2
- **Tasks**: [N]

### Phase 3 — US1: [Story Title]
- **ID**: bd-xxx.3
- **Type**: epic
- **Priority**: 1
- **MVP**: true
- **Tasks**: [N]

### Phase 4 — US2: [Story Title]
- **ID**: bd-xxx.4
- **Type**: epic
- **Priority**: 2
- **Tasks**: [N]

### Phase N — Polish: Cross-Cutting
- **ID**: bd-xxx.N
- **Type**: epic
- **Priority**: [highest US priority + 1]
- **Depends**: US1, US2
- **Tasks**: [N]

## Tasks

### Phase 1 — Setup

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | [Task title] | [file path] | bd-xxx.1.1 |
| T002 | [Task title] | [file path] | bd-xxx.1.2 |

### Phase 3 — US1: [Story Title]

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T005 | [Task title] | [file path] | bd-xxx.3.1 |
| T006 | [Task title] | [file path] | bd-xxx.3.2 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Setup | [N] | 1 | bd-xxx.1 |
| 2: Foundational | [N] | 1 | bd-xxx.2 |
| 3: US1 (MVP) | [N] | 1 | bd-xxx.3 |
| 4: US2 | [N] | 2 | bd-xxx.4 |
| N: Polish | [N] | [N] | bd-xxx.N |
| **Total** | **[N]** | | |

## Dependency Graph

Phase 1: Setup (bd-xxx.1)
    |
Phase 2: Foundational (bd-xxx.2) --blocks--> US1, US2
    |
Phase 3: US1 (bd-xxx.3, MVP)  Phase 4: US2 (bd-xxx.4)  [parallel]
    |                               |
    +-------+-------+-------+-------+
            |
    Phase N: Polish (bd-xxx.N)

## Improvements

Improvements (Level 4: bd-xxx.N.M.P) are NOT pre-planned here. They are created
during implementation when bugs, refactors, or extra tests are discovered. See
SKILL.md "Improvements (Post-Planning)" section for the workflow.
```

---

## Small Feature Variant (< 5 tasks)

For small features, skip sub-epics entirely. Tasks go directly under the root epic.

**Bead structure:**
```
bd-xxx         (root epic, type=epic)
  bd-xxx.1     (task, type=task)
  bd-xxx.2     (task, type=task)
  bd-xxx.3     (task, type=task)
```

**Simplified tasks.md** — no phases, no [US] markers:
```markdown
# Tasks: [FEATURE NAME]

**Epic**: `bd-xxx`

- [ ] T001 [Description] in [path/to/file]
- [ ] T002 [P] [Description] in [path/to/file]
- [ ] T003 [Description] in [path/to/file]

## Dependencies

- T002 depends on T001
- T003 depends on T001
```

**Simplified beads-import.md** — no Epics section:
```markdown
# [FEATURE NAME] - Beads

**Epic**: `bd-xxx`

## Root Epic

- **ID**: bd-xxx
- **Title**: [Feature Name]
- **Type**: epic
- **Priority**: [0-4]

## Tasks

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | [Task title] | [file path] | bd-xxx.1 |
| T002 | [Task title] | [file path] | bd-xxx.2 |
| T003 | [Task title] | [file path] | bd-xxx.3 |
```

Wiring for small features:
```bash
bd dep add bd-xxx bd-xxx.1
bd dep add bd-xxx bd-xxx.2
bd dep add bd-xxx bd-xxx.3
# Plus any sequential deps between tasks
bd dep add bd-xxx.2 bd-xxx.1   # T002 blocked by T001
```
