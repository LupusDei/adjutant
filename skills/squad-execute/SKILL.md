---
name: squad-execute
description: Spawn a full squad of worktree-isolated Claude Code agents to execute a spec or epic. Includes staff engineers, QA sentinel, optional Product/UIUX reviewer, and optional code reviewer. The invoking agent stays in coordinator mode. Use when the user says "spin up a team", "squad execute", "execute this epic with a team", "spawn engineers for this", "staff up", "build a team for this", "run this with agents", "deploy a squad", "get engineers on this", "execute with a crew", or wants parallel multi-agent execution of planned work. Also matches "launch team", "start squad", "kick off execution", and any request involving multiple agents working on an epic or spec simultaneously.
---

# Squad Execute

Orchestrate a full squad of Claude Code native agents to execute a spec or epic in parallel. You are the coordinator — you spawn, monitor, and report.

## Usage

```
/squad-execute <epic-id-or-spec-path>
```

**Examples:**
- `/squad-execute adj-072`
- `/squad-execute specs/041-proposal-project-scoping/`

## Pre-Requisites

Before invoking this skill, the work MUST already be planned:
- An epic with sub-epics and tasks exists in beads (`bd show <epic-id>`)
- OR a spec directory exists with `tasks.md` and `beads-import.md`

If neither exists, tell the user to run `/epic-planner` first. Do NOT plan and execute in the same skill invocation.

## Instructions

### Step 1: Assess the Work

1. **Load the epic** — run `bd show <epic-id>` to see the full hierarchy, dependencies, and status
2. **Identify parallel tracks** — group tasks by sub-epic or phase. Tasks within different sub-epics that have no cross-dependencies are parallel tracks
3. **Count ready work** — run `bd ready` to see unblocked tasks
4. **Read the spec** if a spec path was provided — check `tasks.md` for `[P]` markers indicating parallelizable tasks

### Step 2: Determine Squad Composition

Based on the work assessment, determine how many agents to spawn:

#### Staff Engineers (1-8, REQUIRED)

- **1 engineer per parallel track** — never assign two engineers to the same sequential chain
- If 3 sub-epics can run in parallel, spawn 3 engineers
- If 8 independent tasks exist, spawn up to 8 engineers
- If all tasks are sequential, spawn 1 engineer
- **Rule**: number of engineers = number of parallel tracks, capped at 8

#### QA Sentinel (1, REQUIRED)

Always spawn exactly one QA sentinel. They:
- Review code being written by engineers as it merges to main
- Look for bugs, missed edge cases, and spec adherence
- Create bead bugs (`type=bug`) under the epic for anything found
- Run after the first engineer merges, not before

#### Product/UIUX Reviewer (0-1, OPTIONAL)

Spawn when the epic includes:
- Frontend components (React, CSS, UI changes)
- iOS views or SwiftUI changes
- User-facing workflow changes
- Design or usability requirements in the spec

Skip when the work is purely backend, infrastructure, or internal tooling.

#### Code Reviewer (0-1, OPTIONAL — default spawn)

Spawn by default unless:
- The epic has fewer than 3 tasks total
- The work is trivial (config changes, doc updates, simple wiring)

They:
- Review code quality, test coverage, and test reliability
- Focus on fundamentals: naming, structure, error handling, edge cases
- Create bead tasks (`type=task`) for improvements under the epic

### Step 3: Self-Assign as Coordinator

```bash
bd update <epic-id> --assignee=<your-name> --status=in_progress
```

Report to the user:
```
set_status({ status: "working", task: "Coordinating squad for <epic-title>" })
send_message({ to: "user", body: "Squad Execute: <epic-title>\n\nSquad composition:\n- Engineers: N (tracks: <list>)\n- QA Sentinel: 1\n- Product/UIUX: yes/no (reason)\n- Code Reviewer: yes/no (reason)\n\nSpawning now." })
```

### Step 4: Assign Beads Before Spawning

For each agent, assign their beads BEFORE spawning them:

```bash
bd update <bead-id> --assignee=engineer-1 --status=in_progress
bd update <bead-id> --assignee=engineer-2 --status=in_progress
# etc.
```

QA sentinel, product reviewer, and code reviewer don't get pre-assigned beads — they create their own as they find issues.

### Step 5: Spawn Engineers

Spawn each engineer using **Claude Code's native Agent tool** with `isolation: "worktree"` and `run_in_background: true`.

**CRITICAL**: Use the Agent tool (Claude Code native teammates), NOT `spawn_worker` (Adjutant MCP). Adjutant's `spawn_worker` creates tmux-managed sessions that count against the MAX_SESSIONS cap and inherit Adjutant project context. Claude Code native agents are lightweight, isolated, and don't consume session slots.

