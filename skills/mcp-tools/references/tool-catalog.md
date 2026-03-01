# Adjutant MCP Tool Catalog

Complete reference for all MCP tools exposed by the Adjutant server.
Parameter names and types match the Zod schemas in the implementation.

---

## Messaging Tools

Tools for agent-to-user and agent-to-agent communication. Messages are persisted
in SQLite and broadcast in real-time via WebSocket.

### send_message

Send a message to a specific recipient. Agent identity is resolved server-side
from the MCP session (not client-supplied).

**Input Schema:**

| Field    | Type   | Required | Description                                      |
|----------|--------|----------|--------------------------------------------------|
| to       | string | yes      | Recipient: `"user"` or agent name                |
| body     | string | yes      | Message content                                  |
| threadId | string | no       | Thread ID for conversation grouping              |
| metadata | object | no       | Arbitrary key-value metadata                     |

**Example:**
```json
{
  "to": "user",
  "body": "Feature implementation complete. All 12 tests pass.",
  "threadId": "adj-010-progress"
}
```

**Output:**
```json
{
  "messageId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-02-21T12:00:00.000Z"
}
```

### read_messages

Read messages with optional filtering and cursor-based pagination.

**Input Schema:**

| Field    | Type   | Required | Description                                       |
|----------|--------|----------|---------------------------------------------------|
| threadId | string | no       | Filter by thread ID                               |
| agentId  | string | no       | Filter by agent ID                                |
| limit    | number | no       | Max messages to return (default: 50)              |
| before   | string | no       | Cursor: return messages before this ISO timestamp |
| beforeId | string | no       | Cursor: disambiguate same-second messages         |

**Example:**
```json
{
  "threadId": "adj-010-progress",
  "limit": 10
}
```

**Output:**
```json
{
  "messages": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "agentId": "my-agent",
      "recipient": "user",
      "role": "agent",
      "body": "Feature implementation complete.",
      "deliveryStatus": "read",
      "threadId": "adj-010-progress",
      "createdAt": "2026-02-21T12:00:00.000Z"
    }
  ]
}
```

### list_threads

List conversation threads with message counts and latest message preview.

**Input Schema:**

| Field   | Type   | Required | Description                  |
|---------|--------|----------|------------------------------|
| agentId | string | no       | Filter threads by agent ID   |

**Example:**
```json
{
  "agentId": "my-agent"
}
```

**Output:**
```json
{
  "threads": [
    {
      "threadId": "adj-010-progress",
      "messageCount": 14,
      "latestBody": "Feature implementation complete.",
      "latestCreatedAt": "2026-02-21T12:00:00.000Z",
      "agentId": "my-agent"
    }
  ]
}
```

### mark_read

Mark messages as read. Provide either `messageId` (single) or `agentId` (bulk).
At least one is required.

**Input Schema:**

| Field     | Type   | Required | Description                                    |
|-----------|--------|----------|------------------------------------------------|
| messageId | string | no       | Mark a single message as read                  |
| agentId   | string | no       | Mark all messages from this agent as read      |

