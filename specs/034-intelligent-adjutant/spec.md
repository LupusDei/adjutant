# Intelligent Adjutant — Signal-Driven Coordination

## Problem Statement

The adj-052 epic introduced automated behaviors for work assignment, agent spawning, decommissioning, and nudging. These behaviors operated on cron timers and simple if/else logic — mechanism without intelligence. They caused runaway automation: agents spawning unnecessarily, beads assigned without context, idle agents killed prematurely.

The adjutant agent is an LLM. It can reason. The automation bypassed that capability entirely.

## Vision

Replace blind automation with **event-driven intelligence**. The Overmind pattern: critical events wake the adjutant, it reasons about the situation, takes action, and schedules its own follow-up checks. When nothing is happening, it sleeps. No polling, no cron timers, no routine nudges that produce "nothing to do" responses.

The adjutant thinks ahead. After spawning an agent, it sets a reminder to check on progress in 15 minutes. After seeing an agent go blocked, it gives it 10 minutes then follows up. It drives its own cadence based on what's actually happening.

## Architecture: The Overmind Pattern

```
┌──────────────────────────────────────────────────────────────┐
│                      ADJUTANT AGENT (LLM)                    │
│                                                              │
│  Woken by events → reasons → takes action → schedules next   │
│                                                              │
│  Tools:                                                      │
│    spawn_worker, assign_bead, nudge_agent, decommission,     │
│    rebalance_work, schedule_check, watch_for                 │
└──────┬──────────────────────────────────────────┬────────────┘
       │ commands (MCP tools)                     │ wake-ups
       ▼                                          ▲
┌────────────────┐                    ┌───────────────────────┐
│  ACTION LAYER  │                    │   STIMULUS ENGINE     │
│  (MCP tools)   │                    │                       │
│  spawn, assign │                    │  1. Critical events   │
│  nudge, decom  │                    │     → immediate wake  │
│                │                    │                       │
│  schedule_check│──schedules──────→  │  2. Self-scheduled    │
│  watch_for     │──watches────────→  │     checks → wake     │
│                │                    │                       │
└────────────────┘                    │  3. Event watches     │
                                      │     → conditional wake│
                                      └───────────┬───────────┘
                                                  ▲
                                      ┌───────────────────────┐
                                      │      EVENT BUS        │
                                      │  build:failed/passed  │
                                      │  agent:disconnected   │
                                      │  agent:blocked        │
                                      │  bead:created/closed  │
                                      └───────────────────────┘
```

## Core Principle: No Purposeless Prompting

The adjutant is ONLY woken when:
1. **A critical event demands attention** — build failed, agent disconnected, agent blocked, merge conflict
2. **A self-scheduled check fires** — the adjutant previously decided "wake me in 15 minutes to check on X"
3. **A watched condition is met or times out** — "tell me when adj-042.1.2 closes, or if it hasn't in 30 minutes"

The adjutant is NOT woken for:
- Routine events (bead closed, build passed, agent idle) — these are included as context when the adjutant is woken for another reason
- Hourly heartbeats — removed entirely; the adjutant schedules its own check-ins
- Batched routine signals — no batch windows, no "every 5 minutes"

## User Stories

### US1: Signal Aggregation (Priority: P1)

**As** the adjutant system, **I want** to collect EventBus signals into a buffer with urgency classification **so that** the adjutant receives coherent context when it's woken, not raw event spam.

**Acceptance Criteria:**
- [ ] All relevant EventBus events are captured into a signal buffer
- [ ] Each signal classified as critical (wake immediately) or context (include when woken)
- [ ] Signals are deduplicated (e.g., 5 rapid `agent:status_changed` from same agent → 1 signal)
- [ ] Buffer provides a snapshot method that returns accumulated context signals since last wake
- [ ] Buffer auto-expires stale signals (> 30 minutes old)
- [ ] Critical signals immediately notify the stimulus engine to wake the adjutant

**Signal Classification:**
| Event | Class | Rationale |
|-------|-------|-----------|
| `build:failed` | Critical | Agent may be stuck in a failure loop |
| `mcp:agent_disconnected` | Critical | Orphaned work needs attention |
| `merge:conflict` | Critical | Blocks progress |
| `agent:status_changed` → blocked | Critical | Agent needs help |
| `bead:created` (P0/P1) | Critical | High-priority work arrived |
| `agent:status_changed` → idle | Context | Included when adjutant wakes for any reason |
| `bead:created` (P2+) | Context | Included when adjutant wakes |
| `bead:closed` | Context | Included when adjutant wakes |
| `build:passed` | Context | Included when adjutant wakes |
| `agent:status_changed` → working | Context | Included when adjutant wakes |

### US2: Stimulus Engine (Priority: P1)

**As** the adjutant system, **I want** a stimulus engine that wakes the adjutant on critical events, self-scheduled checks, and watched conditions **so that** the adjutant is only prompted when there's a reason to think.

