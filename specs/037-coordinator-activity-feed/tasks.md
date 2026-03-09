# Tasks: Coordinator Activity Feed

## Phase 1: Backend Wiring

- [ ] T001 [US1] Add `coordinator:action` to EventMap in `backend/src/services/event-bus.ts` and add `"coordinator_action"` to EventType union in `backend/src/types/events.ts`
- [ ] T002 [US1] Bridge logDecision → eventStore.insertEvent in `backend/src/services/mcp-tools/coordination.ts`. Add `eventStore` parameter to `registerCoordinationTools()`, update call in `backend/src/index.ts`. After each `state.logDecision()`, insert a timeline event with eventType "coordinator_action", agentId "adjutant-coordinator", and full decision detail.
- [ ] T003 [US1] Add SSE mapping for `coordinator:action` → `coordinator_action` in `backend/src/routes/events.ts`
- [ ] T004 [US1] Write tests: verify coordination tools insert timeline events, verify EventBus event is emitted, verify SSE mapping exists in `backend/tests/unit/mcp-tools/coordination.test.ts`

## Phase 2: Frontend

- [ ] T005 [P] [US1] Add "coordinator_action" filter chip to `frontend/src/components/timeline/TimelineFilters.tsx` and add coordinator_action rendering (icon, distinct styling) to `frontend/src/components/timeline/TimelineEventCard.tsx`
