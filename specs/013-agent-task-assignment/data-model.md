# Data Model: Agent Task Assignment

**Feature**: 013-agent-task-assignment
**Date**: 2026-02-22

## Entities

### BeadAssignment (API Request)

Represents an assignment operation sent from the frontend to the backend.

| Field    | Type              | Required | Description                              |
|----------|-------------------|----------|------------------------------------------|
| assignee | string \| null    | Yes      | Agent ID to assign, or null to unassign  |
| status   | string \| undefined | No     | Optional status override (defaults to "in_progress" on assign) |

### AgentInfo (API Response)

Represents an agent available for assignment.

| Field     | Type   | Required | Description                          |
|-----------|--------|----------|--------------------------------------|
| agentId   | string | Yes      | Unique agent identifier              |
| status    | string | Yes      | Current status: idle, working, blocked, done |
| task      | string | No       | Current task description             |
| updatedAt | string | Yes      | ISO timestamp of last status update  |

### AssignmentNotification (Internal)

Message sent to an agent when they are assigned a bead.

| Field     | Type   | Required | Description                          |
|-----------|--------|----------|--------------------------------------|
| recipient | string | Yes      | Agent ID of the assignee             |
| body      | string | Yes      | Human-readable assignment message    |
| role      | string | Yes      | Always "system"                      |
| metadata  | object | No       | Contains beadId, beadTitle, action   |

## State Transitions

### Bead Status on Assignment

```
open ──[assign agent]──> in_progress
in_progress ──[reassign]──> in_progress (no status change)
in_progress ──[unassign]──> in_progress (no status change, only assignee cleared)
```

### Assignment Flow

```
User selects agent
  → Frontend: POST/PATCH to backend
    → Backend: bd update <id> --assignee <agent> --status in_progress
    → Backend: insertMessage(notification to agent)
    → Backend: wsBroadcast(chat_message)
  ← Backend: returns updated bead
← Frontend: updates UI optimistically or on response
```

## Existing Types (No Changes Needed)

- `BeadInfo` (frontend) — already has `assignee: string | null`
- `BeadDetail` (frontend) — extends BeadInfo, inherits assignee
- `BeadsIssue` (backend) — already has `assignee?: string | null`
- `AgentStatus` (backend) — already has agentId, status, task, updatedAt
