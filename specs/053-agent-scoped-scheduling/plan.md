# Implementation Plan: Agent-Scoped Scheduling

**Branch**: `053-agent-scoped-scheduling` | **Date**: 2026-04-17
**Epic**: `adj-163` | **Priority**: P1

## Summary

Generalize Adjutant's scheduling system from coordinator-only to agent-scoped. Any agent can create schedules for itself, wakes route to the correct tmux session, and session death invalidates all associated schedules. The coordinator's existing functionality migrates seamlessly — it becomes "just another agent" with admin privileges.

## Bead Map

- `adj-163` - Root: Agent-scoped scheduling
  - `adj-163.1` - Schema & store: add target_agent to schedules
    - `adj-163.1.1` - DB migration: add target_agent, target_tmux_session columns
    - `adj-163.1.2` - Update CronScheduleStore: new columns in create/query/list
    - `adj-163.1.3` - Add listByAgent() and disableByAgent() store methods
    - `adj-163.1.4` - Tests for store changes
  - `adj-163.2` - Wake routing: deliver to correct agent
    - `adj-163.2.1` - Refactor StimulusEngine: carry targetAgent on WakeReason
    - `adj-163.2.2` - Refactor onWake callback: route by targetAgent, not hardcoded
    - `adj-163.2.3` - Agent-targeted prompt delivery (simple vs coordinator rich prompt)
    - `adj-163.2.4` - Tests for wake routing
  - `adj-163.3` - Session death cleanup
    - `adj-163.3.1` - Hook destroySession to disable schedules + cancel watches
    - `adj-163.3.2` - Auto-disable on delivery failure (dead session detection)
    - `adj-163.3.3` - Tests for cleanup
  - `adj-163.4` - MCP tool access: open to all agents
    - `adj-163.4.1` - Relax access control on scheduling tools
    - `adj-163.4.2` - Add ownership filtering (list own, manage own, coordinator sees all)
    - `adj-163.4.3` - Add targetAgent param to create_schedule
    - `adj-163.4.4` - Tests for access control and ownership
  - `adj-163.5` - Coordinator migration & backwards compat
    - `adj-163.5.1` - Migrate existing coordinator wiring to use agent-scoped routing
    - `adj-163.5.2` - Verify auto-develop scheduleCheck still works
    - `adj-163.5.3` - End-to-end verification + regression tests

## Technical Context

**Stack**: TypeScript 5.x (strict), SQLite, Express, Vitest
**Key Files**:
- `backend/src/services/adjutant/cron-schedule-store.ts` — persistent schedule storage
- `backend/src/services/adjutant/stimulus-engine.ts` — in-memory timer + wake routing
- `backend/src/services/mcp-tools/coordination.ts` — MCP tools (create/cancel/pause/resume/list)
- `backend/src/index.ts` — onWake callback (currently hardcoded to coordinator)
- `backend/src/services/lifecycle-manager.ts` — session creation/destruction
- `backend/src/services/session-registry.ts` — session tracking

**Constraints**:
- Backwards compat: coordinator's `buildSituationPrompt()` flow must continue unchanged
- No polling: use existing setTimeout-based timer mechanism
- Persistence: cron schedules in SQLite, watches in-memory (acceptable)
- Delivery idempotent: dead session → log + disable, don't crash

## Architecture Decision

### Agent-scoped schedules with coordinator admin

The schedule system becomes agent-owned:
- **Default**: `create_schedule` targets the calling agent (self-scheduling)
- **Admin**: Coordinator can pass `targetAgent` to target any agent
- **Ownership**: Agents can only list/manage their own schedules
- **Cleanup**: Session death disables all schedules for that agent

### Wake routing refactor

**Before**: Single `onWake` callback hardcoded to coordinator session
**After**: `WakeReason` carries `targetAgent` + `targetTmuxSession`. The `onWake` callback looks up the correct session and delivers.

```typescript
// Before (index.ts)
stimulusEngine.onWake((reason) => {
  const session = bridge.registry.findByTmuxSession(ADJUTANT_TMUX_SESSION);
  bridge.sendInput(session.id, buildSituationPrompt(...));
});

// After (index.ts)
stimulusEngine.onWake((reason) => {
  const targetSession = reason.targetTmuxSession ?? ADJUTANT_TMUX_SESSION;
  const session = bridge.registry.findByTmuxSession(targetSession);
  if (!session) {
    // Dead session — disable the schedule
    if (reason.scheduleId) cronScheduleStore.disable(reason.scheduleId);
    return;
  }

  const isCoordinator = targetSession === ADJUTANT_TMUX_SESSION;
  const prompt = isCoordinator
    ? buildSituationPrompt({ ... })  // Rich context for coordinator
    : `[SCHEDULED REMINDER] ${reason.reason}`;  // Simple for others

  bridge.sendInput(session.id, prompt);
});
```

### Coordinator migration (seamless)

Existing coordinator schedules become agent-scoped with `target_agent = 'adjutant-coordinator'`. The migration:
1. Adds columns with defaults matching the coordinator
2. The onWake refactor detects coordinator-targeted wakes and uses the existing `buildSituationPrompt()` path
3. Zero behavior change for the coordinator — it just gets its wakes through the new routing instead of hardcoded

The `auto-develop-loop.ts` internal `scheduleCheck()` calls also get `targetAgent` param defaulting to the coordinator.

