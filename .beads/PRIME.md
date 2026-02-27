# Beads Workflow Context

> **Context Recovery**: Run `bd prime` after compaction, clear, or new session
> Hooks auto-call this in Claude Code when .beads/ detected

# 🚨 SESSION CLOSE PROTOCOL 🚨

**CRITICAL**: Before saying "done" or "complete", you MUST run this checklist:

```
[ ] 1. npm run build           (lint & type-check — must exit 0)
[ ] 2. npm test                (all tests must pass)
[ ] 3. git status              (check what changed)
[ ] 4. git add <files>         (stage code changes)
[ ] 5. bd sync                 (commit beads changes)
[ ] 6. git commit -m "..."     (commit code)
[ ] 7. bd sync                 (commit any new beads changes)
[ ] 8. git push                (push to remote)
```

**NEVER skip this.** Work is not done until it builds, tests pass, and is committed.
If build or tests fail, fix the issues BEFORE committing — do NOT push broken code.

## Core Rules
- **Default**: Use beads for ALL task tracking (`bd create`, `bd ready`, `bd close`)
- **Prohibited**: Do NOT use TodoWrite, TaskCreate, or markdown files for task tracking. This applies to ALL agents — leader and teammates alike.
- **Workflow**: Create beads issue BEFORE writing code, mark `in_progress` when starting, `close` when done
- **Self-Assignment (MANDATORY)**: When you move ANY bead to `in_progress`, you MUST also set `--assignee=<your-name>` in the same command. Unassigned in-progress beads are a bug. Every `bd update <id> --status=in_progress` MUST include `--assignee=<your-name>`.
- **Real-time updates**: Update bead status as you work, not in bulk at the end. Each task transitions: `open` → `in_progress` → `closed`
- **Hierarchy first**: After creating beads, wire parent-child deps immediately (see "Hierarchy Wiring" section)
- Persistence you don't need is more important than lost context
- Git workflow: hooks auto-sync, run `bd sync` at session end
- Session management: check `bd ready` for available work

## Essential Commands

### Finding Work
- `bd ready` - Show issues ready to work (no blockers)
- `bd list --status=open` - All open issues
- `bd list --status=in_progress` - Your active work
- `bd show <id>` - Detailed issue view with dependencies

### Creating & Updating
- `bd create --title="Summary of this issue" --description="Why this issue exists and what needs to be done" --type=task|bug|epic --priority=2` - New issue
  - Priority: 0-4 or P0-P4 (0=critical, 2=medium, 4=backlog). NOT "high"/"medium"/"low"
- `bd update <id> --assignee=<your-name> --status=in_progress` - Claim work (ALWAYS include --assignee)
- `bd update <id> --assignee=username` - Assign to someone else
- `bd update <id> --title/--description/--notes/--design` - Update fields inline
- `bd close <id>` - Mark complete
- `bd close <id1> <id2> ...` - Close multiple issues at once (more efficient)
- `bd close <id> --reason="explanation"` - Close with reason
- **Tip**: When creating multiple issues/tasks/epics, use parallel subagents for efficiency
- **WARNING**: Do NOT use `bd edit` - it opens $EDITOR (vim/nano) which blocks agents

### Dependencies & Blocking
- `bd dep add <issue> <depends-on>` - Add dependency (issue depends on depends-on)
- `bd blocked` - Show all blocked issues
- `bd show <id>` - See what's blocking/blocked by this issue

### Sync & Collaboration
- `bd sync` - Sync with git remote (run at session end)
- `bd sync --status` - Check sync status without syncing

### Project Health
- `bd stats` - Project statistics (open/closed/blocked counts)
- `bd doctor` - Check for issues (sync problems, missing hooks)

## Common Workflows

**Starting work (solo):**
```bash
bd show <id>       # Review issue details
bd update <id> --assignee=<your-name> --status=in_progress  # Claim it (ALWAYS include --assignee)
set_status({ status: "working", task: "<concise description>" })  # Report to dashboard
```

**Assigning work to a team agent:**
```bash
bd update <id> --assignee=<agent-name>   # Assign before spawning
# Then include the bead ID in the agent's spawn prompt
```

**Completing work:**
```bash
bd close <id1> ...    # Close completed issues at once
set_status({ status: "done", task: "Completed <id>: <what you finished>" })  # Report to dashboard
bd sync                     # Push to remote
```

**Creating dependent work:**
```bash
# Run bd create commands in parallel (use subagents for many items)
bd create --title="Implement feature X" --description="Why this issue exists and what needs to be done" --type=epic
bd create --title="Write tests for X" --description="Why this issue exists and what needs to be done" --type=task
bd dep add beads-yyy beads-xxx  # Tests depend on Phase 1 (Phase 1 blocks tests)
```


**When a user tells you to work on a bead (via chat, message, or prompt):**

