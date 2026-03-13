# Proposal: Agent Hierarchy Doctrine

**Type**: Engineering
**Project**: Adjutant
**Priority**: P1
**Bead**: adj-087
**Status**: Proposed

## Problem

Adjutant currently lacks a codified doctrine for its agent hierarchy. The roles and responsibilities of each layer are scattered across PRIME.md, memory files, skill instructions, and spawn prompts — often inconsistently. New agents don't understand their place in the chain of command. The coordinator sometimes does implementation work. Squad leaders sometimes fail to manage their squads properly. There is no single authoritative document that defines who does what.

## The Doctrine

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
- **Communication**: Reports UP to General. Delegates DOWN to Squad Leaders. Never bypasses the chain.

### Layer 3: Squad Leaders (Named Adjutant Agents)
- **Role**: Mission commanders. Own an epic, proposal, bug, or body of work end-to-end.
- **Spawned by**: Coordinator via `spawn_worker` MCP tool (creates named, dashboard-visible agents)
- **Does**:
  - Owns their assigned beads (self-assigns, updates status, closes when done)
  - Plans execution strategy (reads specs, identifies parallel tracks)
  - Spawns native Claude Code teammates for parallel execution (using `isolation: "worktree"`)
  - Can execute work directly when spawning a squad is overkill
  - Manages their squad: monitors progress, unblocks, reassigns work
  - Runs build verification (npm run build, npm test) before merging
  - Commits, pushes, and merges work to main
  - Cleans up worktrees after squad members finish
  - Reports progress to the General via MCP messages (send_message, set_status, announce)
  - Routes ALL questions to the General via MCP — never blocks on AskUserQuestion
  - Creates bugs/tasks discovered during execution as child beads
- **Does NOT**:
  - Spawn other Squad Leaders (only the Coordinator does that)
  - Work on beads outside their assigned mission scope
  - Ignore build/test failures
- **Communication**: Reports UP to General (and Coordinator sees it). Commands DOWN to their squad.

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

## What Changes

### 1. PRIME.md / .adjutant/PRIME.md
Add a "Chain of Command" section at the top that defines all four layers. This is the first thing any agent reads on session start.

### 2. Coordinator spawn prompt / hooks
Reinforce: "You are Layer 2. You NEVER write code. You spawn Squad Leaders for all missions. You manage capacity and route work."

### 3. Squad Leader spawn prompts (via spawn_worker)
Every `spawn_worker` call must include the doctrine summary: "You are a Squad Leader (Layer 3). You own this mission end-to-end. Spawn native teammates for parallel work. Report to the General via MCP. You are responsible for build verification, merging, and cleanup."

### 4. Squad member spawn prompts (via Agent tool)
Include: "You are a Squad Member (Layer 4). Execute your assigned tasks. Report via bd CLI. Do not spawn additional agents."

### 5. Skills that spawn agents
Update squad-execute, execute-proposal, and epic-planner skills to reference the doctrine layers explicitly.

### 6. Dashboard visibility
- Layer 2 (Coordinator): Always visible, always running
- Layer 3 (Squad Leaders): Visible via agent registry, status on dashboard
- Layer 4 (Squad Members): NOT visible on dashboard (ephemeral native agents)

## Why This Matters

Without a clear hierarchy doctrine:
- The Coordinator tries to do implementation work (violating Layer 2 rules)
- Squad Leaders don't spawn teams when they should (doing everything serially)
- Squad Members try to communicate directly with the user (bypassing the chain)
- New agents don't understand their role and make incorrect assumptions
- Work gets duplicated or dropped because ownership is unclear
- The user has to repeatedly correct agent behavior instead of trusting the system

With the doctrine codified in PRIME.md and enforced in spawn prompts, every agent knows its role from the moment it starts.

## Implementation Scope

This is primarily a documentation and protocol change:
1. Write the doctrine into `.adjutant/PRIME.md` (injected on every session start)
2. Update memory files to reference the doctrine
3. Update skill files (squad-execute, execute-proposal, epic-planner) to include layer context in spawn prompts
4. Update the coordinator's own behavioral rules
5. No code changes required — this is all prompt engineering and documentation
