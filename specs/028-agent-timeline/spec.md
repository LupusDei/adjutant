# Feature Specification: Agent Activity Timeline & Audit Log

**Feature Branch**: `028-agent-timeline`
**Created**: 2026-02-28
**Status**: Draft
**Proposal**: fba96abb-64c4-44a6-85b2-b066b1706b82

## User Scenarios & Testing

### User Story 1 - View Agent Activity Timeline (Priority: P1)

As the Mayor, I want to see a chronological timeline of all agent state transitions, messages, and bead status changes so I can understand what happened and when across my multi-agent system.

**Why this priority**: Without temporal visibility, debugging coordination issues and understanding agent throughput is impossible. The status endpoint only shows current state, not history.

**Independent Test**: Open the Timeline tab, verify events appear in reverse-chronological order from recent agent activity. Filter by a specific agent and confirm only their events show.

**Acceptance Scenarios**:

1. **Given** agents have been sending status updates via MCP, **When** I open the Timeline tab, **Then** I see a reverse-chronological list of events with timestamps, agent names, and action summaries
2. **Given** the timeline shows mixed event types, **When** I filter by "status_change", **Then** only agent status transition events are displayed
3. **Given** an agent changes status while the timeline is open, **When** the status change is emitted, **Then** a new event appears at the top of the timeline in real-time via WebSocket

---

### User Story 2 - iOS Timeline View (Priority: P2)

As the Mayor using the iOS app, I want the same timeline view available on mobile so I can monitor agent activity on the go.

**Why this priority**: Mobile parity is important but web MVP comes first.

**Independent Test**: Open the Timeline tab in the iOS app. Verify events render with proper Pip-Boy styling, filtering works, and new events appear via polling.

**Acceptance Scenarios**:

1. **Given** the backend has timeline events, **When** I open the Timeline tab on iOS, **Then** I see the same events as the web UI with SwiftUI-native rendering
2. **Given** I'm viewing the iOS timeline, **When** I tap a filter chip for a specific agent, **Then** the list filters to only that agent's events

---

### Edge Cases

- What happens when no events exist yet? Show an empty state message.
- What happens when the events table has thousands of entries? Paginate with cursor-based pagination (same pattern as messages).
- What happens to events older than 7 days? Auto-pruned on server start and periodically.
- What if an agent disconnects without a final status update? The disconnect itself is an event.

## Requirements

### Functional Requirements

- **FR-001**: System MUST capture events when agents call set_status, report_progress, or announce via MCP
- **FR-002**: System MUST capture events when messages are sent (send_message) and beads are updated (update_bead, close_bead)
- **FR-003**: System MUST provide a REST endpoint for querying events with pagination and filtering (by agent, event type, bead, time range)
- **FR-004**: System MUST broadcast new events via WebSocket for real-time timeline updates
- **FR-005**: System MUST auto-prune events older than 7 days
- **FR-006**: Web frontend MUST display a Timeline tab with filterable event list
- **FR-007**: iOS app MUST display a Timeline tab with equivalent functionality

### Key Entities

- **TimelineEvent**: Represents a single audit trail entry — has id, timestamp, eventType, agentId, action summary, detail payload, and optional beadId/messageId references

## Success Criteria

- **SC-001**: All MCP tool calls (set_status, announce, send_message, update_bead, close_bead) generate corresponding timeline events
- **SC-002**: Timeline tab loads and renders events within 200ms for up to 1000 events
- **SC-003**: Real-time events appear in the web timeline within 1 second of emission
- **SC-004**: Events older than 7 days are automatically pruned
