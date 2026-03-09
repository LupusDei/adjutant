# Implementation Plan: Spawn Verification Pipeline

**Branch**: `038-spawn-verification` | **Date**: 2026-03-09
**Epic**: `adj-061` | **Priority**: P1

## Summary

Add a spawn health check pipeline that detects when agents fail to connect via MCP after being spawned. The system schedules a 30-second timer after each successful spawn, cancels it when the agent connects via MCP, and emits a `spawn_failed` event if the timer expires. The signal aggregator classifies this as CRITICAL so the stimulus engine notifies the coordinator.

## Bead Map

- `adj-061` - Root: Spawn Verification Pipeline
  - `adj-061.1` - US1: Spawn Health Detection
    - `adj-061.1.1` - Add SpawnFailed event type to event bus
    - `adj-061.1.2` - Implement spawn health check timer in agent-spawner-service
    - `adj-061.1.3` - Wire MCP agent_connected to cancel health check timer
    - `adj-061.1.4` - Tests for spawn health check lifecycle
  - `adj-061.2` - US2: Spawn Failure Recovery
    - `adj-061.2.1` - Classify spawn_failed as CRITICAL in signal aggregator
    - `adj-061.2.2` - Tests for signal classification and stimulus integration

## Technical Context

**Stack**: TypeScript, Node.js, Express, EventBus (custom)
**Storage**: N/A (in-memory timers + existing state store)
**Testing**: Vitest
**Constraints**: Must not block spawn_worker return; timer must be non-blocking

## Architecture Decision

Use the existing EventBus pub/sub pattern rather than polling. The `mcp:agent_connected` event already fires when agents connect — we just need to wire it to cancel a pending health check timer. This avoids adding any new polling mechanisms and keeps the system reactive.

The health check timer lives in `agent-spawner-service.ts` (co-located with spawn logic) rather than in a new service, to keep the spawn lifecycle self-contained.

## Files Changed

| File | Change |
|------|--------|
| `backend/src/services/event-bus.ts` | Add `SpawnFailedEvent` type and `agent:spawn_failed` to EventMap |
| `backend/src/services/agent-spawner-service.ts` | Add health check timer after spawn, cancel on MCP connect |
| `backend/src/services/adjutant/signal-aggregator.ts` | Add `agent:spawn_failed` → CRITICAL classification |
| `backend/tests/unit/spawn-health-check.test.ts` | Tests for timer lifecycle (schedule, cancel, expire) |
| `backend/tests/unit/signal-aggregator.test.ts` | Tests for spawn_failed classification |

## Phase 1: US1 - Spawn Health Detection (MVP)

1. Add `SpawnFailedEvent` to event-bus.ts EventMap (small type addition)
2. In agent-spawner-service.ts, after successful `spawnAgent()`:
   - Store a `setTimeout(30_000)` keyed by agent name in a `Map<string, NodeJS.Timeout>`
   - Subscribe to `mcp:agent_connected` — when the agent name matches, clear the timer
   - If timer fires, emit `agent:spawn_failed` with `{ agentId, reason: "no_mcp_connect" }`
3. Write comprehensive tests with fake timers

## Phase 2: US2 - Spawn Failure Recovery

1. Add `agent:spawn_failed` case to signal-aggregator's `classify()` method → CRITICAL
2. Verify stimulus engine picks up the signal (it already processes CRITICAL signals)
3. Write tests for classification

## Parallel Execution

- Phase 1 tasks are sequential (event type → timer logic → MCP wiring → tests)
- Phase 2 depends on Phase 1 (needs the event type to exist)
- Within Phase 2, classification + tests can be done together

## Verification Steps

- [ ] Spawn an agent in test, verify timer is scheduled
- [ ] Mock MCP connect event, verify timer is cancelled
- [ ] Let timer expire, verify `spawn_failed` event emitted
- [ ] Verify signal aggregator classifies as CRITICAL
- [ ] All existing tests still pass (no regressions)
