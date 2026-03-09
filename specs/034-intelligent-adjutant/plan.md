# Implementation Plan — Intelligent Adjutant

## Architecture Decisions

### 1. Signal Aggregator: Critical vs Context

Signals are classified into two categories, not three:
- **Critical** — wake the adjutant immediately (build:failed, agent:disconnected, agent:blocked, high-priority bead created, merge:conflict)
- **Context** — accumulate silently, included as context when the adjutant wakes for any reason (bead:closed, build:passed, agent:idle, low-priority bead created)

No "routine" wake-ups. Context signals never trigger prompts on their own.

**File**: `backend/src/services/adjutant/signal-aggregator.ts`

### 2. Stimulus Engine: Three Wake Sources

The stimulus engine wakes the adjutant from exactly three sources:
1. **Critical signal** from the aggregator → immediate prompt
2. **Scheduled check** set by the adjutant via `schedule_check` tool → delayed prompt
3. **Watch condition** met or timed out via `watch_for` tool → conditional prompt

No hourly heartbeat. No batch windows. On startup, a single bootstrap prompt orients the adjutant and lets it schedule its own first checks.

**File**: `backend/src/services/adjutant/stimulus-engine.ts`

### 3. Self-Scheduling Tools

Two new tools give the adjutant control over its own wake schedule:

- `schedule_check({ delay: "15m", reason: "Check worker-5 progress on adj-042" })` — fires a prompt after the delay with the reason as context
- `watch_for({ event: "bead:closed", filter: { id: "adj-042.1.2" }, timeout: "30m", reason: "Track adj-042.1.2 completion" })` — fires when the event matches OR the timeout expires, whichever comes first

These are stored in the stimulus engine's schedule queue. Pending watches/checks are included in every stimulus prompt so the adjutant sees its own future plan.

### 4. Action Tools as MCP Tool Handlers

Coordination tools (spawn, assign, nudge, decommission, rebalance) plus self-scheduling tools (schedule_check, watch_for) are registered as MCP tools in a single module. Adjutant-only access enforced via session identity check.

**File**: `backend/src/services/mcp-tools/coordination.ts`

### 5. Stimulus Prompt Format

```
SITUATION — [wake reason]

## What Happened
- [CRITICAL] build:failed — agent "worker-3" exit 1 on adj-042.1.2
- [context] bead:closed — adj-041.3.1 completed by "worker-2" (5 min ago)
- [context] agent:status_changed — "worker-1" now idle (3 min ago)

## Current State
Active agents: 3 (1 working, 1 blocked, 1 idle)
In-progress beads: 4
Ready beads: 3 (1 P1, 2 P2)

## Your Pending Schedule
- In 12m: "Check worker-5 progress on adj-042" (scheduled 3m ago)
- Watching: bead:closed adj-042.1.2 (timeout in 27m)

## Recent Decisions
- 18m ago: Spawned worker-5 for adj-042.1 → worker-5 completed adj-042.1.1, now on adj-042.1.2

## Available Actions
- spawn_worker({ prompt, beadId? }) — create a new agent
- assign_bead({ beadId, agentId, reason }) — assign work
- nudge_agent({ agentId, message }) — prompt an agent
- decommission_agent({ agentId, reason }) — shut down an agent
- rebalance_work({ agentId }) — return agent's beads to pool
- schedule_check({ delay, reason }) — wake yourself later
- watch_for({ event, filter?, timeout?, reason }) — wake on condition

Assess the situation. Take action if warranted. Schedule follow-ups for anything
you want to track. Explain your reasoning.
```

### 6. Bootstrap Prompt

On server startup (after a 60-second delay for services to stabilize), a single bootstrap prompt is injected:

```
BOOTSTRAP — Adjutant system starting up.

Gather the current state (list_agents, list_beads) and assess:
- Are any agents active? What are they working on?
- Are there ready beads that need assignment?
- Are there any anomalies?

Take any immediate actions needed, then schedule your first check-ins.
You will only be woken again by critical events or your own scheduled checks.
```

### 7. Removing Periodic Summary

The periodic-summary behavior is fully replaced by the stimulus engine + bootstrap prompt. The adjutant schedules its own status report cadence. If it wants to send the user an hourly update, it can `schedule_check({ delay: "1h", reason: "Send hourly status update to user" })` after each report.

## Phase Structure

### Phase 1: Signal Aggregator (Foundation)

