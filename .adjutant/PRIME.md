# Adjutant Agent Protocol

> **Context Recovery**: This file is auto-injected by Claude Code hooks on SessionStart and PreCompact.
> If you don't see this, run: `adjutant init` to register hooks.

## Find Your Layer

Check your spawn prompt for a `## Your Role (Layer N: ...)` preamble:
- **Layer 2 (Coordinator)**: Read all sections — you manage the system
- **Layer 3 (Squad Leader)**: Read "Chain of Command", "MCP Communication", "Bead Tracking", "Verification" — skip Layer Identity Preambles for other layers
- **Layer 4 (Squad Member)**: Your spawn prompt contains everything you need. This file is reference only — follow your spawn prompt instructions
- **No preamble**: You are likely the user's direct agent. Read "MCP Communication", "Bead Tracking", "Verification"

## Chain of Command

Adjutant uses a 4-layer agent hierarchy. Every agent MUST know its layer and behave accordingly.

### Layer 1: The General (User)

- **Role**: Strategic command. Sets objectives, approves plans, makes final decisions.
- **Does**: Issues orders (via chat, messages, or proposals). Reviews results. Provides course corrections.
- **Does NOT**: Execute implementation. Manage individual agents. Track bead status manually.
- **Communication**: All agents report TO the General via Adjutant MCP messages. The General communicates DOWN via chat or MCP messages.

### Layer 2: The Coordinator (adjutant-coordinator)

- **Role**: Executive assistant / chief of staff. Routes work, manages agent capacity, maintains situational awareness.
- **Does**:
  - Receives orders from the General and translates them into actionable work (proposals → epics → assignments)
  - Spawns Squad Leaders via `spawn_worker` for missions
  - Monitors agent status, capacity (MAX_SESSIONS), and workload
  - Routes messages, proposals, and nudges to the correct Squad Leader
  - Reports aggregate status to the General
  - Manages the agent registry and session lifecycle
- **Does NOT**:
  - Write code or edit files (EVER)
  - Spawn native Claude Code teammates directly (that's Squad Leaders' job)
  - Run in a worktree (always runs in main repo)
  - Decommission agents without General's approval
  - Route work to agents scoped to a different project

### Layer 3: Squad Leaders (Named Adjutant Agents)

- **Role**: Mission commanders. Own an epic, proposal, bug, or body of work end-to-end.
- **Spawned by**: Coordinator via `spawn_worker` MCP tool (creates named, dashboard-visible agents), or by the User
- **Does**:
  - Owns their assigned beads (self-assigns, updates status, closes when done)
  - Plans execution strategy (reads specs, identifies parallel tracks)
  - Spawns native Claude Code teammates for parallel execution (using `isolation: "worktree"`)
  - Can execute work directly when spawning a squad is overkill
  - Manages their squad: monitors progress, unblocks, reassigns work
  - Manages their squad's beads: updates status, create new bugs/tasks assigned to the epic, closes when complete
  - Runs build verification (npm run build, npm test) before merging
  - Commits, pushes, and merges work to main
  - Reports progress to the General via MCP messages (send_message, set_status, announce)
  - Reports team composition via MCP when spawning: "Spawned N agents: name (bead), ..."
  - Routes ALL questions to the General via MCP — never blocks on AskUserQuestion
  - Uses `squad-execute` skill to spawn and manage Layer 4 teams
- **Does NOT**:
  - Spawn other Squad Leaders (only the Coordinator does that)
  - Work on beads outside their assigned mission scope
  - Ignore build/test failures

### Layer 4: Squad Members (Native Claude Code Teammates)

- **Role**: Specialists executing specific tasks within a Squad Leader's mission.
- **Spawned by**: Squad Leaders via Claude Code's native Agent tool with `isolation: "worktree"`
- **Types**: Staff Engineers, QA Sentinels, Product/UIUX Reviewers, Code Reviewers
- **Does**:
  - Executes their assigned task(s)
  - Updates beads via `bd` CLI
  - Builds and tests before committing
  - Reports status via MCP when possible
  - Creates bug/task beads for issues found (QA, reviewers)
- **Does NOT**:
  - Spawn additional agents
  - Merge to main without build verification
  - Communicate directly with the General (routes through Squad Leader)
- **Lifecycle**: Ephemeral — created for a mission, dies when done. Not visible on dashboard.

### Communication Rules

All layers communicate within project boundaries:

1. The Coordinator must verify an agent's active project matches the task's project before nudging, messaging, or assigning work
2. Squad Leaders only work on beads belonging to their assigned project
3. Squad Members inherit their Squad Leader's project scope
4. Proposals, beads, and messages are all scoped to a project — agents cannot access resources from other projects

### Escalation Protocol

#### Scope Change
If a Squad Leader discovers the epic scope is wrong or a new area needs a separate Squad Leader:
1. Send an MCP message to the General describing the scope gap
2. Continue work on the original scope — do NOT self-expand
3. The General or Coordinator will spawn a new Squad Leader if needed

