# The Full Adjutant: From Dashboard to Autonomous Coordinator

> **Status**: IN PROGRESS
> **Predecessors**: spec-phase1.md (adj-051), spec-051.5.md (adj-051.5)
> **Date**: 2026-03-08

---

## The Military Adjutant

> *"The adjutant controls the battle whilst the CO commands it."*
> — British Army doctrine

In military organizations, the **adjutant** is the commanding officer's chief administrative officer and right hand. The word derives from the Latin *adiutare* — "to assist." The adjutant is not a subordinate who waits for orders. The adjutant is the officer who ensures the commander's intent becomes reality across the entire unit.

### Historical Responsibilities

| Military Duty | Description |
|---------------|-------------|
| **Personnel Management** | Track every soldier's status, postings, leave, welfare. Know who is where and doing what at all times. |
| **Correspondence & Orders** | Route all communications. Publish official orders. Prepare responses. Nothing reaches the CO that hasn't been filtered and prioritized. |
| **Discipline & Conduct** | Monitor unit conduct. Inspect guards. Handle disciplinary matters. Report irregularities daily. |
| **Operational Readiness** | Ensure administrative readiness during deployments. The unit is always ready to fight because the adjutant handled the logistics. |
| **Battle Control** | During operations, the adjutant *controls* the battle — tracking units, managing communications, coordinating movements — while the CO *commands* it. |
| **Link Between CO and Unit** | The adjutant is the conduit between the commander and every member of the unit. No one is forgotten. No one falls through the cracks. |

The adjutant holds special rank: in the British Army, adjutants are senior by appointment to all other captains, ranking just behind the majors. This reflects the reality that the adjutant's informal authority over administration and discipline gives them outsized influence within the unit.

### The Software Analogy

Our Adjutant system maps directly to this military role:

| Military Role | Software Equivalent |
|---------------|-------------------|
| Commanding Officer | The **user** — sets intent, makes strategic decisions |
| Adjutant | The **Adjutant system** — executes intent autonomously |
| Soldiers in the unit | **AI agents** working on beads |
| Personnel records | **Agent profiles** in SQLite state store |
| Official orders | **Bead assignments** and agent spawn commands |
| Correspondence routing | **Message delivery** with priority tiers |
| Discipline enforcement | **Stale agent nudging** and health monitoring |
| Battle control | **Real-time event dispatch** — tracking everything, reacting instantly |
| Daily reports | **Hourly status summaries** to the user |
| Operational readiness | **Health monitoring** — dead agents respawned, work always progressing |

---

## Current State (What We Have)

Phase 1 and the adj-051.5 restructure delivered the event-driven foundation:

### Core Framework (Complete)
- **EventBus** — 12 domain event types, pub/sub backbone
- **AdjutantCore** — wildcard subscription, behavior dispatch, interval scheduling
- **BehaviorRegistry** — pluggable behavior modules with register/unregister/lookup
- **AdjutantState** — SQLite persistence for agent profiles, decisions, metadata
- **CommunicationManager** — routine/important/escalate message tiers

### Behaviors (4 of ~12 needed)
- **Agent Lifecycle** — tracks connect/disconnect/status changes in persistent state
- **Health Monitor** — checks Adjutant agent health every 5 minutes, auto-respawns
- **Periodic Summary** — hourly heartbeat prompt injection + status report to user
- **Stale Agent Nudger** — nudges agents silent for 1+ hours, debounced

### Supporting Infrastructure
- **Adjutant Spawner** — auto-spawns coordinator agent on backend startup
- **Agent Instructions** — `.claude/agents/adjutant.md` with startup sequence and standing orders
- **Database Schema** — migration 009 with agent profiles, decisions, metadata tables
- **102+ unit tests** across 8 test files

### What the Adjutant Can Do Today
1. Spawn itself automatically when the backend starts
2. Recover from crashes within 5 minutes
3. Track every agent's connection status and current task
4. Deliver hourly status reports to the user
5. Nudge stale agents that haven't reported in 1+ hours
6. Queue routine messages and batch them into the next summary
7. Send important messages immediately and escalate with push notifications
8. Log every decision for forensic debugging

### What the Adjutant Cannot Do Yet
1. **Assign work** — cannot match idle agents to ready beads
2. **Spawn agents** — cannot spin up new workers when the backlog grows
3. **Monitor builds** — cannot react to test failures or build errors
4. **Manage epics** — cannot plan, decompose, or close out epics
5. **Prioritize** — cannot reorder work based on dependencies or urgency
6. **Learn** — cannot adapt behavior based on historical patterns
7. **Report proactively** — only reports hourly, not on significant events
8. **Control the battle** — reacts to events but doesn't orchestrate agent coordination

---

