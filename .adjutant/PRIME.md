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
- **When asked a question**: Reply via `send_message({ to: "user", body: "..." })`

### Sending Messages

```
send_message({ to: "user", body: "Build complete. All tests pass." })
send_message({ to: "user", body: "Need clarification on X", threadId: "questions" })
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

Use the `bd` CLI for ALL bead/task operations. Do NOT use TaskCreate, TaskUpdate, or markdown files.

```bash
bd update <id> --status=in_progress   # Before starting work
bd close <id>                          # After completing work
bd sync                                # Before shutting down
```

**WARNING — MCP bead tools vs `bd` CLI:**
- MCP bead tools (`create_bead`, `update_bead`, `close_bead`, `list_beads`, `show_bead`) always operate on the adjutant backend's database — they have NO project routing.
- If you are working in a different project/repo that has its own `.beads/` database, MCP bead tools will hit the WRONG database.
- **Always use `bd` CLI** for bead operations. It runs in your working directory and finds the correct `.beads/` automatically.
- Use MCP tools ONLY for communication: `send_message`, `read_messages`, `set_status`, `report_progress`, `announce`.

## Bead Completion Verification (MANDATORY)

When you finish work on a bead, you MUST verify the build before committing.
Do NOT close a bead or push code that doesn't pass these checks.

### Verification Checklist

```bash
# 1. Lint & build (from project root)
npm run build                           # Must exit 0 with no errors

# 2. Run tests
npm test                                # Must exit 0, all tests pass

# 3. If both pass — commit and push your BRANCH
git add <files>
bd sync
git commit -m "task: <bead-id> <description>"
bd sync
git push -u origin <your-branch>

# 4. Close the bead
bd close <id>
bd sync
```

### Rules

- **Do NOT merge to main.** Push your branch only. The coordinator decides when to merge.
- If lint/build fails → fix the errors, re-run, do NOT skip or `--no-verify`.
- If tests fail → fix the failing tests or the code, do NOT close the bead.
- Report verification results via MCP: `announce({ type: "completion", title: "...", body: "Build + tests pass", beadId: "..." })`
- If blocked (can't fix a failure), report via MCP: `announce({ type: "blocker", title: "...", body: "Build fails: <error>", beadId: "..." })`

## Available MCP Tools

### Communication (use freely)

| Tool | Purpose |
|------|---------|
| `send_message` | Send a message (to, body, threadId) |
| `read_messages` | Read messages (threadId, agentId, limit) |
| `set_status` | Update agent status (working/blocked/idle/done) |
| `report_progress` | Report task progress (percentage, description) |
| `announce` | Broadcast announcement (completion/blocker/question) |
| `list_agents` | List all agents (status) |
| `get_project_state` | Project summary |
| `search_messages` | Full-text search (query, limit) |

### Bead tools (use `bd` CLI instead — see warning above)

| Tool | Purpose |
|------|---------|
| `create_bead` | Create a bead (title, description, type, priority) |
| `update_bead` | Update bead fields (id, status, assignee) |
| `close_bead` | Close a bead (id, reason) |
| `list_beads` | List beads (status, assignee, type) |
| `show_bead` | Get bead details (id) |
