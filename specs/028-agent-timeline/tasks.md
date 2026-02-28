# Tasks: Agent Activity Timeline & Audit Log

**Input**: Design documents from `/specs/028-agent-timeline/`
**Epic**: `adj-028`

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs for this document
- **Bead IDs** (adj-028.N.M): Assigned in beads-import.md after bead creation
- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1, US2, etc.)

## Phase 1: Foundational

**Purpose**: Events table, EventStore service, emission from MCP handlers, REST API

- [ ] T001 Create events table migration in `backend/src/services/migrations/006-events.sql`
- [ ] T002 [P] Define TimelineEvent types and Zod schemas in `backend/src/types/events.ts`
- [ ] T003 Implement EventStore service (insert, getEvents with pagination/filters, pruneOldEvents) in `backend/src/services/event-store.ts`
- [ ] T004 [P] Emit events from set_status, report_progress, and announce handlers in `backend/src/services/mcp-tools/status.ts`
- [ ] T005 [P] Emit events from send_message in `backend/src/services/mcp-tools/messaging.ts` and update_bead/close_bead in `backend/src/services/mcp-tools/beads.ts`
- [ ] T006 Add GET /api/events/timeline endpoint with query params (agentId, eventType, beadId, before, limit) in `backend/src/routes/events.ts`
- [ ] T007 Broadcast new events via WebSocket — add `timeline_event` type to WsServerMessage in `backend/src/services/ws-server.ts`

**Checkpoint**: Backend complete — events are captured, queryable, and broadcast in real-time

---

## Phase 2: US1 - Web Timeline View (Priority: P1, MVP)

**Goal**: Timeline tab in web UI with event list and filters
**Independent Test**: Open Timeline tab, see events, filter by agent and type

- [ ] T008 [US1] Add Timeline tab to TABS array and TabId type in `frontend/src/App.tsx`, add to visible tabs in `frontend/src/contexts/ModeContext.tsx`
- [ ] T009 [US1] Create useTimeline hook for fetching events, real-time WebSocket subscription, and filter state in `frontend/src/hooks/useTimeline.ts`
- [ ] T010 [US1] Add getTimelineEvents() method to `frontend/src/services/api.ts`
- [ ] T011 [US1] Create TimelineView component with vertical event stream in `frontend/src/components/timeline/TimelineView.tsx`
- [ ] T012 [US1] Create TimelineEvent component for individual event rendering (Pip-Boy log entry style) in `frontend/src/components/timeline/TimelineEvent.tsx`
- [ ] T013 [US1] Create TimelineFilters component (agent dropdown, event type chips, bead ID input) in `frontend/src/components/timeline/TimelineFilters.tsx`

**Checkpoint**: US1 independently functional — web timeline visible and filterable

---

## Phase 3: US2 - iOS Timeline View (Priority: P2)

**Goal**: Timeline tab in iOS app with event list and filters
**Independent Test**: Open Timeline tab in iOS, see events, filter by agent

- [ ] T014 [US2] Create TimelineEvent model in `ios/AdjutantKit/Models/TimelineEvent.swift` and add API method in `ios/AdjutantKit/Services/APIClient.swift`
- [ ] T015 [US2] Create SwiftUI TimelineView and TimelineViewModel in `ios/Adjutant/Features/Timeline/`
- [ ] T016 [US2] Add .timeline to AppTab enum in `ios/Adjutant/Core/Navigation/Coordinator.swift` and register in `ios/Adjutant/Core/Navigation/MainTabView.swift`

**Checkpoint**: US2 independently functional — iOS timeline visible and filterable

---

## Phase 4: Polish & Cross-Cutting

- [ ] T017 [P] Implement 7-day auto-pruning — run on server start and schedule every 6 hours in `backend/src/index.ts` using EventStore.pruneOldEvents()
- [ ] T018 Add time-range filter (last 1h, 6h, 24h, 7d) to TimelineFilters component and iOS TimelineView

---

## Dependencies

- Setup (Phase 1) -> blocks all user stories
- T003 (EventStore) blocks T004, T005, T006, T007
- T001 (migration) and T002 (types) can run in parallel, both block T003
- T004 and T005 can run in parallel (different files)
- US1 (Phase 2) and US2 (Phase 3) can run in parallel after Phase 1
- Polish (Phase 4) depends on Phase 2

## Parallel Opportunities

- T001 and T002 within Phase 1 (migration + types)
- T004 and T005 within Phase 1 (different MCP tool files)
- Phase 2 and Phase 3 entirely (web and iOS are independent)
- T017 in Phase 4 is independent of T018
