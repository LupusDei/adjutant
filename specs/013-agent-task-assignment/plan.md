# Implementation Plan: Agent Task Assignment

**Branch**: `013-agent-task-assignment` | **Date**: 2026-02-22 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/013-agent-task-assignment/spec.md`

## Summary

Add the ability to assign beads/tasks to agents from both the Beads view and Epics view. Assignment updates the bead's assignee, auto-transitions open beads to "in_progress", and notifies the assigned agent via the messaging system. The implementation extends the existing PATCH endpoint, adds an agents list endpoint, and adds a shared dropdown component to both views.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode)
**Primary Dependencies**: React 18+, Express, Tailwind CSS, Zod
**Storage**: SQLite (message store), bd CLI (beads)
**Testing**: Vitest (unit tests)
**Target Platform**: Web (desktop browser)
**Project Type**: Web application (frontend + backend)
**Performance Goals**: 60fps UI, <2s assignment round-trip
**Constraints**: bd CLI serialized execution (semaphore), in-memory agent status (not persisted)
**Scale/Scope**: Single-user (Mayor) dashboard, ~10-50 agents, ~100-1000 beads

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type Safety First | PASS | All new types use TypeScript strict, Zod validation at API boundary |
| II. Test-First Development | PASS | TDD for backend service, route handler, and frontend hook |
| III. UI Performance | PASS | Dropdown is lightweight, no animations that risk frame drops |
| IV. Documentation | PASS | JSDoc on new public functions and components |
| V. Simplicity | PASS | Extends existing patterns (PATCH endpoint, shared component), no new abstractions |

## Project Structure

### Documentation (this feature)

```text
specs/013-agent-task-assignment/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── api.yaml         # OpenAPI contract
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── routes/
│   │   ├── beads.ts          # MODIFY: extend PATCH to accept assignee
│   │   └── agents.ts         # NEW: GET /api/agents endpoint
│   ├── services/
│   │   ├── beads-service.ts  # MODIFY: add assignBead() function
│   │   ├── bd-client.ts      # No changes (already supports --assignee)
│   │   ├── message-store.ts  # No changes (insertMessage already works)
│   │   └── mcp-tools/
│   │       └── status.ts     # No changes (getAgentStatuses already exported)
│   └── types/
│       └── index.ts          # MODIFY: add AgentInfo type if needed
└── tests/
    └── unit/
        ├── beads-assign.test.ts  # NEW: assignment service tests
        └── agents-route.test.ts  # NEW: agents endpoint tests

frontend/
├── src/
│   ├── components/
│   │   ├── shared/
│   │   │   └── AgentAssignDropdown.tsx  # NEW: shared assignment dropdown
│   │   ├── beads/
│   │   │   └── KanbanCard.tsx           # MODIFY: add assign control
│   │   └── epics/
│   │       └── EpicDetailView.tsx       # MODIFY: add assign to subtask rows
│   ├── services/
│   │   └── api.ts                       # MODIFY: add assign() and agents.list()
│   └── types/
│       └── index.ts                     # MODIFY: add AgentInfo type
└── tests/
    └── unit/
        └── agent-assign.test.ts         # NEW: hook/component tests
```

**Structure Decision**: Web application structure (existing). No new directories except `backend/src/routes/agents.ts` for the new endpoint.

## Implementation Phases

### Phase 1: Backend — Agent List Endpoint

1. Create `GET /api/agents` route that queries the in-memory agent status store
2. Support `?status=idle` filter parameter
3. Return `{ agents: AgentInfo[] }` response
4. Add Zod validation for query params

### Phase 2: Backend — Extend Bead Assignment

1. Extend `PATCH /api/beads/:id` to accept `assignee` in request body
2. Add `assignBead()` to beads-service that:
   - Calls `bd update <id> --assignee <agent>`
   - If bead status is "open", also sets `--status in_progress`
   - Sends notification message via message-store
   - Broadcasts via WebSocket
3. Add Zod schema for the extended request body

### Phase 3: Frontend — API Methods

1. Add `api.agents.list(status?)` method
2. Extend `api.beads.update()` or add `api.beads.assign(id, agentId)` method

### Phase 4: Frontend — Shared Assignment Component

1. Create `AgentAssignDropdown` component:
   - Fetches agent list on open (filtered to idle/working)
   - Shows current assignee if set
   - Calls assign API on selection
   - Shows loading/error states
   - Pip-Boy themed styling

### Phase 5: Frontend — Integration

1. Add `AgentAssignDropdown` to `KanbanCard`
2. Add `AgentAssignDropdown` to `EpicDetailView` subtask rows
3. Handle optimistic updates and error rollback

## Complexity Tracking

> No violations. All changes follow existing patterns.
