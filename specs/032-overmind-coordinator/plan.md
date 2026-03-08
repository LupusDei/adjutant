# Plan: Adjutant Coordinator — Full Roadmap

> **Feature**: 032-overmind-coordinator
> **Date**: 2026-03-08
> **Active Epic**: adj-052

## Bead Map — adj-052: The Full Adjutant

```
adj-052           (root epic, OPEN, P1)
│
├── adj-052.1     (epic) Phase 2: Work Assignment [P1]
│   ├── adj-052.1.1   State store migration for work assignment [P]
│   ├── adj-052.1.2   Add bead:assigned event to EventBus [P]
│   ├── adj-052.1.3   Work Assigner behavior (depends on .1.1, .1.2)
│   ├── adj-052.1.4   Work Rebalancer behavior (depends on .1.1)
│   └── adj-052.1.5   Integrate Phase 2 into index.ts (depends on .1.3, .1.4)
│
├── adj-052.2     (epic) Phase 3: Agent Spawning [P1] (depends on adj-052.1)
│   ├── adj-052.2.1   Generalize spawner into agent-spawner-service [P]
│   ├── adj-052.2.2   Spawn history tracking in state store [P]
│   ├── adj-052.2.3   Agent Spawner behavior (depends on .2.1, .2.2)
│   ├── adj-052.2.4   Agent Decommissioner behavior (depends on .2.2)
│   └── adj-052.2.5   Integrate Phase 3 into index.ts (depends on .2.3, .2.4)
│
├── adj-052.3     (epic) Phase 4: Build & Quality Monitor [P2] (depends on adj-052.2)
│   ├── adj-052.3.1   Add build/merge events to EventBus
│   ├── adj-052.3.2   Build Monitor behavior (depends on .3.1)
│   ├── adj-052.3.3   Quality Gate behavior [P]
│   ├── adj-052.3.4   Merge Coordinator behavior (depends on .3.1)
│   └── adj-052.3.5   Integrate Phase 4 into index.ts (depends on .3.2, .3.3, .3.4)
│
└── adj-052.4     (epic) Phase 5: Epic Management [P2] (depends on adj-052.3)
    ├── adj-052.4.1   Epic progress tracking in state store
    ├── adj-052.4.2   Epic Planner behavior (depends on .4.1)
    ├── adj-052.4.3   Epic Closer behavior (depends on .4.1)
    ├── adj-052.4.4   Progress Reporter behavior (depends on .4.1)
    ├── adj-052.4.5   Retrospective behavior [P]
    └── adj-052.4.6   Integrate Phase 5 into index.ts (depends on .4.2-.4.5)

Total: 1 root epic + 4 sub-epics + 21 tasks = 26 beads
[P] = parallelizable (no blocking dependencies within phase)
```

---

## Completed Work

