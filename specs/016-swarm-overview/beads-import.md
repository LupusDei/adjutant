# Swarm Overview Page - Beads

**Feature**: 016-swarm-overview
**Generated**: 2026-02-24
**Source**: specs/016-swarm-overview/tasks.md

## Root Epic

- **ID**: adj-020
- **Title**: Swarm Overview Page
- **Type**: epic
- **Priority**: 1
- **Description**: Dedicated overview tab for swarm mode showing project-scoped beads, epics with completion progress, agent status, and quick-spawn. Leftmost tab when active project exists.

## Epics

### Phase 1 — Backend API: Project overview endpoint
- **ID**: adj-020.1
- **Type**: epic
- **Priority**: 1
- **Tasks**: 3

### Phase 2 — iOS Foundation: Models + ViewModel + Tab
- **ID**: adj-020.2
- **Type**: epic
- **Priority**: 1
- **Blocks**: US1, US2, US3
- **Tasks**: 4

### Phase 3 — US1: Beads Section
- **ID**: adj-020.3
- **Type**: epic
- **Priority**: 1
- **MVP**: true
- **Tasks**: 2

### Phase 4 — US2: Agents Section & Start Agent
- **ID**: adj-020.4
- **Type**: epic
- **Priority**: 1
- **Tasks**: 3

### Phase 5 — US3: Epic Progress
- **ID**: adj-020.5
- **Type**: epic
- **Priority**: 2
- **Tasks**: 2

### Phase 6 — Polish: Cross-Cutting
- **ID**: adj-020.6
- **Type**: epic
- **Priority**: 2
- **Depends**: US1, US2, US3
- **Tasks**: 2

### Phase 7 — US4: Project Intelligence (User-Assigned)
- **ID**: adj-020.7
- **Type**: epic
- **Priority**: 3
- **Tasks**: 1

## Tasks

### Phase 1 — Backend API

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Create getProjectOverview() service | backend/src/services/beads-service.ts | adj-020.1.1 |
| T002 | Add computeEpicProgress() | backend/src/services/beads-service.ts | adj-020.1.2 |
| T003 | Create GET /api/projects/:id/overview route | backend/src/routes/projects.ts | adj-020.1.3 |

### Phase 2 — iOS Foundation

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T004 | Create SwarmOverview response models | ios/AdjutantKit/.../Models/SwarmOverview.swift | adj-020.2.1 |
| T005 | Add getProjectOverview to APIClient | ios/AdjutantKit/.../Networking/APIClient+Endpoints.swift | adj-020.2.2 |
| T006 | Create SwarmOverviewViewModel | ios/Adjutant/Features/SwarmOverview/SwarmOverviewViewModel.swift | adj-020.2.3 |
| T007 | Register Overview tab in MainTabView | ios/Adjutant/Core/Navigation/MainTabView.swift | adj-020.2.4 |

### Phase 3 — US1: Beads Section

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T008 | Create SwarmOverviewView with section layout | ios/Adjutant/Features/SwarmOverview/SwarmOverviewView.swift | adj-020.3.1 |
| T009 | Build BeadsSectionView | ios/Adjutant/Features/SwarmOverview/BeadsSectionView.swift | adj-020.3.2 |

### Phase 4 — US2: Agents & Start Agent

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T010 | Build AgentsSectionView | ios/Adjutant/Features/SwarmOverview/AgentsSectionView.swift | adj-020.4.1 |
| T011 | Add Start Agent button with long-press | ios/Adjutant/Features/SwarmOverview/SwarmOverviewView.swift | adj-020.4.2 |
| T012 | Implement post-spawn chat navigation | ios/Adjutant/Features/SwarmOverview/SwarmOverviewViewModel.swift | adj-020.4.3 |

### Phase 5 — US3: Epic Progress

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T013 | Build EpicsSectionView with progress bars | ios/Adjutant/Features/SwarmOverview/EpicsSectionView.swift | adj-020.5.1 |
| T014 | Handle empty state with recently completed | ios/Adjutant/Features/SwarmOverview/EpicsSectionView.swift | adj-020.5.2 |

### Phase 6 — Polish

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T015 | Loading, empty, error states + pull-to-refresh | ios/Adjutant/Features/SwarmOverview/SwarmOverviewView.swift | adj-020.6.1 |
| T016 | Auto-refresh timer + theme consistency | ios/Adjutant/Features/SwarmOverview/SwarmOverviewViewModel.swift | adj-020.6.2 |

### Phase 7 — US4: Project Intelligence

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T017 | Design agent suggestion workflow | (TBD - user-assigned) | adj-020.7.1 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Backend API | 3 | 1 | adj-020.1 |
| 2: iOS Foundation | 4 | 1 | adj-020.2 |
| 3: US1 Beads (MVP) | 2 | 1 | adj-020.3 |
| 4: US2 Agents | 3 | 1 | adj-020.4 |
| 5: US3 Epics | 2 | 2 | adj-020.5 |
| 6: Polish | 2 | 2 | adj-020.6 |
| 7: US4 Intelligence | 1 | 3 | adj-020.7 |
| **Total** | **17** | | |

## Dependency Graph

```
Phase 1: Backend API (adj-020.1)     Phase 2: iOS Foundation (adj-020.2)
  T001 ──┐                             T004 (models, parallel w/ Phase 1)
  T002 ──┤ (parallel)                   T005 (needs Phase 1 endpoint)
  T003 ──┘                             T006 (needs T004, T005)
           \                            T007 (needs T006)
            \                          /
             \────────────────────────/
                        |
        ┌───────────────┼───────────────┐
        ↓               ↓               ↓
  Phase 3: Beads   Phase 4: Agents  Phase 5: Epics   [parallel]
  (adj-020.3)      (adj-020.4)      (adj-020.5)
        |               |               |
        └───────────────┼───────────────┘
                        ↓
              Phase 6: Polish (adj-020.6)

  Phase 7: Intelligence (adj-020.7) — independent, user-assigned
```

## Improvements

Improvements (Level 4: adj-020.N.M.P) are NOT pre-planned here. They are created
during implementation when bugs, refactors, or extra tests are discovered. See
SKILL.md "Improvements (Post-Planning)" section for the workflow.