## Files Changed

| File | Change |
|------|--------|
| `backend/src/services/migrations/032-agent-scoped-schedules.sql` | Add target_agent, target_tmux_session columns |
| `backend/src/services/adjutant/cron-schedule-store.ts` | New columns in create/query, listByAgent(), disableByAgent() |
| `backend/src/services/adjutant/stimulus-engine.ts` | targetAgent on WakeReason, scheduleCheck, registerWatch |
| `backend/src/index.ts` | Refactor onWake: route by targetAgent, dual prompt paths |
| `backend/src/services/mcp-tools/coordination.ts` | Relax access control, ownership filter, targetAgent param |
| `backend/src/services/lifecycle-manager.ts` | Hook destroySession → disableByAgent + cancelWatches |
| `backend/src/services/adjutant/behaviors/auto-develop-loop.ts` | Pass targetAgent to scheduleCheck |

## Phase 1: Schema & Store (adj-163.1)

Add `target_agent` and `target_tmux_session` to `cron_schedules`. Update CronScheduleStore with new create params, query methods, and agent-scoped operations.

**Migration**: `ALTER TABLE ADD COLUMN` with defaults for existing rows:
```sql
ALTER TABLE cron_schedules ADD COLUMN target_agent TEXT NOT NULL DEFAULT 'adjutant-coordinator';
ALTER TABLE cron_schedules ADD COLUMN target_tmux_session TEXT NOT NULL DEFAULT 'adj-swarm-adjutant-coordinator';
```

**New store methods**:
- `listByAgent(agentName)` — returns schedules where `target_agent = agentName`
- `disableByAgent(agentName)` — disables all schedules for an agent (session death)
- Updated `create()` — accepts `targetAgent` and `targetTmuxSession`

## Phase 2: Wake Routing (adj-163.2)

Refactor the StimulusEngine and onWake callback to route wakes to the correct agent.

**WakeReason changes**:
```typescript
interface WakeReason {
  type: "recurring" | "watch" | "check" | "watch_timeout";
  reason: string;
  targetAgent?: string;         // NEW — who gets the wake
  targetTmuxSession?: string;   // NEW — which tmux session
  scheduleId?: string;          // NEW — for auto-disable on dead session
}
```

**Delivery strategy**:
- Coordinator targets → `buildSituationPrompt()` (rich, existing)
- Other agents → `[SCHEDULED REMINDER] {reason}` (simple text prompt injection)
- Dead session → log warning, disable schedule, skip delivery

## Phase 3: Session Death Cleanup (adj-163.3)

Hook into `LifecycleManager.destroySession()` to clean up agent resources.

```typescript
// In destroySession(), after killing tmux:
if (cronScheduleStore) {
  cronScheduleStore.disableByAgent(session.name);
}
if (stimulusEngine) {
  stimulusEngine.cancelWatchesByAgent(session.name);
}
```

Also: auto-disable on delivery failure — if `bridge.sendInput()` fails (session not found), disable the schedule immediately instead of waiting for the next fire.

## Phase 4: MCP Tool Access (adj-163.4)

Open scheduling tools to all agents with ownership enforcement.

**Access control changes**:
- `create_schedule`: any agent (targets self by default, coordinator can target others)
- `list_schedules`: returns only caller's schedules (coordinator sees all)
- `cancel_schedule`, `pause_schedule`, `resume_schedule`: only own schedules (coordinator can manage any)
- `schedule_check`: keep coordinator-only (internal use)

**New param on `create_schedule`**:
```typescript
targetAgent: z.string().optional().describe(
  "Agent to receive the scheduled prompt. Defaults to caller. " +
  "Only the coordinator can target other agents."
)
```

## Phase 5: Coordinator Migration & Verification (adj-163.5)

Ensure zero regression for existing coordinator behavior:
1. Wire the existing `onWake` in `index.ts` through the new routing (coordinator is just `targetAgent = 'adjutant-coordinator'`)
2. Verify `auto-develop-loop.ts` `scheduleCheck()` still works (passes targetAgent for coordinator)
3. End-to-end test: create schedules for multiple agents, verify routing, kill a session, verify cleanup

## Parallel Execution

- **Phase 1**: Sequential (schema first)
- **Phase 2 depends on Phase 1** (needs targetAgent in store)
- **Phase 3 depends on Phase 1** (needs disableByAgent)
- **Phase 2 + Phase 3**: Can run in PARALLEL after Phase 1
- **Phase 4 depends on Phase 1** (needs targetAgent in create)
- **Phase 5 depends on all** (integration verification)

```
Phase 1 (Schema + Store)
    |
    ├── Phase 2 (Wake Routing)  ──→ Phase 5 (Migration + Verify)
    ├── Phase 3 (Cleanup)       ──↗
    └── Phase 4 (MCP Access)    ──↗
```

## Verification Steps

- [ ] Migration adds columns with correct defaults
- [ ] Existing coordinator schedules fire to coordinator after migration
- [ ] New agent creates schedule, receives prompt in its own tmux
- [ ] Killing an agent's tmux session disables its schedules
- [ ] Non-coordinator can only see/manage own schedules
- [ ] Coordinator can manage any agent's schedules
- [ ] `auto-develop` scheduleCheck still works
- [ ] `npm run build` exits 0, `npm test` passes