**Acceptance Criteria:**
- [ ] Critical signals trigger a stimulus prompt within 30 seconds
- [ ] Self-scheduled checks fire at the adjutant-specified time (schedule_check tool)
- [ ] Watched conditions fire when the target event occurs or the timeout expires (watch_for tool)
- [ ] Each stimulus prompt includes: wake reason, accumulated context signals, state snapshot, pending watches/checks
- [ ] Cooldown: minimum 90 seconds between prompts (critical events queue if within cooldown)
- [ ] No hourly heartbeat — the adjutant schedules its own check-ins
- [ ] On startup, a single bootstrap prompt is injected to orient the adjutant and let it schedule its first checks
- [ ] If adjutant tmux session is dead, signals queue until it's alive again
- [ ] Prompt is injected via SessionBridge (same mechanism as periodic-summary)

### US3: Adjutant Action Tools (Priority: P1)

**As** the adjutant agent, **I want** MCP tools for coordination actions AND self-scheduling **so that** I can manage the swarm and drive my own cadence.

**Acceptance Criteria:**
- [ ] `spawn_worker` tool: spawn a new agent with a specific prompt, returns agent name
- [ ] `assign_bead` tool: assign a bead to a specific agent, with a reason field logged
- [ ] `nudge_agent` tool: send a targeted prompt to a specific agent's tmux session
- [ ] `decommission_agent` tool: gracefully shut down an agent (send shutdown message, wait, kill session)
- [ ] `rebalance_work` tool: unassign beads from a disconnected/dead agent, return them to pool
- [ ] `schedule_check` tool: schedule a future wake-up with a reason and delay (e.g., "15m", "1h")
- [ ] `watch_for` tool: register a conditional wake-up — fire when a specific event occurs or timeout expires
- [ ] All tools log decisions with reasoning to the state store
- [ ] All tools validate inputs (e.g., can't decommission protected agents like `adjutant-coordinator`)
- [ ] Coordination tools are restricted to adjutant-only callers

### US4: Adjutant Agent Prompt Update (Priority: P1)

**As** the adjutant agent, **I want** my system prompt to teach me how to reason about events, use action tools, and schedule my own follow-ups **so that** I make intelligent proactive coordination decisions.

**Acceptance Criteria:**
- [ ] Agent prompt (`.claude/agents/adjutant.md`) updated with event-driven reasoning guidance
- [ ] Includes decision framework: when to spawn vs. assign vs. wait
- [ ] Includes self-scheduling patterns: "after spawning, schedule a 15m check", "after seeing blocked, watch for resolution or escalate in 10m"
- [ ] Includes spawn budget awareness (max concurrent agents, cost consideration)
- [ ] Includes examples of good decisions with follow-up scheduling
- [ ] Stimulus prompt template includes "Pending Watches/Checks" section so adjutant sees its own future schedule
- [ ] Agent understands it should explain its reasoning in decision messages
- [ ] On bootstrap, agent should assess current state and schedule appropriate initial checks

### US5: Decision Feedback Loop (Priority: P2)

**As** the adjutant system, **I want** to track outcomes of adjutant decisions and feed them back as context **so that** the adjutant's judgment improves over time.

**Acceptance Criteria:**
- [ ] Every action tool call logs: action, target, reasoning, timestamp
- [ ] Spawn outcomes tracked: did the agent complete its bead? How long did it take?
- [ ] Assignment outcomes tracked: did the agent actually work on the assigned bead?
- [ ] Recent decision outcomes included in stimulus prompts as context
- [ ] Decision log queryable via MCP tool (`query_decisions`)

### US6: Cleanup — Remove Old Behaviors (Priority: P2)

**As** a maintainer, **I want** the old disabled adj-052 behavior files deleted **so that** the codebase has a single source of truth for coordination logic.

**Acceptance Criteria:**
- [ ] Delete: `work-assigner.ts`, `work-rebalancer.ts`, `agent-spawner.ts`, `agent-decommissioner.ts`, `stale-agent-nudger.ts`
- [ ] Delete corresponding test files
- [ ] Remove commented-out imports and registrations from `index.ts`
- [ ] Delete untracked `build-monitor.ts`, `quality-gate.ts` and their tests
- [ ] Remove `periodic-summary.ts` (replaced by stimulus engine)
- [ ] Build and tests still pass after cleanup

## Success Criteria

1. The adjutant is only woken when there's something to think about — never for "nothing to do"
2. The adjutant schedules its own follow-ups after taking action
3. The adjutant can spawn, assign, nudge, decommission, and rebalance via tools
4. Every coordination decision has logged reasoning
5. No cron-based automation makes decisions — all decisions flow through the LLM
6. During quiet periods, the adjutant sleeps indefinitely until the next event

## Out of Scope

- Build monitoring / quality gates (separate concern, can be a future behavior)
- Memory/learning behaviors (already working fine, not part of this epic)
- iOS push notification integration for adjutant decisions
- Multi-project coordination (single project only)
