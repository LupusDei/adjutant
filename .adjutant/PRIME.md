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

### Bead Self-Assignment (MANDATORY)

**You MUST assign yourself to any bead you start working on.** This is non-negotiable.

```bash
bd update <id> --assignee=<your-agent-name> --status=in_progress
```

- Before touching any code for a bead, run `bd update <id> --assignee=<your-name>`
- This applies even if you delegate subtasks to teammates — the **primary agent** who owns the work gets assigned to the parent bead
- If you spawn teammates for child beads, assign yourself to the parent epic/sub-epic and assign each teammate to their specific child beads
- Unassigned in-progress beads are a bug. Every `in_progress` bead must have an assignee.
- The dashboard and other agents rely on assignee data for workload visibility. Without it, beads appear orphaned.

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

# 3. If both pass — commit and push
git add <files>
bd sync
git commit -m "task: <bead-id> <description>"
bd sync
git push -u origin <your-branch>

# 4. Merge to main (if permitted — see rules below)
git checkout main && git pull origin main
git merge <your-branch>
npm run build && npm test              # Re-verify after merge
git push origin main

# 5. Close the bead
bd close <id>
bd sync
```

### Merge-to-Main Rules

- **Default**: Agents may merge to main after verification passes.
- **After merging**: You MUST re-run `npm run build` + `npm test` on the merged result. If the merge introduced conflicts or broke something, fix it before pushing.
- **If push fails** (another agent pushed first): `git pull --rebase origin main`, re-run build/tests, then push again.
- **Coordinator may restrict this** in the spawn prompt (e.g., "push branch only, do not merge") for multi-agent scenarios where several agents touch overlapping files.

### General Rules

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
