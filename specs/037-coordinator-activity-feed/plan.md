# Implementation Plan: Coordinator Activity Feed

## Architecture Decision

**Approach**: Bridge coordinator decisions into existing timeline infrastructure.
**Rationale**: The timeline already supports agent filtering, event type chips, click-to-expand detail, real-time WebSocket updates, and cursor-based pagination. Building a separate panel would duplicate all of this.

## File Changes

### Backend

| File | Change |
|------|--------|
| `backend/src/services/event-bus.ts` | Add `coordinator:action` to `EventMap` |
| `backend/src/types/events.ts` | Add `"coordinator_action"` to `EventType` union |
| `backend/src/services/mcp-tools/coordination.ts` | After each `state.logDecision()`, call `eventStore.insertEvent()` + emit EventBus event |
| `backend/src/routes/events.ts` | Add SSE mapping for `coordinator:action` → `coordinator_action` |

### Frontend

| File | Change |
|------|--------|
| `frontend/src/components/timeline/TimelineFilters.tsx` | Add "coordinator_action" chip |
| `frontend/src/components/timeline/TimelineEventCard.tsx` | Add rendering for coordinator_action events (icon, color, layout) |

### Tests

| File | Change |
|------|--------|
| `backend/tests/unit/mcp-tools/coordination.test.ts` | Test that coordination tools insert timeline events |
| `backend/tests/unit/event-bus.test.ts` | Test coordinator:action event type (if needed) |

## Phase 1: Backend Wiring (Serial)

1. Add types (EventBus + EventType) — foundation everything else depends on
2. Bridge logDecision → insertEvent in coordination tools — requires eventStore param
3. Add SSE mapping — requires event type to exist
4. Tests

## Phase 2: Frontend (Parallel with Phase 1 tests)

5. Filter chip + event card rendering

## Dependency: eventStore Access

The coordination tools currently receive `(server, state, messageStore, stimulusEngine)`. To insert timeline events, they also need `eventStore`. This requires:
- Adding `eventStore` parameter to `registerCoordinationTools()`
- Updating the call in `index.ts`

## Bead Map

- `adj-059` — Root epic: Coordinator Activity Feed via Timeline Integration
  - `adj-059.1` — Add coordinator:action to EventBus + EventType
  - `adj-059.2` — Bridge logDecision → eventStore in coordination tools
  - `adj-059.3` — Add SSE mapping in events router
  - `adj-059.4` — Frontend filter chip + event card rendering
  - `adj-059.5` — Tests for all layers
