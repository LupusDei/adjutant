# QA Review: Agent Role Taxonomy (adj-062)

**Reviewer**: qa-sentinel
**Date**: 2026-03-09
**Status**: Complete

---

## Spec Findings

### S1 [CRITICAL] — Debounce behavior change when using excludeRoles on idle-proposal-nudge

The current `idle-proposal-nudge` behavior processes ALL `agent:status_changed` events, including for coordinators. When a coordinator transitions to non-idle (e.g., "working"), it enters `act()` and clears the debounce key via `state.setMeta(...)`. The coordinator check (`COORDINATOR_IDS.has(agentId)`) only fires AFTER the debounce-clear logic.

**Current flow for coordinator "adjutant-core" going working → idle → working:**
1. `shouldAct()` returns true (for all `agent:status_changed`)
2. `act()` fires: status != "idle" → clears debounce key → returns
3. Later, idle event: `act()` fires: status == "idle" → `COORDINATOR_IDS.has("adjutant-core")` → returns (skipped)
4. Later, working event: `act()` fires: clears debounce key again → returns

**Proposed flow with `excludeRoles: ["coordinator"]`:**
1. `excludeRoles` guard in `dispatchEvent()` skips the behavior entirely for coordinator agents
2. Debounce key is NEVER cleared for coordinators
3. This is functionally equivalent since coordinators never schedule checks anyway — the debounce key for a coordinator would never be set

**Verdict**: Actually safe. The debounce key for a coordinator is never set (step 3 above prevents it), so never clearing it is a no-op. BUT the existing test "still clears debounce key when coordinator transitions to non-idle" (line 280 in idle-proposal-nudge.test.ts) will need to be REMOVED or adjusted. The test asserts a behavior that will no longer occur — this is not a bug, but engineers need to know the test will break.

---

### S2 [CRITICAL] — Event data shape inconsistency: `data.agent` vs `data.agentId`

The `excludeRoles` guard in `dispatchEvent()` needs to extract the agent ID from the event data to look up the agent's role. But different events use different field names:

| Event | Agent ID field | Type source |
|-------|---------------|-------------|
| `agent:status_changed` | `data.agent` | `AgentStatusEvent` |
| `mcp:agent_connected` | `data.agentId` | `McpAgentConnectedEvent` |
| `mcp:agent_disconnected` | `data.agentId` | `McpAgentDisconnectedEvent` |
| `bead:created` | N/A (no agent field) | `BeadCreatedEvent` |
| `mail:received` | `data.from` / `data.to` | loose typing |
| `build:failed` | varies | `BuildFailedEvent` |
| Cron tick events | `data.cronTick: true`, no agent | synthetic |

**The spec does not define how to extract the agent ID from arbitrary event data.** The plan says the dispatch logic "already has access to the event's agent ID" but this is wrong — the dispatcher receives `BehaviorEvent { name, data, seq }` where `data` is typed as `unknown`.

**Recommendation**: The `dispatchEvent` implementation needs a helper function like `extractAgentId(event: BehaviorEvent): string | null` that checks `data.agent`, then `data.agentId`, then returns null. When null is returned, the `excludeRoles` guard should be skipped (spec says this in edge cases section, but the implementation detail is missing from the plan).

---

### S3 [IMPORTANT] — communication.ts migration is architecturally questionable (T008)

The spec says to "replace hardcoded ADJUTANT_AGENT_ID with role-based lookup" in communication.ts. But `ADJUTANT_AGENT_ID` is used as a **sender identity**, not a filter:

```typescript
const ADJUTANT_AGENT_ID = "adjutant-core";
// Used in:
store.insertMessage({ agentId: ADJUTANT_AGENT_ID, ... })
wsBroadcast({ from: ADJUTANT_AGENT_ID, ... })
```

This is the identity of "who is sending this message." Replacing it with `state.getAgentsByRole("coordinator")` creates multiple problems:

1. **Multiple coordinators**: If there are 2+ coordinators, which one's ID do you use as the sender?
2. **No coordinators connected**: At startup, before any coordinator connects, `getAgentsByRole("coordinator")` returns empty. Messages can't be sent.
3. **Dependency inversion**: `CommunicationManager` currently has no dependency on `AdjutantState`. Adding one creates a circular risk since state-store functions call `comm.queueRoutine()` indirectly via behaviors.
4. **Unnecessary coupling**: The value "adjutant-core" is a constant that identifies the system agent. It doesn't need to be "discovered" — it IS the system identity.

