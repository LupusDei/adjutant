# Agent Activity Timeline & Audit Log - Beads

**Feature**: 028-agent-timeline
**Generated**: 2026-02-28
**Source**: specs/028-agent-timeline/tasks.md

## Root Epic

- **ID**: adj-028
- **Title**: Agent Activity Timeline & Audit Log
- **Type**: epic
- **Priority**: 2
- **Description**: Add chronological timeline view showing agent state transitions, message events, and bead status changes. Events table in SQLite, emission from MCP handlers, Timeline tab in web and iOS.

## Epics

### Phase 1 — Foundational: Events table, store, emission, API
- **ID**: adj-028.1
- **Type**: epic
- **Priority**: 1
- **Tasks**: 7

### Phase 2 — US1: Web Timeline View
- **ID**: adj-028.2
- **Type**: epic
- **Priority**: 1
- **MVP**: true
- **Tasks**: 6

### Phase 3 — US2: iOS Timeline View
- **ID**: adj-028.3
- **Type**: epic
- **Priority**: 2
- **Tasks**: 3

### Phase 4 — Polish: Retention & Performance
- **ID**: adj-028.4
- **Type**: epic
- **Priority**: 3
- **Depends**: US1
- **Tasks**: 2

## Tasks

### Phase 1 — Foundational

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Create events table migration | backend/src/services/migrations/006-events.sql | adj-028.1.1 |
| T002 | Define TimelineEvent types and Zod schemas | backend/src/types/events.ts | adj-028.1.2 |
| T003 | Implement EventStore service | backend/src/services/event-store.ts | adj-028.1.3 |
| T004 | Emit events from status MCP tools | backend/src/services/mcp-tools/status.ts | adj-028.1.4 |
| T005 | Emit events from messaging and beads MCP tools | backend/src/services/mcp-tools/messaging.ts, beads.ts | adj-028.1.5 |
| T006 | Add GET /api/events/timeline endpoint | backend/src/routes/events.ts | adj-028.1.6 |
| T007 | Broadcast new events via WebSocket | backend/src/services/ws-server.ts | adj-028.1.7 |

### Phase 2 — US1: Web Timeline View

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T008 | Add Timeline tab to navigation | frontend/src/App.tsx, contexts/ModeContext.tsx | adj-028.2.1 |
| T009 | Create useTimeline hook | frontend/src/hooks/useTimeline.ts | adj-028.2.2 |
| T010 | Add getTimelineEvents API method | frontend/src/services/api.ts | adj-028.2.3 |
| T011 | Create TimelineView component | frontend/src/components/timeline/TimelineView.tsx | adj-028.2.4 |
| T012 | Create TimelineEvent component | frontend/src/components/timeline/TimelineEvent.tsx | adj-028.2.5 |
| T013 | Create TimelineFilters component | frontend/src/components/timeline/TimelineFilters.tsx | adj-028.2.6 |

### Phase 3 — US2: iOS Timeline View

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T014 | Create iOS TimelineEvent model + API method | ios/AdjutantKit/Models/TimelineEvent.swift, Services/APIClient.swift | adj-028.3.1 |
| T015 | Create SwiftUI TimelineView + ViewModel | ios/Adjutant/Features/Timeline/ | adj-028.3.2 |
| T016 | Add Timeline tab to iOS navigation | ios/Adjutant/Core/Navigation/Coordinator.swift, MainTabView.swift | adj-028.3.3 |

### Phase 4 — Polish

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T017 | Implement 7-day auto-pruning | backend/src/index.ts, event-store.ts | adj-028.4.1 |
| T018 | Add time-range filter to web and iOS | frontend + ios TimelineFilters | adj-028.4.2 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Foundational | 7 | 1 | adj-028.1 |
| 2: US1 Web Timeline (MVP) | 6 | 1 | adj-028.2 |
| 3: US2 iOS Timeline | 3 | 2 | adj-028.3 |
| 4: Polish | 2 | 3 | adj-028.4 |
| **Total** | **18** | | |

## Dependency Graph

Phase 1: Foundational (adj-028.1)
    |
    +---> Phase 2: US1 Web (adj-028.2, MVP)    Phase 3: US2 iOS (adj-028.3)  [parallel]
              |                                       |
              +-------+-------+-------+-------+-------+
                      |
              Phase 4: Polish (adj-028.4)

## Improvements

Improvements (Level 4: adj-028.N.M.P) are NOT pre-planned here. They are created
during implementation when bugs, refactors, or extra tests are discovered.
