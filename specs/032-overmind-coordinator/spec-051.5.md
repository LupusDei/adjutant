# adj-051.5: Event-Driven Adjutant Architecture Restructure

> **Status**: COMPLETED
> **Epic**: adj-051.5 (closed)
> **Date**: 2026-03-08
> **Predecessor**: adj-051 Phase 1 (spec-phase1.md)

## Motivation

The Phase 1 implementation scored 5/10 on extensibility during QA review (adj-051.4). The core problems:

1. **Single-purpose scheduler** — one cron job, one heartbeat, no way to add new periodic tasks
2. **No event reactions** — the system polled hourly instead of reacting to events as they happened
3. **No persistent state** — agent profiles existed only in the agent's context window
4. **Tight coupling** — health monitor was hardwired into the scheduler, not a separate concern
5. **No communication abstraction** — messages went directly to tmux, no priority routing

The restructure transformed the architecture from poll-based to event-driven with pluggable behaviors, targeting 8-10/10 extensibility. The goal: **new phases (auto-assign, agent spawning, build monitoring) = new behavior files, zero core changes.**

## Design Principles

1. **Event-Driven First**: React to domain events in real-time, not on a polling schedule
2. **Pluggable Behaviors**: Each concern is a self-contained behavior module implementing a shared interface
3. **Guard-Act Pattern**: Fast `shouldAct()` check before expensive `act()` execution
4. **Three-Tier Communication**: Routine (batched) → Important (immediate) → Escalate (push notification)
5. **Persistent Awareness**: SQLite-backed state survives process restarts
6. **Audit Trail**: Every behavior decision is logged for forensic debugging
7. **Zero-Core Extension**: Adding Phase 2-5 features requires only new behavior files + registration

## Architecture

```
┌─── EventBus (pub/sub) ──────────────────────────────────┐
│                                                           │
│  Domain Events                                           │
│  ├─ mcp:agent_connected / disconnected                  │
│  ├─ agent:status_changed                                │
│  ├─ bead:created / updated / closed                     │
│  └─ stream:status, mail:received, session:cost, ...     │
│                                                           │
│              ▼                                            │
│     AdjutantCore.onAny()                                │
│              │                                            │
│     BehaviorRegistry.getBehaviorsForEvent(name)          │
│              │                                            │
│     ┌────────┴────────┐                                  │
│     ▼                 ▼                                  │
│  behavior.shouldAct()                                    │
│     │                                                    │
│     ▼ (if true)                                          │
│  behavior.act(event, state, comm)                       │
│     │                                                    │
│     ├─► AdjutantState (SQLite)                          │
│     │   ├─ agent_profiles                               │
│     │   ├─ decisions (audit log)                        │
│     │   └─ metadata (key-value)                         │
│     │                                                    │
│     └─► CommunicationManager                            │
│         ├─ queueRoutine()    → batched into next summary│
│         ├─ sendImportant()   → immediate delivery       │
│         ├─ escalate()        → + APNS push notification │
│         └─ messageAgent()    → direct agent message     │
│                                                           │
│  Scheduled Behaviors (setInterval)                       │
│  ├─ health-monitor    (*/5 min)  → respawn if dead     │
│  ├─ stale-agent-nudger (*/15 min) → nudge stale agents │
│  └─ periodic-summary  (hourly)   → heartbeat + summary │
│                                                           │
│  Startup: all scheduled behaviors fire once at T+60s     │
└──────────────────────────────────────────────────────────┘
```

## Key Interfaces

### AdjutantBehavior

```typescript
interface AdjutantBehavior {
  name: string;
  triggers: EventName[];           // EventBus events that activate this behavior
  schedule?: string;               // Cron expression for periodic behaviors
  shouldAct(event: BehaviorEvent, state: AdjutantState): boolean;
  act(event: BehaviorEvent, state: AdjutantState, comm: CommunicationManager): Promise<void>;
}
```

### AdjutantState