When you receive a message referencing a bead ID (e.g., "work on adj-042", "fix adj-017.2", "execute this epic"),
you MUST immediately self-assign before doing any work:

```bash
bd show <id>                                                    # Read the bead details
bd update <id> --assignee=<your-name> --status=in_progress     # Self-assign + claim
```

If the bead is an epic with children, assign yourself to the **parent epic** and all child beads you will personally work on.
If you spawn a team to handle children, still assign yourself to the parent — you are the coordinator and owner.

**All work uses BEADS library with strictly hierarchical beads.**

## Hierarchy Wiring (MANDATORY)

After creating any set of hierarchical beads, you MUST wire dependencies **immediately** — not later, not as an afterthought.

```bash
# Example: after creating bd-001 (epic) with sub-epics .1, .2, .3
bd dep add bd-001 bd-001.1    # root depends on sub-epic 1
bd dep add bd-001 bd-001.2    # root depends on sub-epic 2
bd dep add bd-001 bd-001.3    # root depends on sub-epic 3

# After creating tasks under sub-epic bd-001.1
bd dep add bd-001.1 bd-001.1.1   # sub-epic depends on task 1
bd dep add bd-001.1 bd-001.1.2   # sub-epic depends on task 2
```

**Rules:**
- Every child bead must be linked to its parent via `bd dep add <parent> <child>`
- Do this in the same step as `bd create`, not after
- `bd show <parent>` must display all children — verify this
- Parent epics auto-close when all children are closed (enforced by deps), but you MAY also close them manually with `bd close <id>` when appropriate

## Identifier Format
- Root epic: `bd-xxx` where `bd` represents the beads prefix for the project
  → `xxx` = **sequential numeric** (e.g. `bd-001`, `bd-002`, `bd-003`)  
- Sub-levels: append `.n` (sequential integers starting at 1)  
  Examples: `bd-001.1`, `bd-042.1.3`, `bd-138.2.4.1`

Levels:
1. **Epic**     `bd-xxx`       type=epic     Major feature/refactor/theme
2. **Sub-Epic** `bd-xxx.n`     type=epic     Phases/parallel paths (skip if small)
3. **Task**     `bd-xxx.n.m`   type=task     Deliverable work unit (use `bd-xxx.m` if no sub-epics)
4. **Improvement** `bd-xxx.n.m.p` type=task|bug  
   Only for: bug fix / refactor / extra tests  
   If broader → scope under sub-epic/epic: `bd-xxx.n.p`

**Rules**
- Sequential root IDs
- Create before implementation
- Reference IDs in commits/PRs/logs/comments
- Improvements = quality artifacts only
- Max depth ≈4
- **Epics**: Epics auto-complete when all children are closed (via `bd epic close-eligible`). You may also close epics manually with `bd close <id>` when all work is done.
- Always link dependencies when order matters

## Planning & Execution
1. Create root epic (`bd create … --type=epic`)
2. Break into sub-epics (`.1`, `.2`, …)
3. Break into tasks (`.1`, `.2`, …)
4. During/after → spawn `.p` improvements under affected task (or sub-epic)

**Commit example**: `fix: bd-032.1.2.1 token expiry race ` , `task: bd-002.1.3 new login form with all field checks`

Keep hierarchy clean, shallow, and sequentially-rooted.

# Workflow Orchestration

## 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, **STOP** and re-plan immediately – don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

## 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- **One task** per subagent for focused execution
- Skip self-subagents when unnecessary

## 3. Team Strategy
- Use team members regularly for complex tasks
- Whenever there is a sequence of serial tasks, spin up a team member to tackle them one by one
- If there is ambiguity or uncertainty about the completeness or functioning of a new feature/epic, create a QA team member which focuses on thinking about edge cases and testing - that team member needs to create new beads for the epic that other team members will return to fix before an epic is closed
- Create team members to regularly execute code reviews, from the eyes of a Staff level Engineer, to constantly improve the quality of the code

### Coordinator Self-Assignment (MANDATORY)

When you are the coordinator agent that the user asked to execute on a bead or epic:

1. **You are the owner.** Assign yourself to the parent epic/bead BEFORE spawning any teammates:
   ```bash
   bd update <parent-id> --assignee=<your-name> --status=in_progress
   ```
2. **All child beads default to you.** If you spawn teammates for child tasks, assign them to those specific children. But every bead that doesn't have a dedicated teammate is YOUR responsibility — assign yourself.
3. **No orphaned beads.** Before spawning a team, run `bd update <id> --assignee=<your-name>` on EVERY bead you are about to move to `in_progress`. Then reassign specific children to teammates as you spawn them.
4. **The dashboard tracks ownership.** Without assignee data, the user cannot see who is working on what. This is the #1 source of confusion.

### Worktree Isolation (MANDATORY)

**ALWAYS spawn teammates with `isolation: "worktree"`.** This is non-negotiable.

