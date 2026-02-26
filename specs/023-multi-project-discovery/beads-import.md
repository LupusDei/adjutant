# Multi-Project Discovery & Agent Spawning - Beads

**Feature**: 023-multi-project-discovery
**Generated**: 2026-02-25
**Source**: specs/023-multi-project-discovery/tasks.md

## Root Epic

- **ID**: adj-023
- **Title**: Multi-Project Discovery & Agent Spawning
- **Type**: epic
- **Priority**: 1
- **Description**: Close the gaps so Adjutant can start in any directory, discover sub-directory projects (git repos, .beads/ repos), query/create beads within those projects, and spawn agents to work on code in any discovered project.

## Epics

### Phase 1 — Foundational: Types & MCP Project Context
- **ID**: adj-023.1
- **Type**: epic
- **Priority**: 1
- **Tasks**: 3

### Phase 2 — US1: MCP Project-Scoped Beads (MVP)
- **ID**: adj-023.2
- **Type**: epic
- **Priority**: 1
- **MVP**: true
- **Blocks**: US3, US4
- **Tasks**: 4

### Phase 3 — US2: Enhanced Project Discovery
- **ID**: adj-023.3
- **Type**: epic
- **Priority**: 1
- **Tasks**: 4

### Phase 4 — US3: Frontend Project Navigation
- **ID**: adj-023.4
- **Type**: epic
- **Priority**: 2
- **Depends**: Phase 1
- **Tasks**: 5

### Phase 5 — US4: Cross-Project Agent Spawning
- **ID**: adj-023.5
- **Type**: epic
- **Priority**: 2
- **Depends**: Phase 2, Phase 4
- **Tasks**: 3

## Tasks

### Phase 1 — Foundational

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Add ProjectContext type and hasBeads to Project | backend/src/types/index.ts | adj-023.1.1 |
| T002 | Thread projectId/projectPath into MCP session map | backend/src/services/mcp-server.ts | adj-023.1.2 |
| T003 | Create getProjectContextForSession resolver | backend/src/services/mcp-server.ts | adj-023.1.3 |

### Phase 2 — US1: MCP Project-Scoped Beads

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T004 | Update create_bead with project-scoped beadsDir | backend/src/services/mcp-tools/beads.ts | adj-023.2.1 |
| T005 | Update list/show/update/close_bead with project scoping | backend/src/services/mcp-tools/beads.ts | adj-023.2.2 |
| T006 | Add project metadata to status/announce tools | backend/src/services/mcp-tools/status.ts | adj-023.2.3 |
| T007 | Integration tests for multi-project MCP isolation | backend/tests/unit/mcp-project-scoping.test.ts | adj-023.2.4 |

### Phase 3 — US2: Enhanced Project Discovery

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T008 | Enhance discoverLocalProjects with .beads/ and depth | backend/src/services/projects-service.ts | adj-023.3.1 |
| T009 | Add project health check for stale paths | backend/src/services/projects-service.ts | adj-023.3.2 |
| T010 | Add POST /api/projects/rediscover endpoint | backend/src/routes/projects.ts | adj-023.3.3 |
| T011 | Tests for enhanced discovery and health checks | backend/tests/unit/projects-discovery.test.ts | adj-023.3.4 |

### Phase 4 — US3: Frontend Project Navigation

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T012 | Create ProjectContext and useProjects hook | frontend/src/contexts/ProjectContext.tsx, frontend/src/hooks/useProjects.ts | adj-023.4.1 |
| T013 | Create ProjectSelector component | frontend/src/components/shared/ProjectSelector.tsx | adj-023.4.2 |
| T014 | Wire BeadsView to project filter | frontend/src/components/beads/BeadsView.tsx | adj-023.4.3 |
| T015 | Wire EpicsView to project filter | frontend/src/components/epics/EpicsView.tsx | adj-023.4.4 |
| T016 | Add project overview panel | frontend/src/components/projects/ProjectOverview.tsx | adj-023.4.5 |

### Phase 5 — US4: Cross-Project Agent Spawning

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T017 | Update spawn-polecat to accept projectId | backend/src/routes/agents.ts | adj-023.5.1 |
| T018 | Update SendToAgentModal with ProjectContext | frontend/src/components/proposals/SendToAgentModal.tsx | adj-023.5.2 |
| T019 | End-to-end test: spawn, connect, create bead | backend/tests/unit/cross-project-spawn.test.ts | adj-023.5.3 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Foundational | 3 | 1 | adj-023.1 |
| 2: US1 MCP Scoping (MVP) | 4 | 1 | adj-023.2 |
| 3: US2 Discovery | 4 | 1 | adj-023.3 |
| 4: US3 Frontend Nav | 5 | 2 | adj-023.4 |
| 5: US4 Agent Spawning | 3 | 2 | adj-023.5 |
| **Total** | **19** | | |

## Dependency Graph

```
Phase 1: Foundational (adj-023.1)
    |
    +---> Phase 2: US1 MCP Scoping (adj-023.2, MVP)  Phase 3: US2 Discovery (adj-023.3)  [parallel]
    |         |
    |         v
    +---> Phase 4: US3 Frontend Nav (adj-023.4)
              |         |
              v         v
         Phase 5: US4 Agent Spawning (adj-023.5)
```

## Improvements

Improvements (Level 4: adj-023.N.M.P) are NOT pre-planned here. They are created
during implementation when bugs, refactors, or extra tests are discovered. See
SKILL.md "Improvements (Post-Planning)" section for the workflow.