### adj-051: Phase 1 — Agent + Scheduler + Health Monitor
```
adj-051           (root epic, CLOSED)
├── adj-051.0.1   CLOSED  Bug: duplicated ADJUTANT_TMUX_SESSION constant
├── adj-051.1     CLOSED  (epic) Phase 1: Agent Definition & Auto-Spawn
│   ├── adj-051.1.1       CLOSED  Create Adjutant agent instructions file
│   │   ├── adj-051.1.1.1 CLOSED  Bug: no context window management strategy (by-design)
│   │   └── adj-051.1.1.2 CLOSED  Bug: tool name mismatch (verified — no mismatch)
│   ├── adj-051.1.2       CLOSED  Create Adjutant agent spawner service
│   │   ├── adj-051.1.2.1 CLOSED  Bug: spawner missing --agent-file flag (FIXED)
│   │   ├── adj-051.1.2.2 CLOSED  Bug: duplicate spawn prevention (deferred)
│   │   ├── adj-051.1.2.3 CLOSED  Update spawner tests
│   │   └── adj-051.1.2.4 CLOSED  Bug: dead code in spawner (by-design)
│   └── adj-051.1.3       CLOSED  Integrate auto-spawn into backend startup
│       ├── adj-051.1.3.1 CLOSED  Remove duplicate log in index.ts (FIXED)
│       └── adj-051.1.3.2 CLOSED  Bug: tmux session name collision (FIXED)
├── adj-051.2     CLOSED  (epic) Phase 2: Scheduler & Heartbeat (SUPERSEDED by .5)
│   ├── adj-051.2.1       CLOSED  Create scheduler service
│   ├── adj-051.2.2       CLOSED  Define heartbeat prompt
│   └── adj-051.2.3       CLOSED  Integrate scheduler into startup
├── adj-051.3     CLOSED  (epic) Phase 3: Health Monitor (SUPERSEDED by .5.6)
│   ├── adj-051.3.1       CLOSED  Add health check + recovery
│   └── adj-051.3.2       CLOSED  Wire health check into scheduler
├── adj-051.4     CLOSED  (epic) QA: Extensibility Review
│   ├── adj-051.4.1       CLOSED  list_agents missing lastActivity (FIXED)
│   ├── adj-051.4.2       CLOSED  Spawner missing --agent flag (dup of .1.2.1)
│   ├── adj-051.4.3       CLOSED  Duplicated constant (FIXED via .0.1)
│   ├── adj-051.4.4       CLOSED  Scheduler single-purpose (SUPERSEDED by .5)
│   ├── adj-051.4.5       CLOSED  Spawner Adjutant-specific (deferred to Phase 3)
│   ├── adj-051.4.6       CLOSED  Agent instructions not modular (deferred to Phase 2+)
│   ├── adj-051.4.7       CLOSED  No heartbeat on startup (FIXED — 60s startup fire)
│   ├── adj-051.4.8       CLOSED  No alive check before heartbeat (SUPERSEDED by .5.6)
│   ├── adj-051.4.9       CLOSED  No recently-closed beads in prompt (SUPERSEDED)
│   └── adj-051.4.10      CLOSED  tmuxSendKeys duplicates tmux.ts (SUPERSEDED)
└── adj-051.5     CLOSED  (epic) Restructure: Event-Driven Architecture
    ├── adj-051.5.1       CLOSED  State Store + SQLite migration
    ├── adj-051.5.2       CLOSED  Behavior Registry
    ├── adj-051.5.3       CLOSED  Communication Manager
    ├── adj-051.5.4       CLOSED  Adjutant Core — event dispatch + scheduling
    ├── adj-051.5.5       CLOSED  Agent Lifecycle Behavior
    ├── adj-051.5.6       CLOSED  Health Monitor Behavior
    ├── adj-051.5.7       CLOSED  Periodic Summary Behavior
    ├── adj-051.5.8       CLOSED  Stale Agent Nudger Behavior
    └── adj-051.5.9       CLOSED  Integration & Cleanup
```

**QA Beads** (created during adj-051.5 restructure, all CLOSED):
- adj-0gc2, adj-5saq, adj-p9i6, adj-dfcj — Behavior Registry QA
- adj-2248, adj-3o4c, adj-btir, adj-6h66, adj-h1hl — State Store QA
- adj-5vyy, adj-tgkn — Communication / Pruning QA

**Total Phase 1 beads**: 38 created, 38 closed

---

## Remaining Work: Phases 2–5

### Phase 2: Work Assignment

**Goal**: The Adjutant assigns idle agents to ready beads automatically.

**Files to create:**
- `backend/src/services/adjutant/behaviors/work-assigner.ts`
- `backend/src/services/adjutant/behaviors/work-rebalancer.ts`
- `backend/tests/unit/adjutant/behaviors/work-assigner.test.ts`
- `backend/tests/unit/adjutant/behaviors/work-rebalancer.test.ts`

**Files to modify:**
- `backend/src/services/event-bus.ts` — add `bead:assigned` event type
- `backend/src/services/adjutant/state-store.ts` — add `assignment_count`, `last_epic_id` to agent profile
- `backend/src/services/migrations/010-work-assignment.sql` — schema changes
- `backend/src/index.ts` — register new behaviors

**Dependencies**: None (builds on existing Phase 1 infrastructure)

### Phase 3: Agent Spawning

**Goal**: The Adjutant spawns new agents when work is available and no agents are idle, decommissions excess idle agents.

**Files to create:**
- `backend/src/services/adjutant/behaviors/agent-spawner.ts`
- `backend/src/services/adjutant/behaviors/agent-decommissioner.ts`
- `backend/src/services/agent-spawner-service.ts` (generalized from adjutant-spawner.ts)
- `backend/tests/unit/adjutant/behaviors/agent-spawner.test.ts`
- `backend/tests/unit/adjutant/behaviors/agent-decommissioner.test.ts`