```typescript
interface AdjutantState {
  getAgentProfile(agentId: string): AgentProfile | null;
  upsertAgentProfile(profile: Partial<Omit<AgentProfile, 'lastStatusAt'>> & { agentId: string }): void;
  getAllAgentProfiles(): AgentProfile[];
  logDecision(entry: DecisionEntry): void;
  getRecentDecisions(limit: number): DecisionEntry[];
  getMeta(key: string): string | null;
  setMeta(key: string, value: string): void;
  pruneOldDecisions(olderThanDays: number): number;
}
```

### CommunicationManager

```typescript
interface CommunicationManager {
  queueRoutine(message: string): void;
  sendImportant(message: string): Promise<void>;
  escalate(message: string): Promise<void>;
  messageAgent(agentId: string, message: string): Promise<void>;
  flushRoutineQueue(): string[];
  getRoutineQueueLength(): number;
}
```

## Implementation

### File Structure

```
backend/src/services/adjutant/
├── adjutant-core.ts          # Event subscriptions, dispatch, interval scheduling
├── behavior-registry.ts      # AdjutantBehavior interface + registry
├── state-store.ts            # SQLite persistent state (agent profiles, decisions)
├── communication.ts          # Priority-based outbound messaging
└── behaviors/
    ├── agent-lifecycle.ts    # Track agent connect/disconnect/status
    ├── health-monitor.ts     # Keep Adjutant agent alive
    ├── periodic-summary.ts   # Hourly heartbeat + summary
    └── stale-agent-nudger.ts # Nudge agents with stale status

backend/src/services/migrations/
└── 009-adjutant-state.sql    # SQLite schema for state store

backend/tests/unit/adjutant/
├── adjutant-core.test.ts     # 25 tests
├── behavior-registry.test.ts # Tests for register/lookup/unregister
├── state-store.test.ts       # Tests with temp SQLite DBs
├── communication.test.ts     # Tests for priority queue + delivery
└── behaviors/
    ├── agent-lifecycle.test.ts
    ├── health-monitor.test.ts
    ├── periodic-summary.test.ts
    └── stale-agent-nudger.test.ts
```

### Behaviors Implemented

| Behavior | Triggers | Schedule | Purpose |
|----------|----------|----------|---------|
| `agent-lifecycle` | `mcp:agent_connected`, `mcp:agent_disconnected`, `agent:status_changed` | — | Track agent profiles in persistent state |
| `health-monitor` | — | `*/5 * * * *` | Check Adjutant tmux session, respawn if dead |
| `periodic-summary` | — | `0 * * * *` | Inject heartbeat prompt, deliver hourly report |
| `stale-agent-nudger` | `agent:status_changed` | `*/15 * * * *` | Nudge agents silent for 1+ hours |

### Database Schema (migration 009)