**Recommendation**: Keep `ADJUTANT_AGENT_ID` as a constant in communication.ts. Instead, export it so other files can import it (or create a shared `KNOWN_COORDINATOR_IDS` constant for the role inference in T003). T008 should be reconsidered or descoped.

---

### S4 [IMPORTANT] — signal-aggregator migration adds unnecessary dependency (T007)

The `SignalAggregator` is currently a standalone event classifier with no dependencies on the state store. The spec proposes replacing:
```typescript
const ADJUTANT_IDS = new Set(["adjutant-coordinator", "adjutant", "adjutant-core"]);
```
with `state.isCoordinator(to)`.

Issues:
1. **Constructor change**: `SignalAggregator` currently takes no constructor args. Adding `AdjutantState` changes its API and requires updating all call sites and tests.
2. **Testability regression**: Currently, signal-aggregator tests don't need to mock the state store. After migration, every test needs a mock state with `isCoordinator()`.
3. **Classification vs. policy**: The aggregator's use of `ADJUTANT_IDS` is for classifying "is this a message TO the adjutant system" — it's about message routing semantics, not role-based policy. Using a role query here conflates two concerns.
4. **Runtime overhead**: `isCoordinator()` hits SQLite on every `mail:received` event. The current `Set.has()` is O(1) in-memory.

**Recommendation**: Either (a) keep the constant but import it from a shared location like `known-agents.ts`, or (b) pass a simple `isSystemAgent: (id: string) => boolean` function to the constructor instead of the full state store. Option (a) is simpler.

---

### S5 [IMPORTANT] — Missing edge case: agent role changes mid-session

The spec says role is inferred on connect via `agent-lifecycle.ts`. But what if:
1. Agent "stetmann" connects and gets role="worker" (default)
2. A new hardcoded coordinator ID list is deployed that includes "stetmann"
3. Server restarts — now on next connect, "stetmann" gets role="coordinator"
4. Between restart and reconnect, all behaviors still treat "stetmann" as worker

This is probably acceptable for now, but the spec should explicitly state: **Roles are assigned at connect time and are immutable until the next connect.** Without this, someone might expect `isCoordinator()` to always reflect the latest config.

---

### S6 [IMPORTANT] — SC-001 is incomplete: hardcoded coordinator IDs also exist in other files

The spec says SC-001 is "Zero hardcoded coordinator ID sets remain in behavior files." But grep reveals:

- `behaviors/health-monitor.ts:29` — hardcoded `target: "adjutant-coordinator"`
- `behaviors/self-improver.ts:96` — hardcoded `author: "adjutant-core"`

These are identity references (who is the health monitor targeting, who authored a proposal), not filter guards. They're different from the COORDINATOR_IDS/ADJUTANT_IDS patterns. But SC-001 says "behavior files" which would include these.

**Recommendation**: Clarify SC-001 to say "Zero hardcoded coordinator ID *filter sets*" or explicitly scope it to the 3 files in the migration plan. Otherwise an engineer could interpret it as needing to migrate health-monitor.ts and self-improver.ts too.

---

### S7 [MINOR] — Spec says 3 roles but only 2 matter

FR-001 defines roles: "coordinator", "worker", "qa". But:
- No behavior uses `excludeRoles: ["qa"]` or checks for QA role
- No edge case tests QA role behavior
- The role inference in T003 only distinguishes coordinator vs. default (worker)
- QA agents would just be workers with a label

This isn't a bug — having the type defined for future use is fine. But the acceptance scenarios should include a test like: "agent with role=qa is NOT excluded by `excludeRoles: ['coordinator']`" to confirm QA and coordinator are truly independent.

---

### S8 [MINOR] — SQLite migration: ALTER TABLE for role column needs DEFAULT

The plan mentions `ALTER TABLE adjutant_agent_profiles ADD COLUMN role`. SQLite `ALTER TABLE ADD COLUMN` requires a DEFAULT clause for tables that already have rows. If the migration runs on a database with existing agent profiles, the column will be NULL unless a DEFAULT is specified.

The spec says FR-005: "Agents without explicit role MUST default to 'worker'". So the migration SQL should be:
```sql
ALTER TABLE adjutant_agent_profiles ADD COLUMN role TEXT NOT NULL DEFAULT 'worker';
```

If the implementer forgets `DEFAULT 'worker'`, existing profiles will have `role = NULL` and `isCoordinator()` could behave incorrectly.

---