## The Full Vision: Phases 2–5

Each phase adds new behavior files. **Zero changes to the core framework** — the extensibility proof from adj-051.5 holds.

### Phase 2: Work Assignment (The Adjutant Assigns Duties)

> *Military parallel: The adjutant manages postings and assignments — ensuring every soldier has orders and no position goes unfilled.*

**New Behaviors:**

#### `behaviors/work-assigner.ts`
- **Triggers**: `bead:created`, `agent:status_changed`, `bead:closed`
- **Schedule**: `*/5 * * * *` (fallback sweep every 5 minutes)
- **Logic**:
  1. On `bead:created` or `bead:closed`: check if any idle agents exist
  2. On `agent:status_changed` to idle: check if any ready beads exist
  3. Match: find the best idle agent for the highest-priority ready bead
  4. Assign: `bd update <id> --assignee=<agent> --status=in_progress`
  5. Notify: message the agent with bead details and instructions
  6. Log: decision with matching rationale

- **Matching Algorithm** (rules-based, no LLM):
  - Priority: P0 beads first, then P1, etc.
  - Affinity: prefer agents that previously worked on the same epic
  - Recency: prefer agents that became idle most recently (still warm)
  - Exclusion: don't assign to agents that are blocked or disconnected

- **Guard Conditions** (`shouldAct`):
  - At least one idle agent exists in agent profiles
  - At least one open, unblocked, unassigned bead exists
  - No assignment was made in the last 30 seconds (debounce)

#### `behaviors/work-rebalancer.ts`
- **Triggers**: `agent:status_changed` (to blocked/disconnected)
- **Logic**:
  1. When an agent goes blocked or disconnects, check their in-progress beads
  2. If beads are orphaned (assigned to dead agent), unassign them
  3. Queue routine message: "Agent X disconnected, beads Y and Z returned to open pool"
  4. Work-assigner will pick them up on next cycle

**State Store Changes:**
- Add `assignment_count` to agent profiles (for load balancing)
- Add `last_assigned_at` to metadata (for debounce)

**EventBus Additions:**
- `bead:assigned` — emitted when work-assigner assigns a bead (new event type)

**Estimated Beads**: 4-5 tasks

---

### Phase 3: Agent Spawning (The Adjutant Calls Up Reserves)

> *Military parallel: The adjutant manages unit strength — requesting reinforcements when the unit is undermanned, and standing down excess troops when the mission is complete.*

**New Behaviors:**

#### `behaviors/agent-spawner.ts`
- **Triggers**: `bead:created`, `bead:assigned` (from Phase 2)
- **Schedule**: `*/10 * * * *` (capacity check every 10 minutes)
- **Logic**:
  1. Count: ready beads (open + unblocked + unassigned)
  2. Count: active agents (connected, not idle/done)
  3. If ready beads > 0 AND no idle agents AND active < MAX_AGENTS:
     - Spawn a new agent via `getSessionBridge().lifecycle.createSession()`
     - Use worktree isolation (mandatory per project rules)
     - Include bead assignment in spawn prompt
  4. If no ready beads AND idle agents > IDLE_THRESHOLD:
     - Send shutdown suggestion to excess idle agents

- **Configuration** (via AdjutantState metadata):
  - `max_concurrent_agents` — hard cap (default: 5)
  - `idle_threshold` — how many idle agents before suggesting shutdowns (default: 2)
  - `spawn_cooldown_ms` — minimum time between spawns (default: 60,000ms)

- **Guard Conditions**:
  - Not at agent cap
  - Cooldown elapsed since last spawn
  - At least one ready bead that no existing agent can handle

#### `behaviors/agent-decommissioner.ts`
- **Triggers**: `agent:status_changed` (to done/idle)
- **Schedule**: `*/30 * * * *` (cleanup sweep)
- **Logic**:
  1. Find agents that have been idle for 30+ minutes with no pending work
  2. Send graceful shutdown request
  3. If agent doesn't respond within 5 minutes, escalate to user
  4. Update agent profile to `decommissioned`

**Spawner Service Changes:**
- Generalize `adjutant-spawner.ts` into `agent-spawner-service.ts`
- Support arbitrary agent names, project paths, and agent files
- Keep Adjutant-specific spawn as a special case

**Estimated Beads**: 5-6 tasks

---

### Phase 4: Build & Quality Monitor (The Adjutant Inspects the Troops)

> *Military parallel: The adjutant inspects guards, monitors conduct, and reports irregularities daily. Every failure is documented and addressed — the unit's readiness is the adjutant's responsibility.*

**New Behaviors:**

