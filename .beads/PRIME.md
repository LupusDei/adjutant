# Beads Workflow Context

> **Context Recovery**: Run `bd prime` after compaction, clear, or new session
> Hooks auto-call this in Claude Code when .beads/ detected

# 🚨 SESSION CLOSE PROTOCOL 🚨

**CRITICAL**: Before saying "done" or "complete", you MUST run this checklist:

```
[ ] 1. git status              (check what changed)
[ ] 2. git add <files>         (stage code changes)
[ ] 3. bd sync                 (commit beads changes)
[ ] 4. git commit -m "..."     (commit code)
[ ] 5. bd sync                 (commit any new beads changes)
[ ] 6. git push                (push to remote)
```

**NEVER skip this.** Work is not done until commited and sometimes pushed.

## Core Rules
- **Default**: Use beads for ALL task tracking (`bd create`, `bd ready`, `bd close`)
- **Prohibited**: Do NOT use TodoWrite, TaskCreate, or markdown files for task tracking. This applies to ALL agents — leader and teammates alike.
- **Workflow**: Create beads issue BEFORE writing code, mark `in_progress` when starting, `close` when done
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
- `bd update <id> --status=in_progress` - Claim work
- `bd update <id> --assignee=username` - Assign to someone
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
bd update <id> --status=in_progress  # Claim it
```

**Assigning work to a team agent:**
```bash
bd update <id> --assignee=<agent-name>   # Assign before spawning
# Then include the bead ID in the agent's spawn prompt
```

**Completing work:**
```bash
bd close <id1> ...    # Close completed issues at once
bd sync                     # Push to remote
```

**Creating dependent work:**
```bash
# Run bd create commands in parallel (use subagents for many items)
bd create --title="Implement feature X" --description="Why this issue exists and what needs to be done" --type=epic
bd create --title="Write tests for X" --description="Why this issue exists and what needs to be done" --type=task
bd dep add beads-yyy beads-xxx  # Tests depend on Phase 1 (Phase 1 blocks tests)
```


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
- Parents cannot close until all children are closed (enforced by deps)

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
- Close parents only after all children closed
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
- If the work of two or more team members will edit similar files, **use git worktrees**
- If there is ambiguity or uncertainty about the completeness or functioning of a new feature/epic, create a QA team member which focuses on thinking about edge cases and testing - that team member needs to create new beads for the epic that other team members will return to fix before an epic is closed
- Create team members to regularly execute code reviews, from the eyes of a Staff level Engineer, to constantly improve the quality of the code

### Team Agent Beads Protocol (MANDATORY)

**Teammates do NOT receive PRIME.md automatically.** They have no hooks, no session start, and no knowledge of beads unless you tell them. You must inject the workflow into every spawn prompt.

When assigning work to team agents, the **coordinator** must:
1. **Assign beads before spawning** — use `bd update <id> --assignee=<agent-name>` for every bead the agent will own
2. **Include this block verbatim** in every spawn prompt:
   ```
   ## Task Tracking (MANDATORY)
   Use the `bd` CLI for ALL task tracking. Do NOT use TaskCreate or TaskUpdate.

   Your assigned beads: <list their bead IDs here>
   Parent epic: <parent bead ID>

   Before starting each task:  bd update <id> --status=in_progress
   After completing each task:  bd close <id>
   After ALL tasks done:        bd close <parent-id>
   Before shutting down:        bd sync
   ```
3. **Include the working directory** — teammates in worktrees won't have `.beads/`, so tell them the path to the main repo if needed

Each **team agent** must:
1. Run `bd update <id> --status=in_progress` before starting each task
2. Run `bd close <id>` after completing each task
3. Close the parent epic after all children are done
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
