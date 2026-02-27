---
description: MCP tools for communicating with the Adjutant dashboard and other agents. Use when agents need to send messages, report status, manage beads, or query system state.
handoffs:
  - label: Broadcast to All Agents
    agent: adjutant.broadcast
    prompt: Broadcast this message to all agents
  - label: Direct Message an Agent
    agent: adjutant.dm
    prompt: Send a direct message to an agent
  - label: Discuss a Proposal
    agent: adjutant.discuss-proposal
    prompt: Discuss a proposal
---

## User Input

```text
$ARGUMENTS
```

# Adjutant Agent MCP Tools

This skill provides MCP tools for agents to interact with the Adjutant dashboard,
communicate with the user (Mayor) and other agents, manage beads, and report status.

## Connection

The MCP server auto-connects via the `adjutant` server configured in `.mcp.json` at the project root.
Your agent identity is resolved server-side from the MCP session -- the server maps your
session ID to your agent ID (set via the `agentId` query param on SSE connect or the
`X-Agent-Id` header, or the `ADJUTANT_AGENT_ID` environment variable).

The server endpoint is `http://localhost:4201/mcp/sse` (SSE transport).

## Available Tools

### Messaging Tools

Use these to communicate with the Mayor (user) and other agents.

**`send_message`** -- Send a message to a recipient.
```
send_message({
  to: "user",
  body: "Build complete. All tests pass.",
  threadId: "build-status"
})
```

**`read_messages`** -- Read messages with optional filters (by agent, thread).
```
read_messages({ limit: 10, threadId: "build-status" })
```

**`list_threads`** -- List conversation threads with message counts.
```
list_threads({ agentId: "my-agent" })
```

**`mark_read`** -- Mark messages as read (by messageId or agentId).
```
mark_read({ messageId: "uuid-here" })
mark_read({ agentId: "researcher" })
```

### Status Tools

Use these to report your current state to the dashboard.

**`set_status`** -- Update your agent status. Use for state transitions.
```
set_status({ status: "working", task: "Implementing feature X", beadId: "adj-010.3" })
```
Valid statuses: `working`, `blocked`, `idle`, `done`

**`report_progress`** -- Report task progress with a percentage. Use for long-running work.
```
report_progress({ task: "adj-010.7 skill tools", percentage: 50, description: "Halfway through implementation" })
```

**`announce`** -- Broadcast an announcement to the dashboard. Requires both title and body.
```
announce({ type: "completion", title: "Feature X done", body: "All tests pass. Ready for review.", beadId: "adj-010.3" })
```
Announcement types: `completion`, `blocker`, `question`

### Bead Tools

Use these to manage beads (work items) without shelling out to `bd`.

**`create_bead`** -- Create a new bead.
```
create_bead({ title: "Fix login bug", description: "Login times out after 30s", type: "bug", priority: 1 })
```

**`update_bead`** -- Update bead fields (status, assignee, title, etc.).
```
update_bead({ id: "adj-042", status: "in_progress", assignee: "my-agent" })
```

**`close_bead`** -- Close a bead with optional reason.
```
close_bead({ id: "adj-042", reason: "All tasks completed" })
```

**`list_beads`** -- List beads with optional filters.
```
list_beads({ status: "open", assignee: "my-agent" })
```

**`show_bead`** -- Get full details for a single bead.
```
show_bead({ id: "adj-042" })
```

### Proposal Tools

Use these to generate and review improvement proposals when idle.

**`create_proposal`** -- Create a new improvement proposal. Agent identity is resolved server-side.
```
create_proposal({
  title: "Add keyboard shortcuts for common actions",
  description: "What: Add keyboard shortcuts...\nWhy: Power users need faster navigation...\nHow: KeyboardShortcutManager component...\nImpact: Faster UX for power users",
  type: "product"
})
```
Types: `product` (UX/product improvements), `engineering` (refactoring/architecture)

**`list_proposals`** -- List existing proposals. Use to check uniqueness before creating.
```
list_proposals()                           // All proposals
list_proposals({ type: "engineering" })    // Only engineering proposals
list_proposals({ status: "pending" })      // Only pending proposals
```

See `skills/mcp-tools/references/generate-proposal.md` for the full proposal generation protocol.

### Query Tools

Read-only tools for system introspection.

**`list_agents`** -- List all agents with their status.
```
list_agents({ status: "active" })
```

**`get_project_state`** -- Get a summary of the current project state (beads, agents, messages).
```
get_project_state()
```

**`search_messages`** -- Full-text search across all messages.
```
search_messages({ query: "deployment failed", limit: 5 })
```

## Messaging Workflow

Messages flow through this pipeline:

1. Agent calls `send_message` via MCP
2. Message is persisted to SQLite (survives restarts)
3. WebSocket event broadcasts to connected dashboard clients
4. If recipient is `"user"` or `"mayor/"`, APNS push notification is sent to iOS

Messages are durable -- they persist even if the dashboard is not connected.
Use `read_messages` to catch up on messages sent while you were offline.

## Responding to Messages (MANDATORY)

When you receive a message via MCP (visible through `read_messages`), you **MUST** respond
using `send_message`. Never respond via stdout or text output alone -- the user and other
agents can only see messages sent through the MCP tools.

**On startup**: Call `read_messages({ limit: 5 })` to check for any pending messages.
If there are unread messages addressed to you, respond to them via `send_message`.

**During work**: Periodically check for new messages, especially if you're working on
a long task. The user may send follow-up questions or priority changes.

**When asked a question**: Always reply via `send_message({ to: "user", body: "..." })`.
Do NOT just print an answer to the terminal.

## Status Reporting Guidelines

- **`set_status`**: Use when your overall state changes (starting work, getting blocked, finishing).
  Call this at the beginning and end of major work phases.
- **`report_progress`**: Use periodically during long-running tasks to show incremental progress.
  Include a percentage and brief description string.
- **`announce`**: Use for events that need dashboard attention. Completions, blockers, and questions.
  These are highlighted prominently in the UI. Requires both `title` and `body`.

## Proposal Generation (Idle Agent Protocol)

When your task queue is empty (`bd ready` returns no work), enter proposal mode:

1. Spawn two teammates: a Product/UX analyst and a Staff Engineer
2. Each teammate calls `list_proposals` first to check for duplicates
3. Each creates one unique proposal via `create_proposal`
4. Each announces the proposal via `announce`

See `skills/mcp-tools/references/generate-proposal.md` for the complete protocol, spawn prompts, and guidelines.

## References

- `skills/mcp-tools/references/tool-catalog.md` -- Complete input/output schemas for all tools
- `skills/mcp-tools/references/generate-proposal.md` -- Proposal generation protocol and spawn prompts