**Example (single):**
```json
{
  "messageId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Example (bulk):**
```json
{
  "agentId": "researcher"
}
```

**Output:**
```json
{
  "success": true
}
```

---

## Status Tools

Tools for agents to report their current state to the dashboard.
Agent identity is resolved server-side from the MCP session.

### set_status

Update the agent's current status. Broadcasts a WebSocket `typing` event.

**Input Schema:**

| Field  | Type   | Required | Description                                          |
|--------|--------|----------|------------------------------------------------------|
| status | string | yes      | One of `"working"`, `"blocked"`, `"idle"`, `"done"`  |
| task   | string | no       | Human-readable description of current task           |
| beadId | string | no       | Bead ID being worked on                              |

**Example:**
```json
{
  "status": "working",
  "task": "Running test suite for messaging module",
  "beadId": "adj-010.3"
}
```

**Output:**
```json
{
  "acknowledged": true,
  "status": "working"
}
```

### report_progress

Report incremental progress on a task with percentage. Broadcasts a WebSocket event.

**Input Schema:**

| Field       | Type   | Required | Description                            |
|-------------|--------|----------|----------------------------------------|
| task        | string | yes      | Task being worked on                   |
| percentage  | number | yes      | Completion percentage (0-100)          |
| description | string | no       | Human-readable progress description    |

**Example:**
```json
{
  "task": "adj-010.3 MCP tools",
  "percentage": 75,
  "description": "3 of 4 tools implemented"
}
```

**Output:**
```json
{
  "acknowledged": true,
  "percentage": 75
}
```

### announce

Broadcast an announcement to the dashboard. Stored in the messages table
with `role: "announcement"`. Requires both `title` and `body`.

**Input Schema:**

| Field  | Type   | Required | Description                                            |
|--------|--------|----------|--------------------------------------------------------|
| type   | string | yes      | One of `"completion"`, `"blocker"`, `"question"`       |
| title  | string | yes      | Announcement title                                     |
| body   | string | yes      | Announcement body                                      |
| beadId | string | no       | Related bead ID                                        |

**Example:**
```json
{
  "type": "completion",
  "title": "Messaging tools done",
  "body": "All tests pass. Ready for review.",
  "beadId": "adj-010.3"
}
```

**Output:**
```json
{
  "messageId": "550e8400-e29b-41d4-a716-446655440001",
  "timestamp": "2026-02-21T12:00:00.000Z"
}
```

---

## Bead Tools

Tools for managing beads (work items) via MCP instead of shelling out to `bd`.
All operations are serialized through a mutex to prevent concurrent SQLite access.

### create_bead

Create a new bead.

**Input Schema:**

| Field       | Type   | Required | Description                                      |
|-------------|--------|----------|--------------------------------------------------|
| title       | string | yes      | Bead title                                       |
| description | string | yes      | Bead description                                 |
| type        | string | yes      | One of `"epic"`, `"task"`, `"bug"`               |
| priority    | number | yes      | Priority: 0=critical, 1=high, 2=medium, 3=low, 4=backlog |
| id          | string | no       | Custom bead ID (auto-generated if omitted)       |

**Example:**
```json
{
  "title": "Add rate limiting to MCP tools",
  "description": "Implement per-agent rate limiting for tool calls",
  "type": "task",
  "priority": 2
}
```

**Output:**
```
Created bead adj-xyz: Add rate limiting to MCP tools
```

### update_bead

Update fields on an existing bead.

**Input Schema:**

| Field       | Type   | Required | Description                                           |
|-------------|--------|----------|-------------------------------------------------------|
| id          | string | yes      | Bead ID (e.g. `"adj-042"`)                           |
| status      | string | no       | One of `"open"`, `"in_progress"`, `"closed"`          |
| title       | string | no       | Updated title                                         |
| description | string | no       | Updated description                                   |
| assignee    | string | no       | Assignee name                                         |
| priority    | number | no       | Priority: 0=critical, 1=high, 2=medium, 3=low, 4=backlog |

**Example:**
```json
{
  "id": "adj-042",
  "status": "in_progress",
  "assignee": "my-agent"
}
```

**Output:**
```
Updated bead adj-042
```

### close_bead

Close a bead (mark as done).

**Input Schema:**

| Field  | Type   | Required | Description         |
|--------|--------|----------|---------------------|
| id     | string | yes      | Bead ID to close    |
| reason | string | no       | Close reason        |

**Example:**
```json
{
  "id": "adj-042",
  "reason": "All tasks completed"
}
```

**Output:**
```
Closed bead adj-042
```

### list_beads

List beads with optional filters.

**Input Schema:**

| Field    | Type   | Required | Description                                             |
|----------|--------|----------|---------------------------------------------------------|
| status   | string | no       | Filter: `"open"`, `"in_progress"`, `"closed"`, `"all"` |
| assignee | string | no       | Filter by assignee                                      |
| type     | string | no       | Filter: `"epic"`, `"task"`, `"bug"`                     |

**Example:**
```json
{
  "status": "open",
  "assignee": "my-agent"
}
```

**Output:**
```
[open] adj-042 (task, P2): Add rate limiting to MCP tools
[in_progress] adj-043 (bug, P1): Fix login timeout
```

### show_bead

Get full details for a single bead, including dependencies.

**Input Schema:**

| Field | Type   | Required | Description    |
|-------|--------|----------|----------------|
| id    | string | yes      | Bead ID        |

**Example:**
```json
{
  "id": "adj-042"
}
```

**Output:**
```
ID: adj-042
Title: Add rate limiting to MCP tools
Status: in_progress
Type: task
Priority: P2
Assignee: my-agent
Description: Implement per-agent rate limiting...
Dependencies:
  - adj-010.2 (depends)