**Files to modify:**
- `backend/src/services/adjutant/state-store.ts` — add spawn history tracking
- `backend/src/services/migrations/011-spawn-history.sql`
- `backend/src/index.ts` — register new behaviors

**Dependencies**: Phase 2 (work-assigner provides `bead:assigned` event)

### Phase 4: Build & Quality Monitor

**Goal**: The Adjutant monitors build/test results, creates bug beads for failures, enforces quality gates on bead closure, and coordinates merges.

**Files to create:**
- `backend/src/services/adjutant/behaviors/build-monitor.ts`
- `backend/src/services/adjutant/behaviors/quality-gate.ts`
- `backend/src/services/adjutant/behaviors/merge-coordinator.ts`
- `backend/tests/unit/adjutant/behaviors/build-monitor.test.ts`
- `backend/tests/unit/adjutant/behaviors/quality-gate.test.ts`
- `backend/tests/unit/adjutant/behaviors/merge-coordinator.test.ts`

**Files to modify:**
- `backend/src/services/event-bus.ts` — add build/merge event types
- `backend/src/index.ts` — register new behaviors

**Dependencies**: Phase 3 (agents must be spawning autonomously for build monitoring to matter)

### Phase 5: Epic Management

**Goal**: The Adjutant plans epics from user intent, auto-closes eligible epics, reports progress proactively, and generates retrospectives.

**Files to create:**
- `backend/src/services/adjutant/behaviors/epic-planner.ts`
- `backend/src/services/adjutant/behaviors/epic-closer.ts`
- `backend/src/services/adjutant/behaviors/progress-reporter.ts`
- `backend/src/services/adjutant/behaviors/retrospective.ts`
- `backend/src/services/migrations/012-epic-progress.sql`
- Tests for each behavior

**Files to modify:**
- `backend/src/services/adjutant/state-store.ts` — add epic progress and performance tables
- `backend/src/index.ts` — register new behaviors

**Dependencies**: Phases 2-4 (needs autonomous work assignment, spawning, and quality gates)

---

## Execution Strategy

### Recommended: Two mega-epics

**Epic A: Autonomous Work Execution** (Phases 2 + 3)
- ~10 beads
- Delivers: agent auto-assignment + agent auto-spawning
- This is the single highest-value upgrade — the user stops manually assigning work

**Epic B: Quality & Campaign Management** (Phases 4 + 5)
- ~15 beads
- Delivers: build monitoring, quality gates, merge coordination, epic planning
- Requires Epic A to be stable first

### Parallelization Opportunities

**Within Phase 2**: work-assigner and work-rebalancer can be built in parallel (different triggers, different logic)

**Within Phase 3**: agent-spawner and agent-decommissioner can be built in parallel

**Within Phase 4**: build-monitor, quality-gate, and merge-coordinator are independent behaviors

**Within Phase 5**: All 4 behaviors are independent

**Cross-phase**: Phase 2 and Phase 3 share the state store migration, so the migration must be done first. Similarly for Phases 4/5.

---

## Success Criteria

### Phase 2 Complete When:
- [ ] User creates a bead → idle agent is automatically assigned within 5 minutes
- [ ] Agent disconnects → orphaned beads returned to open pool
- [ ] No manual `bd update --assignee` needed for routine work

### Phase 3 Complete When:
- [ ] Backlog grows beyond idle agent capacity → new agent spawned automatically
- [ ] Idle agents with no work for 30+ minutes → shutdown suggested
- [ ] Agent count never exceeds configured maximum

### Phase 4 Complete When:
- [ ] Build failure → bug bead created and assigned automatically
- [ ] Bead closed without passing tests → reopened with explanation
- [ ] Multiple branches ready → merges serialized without conflicts

### Phase 5 Complete When:
- [ ] User describes work in chat → epic created with tasks and dependencies
- [ ] All children of an epic close → parent auto-closes with summary
- [ ] Milestones (25/50/75/100%) trigger proactive updates
- [ ] Daily/weekly retrospective generated with performance metrics

### The Full Adjutant Complete When:
- [ ] User sets intent → Adjutant plans, assigns, spawns, monitors, reports, and closes
- [ ] Zero manual intervention required for routine development cycles
- [ ] Quality gates prevent broken code from reaching main
- [ ] The user's role is purely strategic: approve plans, make decisions, review results
