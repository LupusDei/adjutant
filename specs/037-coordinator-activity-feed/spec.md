# Coordinator Activity Feed via Timeline Integration

**Proposal**: 98c392a0 (supersedes 6fec184c)
**Priority**: P2
**Type**: Product

## Problem

The Adjutant coordinator makes decisions (spawning agents, assigning beads, nudging idle agents, decommissioning) but these are invisible to the user unless explicitly messaged. This caused adj-055 (premature agent shutdowns) and creates ongoing operational blind spots.

## User Stories

### US1: View Coordinator Actions in Timeline (Priority: P2)

**As a** user monitoring my agent swarm,
**I want to** see coordinator decisions in the existing timeline,
**So that** I have full visibility into what the coordinator is doing and why.

**Acceptance Criteria:**
- [ ] Coordinator decisions (spawn, assign, nudge, decommission, rebalance) appear as timeline events
- [ ] Events show: timestamp, action type, target agent/bead, reason
- [ ] Events appear in real-time via WebSocket (no page refresh needed)
- [ ] Filtering timeline by agent "adjutant-coordinator" shows only coordinator actions
- [ ] A "coordinator_action" filter chip exists in the timeline filters
- [ ] Click-to-expand shows full decision detail (behavior, action, target, reason)

## Requirements

### Functional
- Bridge `state.logDecision()` to `eventStore.insertEvent()` in coordination tools
- Add `coordinator:action` event to EventBus EventMap
- Add `coordinator_action` to timeline EventType union
- Add SSE mapping for real-time streaming
- Frontend filter chip and event card rendering

### Non-Functional
- No new REST endpoints (reuse `/api/events/timeline`)
- No new WebSocket endpoints (reuse existing broadcast)
- No new database tables (reuse `events` table)
- Must not affect performance of existing timeline queries

## Success Criteria
- User can filter timeline to "adjutant-coordinator" and see all decisions
- Events appear within 1 second of the coordinator making a decision
- All coordination tool actions produce timeline events
