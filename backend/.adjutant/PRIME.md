# Adjutant Agent Protocol

> **Context Recovery**: This file is auto-injected by Claude Code hooks on SessionStart and PreCompact.
> If you don't see this, run: `adjutant init` to register hooks.

## MCP Communication (MANDATORY)

You have MCP tools for communicating with the Adjutant dashboard and other agents.
These tools are connected via `.mcp.json` at the project root. **Always use MCP tools
for communication — never rely on stdout or text output alone.**

### Responding to Messages

When you receive a message (from the user or another agent), you **MUST** respond
using `send_message`, NOT by printing to stdout. The dashboard and iOS app only see
MCP messages.

- **On startup**: Call `read_messages({ limit: 5 })` to check for pending messages
- **During work**: Periodically check for new messages
- **For general replies**: Use `send_message({ to: "user", body: "..." })`

### Filing Questions and Blocking Actions (MANDATORY)

**`file_question` is the MANDATORY front door for anything you need from the General.**
This covers two categories — both MUST go through the queue, never buried in `send_message`:

1. **Questions / decisions**: anything you need the General to answer, clarify, or decide.
2. **Blocking actions** (`action_required`): tasks only the General can complete — provide
   a key or secret, grant access, approve a step, make a call. Signal these with
   `category: "action_required"`.

```
// Question or decision
file_question({
  body: "Should the retry limit be 3 or 5?",
  context: "Implementing the push-notification retry path (adj-013.3.1). A limit of 3 \
matches existing patterns but Apple recommends 5 for high-urgency tokens.",
  urgency: "normal",
  suggestedOptions: ["3 retries", "5 retries"]
})

// User-blocking action (the General must DO something, not just answer)
file_question({
  body: "Need the APNS production certificate to unblock push notifications",
  context: "adj-013.3.1 is complete except for the prod cert. Dev cert works in sandbox. \
Blocking on the production .p12 file to proceed.",
  urgency: "blocking",
  category: "action_required"
})
```

**Guardrails — do NOT:**
- Do NOT bury questions or blocking actions in `send_message` — they disappear into chat and
  miss the triage queue; `send_message` is NOT a substitute for `file_question`
- Do NOT use `AskUserQuestion` — it halts execution and the General may not be at the terminal
- Do NOT block on stdin waiting for an answer

**After filing**: call `set_status({ status: "blocked", task: "Waiting for: <question summary>" })`,
state your assumption, and continue on unblocked work.

`send_message` stays for general comms and replying to the General — not for questions or blocking actions.

### Sending Messages

```
send_message({ to: "user", body: "Build complete. All tests pass." })
send_message({ to: "user", body: "Finished adj-013.2, moving to adj-013.3" })
```

### Status Reporting

Report state changes so the dashboard shows your current activity:

```
set_status({ status: "working", task: "Implementing feature X", beadId: "adj-013.2.1" })
set_status({ status: "blocked", task: "Waiting for API key" })
set_status({ status: "done" })
```

### Progress on Long Tasks

```
report_progress({ task: "adj-013.2", percentage: 50, description: "Halfway done" })
```

### Announcements

For events that need dashboard attention:

```
announce({ type: "completion", title: "Feature done", body: "All tests pass.", beadId: "adj-013.2" })
announce({ type: "blocker", title: "Need help", body: "Can't access the API", beadId: "adj-013.2" })
```

## Bead Tracking

Use beads (`bd` CLI) for ALL task tracking. Do NOT use TaskCreate, TaskUpdate, or markdown files.

```bash
bd update <id> --status=in_progress   # Before starting work
bd close <id>                          # After completing work
bd vc commit -m "session end"          # Before shutting down (Dolt backend)
```

## Available MCP Tools

| Tool | Purpose |
|------|---------|
| `file_question` | File a question or blocking action for the General (body, context, urgency, category, suggestedOptions) |
| `send_message` | Send a message (to, body, threadId) — for general comms, not questions |
| `read_messages` | Read messages (threadId, agentId, limit) |
| `set_status` | Update agent status (working/blocked/idle/done) |
| `report_progress` | Report task progress (percentage, description) |
| `announce` | Broadcast announcement (completion/blocker/question) |
| `create_bead` | Create a bead (title, description, type, priority) |
| `update_bead` | Update bead fields (id, status, assignee) |
| `close_bead` | Close a bead (id, reason) |
| `list_beads` | List beads (status, assignee, type) |
| `show_bead` | Get bead details (id) |
| `list_agents` | List all agents (status) |
| `get_project_state` | Project summary |
| `search_messages` | Full-text search (query, limit) |
