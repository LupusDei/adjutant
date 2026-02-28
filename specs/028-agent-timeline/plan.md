# Implementation Plan: Agent Activity Timeline & Audit Log

**Branch**: `028-agent-timeline` | **Date**: 2026-02-28
**Epic**: `adj-028` | **Priority**: P2

## Summary

Add an `events` table in SQLite to capture agent state transitions, messages, bead updates, and announcements as they happen. Expose via REST API and WebSocket for a new Timeline tab in both web and iOS. Events auto-prune after 7 days.

## Bead Map

- `adj-028` - Root: Agent Activity Timeline & Audit Log
  - `adj-028.1` - Foundational: Events table, store, emission, API
    - `adj-028.1.1` - Create events table migration
    - `adj-028.1.2` - Define TimelineEvent types
    - `adj-028.1.3` - Implement EventStore service
    - `adj-028.1.4` - Emit events from status MCP tools
    - `adj-028.1.5` - Emit events from messaging and beads MCP tools
    - `adj-028.1.6` - Add GET /api/events/timeline endpoint
    - `adj-028.1.7` - Broadcast new events via WebSocket
  - `adj-028.2` - US1: Web Timeline View
    - `adj-028.2.1` - Add Timeline tab to navigation
    - `adj-028.2.2` - Create useTimeline hook
    - `adj-028.2.3` - Create TimelineView component
    - `adj-028.2.4` - Add filter controls (agent, type, bead)
  - `adj-028.3` - US2: iOS Timeline View
    - `adj-028.3.1` - Create iOS TimelineEvent model + API method
    - `adj-028.3.2` - Create SwiftUI TimelineView + ViewModel
    - `adj-028.3.3` - Add Timeline tab to iOS navigation
  - `adj-028.4` - Polish: Retention & Performance
    - `adj-028.4.1` - Implement 7-day auto-pruning
    - `adj-028.4.2` - Add time-range filter to web and iOS

## Technical Context

**Stack**: TypeScript 5.x (strict), React 18, Express, Tailwind, Zod, SwiftUI
**Storage**: SQLite (better-sqlite3) via migration system in backend/src/services/migrations/
**Testing**: Vitest (backend + frontend)
**Constraints**: 200ms load time for 1000 events, 7-day retention

## Architecture Decision

Reuse the existing SQLite migration system and MessageStore patterns. Events are write-heavy but read-infrequently, so a simple table with indexed columns suffices. No need for a separate database — add to the existing adjutant.db.

Emit events inline in MCP tool handlers (status.ts, messaging.ts, beads.ts) rather than using an event bus, since these are the single entry points for all agent actions. This minimizes code changes and guarantees no events are missed.

WebSocket broadcast uses the existing `wsBroadcast` infrastructure with a new `timeline_event` message type.

## Files Changed

| File | Change |
|------|--------|
| `backend/src/services/migrations/006-events.sql` | New events table + indexes |
| `backend/src/types/events.ts` | TimelineEvent type + Zod schema |
| `backend/src/services/event-store.ts` | EventStore class (insert, query, prune) |
| `backend/src/services/mcp-tools/status.ts` | Emit events on set_status, report_progress, announce |
| `backend/src/services/mcp-tools/messaging.ts` | Emit events on send_message |
| `backend/src/services/mcp-tools/beads.ts` | Emit events on update_bead, close_bead |
| `backend/src/routes/events.ts` | GET /api/events/timeline endpoint |
| `backend/src/index.ts` | Register events routes, init pruning |
| `backend/src/services/ws-server.ts` | Add `timeline_event` to WsServerMessage union |
| `frontend/src/App.tsx` | Add Timeline tab to TABS array |
| `frontend/src/contexts/ModeContext.tsx` | Add timeline to visible tabs |
| `frontend/src/components/timeline/TimelineView.tsx` | Main timeline component |
| `frontend/src/components/timeline/TimelineEvent.tsx` | Individual event rendering |
| `frontend/src/components/timeline/TimelineFilters.tsx` | Filter controls |
| `frontend/src/hooks/useTimeline.ts` | Data fetching + filtering hook |
| `frontend/src/services/api.ts` | Add getTimelineEvents() API method |
| `ios/Adjutant/Features/Timeline/TimelineView.swift` | SwiftUI timeline view |
| `ios/Adjutant/Features/Timeline/TimelineViewModel.swift` | ViewModel for timeline |
| `ios/Adjutant/Core/Navigation/Coordinator.swift` | Add .timeline to AppTab |
| `ios/Adjutant/Core/Navigation/MainTabView.swift` | Register timeline tab |
| `ios/AdjutantKit/Models/TimelineEvent.swift` | iOS model |
| `ios/AdjutantKit/Services/APIClient.swift` | Add timeline API call |

## Phase 1: Foundational

Create the events table, EventStore service, wire emission into all MCP tool handlers, and expose a REST endpoint. This is the critical path — everything else depends on it.

Key decisions:
- Events table columns: id (UUID), event_type, agent_id, action, detail (JSON), bead_id, message_id, created_at
- Indexes on: event_type, agent_id, bead_id, created_at
- EventStore follows MessageStore patterns (prepare statements, cursor pagination)
- Emit events synchronously inline (not async) — SQLite writes are fast with WAL mode

## Phase 2: US1 - Web Timeline View (MVP)

Add Timeline as a new tab after BEADS. Create the TimelineView component with a vertical event stream. Each event is a Pip-Boy styled log entry with timestamp, agent indicator, and action summary. Filter by agent, event type, and bead ID via dropdowns/chips.

Real-time updates via WebSocket `timeline_event` messages — new events prepend to the list with a subtle animation.

## Phase 3: US2 - iOS Timeline View

Mirror the web timeline in SwiftUI. Add `.timeline` to AppTab enum, create TimelineView with LazyVStack of events, add filter controls. Uses polling (existing pattern) rather than WebSocket.

## Phase 4: Polish

Implement auto-pruning: on server start and every 6 hours, delete events older than 7 days. Add time-range picker to both web and iOS UIs.

## Parallel Execution

- Phase 1 must complete before Phase 2 and 3
- Phase 2 (web) and Phase 3 (iOS) can run in parallel after Phase 1
- Phase 4 depends on Phase 2

## Verification Steps

- [ ] Events are created for each MCP tool call (check with GET /api/events/timeline)
- [ ] Timeline tab appears in web UI and renders events
- [ ] Filtering by agent and event type works correctly
- [ ] New events appear in real-time via WebSocket
- [ ] iOS timeline tab renders events with proper styling
- [ ] Events older than 7 days are pruned on server restart
- [ ] All existing tests still pass (no regressions from MCP tool changes)