### S9 [MINOR] — No test coverage for cron/scheduled behavior events with excludeRoles

The `dispatchEvent` function is called both from EventBus events AND from cron interval ticks. Cron events have synthetic data: `{ cronTick: true, behavior: "..." }` with no agent ID. The spec says "when event has no agent ID, skip role check, let behavior run" — but no test verifies this for scheduled behaviors hitting the excludeRoles guard.

---

## Code Review Findings

### C1 [CRITICAL] — dispatchEvent has no access to agent role information

Looking at `adjutant-core.ts` line 122-142, `dispatchEvent()` receives:
- `event: BehaviorEvent` (contains `data: unknown`)
- `behaviors: AdjutantBehavior[]`
- `state: AdjutantState`
- `comm: CommunicationManager`

The state store is available, but the function currently doesn't extract agent IDs from events at all. The implementer needs to:
1. Extract agent ID from heterogeneous event data shapes (see S2)
2. Look up the role via `state.getAgentProfile(agentId)?.role`
3. Check against `behavior.excludeRoles`

This is all doable but more complex than the plan implies. The plan says "the dispatch logic already has access to the event's agent ID" — this is misleading because `data` is typed `unknown` and requires shape detection.

---

### C2 [IMPORTANT] — upsertAgentProfile INSERT statement doesn't include role column

In `state-store.ts` line 157-160, the INSERT statement has 10 columns:
```sql
INSERT INTO adjutant_agent_profiles (agent_id, last_status, ..., last_epic_id)
VALUES (?, ?, ...)
```

After adding the `role` column, BOTH the INSERT and UPDATE statements need to be updated. The UPDATE statement (line 162-168) also needs the role column. The `rowToProfile()` function (line 109-122) needs to map `row.role` to `profile.role`. The `AgentProfileRow` interface needs `role`. The `AgentProfile` interface needs `role`.

This is a lot of coordinated changes in state-store.ts. Missing any one of them causes:
- INSERT without role → uses DEFAULT, acceptable
- UPDATE without role → role gets reset to DEFAULT on every profile update (BUG)
- rowToProfile without role → role is silently dropped from query results (BUG)

**Recommendation**: The tasks should explicitly enumerate all the places in state-store.ts that need updating, not just "add role field to AgentProfile."

---

### C3 [IMPORTANT] — prepared statements are created at module init, not per-query

In `state-store.ts`, all `db.prepare()` calls happen when `createAdjutantState()` is called (line 148+). If the ALTER TABLE migration runs AFTER these statements are prepared, the prepared statements won't include the new `role` column.

However, looking at how migrations work — they run on server startup before the state store is created — this is probably fine. But if someone ever runs migrations in a different order, the statements would be stale.

**Recommendation**: Verify the migration runs before `createAdjutantState()` is called. Add a comment noting this dependency.

---

### C4 [MINOR] — idle-proposal-nudge test references an event that won't match triggers

The test file has a `makeDisconnectedEvent` helper (line 87-93) that creates an `mcp:agent_disconnected` event. But this event is never used in any test. This is a harmless artifact but worth noting — it's a dead code smell.

---

## Recommendations Summary

| # | Severity | Action |
|---|----------|--------|
| S1 | Critical | Document that test line 280 in idle-proposal-nudge.test.ts must be updated. Not a bug, but a known test breakage. |
| S2 | Critical | Add `extractAgentId()` helper spec to plan. Without it, excludeRoles can't work. |
| S3 | Important | Reconsider T008 (communication.ts migration). Keep ADJUTANT_AGENT_ID as constant. |
| S4 | Important | Reconsider T007 (signal-aggregator migration). Use shared constant or injected function, not full state store. |
| S5 | Important | Document that roles are immutable between connections. |
| S6 | Important | Clarify SC-001 scope to avoid confusion with identity references in other behaviors. |
| S7 | Minor | Add acceptance test for QA role not being excluded by coordinator filter. |
| S8 | Minor | Ensure migration SQL includes `DEFAULT 'worker'`. |
| S9 | Minor | Add test for cron events passing through excludeRoles guard unblocked. |
| C1 | Critical | Plan must specify how agent ID is extracted from heterogeneous event data. |
| C2 | Important | Enumerate all state-store.ts changes (INSERT, UPDATE, row mapper, interfaces). |
| C3 | Important | Verify migration order guarantees prepared statements see new column. |
| C4 | Minor | Clean up unused makeDisconnectedEvent in test file. |