**Parallel execution**: All engineers that can work in parallel MUST be spawned with `run_in_background: true` so they run concurrently as independent background agents. Do NOT spawn them as foreground sub-agents (which would serialize). You will be notified when each background agent completes — do not poll or sleep waiting for them.

**Spawning pattern**:
```
Agent tool call 1: { name: "engineer-1", isolation: "worktree", run_in_background: true, prompt: "..." }
Agent tool call 2: { name: "engineer-2", isolation: "worktree", run_in_background: true, prompt: "..." }
Agent tool call 3: { name: "engineer-3", isolation: "worktree", run_in_background: true, prompt: "..." }
// Send ALL parallel agents in a SINGLE message with multiple Agent tool calls
```

Launch all parallel-track engineers in the same message so they start simultaneously.

**Every engineer spawn prompt MUST include this block verbatim:**

```
## Task Tracking (MANDATORY)
Use the `bd` CLI for ALL task tracking. Do NOT use TaskCreate or TaskUpdate.

Your name (for --assignee): <agent-name>
Your assigned beads: <list their bead IDs>
Parent epic: <epic-id>

Before starting each task:
  bd update <id> --assignee=<your-name> --status=in_progress
  set_status({ status: "working", task: "<concise description>" })
After completing each task:
  1. npm run build          (must exit 0)
  2. npm test               (must pass)
  3. git add <files> && bd sync && git commit -m "task: <bead-id> <description>" && bd sync
  4. git push -u origin <your-branch>
  5. Merge to main: git checkout main && git pull && git merge <branch> && npm run build && npm test && git push origin main
  6. bd close <id>
  7. set_status({ status: "done", task: "Completed <bead-id>: <what you finished>" })
If push to main fails (race), pull --rebase and retry.
If build/tests fail, fix them before closing the bead.
Before shutting down:
  set_status({ status: "idle", task: "Finished work, shutting down" })
  bd sync

## Question Routing (MANDATORY)
All questions MUST go through Adjutant MCP: send_message({ to: "user", body: "..." })
Do NOT use AskUserQuestion. Do NOT print questions to stdout.
Send the question, state your assumption, and continue without blocking.
```

Additionally include:
- The specific task descriptions from the spec/bead
- File paths they'll be working on
- Any dependencies they must wait for (e.g., "wait until adj-072.1 merges before starting")

### Step 6: Spawn QA Sentinel

Spawn after the first engineer starts merging work. Use Claude Code's native Agent tool with `isolation: "worktree"` and `run_in_background: true`.

**QA Sentinel spawn prompt template:**

```
You are a QA sentinel for epic <epic-id>: <title>.

Your job:
1. Wait for engineers to merge work to main
2. Pull main and review the changes against the spec
3. Run the full test suite and look for gaps
4. Check edge cases the spec mentions but tests don't cover
5. For each bug or gap found, create a bead:
   bd create --id=<epic-id>.N.M.P --title="Bug: <description>" --type=bug --priority=<1-3>
   bd dep add <parent-bead> <new-bug-id>
6. Report findings via: send_message({ to: "user", body: "QA found: <summary>" })

Spec location: <spec-path>
Epic: <epic-id>

<Include the Task Tracking and Question Routing blocks from Step 5>
```

### Step 7: Spawn Optional Reviewers

Spawn all reviewers using Claude Code's native Agent tool with `isolation: "worktree"` and `run_in_background: true`. Launch QA + reviewers in the same message if spawning together.

#### Product/UIUX Reviewer

```
You are a Product/UIUX reviewer for epic <epic-id>: <title>.

Your job:
1. Read the spec at <spec-path>, focusing on user stories and acceptance criteria
2. As engineers merge UI changes, review them for:
   - Does the implementation match the spec's intent?
   - Is the UX intuitive? Are there confusing flows?
   - Does it follow the project's design system/theme?
   - Are accessibility requirements met?
3. For each issue found, create a bead:
   bd create --id=<epic-id>.N.M.P --title="UX: <description>" --type=task --priority=<1-3>
   bd dep add <parent-bead> <new-task-id>
4. Report via: send_message({ to: "user", body: "Product review: <summary>" })

<Include the Task Tracking and Question Routing blocks from Step 5>
```

#### Code Reviewer