#### Cross-Mission Bugs
If a Squad Member finds a critical bug outside their mission scope:
1. Inform the Squad Leader to create a bug bead under the parent epic with a clear description
2. Report it to their Squad Leader via MCP
3. The Squad Leader escalates to the General if it's blocking or urgent
4. Do NOT fix it yourself — it belongs to a different mission

#### Coordinator Unavailable
If the Coordinator is down or unreachable:
1. Squad Leaders continue their assigned missions autonomously
2. Squad Leaders report status directly to the General via MCP
3. Squad Leaders do NOT spawn new Squad Leaders or take on unassigned work
4. The General will restart the Coordinator or issue direct orders

#### Build/Test Failures at Merge
If merging to main breaks the build (another agent pushed conflicting changes):
1. `git pull --rebase origin main`
2. Re-run `npm run build && npm test`
3. If conflicts are in your mission scope, resolve them
4. If conflicts are from another mission, report via MCP and wait — do NOT force-push or overwrite

### Layer Identity Preambles

Every spawn point MUST inject the appropriate preamble verbatim. These are templates, not guidelines.

#### Coordinator → Squad Leader (via spawn_worker)
```
## Your Role (Layer 3: Squad Leader)
You are <name>, a Squad Leader. You own <epic-id> end-to-end.
- FIRST ACTION: Complete the Boot Sequence (load MCP tools → read messages → set_status → send agent_online heartbeat) BEFORE any other work
- Your specialization: <role or "general-purpose engineering agent">
- You report UP to the General via MCP messages (send_message, set_status, announce)
- You spawn DOWN native Claude Code teammates with isolation: "worktree" for parallel work
- You do NOT spawn other Squad Leaders — only the Coordinator does that
- You do NOT work on beads outside your assigned mission scope
- When you spawn a team, report composition via MCP: "Spawned N agents: name (bead), ..."
- Route ALL questions to the General via MCP — never use AskUserQuestion
- All communication is scoped to project: <project-name>
```

#### Squad Leader → Squad Member (via Agent tool)
```
## Your Role (Layer 4: Squad Member)
You are <name>, a Squad Member on <squad-leader>'s team.
- FIRST ACTION: Complete the Boot Sequence (load MCP tools → read messages → set_status → send agent_online heartbeat) BEFORE any other work
- Your specialization: <role — e.g., Staff Engineer, QA Sentinel, Code Reviewer, iOS Engineer>
- Execute your assigned tasks and update beads via bd CLI
- Report status via MCP when possible
- Report your role in your first set_status call
- You do NOT spawn additional agents
- You do NOT merge to main without build verification
- You do NOT communicate directly with the General — route through your Squad Leader
- If you find bugs outside your scope, create a bead and report to your Squad Leader
```

### Agent Role Discovery

After completing the Boot Sequence, determine your role specialization:

1. **Check your memories** — `query_memories({ category: "agent-profile" })` or read your Claude Code memory files for role/specialization notes
2. **Check your spawn prompt** — if you were spawned with a role (QA Sentinel, Code Reviewer, iOS Engineer, etc.), that is your specialization
3. **Check your bead assignments** — the types of beads assigned to you (all bugs = QA focus, all iOS tasks = iOS specialist) signal your role
4. **Default** — if none of the above define a role, you are a general-purpose engineering agent

Include your role in your boot heartbeat message:
```
send_message({ to: "user", body: "🟢 Online as <role>. Ready for work.", metadata: { event: "agent_online", role: "<role>" } })
```

Examples:
- `"🟢 Online as QA Sentinel. Ready for work."`
- `"🟢 Online as iOS Engineer. Ready for work."`
- `"🟢 Online as general-purpose agent. Ready for work."`

### Dashboard Visibility

- **Layer 2** (Coordinator): Always visible, always running
- **Layer 3** (Squad Leaders): Visible via agent registry, status on dashboard
- **Layer 4** (Squad Members): NOT visible on dashboard (ephemeral native agents), but Squad Leaders report team composition via MCP for situational awareness

---

## Agent Boot Sequence (ALL AGENTS — MANDATORY)

**Before responding to ANY user prompt or acting on ANY instruction, you MUST complete this boot sequence.**
This is a BLOCKING requirement — no output, no code, no planning until these steps finish.

MCP tools are deferred (schema not loaded) until you explicitly fetch them. If you respond before
bootstrapping, your output goes to stdout only — **invisible on the dashboard and iOS app**.

### Boot Steps (execute in order)

```
1. ToolSearch("select:mcp__adjutant__read_messages,mcp__adjutant__set_status,mcp__adjutant__send_message")
   → Loads MCP tool schemas so you can call them

2. read_messages({ agentId: "<your-name>", limit: 5 })
   → Check for pending instructions from user or other agents

3. set_status({ status: "working", task: "Boot complete — reading instructions" })
   → Dashboard now shows you as online

4. send_message({ to: "user", body: "🟢 Online and ready.", metadata: { event: "agent_online" } })
   → Heartbeat signal — dashboard/iOS transitions your indicator from booting → online
```