#### `behaviors/build-monitor.ts`
- **Triggers**: `stream:status` (build/test completion events)
- **Logic**:
  1. On stream completion with exit code != 0: build/test failure detected
  2. Parse error output to identify the failure type (TypeScript, test, lint)
  3. Create a bug bead: `bd create --type=bug --title="Build failure: <summary>"`
  4. If an idle agent exists, assign immediately
  5. If no idle agent, escalate to user: "Build failed, no agents available to fix"
  6. Log decision with failure details

- **Guard Conditions**:
  - Only react to streams from known agent sessions
  - Ignore streams already associated with a bug-fix bead (avoid loops)
  - Rate limit: max 1 bug bead per agent per 10 minutes

#### `behaviors/quality-gate.ts`
- **Triggers**: `bead:closed`
- **Logic**:
  1. On bead closure, verify the associated branch/commit:
     - Did `npm run build` pass?
     - Did `npm test` pass?
     - Is the branch merged to main?
  2. If any check fails, reopen the bead with a comment explaining what failed
  3. Queue routine message: "Bead X closed without passing quality gate — reopened"

- **Guard Conditions**:
  - Only verify beads of type `task` or `bug` (not epics)
  - Skip if bead was closed with `--reason` containing "by-design" or "deferred"

#### `behaviors/merge-coordinator.ts`
- **Triggers**: `bead:closed` (when multiple agents have branches ready)
- **Logic**:
  1. Track which branches are ready to merge (bead closed, tests pass)
  2. Serialize merges to main to avoid conflicts
  3. If merge conflict detected, create a resolution bead and assign to the original agent
  4. After successful merge, verify main still builds

**EventBus Additions:**
- `build:failed` — emitted by build-monitor when failure detected
- `build:passed` — emitted after successful verification
- `merge:completed` — emitted after successful merge to main
- `merge:conflict` — emitted when merge conflict detected

**Estimated Beads**: 6-8 tasks

---

### Phase 5: Epic Management (The Adjutant Plans the Campaign)

> *Military parallel: The adjutant doesn't just manage day-to-day operations — they plan campaigns, coordinate multi-unit operations, and ensure the commander's strategic intent is executed across the entire force.*

**New Behaviors:**

#### `behaviors/epic-planner.ts`
- **Triggers**: `mail:received` (user messages with epic intent)
- **Logic**:
  1. Detect user messages that describe new work ("build a feature for...", "we need to...")
  2. Invoke the Adjutant agent (via tmux prompt) with a planning directive
  3. Agent uses epic-planner skill to generate spec artifacts and beads
  4. Work-assigner (Phase 2) automatically begins assigning tasks
  5. Report plan summary to user for approval

- **Guard Conditions**:
  - Only react to messages from `user` (not agent-to-agent)
  - Require explicit intent keywords or a `/plan` command prefix
  - Don't auto-plan if an epic is already in-progress for the same topic

#### `behaviors/epic-closer.ts`
- **Triggers**: `bead:closed`
- **Schedule**: `*/30 * * * *` (sweep for eligible epics)
- **Logic**:
  1. On any bead closure, check if the parent epic is now close-eligible
  2. If all children are closed, close the parent epic automatically
  3. Generate a completion summary for the user
  4. Send completion announcement via CommunicationManager

#### `behaviors/progress-reporter.ts`
- **Triggers**: `bead:closed`, `bead:updated`, `agent:status_changed`
- **Logic**:
  1. Track epic progress: N of M tasks complete
  2. On significant milestones (25%, 50%, 75%, 100%), send proactive update
  3. Detect stalled epics: no bead closures in 2+ hours → escalate
  4. Include burndown data in hourly summary

#### `behaviors/retrospective.ts`
- **Schedule**: Daily at end of day (or after epic completion)
- **Logic**:
  1. Gather metrics: beads closed, time per bead, agents used, failures encountered
  2. Identify patterns: which agents are fastest, which beads took longest, common failure types
  3. Generate retrospective summary for user
  4. Store patterns in state metadata for future optimization

**State Store Changes:**
- Add `epic_progress` table for tracking milestone timestamps
- Add `agent_performance` metrics for retrospective analysis

**Estimated Beads**: 8-10 tasks

---

## Phase Summary

| Phase | Military Parallel | Behaviors | Status | Est. Beads |
|-------|-------------------|-----------|--------|------------|
| **1** | Basic reporting & admin | agent-lifecycle, health-monitor, periodic-summary, stale-agent-nudger | **COMPLETE** | 13 (closed) |
| **2** | Assignment of duties | work-assigner, work-rebalancer | NOT STARTED | 4-5 |
| **3** | Calling up reserves | agent-spawner, agent-decommissioner | NOT STARTED | 5-6 |
| **4** | Inspecting the troops | build-monitor, quality-gate, merge-coordinator | NOT STARTED | 6-8 |
| **5** | Planning the campaign | epic-planner, epic-closer, progress-reporter, retrospective | NOT STARTED | 8-10 |

