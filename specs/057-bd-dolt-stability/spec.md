# Spec: Permanent fix for recurring bd/dolt outages

**Feature dir**: `specs/057-bd-dolt-stability/`
**Root epic**: `adj-182`
**Source**: accepted engineering proposal `101fb42c` (author karax, reviewed/endorsed by raynor)
**Priority**: P1 (critical — recurring outages block every agent in every project)

## Problem

`bd` becomes unusable for minutes at a time across all projects:
```
dolt circuit breaker is open: server appears down, failing fast (cooldown 5s)
failed to open database: ... server appears down
```
Agents can't self-assign, update, or close beads. Recurs after macOS sleep and under concurrent load.

**Root cause (confirmed in beads source + reproduced live):** Since beads v0.60.0, an
unpinned Dolt server grabs a random OS-assigned ephemeral port (`net.Listen(":0")`) on every
(re)start. macOS sleep/crash/idle/`KillStaleServers` churns the port; `.beads/dolt-server.port`
and the per-host circuit-breaker file (`/tmp/beads-dolt-circuit-<host>-<port>.json`) go stale, so
`bd` fails fast against a dead port while a healthy server runs on a different port. `bd dolt status`
trusts the PID file, not connectivity. Worktrees each carry their own `.beads`. A secondary,
independently-fatal issue: the Adjutant backend's bd-client caches the endpoint at boot and never
reconnects, so the breaker stays open forever on the dead cached port. Dolt `auto-commit` defaults
OFF, so `bd create/update` land in the working set and are invisible to `bd list` (HEAD) until a
manual `bd dolt commit`.

## Goal

Exactly one **supervised** Dolt server per project, on a **stable pinned port**, with beads in
**externally-managed** mode (bd connects, never spawns/kills), a **reconnecting** backend client,
and **self-healing** via `adjutant doctor`/`init`/backend boot. Worktrees and nested clones share
the single per-project server (atomic writes; never two servers on one data-dir).

## User Stories

### US1 — Stop the bleeding (Priority: P1) — MVP
**As** an agent on an active project, **I want** a stable, supervised Dolt server on a fixed port,
**so that** `bd` never fails with "server appears down" after sleep/crash/churn.
Acceptance:
- A per-project port is allocated from a reserved band (17000–17999), persisted in
  `~/.adjutant/projects.json` (`doltPort`), and applied to `.beads/metadata.json` (`dolt_server_port`),
  `.beads/dolt/config.yaml` (`listener.port`), and the project env (`BEADS_DOLT_SERVER_PORT`).
- A macOS launchd LaunchAgent (`com.adjutant.dolt.<projectId>`, `KeepAlive{Crashed:true,SuccessfulExit:false}`,
  `RunAtLoad`) runs the one server; beads is in externally-managed mode (`bd dolt status` → `running (external)`).
- A live-cutover migrates the running adjutant project with no data loss and the backend re-inits on the pinned port.
- After a forced `dolt` kill and after macOS sleep/wake, `bd list` works within seconds, port unchanged, no breaker error.

### US2 — Adjutant self-heals (Priority: P1)
**As** the operator, **I want** `adjutant doctor`/`init`/backend boot to detect and repair dolt health,
**so that** outages auto-recover without manual `bd-doctor.sh` runs.
Acceptance:
- New `checkDolt()` in `cli/commands/doctor.ts` verifies: port pinned, agent loaded, server **reachable via SQL probe** (not PID),
  `.beads/dolt-server.port` == pinned port, no cross-project port collision, and detects/kills **rogue** dolt on the data-dir.
- `adjutant doctor --fix` installs/loads the agent, pins the port, kills rogue servers, clears stale circuit files.
- `adjutant init` installs the supervisor + pins the port (new projects correct by default).
- Backend `ensureDoltSupervisor()` loads the agent on boot and runs a health/self-heal loop; the backend
  bd-client **reconnects by re-reading the pinned endpoint** (backoff) instead of cache-once-fail-forever.
- Supervised server has Dolt `auto-commit` enabled → `bd create/update` are immediately visible to `bd list`.

### US3 — Worktrees, multi-project sweep & bd upgrade (Priority: P2)
**As** a squad lead spawning worktree agents, **I want** every worktree/clone to share the one
per-project server, **so that** writes stay atomic and no worktree spawns a rogue server.
Acceptance:
- `scripts/provision-worktree.sh` exports the pinned `BEADS_DOLT_SERVER_PORT` and ensures no stray worktree dolt data-dir.
- A fleet installer allocates+pins+supervises every `hasBeads` project in the registry (idempotent, dry-run supported).
- `bd` upgraded 0.60.0 → 1.0.4 fleet-wide (avoid gated v1.0.5); externally-managed verified on 1.0.4 (#2073 retest).
- Two concurrent agents + a worktree read/write beads with zero "server appears down" over a sustained run.

### US4 — Remote / shared tier (Priority: P3, optional)
**As** a multi-machine operator, **I want** an opt-in shared/remote Dolt option, **so that** clones
on other machines can collaborate.
Acceptance:
- Opt-in via registry flag: shared SQL server (bind `0.0.0.0:<PORT>`, `bd dolt set host/port`, Dolt user auth — atomic but networked)
  OR Dolt-native remote push/pull (offline-capable, NOT atomic across clones — documented tradeoff).
- Linux `systemd --user` unit equivalent of the launchd supervisor; doctor degrades gracefully where no supervisor exists.
- Unix-domain-socket transport (`dolt --socket`) evaluated as a port-allocation-free alternative (spike + decision).

## Out of Scope / Non-Goals
- The intermittent **ENOSPC on the sandbox filesystem** — that is sandbox-quota scope, NOT dolt; flagged separately
  to the harness/General. (Side benefit only: collapsing ~20 worktree `.beads/dolt` copies to one server data-dir reduces disk.)
- Rewriting beads itself — we configure its existing levers (`BEADS_DOLT_*`, externally-managed mode).

## Success Criteria
- Zero "circuit breaker / server appears down" incidents over a 1-week sustained multi-agent run on adjutant.
- `bd dolt status` = `running (external)` on the pinned port; `.beads/dolt-server.port` always == pinned port.
- Exactly one `dolt sql-server` per project data-dir at all times.
- Backend recovers automatically after an endpoint blip **without** a manual restart.
- `adjutant doctor` flags + `--fix` repairs unhealthy/mis-ported/colliding/rogue servers; fresh `adjutant init` healthy by default.