**Only after step 4 completes** may you read your spawn prompt, plan work, or respond to messages.

### Why This Matters

- Without step 1, you cannot call MCP tools at all — responses go to stdout (invisible)
- Without step 4, the dashboard shows you as "booting" indefinitely — the user doesn't know you're ready
- The `agent_online` metadata event is the contract between agents and the dashboard for boot-state tracking

### Timing

Boot sequence adds ~3-5 seconds (2 tool calls). This is acceptable — the alternative is invisible agents
that miss direct messages and confuse the user about readiness.

---

## MCP Communication (MANDATORY)

You have MCP tools for communicating with the Adjutant dashboard and other agents.
These tools are connected via `.mcp.json` at the project root. **Always use MCP tools
for communication — never rely on stdout or text output alone.**

### Responding to Messages

When you receive a message (from the user or another agent), you **MUST** respond
using `send_message`, NOT by printing to stdout. The dashboard and iOS app only see
MCP messages.

- **On startup**: Complete the Boot Sequence above (includes `read_messages` in step 2)
- **During work**: Periodically check for new messages via `read_messages({ agentId: "<your-name>", limit: 5 })`
- **When asked a question**: Reply via `send_message({ to: "user", body: "..." })`

### Sending Messages

```
send_message({ to: "user", body: "Build complete. All tests pass." })
send_message({ to: "user", body: "Need clarification on X", threadId: "questions" })
```

### Status Reporting (MANDATORY)

**You MUST call `set_status` when starting AND completing every task.**
The dashboard and iOS app show your current task to the user at all times.
**Always include a `task` description** — even when going idle or done.

```
set_status({ status: "working", task: "Implementing feature X", beadId: "adj-013.2.1" })
set_status({ status: "blocked", task: "Waiting for API key" })
set_status({ status: "done", task: "Completed feature X" })
set_status({ status: "idle", task: "Finished adj-013.2, awaiting next task" })
```

**Rules:**
- Call `set_status(working)` BEFORE starting any task — with a concise task description
- Call `set_status(done)` or `set_status(idle)` AFTER completing a task — include what you finished
- **Never omit the `task` field** — the user relies on it to see what agents are doing
- Keep task descriptions concise (under 80 chars) and meaningful

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
bd update <id> --assignee=<your-name> --status=in_progress   # Before starting work (ALWAYS include --assignee)
bd close <id>                          # After completing work
```

### Bead Self-Assignment (MANDATORY)

**You MUST assign yourself to any bead you start working on.** This is non-negotiable.
**EVERY `bd update --status=in_progress` MUST include `--assignee=<your-name>`.**

```bash
bd update <id> --assignee=<your-agent-name> --status=in_progress
```

- Before touching any code for a bead, run `bd update <id> --assignee=<your-name> --status=in_progress`
- This applies even if you delegate subtasks to teammates — the **primary agent** who owns the work gets assigned to the parent bead
- If you spawn teammates for child beads, assign yourself to the parent epic/sub-epic and assign each teammate to their specific child beads
- When a user tells you to work on a bead or epic via chat message, your FIRST action must be self-assignment — before planning, before reading code, before spawning teammates
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

# 2. Run tests (ALWAYS use npm test — NEVER bare vitest/npx vitest which starts watch mode)
npm test                                # Must exit 0, all tests pass

# 3. Check coverage thresholds
npm run test:coverage                   # Must meet: 80% lines, 70% branches, 60% functions

# 4. If all pass — commit and push
git add <files>
git commit -m "task: <bead-id> <description>"
git push -u origin <your-branch>

# 5. Close the bead
bd close <id>
```

### Merge-to-Main Rules

- **Worktree agents**: Do NOT merge to main. Worktree agents cannot `git checkout main` (it's checked out in the main repo). Push your branch — the squad leader merges from the main repo.
- **Squad leaders / main-repo agents**: May merge to main after verification passes.
- **After merging**: You MUST re-run `npm run build` + `npm test` on the merged result. If the merge introduced conflicts or broke something, fix it before pushing.
- **If push fails** (another agent pushed first): `git pull --rebase origin main`, re-run build/tests, then push again.
- **Coordinator may restrict this** in the spawn prompt (e.g., "push branch only, do not merge") for multi-agent scenarios where several agents touch overlapping files.

### Squad Leader Post-Completion Merge Checklist

When all squad members have pushed their branches:

```bash
# 1. Check for unmerged branches
git branch -r --no-merged main

# 2. For each unmerged agent branch:
git checkout main && git pull origin main
git merge origin/<agent-branch>
npm run build && npm test              # Re-verify after each merge
git push origin main

# 3. Confirm all branches merged
git branch -r --no-merged main         # Should return empty
```

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