Create the signal buffer with critical/context classification, deduplication, and expiry.

**Files:**
- `backend/src/services/adjutant/signal-aggregator.ts` (new)
- `backend/tests/unit/adjutant/signal-aggregator.test.ts` (new)

### Phase 2: Stimulus Engine (Wake Management)

Create the stimulus engine that wakes the adjutant from three sources: critical signals, scheduled checks, and watched conditions. Includes the bootstrap prompt.

**Files:**
- `backend/src/services/adjutant/stimulus-engine.ts` (new)
- `backend/tests/unit/adjutant/stimulus-engine.test.ts` (new)
- `backend/src/index.ts` (register stimulus engine, remove periodic-summary)

### Phase 3: Action Tools (LLM-Controlled Actions + Self-Scheduling)

Create MCP tools for coordination actions and self-scheduling.

**Files:**
- `backend/src/services/mcp-tools/coordination.ts` (new)
- `backend/tests/unit/mcp-tools/coordination.test.ts` (new)
- `backend/src/services/mcp-server.ts` (register new tools)

### Phase 4: Adjutant Prompt Update

Update the adjutant agent prompt with event-driven reasoning, self-scheduling patterns, and tool documentation.

**Files:**
- `.claude/agents/adjutant.md` (modify)

### Phase 5: Decision Feedback Loop

Extend state store with outcome tracking, include in stimulus prompts.

**Files:**
- `backend/src/services/adjutant/state-store.ts` (extend)
- `backend/src/services/adjutant/stimulus-engine.ts` (include feedback)
- `backend/tests/unit/adjutant/state-store.test.ts` (extend)

### Phase 6: Cleanup

Delete old disabled behavior files and dead imports.

**Files:**
- Delete: `work-assigner.ts`, `work-rebalancer.ts`, `agent-spawner.ts`, `agent-decommissioner.ts`, `stale-agent-nudger.ts`, `build-monitor.ts`, `quality-gate.ts`, `periodic-summary.ts`
- Delete corresponding test files
- Modify: `backend/src/index.ts` (remove dead imports/comments)

## Parallel Opportunities

- Phase 1 (Signal Aggregator) and Phase 3 (Action Tools) can be built in parallel
- Phase 4 (Prompt Update) can start once Phase 2 and Phase 3 are done
- Phase 6 (Cleanup) can happen any time after Phase 2

## Dependencies

```
Phase 1 (Signals) ──→ Phase 2 (Stimulus Engine) ──→ Phase 4 (Prompt)
                                                  ↗
Phase 3 (Action Tools) ──────────────────────────→ Phase 5 (Feedback)

Phase 6 (Cleanup) ← after Phase 2
```

## Bead Map

- `adj-054` — Root epic: Intelligent Adjutant — Signal-Driven Coordination
  - `adj-054.1` — Phase 1: Signal Aggregator
    - `adj-054.1.1` — Signal buffer with critical/context classification
    - `adj-054.1.2` — Deduplication and expiry logic
    - `adj-054.1.3` — Register aggregator in AdjutantCore
  - `adj-054.2` — Phase 2: Stimulus Engine
    - `adj-054.2.1` — Stimulus engine with three wake sources (critical, scheduled, watched)
    - `adj-054.2.2` — Situation prompt template + bootstrap prompt
    - `adj-054.2.3` — Replace periodic-summary, register stimulus engine in index.ts
  - `adj-054.3` — Phase 3: Action Tools
    - `adj-054.3.1` — spawn_worker MCP tool
    - `adj-054.3.2` — assign_bead MCP tool
    - `adj-054.3.3` — nudge_agent MCP tool
    - `adj-054.3.4` — decommission_agent + rebalance_work MCP tools
    - `adj-054.3.5` — schedule_check + watch_for MCP tools
    - `adj-054.3.6` — Adjutant-only access guard for coordination tools
  - `adj-054.4` — Phase 4: Adjutant Prompt Update
    - `adj-054.4.1` — Update adjutant.md with event-driven reasoning + self-scheduling patterns
  - `adj-054.5` — Phase 5: Decision Feedback
    - `adj-054.5.1` — Outcome tracking in state store
    - `adj-054.5.2` — Feedback summary in stimulus prompts
  - `adj-054.6` — Phase 6: Cleanup
    - `adj-054.6.1` — Delete old behavior files, periodic-summary, and dead imports
