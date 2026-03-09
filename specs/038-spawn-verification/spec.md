# Feature Specification: Spawn Verification Pipeline

**Feature Branch**: `038-spawn-verification`
**Created**: 2026-03-09
**Status**: Draft

## User Scenarios & Testing

### User Story 1 - Spawn Health Detection (Priority: P1)

After spawning an agent via `spawn_worker`, the system automatically detects whether the agent successfully connected via MCP within a timeout window. If the agent fails to connect, a spawn failure event is emitted for the coordinator to act on.

**Why this priority**: 50% spawn failure rate observed in adj-058 (2/4 worktree spawns needed retry). Without detection, failures are invisible until the user manually checks tmux panes.

**Independent Test**: Spawn an agent, verify health check timer fires if no MCP connection arrives within 30s.

**Acceptance Scenarios**:

1. **Given** an agent is spawned via `spawn_worker`, **When** the agent connects via MCP within 30s, **Then** the health check timer is cancelled and the agent is marked healthy.
2. **Given** an agent is spawned via `spawn_worker`, **When** the agent does NOT connect via MCP within 30s, **Then** a `spawn_failed` event is emitted with reason `no_mcp_connect`.
3. **Given** a spawn failure is detected, **When** the signal aggregator classifies the event, **Then** it is classified as CRITICAL priority.

---

### User Story 2 - Spawn Failure Recovery (Priority: P2)

When a spawn failure is detected, the coordinator is notified via the stimulus engine. The failure is logged with context (tmux pane state, session info) to aid debugging.

**Why this priority**: Detection without notification is useless. The coordinator needs to know so it can retry or reassign work.

**Independent Test**: Trigger a spawn failure event, verify the stimulus engine receives a CRITICAL signal and the coordinator is woken.

**Acceptance Scenarios**:

1. **Given** a `spawn_failed` event is emitted, **When** the signal aggregator processes it, **Then** a CRITICAL signal is generated with the agent ID and failure reason.
2. **Given** a CRITICAL spawn failure signal exists, **When** the stimulus engine runs its next cycle, **Then** the coordinator's situation prompt includes spawn failure context.

---

### Edge Cases

- What happens if the agent connects via MCP AFTER the health check timer fires? (Race condition — should be a no-op, agent is already marked failed.)
- What happens if the MCP server restarts during the health check window? (Timer should still fire — no false positive.)
- What happens if `spawn_worker` itself fails (returns `success: false`)? (No health check needed — failure is already known.)

## Requirements

### Functional Requirements

- **FR-001**: System MUST schedule a health check timer after each successful `spawn_worker` call.
- **FR-002**: System MUST cancel the health check timer when the spawned agent connects via MCP.
- **FR-003**: System MUST emit a `spawn_failed` event when the health check timer expires.
- **FR-004**: Signal aggregator MUST classify `spawn_failed` events as CRITICAL.
- **FR-005**: System MUST log spawn failure with agent ID, tmux session name, and failure reason.

### Key Entities

- **SpawnHealthCheck**: Timer tracking a pending spawn verification. Keyed by agent name.
- **SpawnFailedEvent**: Event emitted when spawn verification fails. Contains agentId, reason, tmuxSession.

## Success Criteria

- **SC-001**: 100% of spawn failures detected within 30s of spawn call.
- **SC-002**: Zero false positives (healthy agents not marked as failed).
- **SC-003**: Coordinator receives spawn failure signal within one stimulus cycle (~60s).
