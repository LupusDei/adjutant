# Plan: Permanent fix for recurring bd/dolt outages

**Root epic**: `adj-182` · **Spec**: `specs/057-bd-dolt-stability/spec.md`

## Architecture decisions

1. **Pin a stable per-project port; never let bd pick a random one.** Allocation lives in the
   existing central registry `~/.adjutant/projects.json` (new `doltPort` field), first-free in band
   **17000–17999**, persisted forever. Applied to three places beads actually reads (NOT global
   `~/.config/bd/config.yaml` — issue #2073 ignores it):
   - `.beads/metadata.json` → `dolt_server_port`
   - `.beads/dolt/config.yaml` → `listener.port`
   - project env → `BEADS_DOLT_SERVER_PORT`
2. **Externally-managed mode** (explicit `dolt_server_port` ⇒ beads `IsAutoStartDisabled()` true) so
   bd connects instead of spawning/killing — eliminates ephemeral-port churn at the source.
3. **One supervised server per project** via launchd LaunchAgent (macOS) / systemd --user (Linux),
   `KeepAlive{Crashed:true,SuccessfulExit:false}` + a SQL health-probe (`SELECT 1`), single-instance
   enforced by `.beads/dolt-server.lock` flock + PID (Dolt does not block double-open → corruption risk).
4. **Reconnecting client** (raynor A): backend bd-client re-reads the pinned endpoint with backoff;
   `ensureDoltSupervisor()` re-inits the connection on probe failure — file repair alone is insufficient.
5. **Self-healing surfaces**: `adjutant doctor` (`checkDolt()` + `--fix`), `adjutant init`, backend boot.
6. **Layering**: port-allocator + pin + plist/unit generators are pure, unit-tested functions in `cli/lib/`
   (and shared with backend). Shell scripts (`install-dolt-supervisor.sh`, extended `bd-doctor.sh`) wrap them.
   Backend logic in `backend/src/services/` (bd-client + a new dolt-supervisor service). CLI checks in `cli/commands/doctor.ts`.

## Key file paths

- `cli/lib/dolt-port-registry.ts` (NEW) — allocate/read/persist `doltPort` in `~/.adjutant/projects.json`.
- `cli/lib/dolt-pin.ts` (NEW) — write pinned port into metadata.json + dolt/config.yaml; emit env.
- `cli/lib/dolt-supervisor.ts` (NEW) — generate launchd plist / systemd unit; install/load/kickstart helpers (pure gen + thin exec).
- `cli/commands/doctor.ts` (EDIT) — add `checkDolt()` group + `--fix` repair path.
- `cli/commands/init.ts` (EDIT) — install supervisor + pin port during init.
- `backend/src/services/bd-client.ts` (EDIT) — reconnect-with-backoff, re-read pinned endpoint, breaker reset.
- `backend/src/services/dolt-supervisor.ts` (NEW) — `ensureDoltSupervisor()` + health/self-heal loop on boot.
- `scripts/install-dolt-supervisor.sh` (NEW) — idempotent install/load + externally-managed + start + probe.
- `scripts/bd-doctor.sh` (EDIT) — `--restart` → `launchctl kickstart -k`; rogue-dolt detect+kill.
- `scripts/provision-worktree.sh` (EDIT) — export pinned port; ensure no stray worktree dolt dir.
- `scripts/fleet-install-dolt.sh` (NEW) — sweep all `hasBeads` projects in the registry (dry-run supported).

## Phases (= sub-epics)

### Phase 1 — Stop the bleeding (`adj-182.1`, P1, MVP)
Port allocator + registry `doltPort`; pin (metadata.json/config.yaml/env); launchd plist generator;
`install-dolt-supervisor.sh`; externally-managed mode; `bd-doctor.sh` → kickstart + rogue-kill;
live-cutover runbook+script for adjutant incl. backend restart. **Validated on adjutant first.**

### Phase 2 — Adjutant integration (`adj-182.2`, P1)
`checkDolt()` in `adjutant doctor` + `--fix`; `adjutant init` installs supervisor; backend
`ensureDoltSupervisor()` + health loop; reconnecting bd-client; Dolt `auto-commit` on.

### Phase 3 — Worktree + multi-project sweep + bd upgrade (`adj-182.3`, P2)
`provision-worktree.sh` wiring; `fleet-install-dolt.sh` across the registry; `bd` 0.60.0 → 1.0.4 fleet-wide + verify.

### Phase 4 — Remote / shared tier (`adj-182.4`, P3, optional)
Shared-SQL opt-in via registry flag; Linux systemd --user unit; unix-domain-socket evaluation spike.

## Parallelism
- P1 tasks `1.1` (registry) and `1.3` (plist generator) are independent `[P]`. `1.2` (pin) depends on `1.1`.
  `1.4` (installer) depends on `1.2`+`1.3`. `1.5` (bd-doctor) is independent `[P]`. `1.6` (cutover) depends on `1.4`+`1.5`.
- P2 depends on P1 landing. Within P2, `2.4` (bd-client) and `2.6` (auto-commit) are independent of `2.1–2.3`.
- P3 depends on P2. P4 depends on P3 and is optional.
- Concurrent engineers MUST use `isolation: "worktree"`; squad lead merges from main.

## Risks / mitigations
- bd still manages server → ensure externally-managed; verify `KillStaleServers` respects it on 1.0.4 before fleet.
- Dolt data-dir double-open corruption → flock + launchd singleton + doctor rogue-kill; never delete live `.dolt/**/LOCK`.
- Live-cutover on a running project → quiesce + ordered sequence + backend restart; adjutant-first validation.
- Port-band exhaustion → registry allocator persists per project; 1000-port band is ample.
- Non-macOS → systemd --user unit; doctor degrades to "supervisor not installed (manual)".

## Bead Map (created — 24 beads)

- `adj-182` — Root epic: Permanent fix for recurring bd/dolt outages
  - `adj-182.1` — Phase 1: Stop the bleeding
    - `adj-182.1.1` Dolt port registry + allocator  *(ready — entry)*
    - `adj-182.1.2` Pin writer (metadata/config/env)  *(← .1.1)*
    - `adj-182.1.3` Supervisor generator (plist/unit)  *(ready — entry)*
    - `adj-182.1.4` installSupervisor() + entrypoint  *(← .1.2, .1.3)*
    - `adj-182.1.5` bd-doctor kickstart + rogue-kill  *(ready — entry)*
    - `adj-182.1.6` doltLiveCutover()  *(← .1.4, .1.5)*
    - `adj-182.1.7` Cutover runbook + acceptance  *(← .1.6)*
  - `adj-182.2` — Phase 2: Adjutant integration  *(← Phase 1)*
    - `adj-182.2.1` checkDolt() health group
    - `adj-182.2.2` doctor --fix dolt repair  *(← .2.1)*
    - `adj-182.2.3` init installs supervisor
    - `adj-182.2.4` reconnecting bd-client
    - `adj-182.2.5` ensureDoltSupervisor() + health loop  *(← .2.4)*
    - `adj-182.2.6` Dolt auto-commit enabled
  - `adj-182.3` — Phase 3: Worktree + sweep + bd upgrade  *(← Phase 2)*
    - `adj-182.3.1` provision-worktree pinned port  *(← .1.1)*
    - `adj-182.3.2` fleet-install-dolt sweep  *(← .1.4)*
    - `adj-182.3.3` bd 0.60.0→1.0.4 upgrade + verify
  - `adj-182.4` — Phase 4: Remote / shared tier (optional)  *(← Phase 3)*
    - `adj-182.4.1` shared-SQL opt-in
    - `adj-182.4.2` systemd unit + degradation
    - `adj-182.4.3` unix-socket spike

Entry points (run `bd ready`): `adj-182.1.1`, `adj-182.1.3`, `adj-182.1.5`.