```

---

## Proposal Tools

Tools for generating and reviewing improvement proposals. Agents use these
when idle to submit product/UX or engineering improvement ideas.

### create_proposal

Create a new improvement proposal. Agent identity is resolved server-side
from the MCP session and used as the author.

**Input Schema:**

| Field       | Type   | Required | Description                                                        |
|-------------|--------|----------|--------------------------------------------------------------------|
| title       | string | yes      | Concise proposal title                                             |
| description | string | yes      | Deep description: what, why, how, and expected impact              |
| type        | string | yes      | `"product"` (UX/product) or `"engineering"` (refactor/architecture)|

**Example:**
```json
{
  "title": "Add keyboard shortcuts for common actions",
  "description": "What: Add keyboard shortcuts for tab navigation, message sending, and bead actions.\nWhy: Power users must currently use mouse for everything, slowing down workflows.\nHow: Create a KeyboardShortcutManager React context that registers global key handlers.\nImpact: Significantly faster navigation for experienced users.",
  "type": "product"
}
```

**Output:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440003",
  "title": "Add keyboard shortcuts for common actions",
  "type": "product",
  "status": "pending",
  "createdAt": "2026-02-24T12:00:00.000Z"
}
```

### list_proposals

List existing proposals with optional filters. Use this before creating
a proposal to check for duplicates.

**Input Schema:**

| Field  | Type   | Required | Description                                                  |
|--------|--------|----------|--------------------------------------------------------------|
| status | string | no       | Filter: `"pending"`, `"accepted"`, `"dismissed"`             |
| type   | string | no       | Filter: `"product"`, `"engineering"`                         |

**Example:**
```json
{
  "type": "engineering"
}
```

**Output:**
```json
{
  "proposals": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440003",
      "author": "staff-engineer-agent",
      "title": "Extract shared Zod validation into middleware",
      "description": "What: ...",
      "type": "engineering",
      "status": "pending",
      "createdAt": "2026-02-24T12:00:00.000Z"
    }
  ],
  "count": 1
}
```

---

## Query Tools

Read-only tools for system introspection. Agents can use these to understand
the current state of the project without side effects.

### list_agents

List all known agents with their current status.

**Input Schema:**

| Field  | Type   | Required | Description                                     |
|--------|--------|----------|-------------------------------------------------|
| status | string | no       | Filter: `"active"`, `"idle"`, `"all"` (default: `"all"`) |

**Example:**
```json
{
  "status": "active"
}
```

**Output:**
```json
{
  "agents": [
    {
      "agentId": "messaging-builder",
      "status": "working",
      "currentTask": "Implementing send_message tool",
      "sessionId": "abc-123",
      "connectedAt": "2026-02-21T11:00:00.000Z"
    }
  ],
  "count": 1
}
```

### get_project_state

Get a summary of the current project state.

**Input Schema:**

No required inputs. Call with empty object `{}`.

**Example:**
```json
{}
```

**Output:**
```json
{
  "connectedAgents": 5,
  "openBeads": 15,
  "recentMessages": 42,
  "unreadCounts": [
    { "agentId": "builder", "count": 3 }
  ]
}
```

### search_messages

Full-text search across all messages. Uses SQLite FTS5 for fast matching.

**Input Schema:**

| Field   | Type   | Required | Description                        |
|---------|--------|----------|------------------------------------|
| query   | string | yes      | Search query (FTS5 syntax)         |
| agentId | string | no       | Filter results to specific agent   |
| limit   | number | no       | Max results to return (default: 20) |

**Example:**
```json
{
  "query": "deployment failed",
  "limit": 5
}
```

**Output:**
```json
{
  "results": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440002",
      "agentId": "deploy-agent",
      "role": "announcement",
      "body": "Deployment failed: nginx config error on port 443",
      "eventType": "announcement",
      "createdAt": "2026-02-21T11:45:00.000Z"
    }
  ],
  "count": 1
}
```

---

## Error Format

All tools return errors in a consistent format when used with MCP content blocks:

```json
{
  "error": "Error: description of what went wrong"
}
```

For bead tools, errors include `isError: true` in the MCP response:
```
Error: bd create failed
```

Common error scenarios:
- Unknown session -- agent not connected via MCP SSE
- Bead not found -- invalid bead ID
- Validation errors -- Zod schema validation failures (wrong param names/types)
- bd command failures -- underlying `bd` CLI errors