Multiple agents sharing the same working directory will silently overwrite each other's file edits. Claude Code caches file contents between tool calls — when agent A writes a file and agent B (with the old version cached) writes the same file, A's changes are permanently lost with no warning. Even agents working on "different" features often touch shared files (`types/index.ts`, `api.ts`, `App.tsx`, etc.).

- **Default to worktree** for every teammate spawn, no exceptions
- Do NOT spawn teammates without `isolation: "worktree"` unless they are read-only (Explore, Plan agents that will never edit files)
- If a teammate needs access to `.beads/`, include the main repo path in the spawn prompt so they can run `bd --dir /path/to/main`
- Ref: adj-osic — 7 concurrent agents sharing one directory caused 85+ silent file overwrites in a single session

### Team Agent Beads Protocol (MANDATORY)

**Teammates do NOT receive PRIME.md automatically.** They have no hooks, no session start, and no knowledge of beads unless you tell them. You must inject the workflow into every spawn prompt.

When assigning work to team agents, the **coordinator** must:
1. **Assign beads before spawning** — use `bd update <id> --assignee=<agent-name>` for every bead the agent will own
2. **Use `isolation: "worktree"`** on the Task tool for every teammate that will edit files (see "Worktree Isolation" above)
3. **Include this block verbatim** in every spawn prompt:
   ```
   ## Task Tracking (MANDATORY)
   Use the `bd` CLI for ALL task tracking. Do NOT use TaskCreate or TaskUpdate.

   Your name (for --assignee): <agent-name>
   Your assigned beads: <list their bead IDs here>
   Parent epic: <parent bead ID>

   Before starting each task:
     bd update <id> --assignee=<your-name> --status=in_progress
     set_status({ status: "working", task: "<concise description of what you're doing>" })
   After completing each task:
     1. npm run build          (must exit 0)
     2. npm test               (must pass)
     3. git add <files> && bd sync && git commit -m "task: <bead-id> <description>" && bd sync
     4. git push -u origin <your-branch>
     5. Merge to main: git checkout main && git pull && git merge <branch> && npm run build && npm test && git push origin main
     6. bd close <id>
     7. set_status({ status: "done", task: "Completed <bead-id>: <what you finished>" })
   If push to main fails (race), pull --rebase and retry.
   You may close parent epics manually when all children are done, or let them auto-close.
   If build/tests fail, fix them before closing the bead.
   Before shutting down:
     set_status({ status: "idle", task: "Finished work, shutting down" })
     bd sync
   ```
4. **Include the working directory** — teammates in worktrees won't have `.beads/`, so tell them the path to the main repo if needed

Each **team agent** must:
1. Run `bd update <id> --status=in_progress` before starting each task
2. Run `bd close <id>` after completing each task
3. You may close parent epics manually when all children are done, or let them auto-close
4. Run `bd sync` before shutting down

If an agent is not updating beads, that is a bug in the spawn prompt, not the agent's fault.

### Panic Prevention
When agents hit blockers (permissions, errors, failures):
1. **Assess** — check what work was already done (diffs, grep, status)
2. **Resolve** — fix the blocker or ask the user, don't work around it
3. **Only then respawn** — if the agent is confirmed dead and you know exactly what remains
Never spawn duplicate agents on the same worktree/branch to "try again."

## 4. After Self-Improvement Loop
After user correction:
- Update `memory` with the pattern of what went wrong
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at the start of every session

## 5. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between old and new when relevant
- Ask yourself: **"Would a staff engineer approve this?"**
- Run tests, check logs, demonstrate correctness

## 6. Demand Elegance (Balanced)
For non-trivial changes, pause and ask:
- "Is there a more elegant way?"
- If a fix feels hacky: "Knowing what I know now, would I implement the elegant solution instead?"
- Skip over-engineering simple fixes
- Challenge your own work before presenting it

## 7. Autonomous Bug Fixing
- When given a bug report, error, failing test – **just fix it**
- Don't immediately ask for hand-holding
- Point at logs, errors, failing tests → then resolve them
- Zero context / failing CI tests required from the user

## Task Management
**If you are a team lead or talking directly to the overseer of human**
1. **Plan First**: Write plan with a explanatory name to `docs/<name>.md` with checkable items  
2. **Verify Plan**: Check in before starting implementation  
3. **Explain Progress**: High-level summary at each major step  
4. **Create bead epics and issues to represent the work, and match those up to the planning doc**
4. **Track Progress**: Mark items as in_progress when started and closed when completed
5. **Document Results**: Add review section to `docs/<name>.md`  
6. **Capture Lessons**: Update `memory` after corrections  

**Skip this for simple tasks or when the beads have already been created**

## Core Principles

- **Simplicity First**: Make every change as small as possible. Minimal code impact.
- **Senior Laziness**: Find root causes. No temporary / band-aid fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing new bugs.
- **Always Track Work**: Before starting a task, mark it as `in_progress`.  When complete, mark it as `closed`