```sql
-- Agent tracking
CREATE TABLE IF NOT EXISTS adjutant_agent_profiles (
  agent_id TEXT PRIMARY KEY,
  last_status TEXT NOT NULL DEFAULT 'unknown',
  last_status_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_activity TEXT,
  current_task TEXT,
  current_bead_id TEXT,
  connected_at TEXT,
  disconnected_at TEXT
);
CREATE INDEX idx_adjutant_agent_profiles_status_at ON adjutant_agent_profiles(last_status_at);

-- Behavior decision audit log
CREATE TABLE IF NOT EXISTS adjutant_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  behavior TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_adjutant_decisions_behavior ON adjutant_decisions(behavior);
CREATE INDEX idx_adjutant_decisions_created ON adjutant_decisions(created_at);

-- Key-value metadata
CREATE TABLE IF NOT EXISTS adjutant_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Bead Map

```
adj-051.5 — Restructure: Event-Driven Adjutant Architecture (epic, CLOSED)
│
├── adj-051.5.1 — State Store + SQLite migration          @engineer-1  CLOSED
├── adj-051.5.2 — Behavior Registry                       @engineer-2  CLOSED
├── adj-051.5.3 — Communication Manager                   @engineer-3  CLOSED
├── adj-051.5.4 — Adjutant Core — event dispatch + cron   @overmind    CLOSED
├── adj-051.5.5 — Agent Lifecycle Behavior                 @engineer-4  CLOSED
├── adj-051.5.6 — Health Monitor Behavior                  @engineer-5  CLOSED
├── adj-051.5.7 — Periodic Summary Behavior                @engineer-6  CLOSED
├── adj-051.5.8 — Stale Agent Nudger Behavior              @engineer-7  CLOSED
└── adj-051.5.9 — Integration & Cleanup                    @overmind    CLOSED
```

### Build Order

- **Sub-Epic A** (parallel): adj-051.5.1, .5.2, .5.3 — Core framework (3 agents)
- **Sub-Epic B** (sequential): adj-051.5.4 — Adjutant Core (depends on A)
- **Sub-Epic C** (parallel): adj-051.5.5, .5.6, .5.7, .5.8 — Behaviors (4 agents)
- **Sub-Epic D** (sequential): adj-051.5.9 — Integration (depends on C)

### QA Fixes Applied Post-Restructure

| Issue | Fix | Bead |
|-------|-----|------|
| node-cron "missed execution" spam | Replaced node-cron with native setInterval + cronToIntervalMs() | adj-051.4.4 |
| Spawner missing `--agent-file` flag | Added `claudeArgs: ["--agent-file", ".claude/agents/adjutant.md"]` | adj-051.1.2.1 |
| tmux session name collision | Renamed to `adjutant-coordinator` → `adj-swarm-adjutant-coordinator` | adj-051.1.3.2 |
| Duplicated ADJUTANT_TMUX_SESSION | Exported from spawner, imported in periodic-summary | adj-051.0.1 |
| Missing `lastActivity` in list_agents | Added field to MCP tool output | adj-051.4.1 |
| No startup heartbeat | Added 60-second startup fire for all scheduled behaviors | adj-051.4.7 |
| Duplicate log in index.ts | Removed (spawner already logs) | adj-051.1.3.1 |
| Behavior registry type safety | Proper types, unregister/clear, dead behavior rejection | adj-0gc2 (QA) |
| State store edge cases | Pre-prepared UPDATE, limit clamp, pruneOldDecisions | adj-2248 (QA) |
| Missing index on last_status_at | Added to migration | adj-h1hl (QA) |

## Extensibility Proof

Each future phase = one new file in `behaviors/`:

```typescript
// Phase 2: behaviors/work-assigner.ts
{
  name: "work-assigner",
  triggers: ["bead:created", "agent:status_changed"],
  shouldAct: (event, state) => /* idle agent exists AND ready bead exists */,
  act: async (event, state, comm) => /* assign bead to idle agent */,
}

// Phase 3: behaviors/agent-spawner.ts
{
  name: "agent-spawner",
  triggers: ["bead:created"],
  shouldAct: (event, state) => /* ready beads > 0 AND no idle agents AND under limit */,
  act: async (event, state, comm) => /* spawn new agent via lifecycle manager */,
}
```

**Zero changes to adjutant-core.ts, behavior-registry.ts, state-store.ts, or communication.ts.**

## Test Coverage

- **102+ tests** across 8 test files
- All behaviors have dedicated unit tests
- adjutant-core tests use fake timers for deterministic scheduling
- State store tests use temporary SQLite databases
- Communication tests verify priority routing and queue mechanics
- Total backend test suite: **1757 tests passing**

## What Changed from Phase 1

| Aspect | Phase 1 | adj-051.5 |
|--------|---------|-----------|
| Scheduling | node-cron single job | setInterval per behavior |
| Event handling | None (poll-only) | EventBus subscription via onAny() |
| State persistence | None (agent context only) | SQLite tables (profiles, decisions, metadata) |
| Health monitor | Wired into scheduler | Standalone behavior module |
| Communication | Direct tmux send-keys | Priority queue (routine/important/escalate) |
| Agent tracking | None | Persistent AgentProfile per agent |
| Extensibility | Modify scheduler.ts | Add new behavior file + register |
| Audit trail | None | Decision log with 30-day retention |
| Startup behavior | Wait for first cron tick | Fire all scheduled behaviors at T+60s |
