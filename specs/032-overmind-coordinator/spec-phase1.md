# adj-051 Phase 1: Adjutant Coordinator Agent

> **Status**: COMPLETED
> **Epic**: adj-051 (closed)
> **Date**: 2026-03-08

## Overview

The Adjutant system required constant user input to check on agents, verify builds, confirm pushes. Phase 1 introduced an autonomous "primary coordinator" agent that spawns automatically when the backend starts and continuously monitors the system.

This was the first step in the Adjutant autonomy roadmap — transforming the system from a passive dashboard into an active coordinator.

## User Stories

### US1: Automatic Agent Spawn (Priority: P1)
**As a** user starting the Adjutant backend,
**I want** a coordinator agent to spawn automatically,
**so that** I don't have to manually start an agent to monitor my system.

**Acceptance Criteria:**
- Backend startup spawns a Claude Code agent in a tmux session
- Agent uses `.claude/agents/adjutant.md` for identity and instructions
- Agent registers with MCP and reports status on startup
- If the session already exists, skip spawn (idempotent)
- Spawn failure is non-fatal (backend continues running)

**Beads**: adj-051.1 (epic), adj-051.1.1, adj-051.1.2, adj-051.1.3

### US2: Hourly Status Reports (Priority: P1)
**As a** user with agents running,
**I want** an hourly status summary delivered to my dashboard,
**so that** I can see what's happening without manually querying each agent.

**Acceptance Criteria:**
- Cron job fires every hour
- Heartbeat prompt injected into Adjutant agent's tmux session via `tmux send-keys`
- Agent gathers state via MCP tools: `list_agents()`, `list_beads()`, `read_messages()`
- Agent compiles summary: active agents, current tasks, open beads, recent completions
- Summary delivered via `send_message({ to: "user" })` (appears in dashboard + iOS push)

**Beads**: adj-051.2 (epic), adj-051.2.1, adj-051.2.2, adj-051.2.3

### US3: Health Monitor & Recovery (Priority: P2)
**As a** user relying on the coordinator,
**I want** the system to detect and recover from coordinator crashes,
**so that** monitoring continues uninterrupted.

**Acceptance Criteria:**
- Health check runs periodically (every 5 minutes)
- Checks if Adjutant tmux session exists via `tmux list-sessions`
- If dead, respawns automatically with 10-second stabilization wait
- Logs recovery event
- Never throws — graceful degradation

**Beads**: adj-051.3 (epic), adj-051.3.1, adj-051.3.2

### US4: Stale Agent Detection (Priority: P2)
**As a** user with multiple agents working,
**I want** stale agents (no status update in 1+ hours) to be automatically nudged,
**so that** I know when agents have gone silent.

**Acceptance Criteria:**
- Agent `lastActivity` tracked per status update
- Stale threshold: 1 hour since last status change
- Nudge message sent via `send_message({ to: "<agent>" })`
- Stale agents flagged in hourly summary
- Debounce: don't nudge the same agent more than once per hour

**Beads**: Partially in adj-051.2 (heartbeat prompt instructions), formalized in adj-051.5.8

## Architecture (Original)

```
backend startup
    │
    ├── spawnAdjutant(projectRoot)     → tmux session "adj-swarm-adjutant"
    │                                     └── Claude Code + adjutant.md
    │
    └── startScheduler()               → node-cron hourly job
            │
            ├── ensureAdjutantAlive()  → health check + respawn
            └── sendHeartbeat()        → tmux send-keys prompt injection
                    │
                    └── Adjutant agent executes:
                        ├── list_agents()
                        ├── list_beads()
                        ├── send_message() to stale agents
                        └── send_message() to user (summary)
```

### Key Files (Original)

| File | Purpose |
|------|---------|
| `backend/src/services/adjutant-spawner.ts` | Spawn/health-check Adjutant tmux session |
| `backend/src/services/scheduler.ts` | node-cron hourly job + heartbeat injection |
| `.claude/agents/adjutant.md` | Agent identity and instructions |

### Known Issues Found During QA (adj-051.4)

| Bead | Issue | Severity |
|------|-------|----------|
| adj-051.4.2 | Spawner didn't pass `--agent-file` flag | P2 |
| adj-051.4.7 | No heartbeat on startup (wait up to 1 hour) | P2 |
| adj-051.4.8 | Scheduler didn't verify agent alive before heartbeat | P2 |
| adj-051.4.1 | `list_agents` missing `lastActivity` field | P2 |
| adj-051.4.3 | ADJUTANT_TMUX_SESSION constant duplicated | P3 |
| adj-051.4.4 | Scheduler single-purpose, not extensible | P3 |
| adj-051.4.5 | Spawner Adjutant-specific, can't spawn others | P3 |
| adj-051.4.9 | No "recently closed beads" in heartbeat | P3 |
| adj-051.4.10 | tmuxSendKeys duplicated tmux.ts | P3 |

**QA Verdict**: Scored 5/10 on extensibility. Triggered the adj-051.5 restructure.

## Outcome

Phase 1 delivered a working autonomous coordinator, but the architecture was tightly coupled:
- `scheduler.ts` was single-purpose (one cron job, one heartbeat)
- `adjutant-spawner.ts` was Adjutant-specific (couldn't spawn arbitrary agents)
- No event-driven reactions — everything was poll-based on the hourly cron
- No persistent state — agent profiles existed only in memory
- Health monitor was wired directly into the scheduler pre-heartbeat step

These limitations motivated the adj-051.5 restructure to an event-driven architecture.