```
You are a staff-level code reviewer for epic <epic-id>: <title>.

Your job:
1. As engineers merge to main, review the code with a staff engineer's eye
2. Check for:
   - Code quality: naming, structure, readability, DRY
   - Test coverage: are critical paths tested? Are edge cases covered?
   - Test reliability: are tests deterministic? Do they test behavior, not implementation?
   - Error handling: are failure modes handled gracefully?
   - Security: any injection risks, data leaks, or auth bypasses?
3. For each improvement needed, create a bead:
   bd create --id=<epic-id>.N.M.P --title="Review: <description>" --type=task --priority=<2-3>
   bd dep add <parent-bead> <new-task-id>
4. Report via: send_message({ to: "user", body: "Code review: <summary>" })

<Include the Task Tracking and Question Routing blocks from Step 5>
```

### Step 8: Monitor and Report

While the squad works, the coordinator (you) must:

1. **Check progress regularly** — every 2-3 minutes, check `bd list --status=in_progress` and agent statuses via `list_agents()`
2. **Report milestones** — when a sub-epic completes, a phase finishes, or a reviewer finds issues:
   ```
   send_message({ to: "user", body: "Squad update: <what happened>" })
   report_progress({ task: "<epic-id>", percentage: N, description: "<status>" })
   ```
3. **Unblock agents** — if an agent reports a blocker, investigate and help resolve it
4. **Close sub-epics** — when all tasks under a sub-epic are closed, close the sub-epic:
   ```bash
   bd close <sub-epic-id>
   ```
5. **Do NOT do implementation work yourself** — your job is coordination only

### Step 9: Handle Reviewer Findings

When QA, Product, or Code Review agents create bug/task beads:

1. The reviewer creates the bead under the epic with proper parent wiring
2. You (coordinator) decide: assign to an existing engineer who is finishing up, or note it for a follow-up pass
3. If engineers are still active, assign the fix:
   ```bash
   bd update <bug-id> --assignee=<engineer-name>
   ```
   Then notify the engineer via `send_message({ to: "<engineer-name>", body: "New fix assigned: <bug-id> — <description>" })`
4. If all engineers are done, the bugs remain open for a follow-up squad or manual fix

### Step 10: Wrap Up

When all engineer tasks are closed and reviewer findings are either fixed or documented:

1. Close the root epic if all children are done:
   ```bash
   bd close <epic-id> --reason="All phases complete"
   ```
2. If reviewer bugs remain open, leave the epic open and report:
   ```
   send_message({ to: "user", body: "Squad complete for <epic-title>.\n\nResults:\n- Tasks closed: N/M\n- QA bugs found: X (Y fixed, Z remaining)\n- Code review items: X (Y fixed, Z remaining)\n- Product issues: X (Y fixed, Z remaining)\n\nRemaining items need follow-up." })
   ```
3. Final announcement:
   ```
   announce({ type: "completion", title: "Squad complete: <title>", body: "<summary>", beadId: "<epic-id>" })
   set_status({ status: "done", task: "Squad complete: <epic-title>" })
   ```
4. Clean up worktrees — verify all agent branches are merged, then remove stale worktrees

## Key Rules

- **Use Claude Code native Agent tool** for ALL spawning — NEVER use `spawn_worker` (Adjutant MCP)
- **ALWAYS use `isolation: "worktree"`** for every agent that edits files — no exceptions
- **NEVER do implementation work as coordinator** — delegate everything
- **Assign beads BEFORE spawning** — agents must know their work upfront
- **All communication via Adjutant MCP** — not stdout, not AskUserQuestion
- **QA sentinel is mandatory** — never skip it, even for small epics
- **Reviewers create their own beads** — they wire them under the epic hierarchy
- **Engineers must build + test before merging** — the spawn prompt enforces this
- **Report to user at every milestone** — silence is not acceptable

## Spawn Sequencing

For epics with dependencies between phases:

1. Spawn Phase 1 engineers immediately
2. Spawn QA sentinel after first Phase 1 merge
3. Spawn Phase 2+ engineers only after their dependencies merge to main
4. Spawn product/code reviewers after the first substantial merge

This prevents stale-branch conflicts (adj-yzvk: agents branching before dependencies land).

## Squad Size Guidelines

| Epic Size | Engineers | QA | Product | Code Review |
|-----------|-----------|-----|---------|-------------|
| Small (1-3 tasks) | 1 | 1 | No | No |
| Medium (4-8 tasks, 2-3 tracks) | 2-3 | 1 | If UI | Yes |
| Large (9-15 tasks, 3-5 tracks) | 3-5 | 1 | If UI | Yes |
| XL (16+ tasks, 5+ tracks) | 5-8 | 1 | If UI | Yes |