**Total remaining**: ~23-29 beads across 4 phases

## EventBus Event Map (Current + Planned)

```typescript
interface EventMap {
  // Current (12 events)
  "mail:received": MailReceivedEvent;
  "mail:read": MailReadEvent;
  "bead:created": BeadCreatedEvent;
  "bead:updated": BeadUpdatedEvent;
  "bead:closed": BeadClosedEvent;
  "agent:status_changed": AgentStatusEvent;
  "stream:status": StreamStatusEvent;
  "stream:output": Record<string, unknown>;
  "session:cost": Record<string, unknown>;
  "session:cost_alert": Record<string, unknown>;
  "session:permission": Record<string, unknown>;
  "mcp:agent_connected": McpAgentConnectedEvent;
  "mcp:agent_disconnected": McpAgentDisconnectedEvent;

  // Phase 2 additions
  "bead:assigned": BeadAssignedEvent;

  // Phase 4 additions
  "build:failed": BuildFailedEvent;
  "build:passed": BuildPassedEvent;
  "merge:completed": MergeCompletedEvent;
  "merge:conflict": MergeConflictEvent;
}
```

## State Store Evolution

```sql
-- Phase 1 (COMPLETE): migration 009
adjutant_agent_profiles    -- agent tracking
adjutant_decisions         -- behavior audit log
adjutant_metadata          -- key-value state

-- Phase 2: migration 010
ALTER TABLE adjutant_agent_profiles ADD COLUMN assignment_count INTEGER DEFAULT 0;
ALTER TABLE adjutant_agent_profiles ADD COLUMN last_epic_id TEXT;

-- Phase 3: migration 011
CREATE TABLE adjutant_spawn_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  spawned_at TEXT NOT NULL DEFAULT (datetime('now')),
  reason TEXT,
  bead_id TEXT,
  decommissioned_at TEXT
);

-- Phase 5: migration 012
CREATE TABLE adjutant_epic_progress (
  epic_id TEXT PRIMARY KEY,
  total_tasks INTEGER NOT NULL,
  completed_tasks INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_activity TEXT,
  milestone_25 TEXT,
  milestone_50 TEXT,
  milestone_75 TEXT,
  completed_at TEXT
);
```

## The Full Adjutant: End State

When all 5 phases are complete, the Adjutant will be a fully autonomous coordinator that:

1. **Knows everything** — persistent awareness of every agent's status, every bead's state, every build result
2. **Reacts instantly** — event-driven dispatch means the Adjutant responds to changes in milliseconds, not on hourly polls
3. **Assigns work intelligently** — matches agents to beads based on priority, affinity, and availability
4. **Scales the workforce** — spawns new agents when the backlog grows, decommissions idle ones
5. **Enforces quality** — verifies builds pass before accepting bead closures, creates bug beads for failures
6. **Coordinates merges** — serializes branch merges to prevent conflicts, handles conflict resolution
7. **Plans campaigns** — decomposes user intent into structured epics with tasks and dependencies
8. **Reports proactively** — sends updates on milestones, stalls, and completions without being asked
9. **Learns from history** — tracks performance patterns and adapts assignment strategies
10. **Never sleeps** — health monitoring ensures continuous operation, auto-recovery from any failure

The user's role becomes what the commanding officer's role is in a well-run unit: **set the intent, make the decisions that matter, and trust the adjutant to handle everything else.**

> *The adjutant controls the battle. The CO commands it.*

---

## Recommended Execution Order

1. **Phase 2 first** — work assignment is the highest-value next step; it eliminates the manual `bd update --assignee` loop
2. **Phase 3 second** — agent spawning builds on Phase 2's assignment logic
3. **Phase 4 third** — build monitoring requires agents to be spawning and working autonomously
4. **Phase 5 last** — epic management is the capstone; it requires all other phases to be stable

Phases 2-3 could be a single epic (~10 beads). Phases 4-5 could be a second epic (~15 beads). Or each phase could be its own epic for more granular tracking.

## References

- [spec-phase1.md](./spec-phase1.md) — Original adj-051 design
- [spec-051.5.md](./spec-051.5.md) — Event-driven restructure
- [Adjutant (Wikipedia)](https://en.wikipedia.org/wiki/Adjutant) — Military adjutant role
- [Adjutant (Britannica)](https://www.britannica.com/topic/adjutant) — Staff officer, logistics & administration
- [The Role of the Adjutant in the Indian Army](https://shop.ssbcrack.com/blogs/blog/the-role-of-the-adjutant-in-the-indian-army-key-duties-and-its-partnership-with-the-commanding-officer) — CO partnership model
