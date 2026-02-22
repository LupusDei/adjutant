# Agent Task Assignment - Beads

**Feature**: 013-agent-task-assignment
**Generated**: 2026-02-22
**Source**: specs/013-agent-task-assignment/tasks.md

## Root Epic

- **Title**: Agent Task Assignment
- **Type**: epic
- **Priority**: 1
- **Description**: Add the ability to assign beads/tasks to agents from both the Beads view and Epics view. Assignment updates assignee, auto-transitions open beads to in_progress, and notifies the assigned agent via messaging.

## Epics

### Setup: Shared Infrastructure
- **Type**: epic
- **Priority**: 1
- **Description**: Types and API methods shared across all user stories
- **Tasks**: 2

### Foundational: Backend Endpoints
- **Type**: epic
- **Priority**: 1
- **Description**: Backend endpoints that ALL user stories depend on — agent list API and bead assignment API
- **Blocks**: US1, US2, US3
- **Tasks**: 8

### US1: Assign from Beads View
- **Type**: epic
- **Priority**: 1
- **Description**: Mayor can assign beads to agents from KanbanCard and BeadsList views
- **MVP**: true
- **Tasks**: 5

### US2: Assign from Epics View
- **Type**: epic
- **Priority**: 1
- **Description**: Mayor can assign epic subtasks and epics to agents from EpicDetailView
- **Depends**: US1
- **Tasks**: 3

### US3: Agent Availability Filtering
- **Type**: epic
- **Priority**: 2
- **Description**: Assignment dropdown only shows idle/working agents, refreshes on open, shows empty state
- **Depends**: US1
- **Tasks**: 3

### Polish: Cross-Cutting Concerns
- **Type**: epic
- **Priority**: 3
- **Description**: Error handling, edge cases, documentation
- **Depends**: US1, US2, US3
- **Tasks**: 3

## Tasks

### Setup

| Title                                                        | Path                         |
|--------------------------------------------------------------|------------------------------|
| Add AgentInfo type to frontend                               | frontend/src/types/index.ts  |
| Add AgentInfo type and BeadAssignRequest Zod schema to backend | backend/src/types/index.ts   |

### Foundational

| Title                                                                                              | Path                                        |
|----------------------------------------------------------------------------------------------------|---------------------------------------------|
| Write unit tests for GET /api/agents endpoint                                                      | backend/tests/unit/agents-route.test.ts     |
| Write unit tests for assignBead service function                                                   | backend/tests/unit/beads-assign.test.ts     |
| Create GET /api/agents route with status filter query param                                        | backend/src/routes/agents.ts                |
| Register agents route in app setup                                                                 | backend/src/index.ts                        |
| Add assignBead() function to beads-service (bd update --assignee, auto-transition, notify, broadcast) | backend/src/services/beads-service.ts       |
| Extend PATCH /api/beads/:id to accept assignee field with Zod validation                          | backend/src/routes/beads.ts                 |
| Add api.agents.list(status?) method to frontend API service                                        | frontend/src/services/api.ts                |
| Add api.beads.assign(id, agentId) method to frontend API service                                  | frontend/src/services/api.ts                |

### US1: Assign from Beads View

| Title                                                                                              | Path                                                          |
|----------------------------------------------------------------------------------------------------|---------------------------------------------------------------|
| Write unit tests for AgentAssignDropdown component                                                 | frontend/tests/unit/agent-assign-dropdown.test.ts             |
| Create AgentAssignDropdown shared component with Pip-Boy styling                                   | frontend/src/components/shared/AgentAssignDropdown.tsx         |
| Integrate AgentAssignDropdown into KanbanCard component                                            | frontend/src/components/beads/KanbanCard.tsx                   |
| Integrate AgentAssignDropdown into BeadsList component                                             | frontend/src/components/beads/BeadsList.tsx                    |
| Add onAssign callback prop to BeadsView for data refresh                                           | frontend/src/components/beads/BeadsView.tsx                    |

### US2: Assign from Epics View

| Title                                                                                              | Path                                                          |
|----------------------------------------------------------------------------------------------------|---------------------------------------------------------------|
| Integrate AgentAssignDropdown into EpicDetailView subtask rows                                     | frontend/src/components/epics/EpicDetailView.tsx               |
| Integrate AgentAssignDropdown into EpicCard for epic-level assignment                              | frontend/src/components/epics/EpicCard.tsx                     |
| Add onAssign callback to EpicsView for data refresh                                               | frontend/src/components/epics/EpicsView.tsx                    |

### US3: Agent Availability Filtering

| Title                                                                                              | Path                                                          |
|----------------------------------------------------------------------------------------------------|---------------------------------------------------------------|
| Write unit tests for agent filtering logic                                                         | frontend/tests/unit/agent-assign-dropdown.test.ts             |
| Ensure AgentAssignDropdown filters to idle/working and shows empty state                           | frontend/src/components/shared/AgentAssignDropdown.tsx         |
| Add loading spinner and error toast for failed agent fetch                                         | frontend/src/components/shared/AgentAssignDropdown.tsx         |

### Polish

| Title                                                        | Path                                    |
|--------------------------------------------------------------|-----------------------------------------|
| Add error handling for bd CLI failures in assignBead         | backend/src/services/beads-service.ts   |
| Add JSDoc comments to all new public functions and components | -                                       |
| Run quickstart.md validation                                 | -                                       |

## Summary

| Phase          | Tasks | Priority |
|----------------|-------|----------|
| Setup          | 2     | 1        |
| Foundational   | 8     | 1        |
| US1 (MVP)      | 5     | 1        |
| US2            | 3     | 1        |
| US3            | 3     | 2        |
| Polish         | 3     | 3        |
| **Total**      | **24** |         |

## MVP Scope

- Setup: 2 tasks
- Foundational: 8 tasks
- US1: 5 tasks
- **Total**: 15 tasks

## Notes

- Constitution requires TDD: tests must be written and fail before implementation
- Pure UI components (styling only) exempt from pre-written tests
- Each user story is independently testable
- US2 depends on US1's shared AgentAssignDropdown component
- US3 enhances US1's AgentAssignDropdown with filtering refinements
- bd CLI commands serialized through semaphore (no concurrent access)
