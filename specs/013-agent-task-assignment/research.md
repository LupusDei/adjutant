# Research: Agent Task Assignment

**Feature**: 013-agent-task-assignment
**Date**: 2026-02-22

## Findings

### 1. Existing Assignee Support

**Decision**: Leverage existing bd CLI `--assignee` flag and `BeadsIssue.assignee` field.

**Rationale**: The bd CLI already supports `bd update <id> --assignee <name>`. The MCP `update_bead` tool already exposes this to agents. The `BeadInfo` frontend type already has an `assignee: string | null` field. Only the REST API and frontend UI are missing.

**Alternatives considered**:
- Custom assignment store separate from beads — rejected, unnecessary duplication
- Direct SQLite writes — rejected, violates CLI wrapper pattern

### 2. REST Endpoint for Assignment

**Decision**: Extend `PATCH /api/beads/:id` to accept `assignee` in addition to `status`.

**Rationale**: The existing PATCH endpoint already handles bead updates. Adding `assignee` is additive and doesn't break existing callers. A single endpoint that can update both status and assignee atomically ensures the "assign + move to in_progress" operation is a single API call.

**Alternatives considered**:
- Separate `POST /api/beads/:id/assign` endpoint — rejected, over-engineering for a field update
- PUT replacing the whole bead — rejected, too broad for targeted updates

### 3. Agent List Endpoint

**Decision**: Create `GET /api/agents` endpoint exposing the in-memory agent status store.

**Rationale**: The agent status map (`getAgentStatuses()` from `status.ts`) already tracks all connected agents with their status. The frontend needs this data to populate the assignment dropdown. No new data source needed.

**Alternatives considered**:
- Using `gt agents list --all` CLI — rejected, that shows rig-level agents, not MCP-connected agents with real-time status
- WebSocket-only agent list — rejected, REST is simpler for a dropdown that fetches on open

### 4. Assignment Notification

**Decision**: Use the existing `message-store.insertMessage()` to create a system message to the assigned agent, broadcast via WebSocket.

**Rationale**: The message store already handles agent-targeted messages with WebSocket broadcast. The agent will receive the notification in real-time if connected, or see it when they next call `read_messages`.

**Alternatives considered**:
- Direct WebSocket event without persistence — rejected, agent might miss it if temporarily disconnected
- MCP tool callback — rejected, the server pushes to agents via messages, not tool calls

### 5. Agent Identifier Format

**Decision**: Use the agent's `agentId` string from the status store (e.g., "agent-1", "adjutant-agent").

**Rationale**: This matches the identifier used in the message store for routing messages to agents. The bd CLI assignee field is a free-text string, so any identifier works.

**Alternatives considered**:
- Using rig/agent format (e.g., "adjutant/agent-1") — considered but the status store only tracks agentId, not rig association

### 6. UI Component Pattern

**Decision**: Create a shared `AgentAssignDropdown` component used by both KanbanCard and EpicDetailView.

**Rationale**: Both views need identical assignment functionality. A shared component avoids duplication and ensures consistent behavior.

**Alternatives considered**:
- Inline dropdown in each component — rejected, violates DRY
- Context menu — rejected, less discoverable than an inline control
