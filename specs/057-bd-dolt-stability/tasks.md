# Tasks: Permanent fix for recurring bd/dolt outages

**Root epic**: `adj-182` · **Spec**: `specs/057-bd-dolt-stability/`

Legend: `[P]` = parallelizable (different files, no dep). `[US#]` = user story. Bead IDs in beads-import.md.
Every implementation task is TDD-shaped (Shape A split, or Shape B single with explicit RED→GREEN).

## Phase 1 — Stop the bleeding (US1, `adj-182.1`)

- [ ] T001a [P] [US1] Write failing tests for the dolt port registry in
      `backend/tests/unit/dolt-port-registry.test.ts` (cli lib tested from backend vitest):
      allocate first-free port in 17000–17999 per projectId, persist `doltPort` to
      `~/.adjutant/projects.json` (use a temp registry path seam), idempotent re-read,
      collision-avoidance across two projects, band-exhaustion error. Confirm RED.
- [ ] T001b [US1] Implement `cli/lib/dolt-port-registry.ts` (`allocateDoltPort`, `getDoltPort`,
      seam for registry path) until T001a is GREEN. No paths beyond what tests require.
- [ ] T002a [US1] Write failing tests for the pin writer in
      `backend/tests/unit/dolt-pin.test.ts`: writes `dolt_server_port` to a temp
      `.beads/metadata.json`, `listener.port` to a temp `.beads/dolt/config.yaml` (preserving
      other keys), returns the `BEADS_DOLT_SERVER_PORT` export line, idempotent. Confirm RED.
- [ ] T002b [US1] Implement `cli/lib/dolt-pin.ts` (`pinDoltPort`) until T002a is GREEN. Depends on T001.
- [ ] T003a [P] [US1] Write failing tests for the supervisor generator in
      `backend/tests/unit/dolt-supervisor-gen.test.ts`: `renderLaunchdPlist({label,doltBin,configPath,
      workingDir,logPath})` emits valid plist with `KeepAlive{Crashed:true,SuccessfulExit:false}`,
      `RunAtLoad`, correct `ProgramArguments`/`WorkingDirectory`; `renderSystemdUnit(...)` emits a
      `--user` unit. Confirm RED.
- [ ] T003b [US1] Implement the generators in `cli/lib/dolt-supervisor.ts` until T003a is GREEN.
- [ ] T004a [US1] Write failing tests for `installSupervisor()` orchestration in
      `backend/tests/unit/dolt-supervisor-install.test.ts` (inject exec + fs seams): pins port (T002),
      writes plist (T003), sets externally-managed (`dolt_server_port` present), and the install
      sequence is bootout→bootstrap (idempotent); verifies via an injected SQL-probe. Confirm RED.
- [ ] T004b [US1] Implement `installSupervisor()` in `cli/lib/dolt-supervisor.ts` until T004a is GREEN.
      Depends on T002b, T003b.
- [ ] T004c [setup] [US1] Add thin entrypoint `scripts/install-dolt-supervisor.sh` that calls the CLI
      `installSupervisor` path (no logic of its own).
- [ ] T005a [P] [US1] Write failing regression tests in `backend/tests/unit/bd-doctor.test.ts` (extend
      existing suite, reuse seams `BD_DOCTOR_DOLT_OVERRIDE`/`BD_DOCTOR_INITIAL_BD_OK`/`BD_DOCTOR_SKIP_BD_VERIFY`):
      under externally-managed mode `--restart` invokes `launchctl kickstart -k` (NOT `bd dolt start`),
      and a rogue `dolt sql-server` with cwd under the data-dir that is NOT the supervised PID is
      detected and killed. Confirm RED.
- [ ] T005b [US1] Update `scripts/bd-doctor.sh` (kickstart restart path + rogue-dolt detect/kill via the
      existing lsof cwd-under-`.beads` discovery) until T005a is GREEN.
- [ ] T006a [US1] Write failing tests for `doltLiveCutover()` in
      `backend/tests/unit/dolt-live-cutover.test.ts` (inject exec/fs/backend-restart seams): enforces
      order quiesce → stop lazy server → start supervised on pinned port → clear
      `/tmp/beads-dolt-circuit-*.json` → trigger backend re-init; aborts safely if the supervised
      server fails its SQL probe (no backend restart on failure). Confirm RED.
- [ ] T006b [US1] Implement `doltLiveCutover()` in `cli/lib/dolt-supervisor.ts` until T006a is GREEN.
      Depends on T004b, T005b.
- [ ] T007 [docs] [US1] Author `specs/057-bd-dolt-stability/runbook-cutover.md` (operator steps to run
      the adjutant live-cutover) and record the acceptance validation result (forced-kill + sleep/wake
      → `bd list` recovers, port unchanged, no breaker error).

## Phase 2 — Adjutant integration (US2, `adj-182.2`)

- [ ] T008a [US2] Write failing tests for `checkDolt()` in `backend/tests/unit/cli-doctor-dolt.test.ts`
      (inject probe + registry + ps/lsof seams): reports pass/fail for port-pinned, agent-loaded,
      server-reachable-via-SQL-probe (NEVER the PID — the #2670 fix), `.beads/dolt-server.port`==pinned,
      cross-project collision, and rogue-server present. Confirm RED.
- [ ] T008b [US2] Implement `checkDolt()` in `cli/commands/doctor.ts` (new check group) until T008a is GREEN.
      Reuse bd-doctor's connectivity-probe semantics.
- [ ] T009a [US2] Write failing tests for the doctor `--fix` dolt repair path in
      `backend/tests/unit/cli-doctor-fix.test.ts`: installs/loads agent, pins port, kills rogue,
      clears stale circuit files; idempotent on a healthy system. Confirm RED.
- [ ] T009b [US2] Implement the `--fix` dolt branch in `cli/commands/doctor.ts` until T009a is GREEN.
      Depends on T004b, T008b.
- [ ] T010a [US2] Write failing tests for `adjutant init` supervisor install in
      `backend/tests/unit/cli-init-dolt.test.ts` (seams): fresh init allocates+pins the port and
      installs+loads the supervisor; re-running init is idempotent. Confirm RED.
- [ ] T010b [US2] Wire supervisor install + port pin into `cli/commands/init.ts` until T010a is GREEN.
      Depends on T004b.
- [ ] T011a [P] [US2] Write failing tests for the reconnecting bd-client in
      `backend/tests/unit/bd-client-reconnect.test.ts`: on a connection failure the client RE-READS the
      pinned endpoint and reconnects with backoff (does NOT cache-once-fail-forever); the breaker resets
      on a successful reconnect; a recovered endpoint resumes without process restart. Confirm RED.
- [ ] T011b [US2] Implement reconnect-with-backoff + endpoint re-read in
      `backend/src/services/bd-client.ts` until T011a is GREEN.
- [ ] T012a [US2] Write failing tests for `ensureDoltSupervisor()` in
      `backend/tests/unit/dolt-supervisor-service.test.ts` (seams): on boot loads the agent if unloaded;
      the health loop SQL-probes on an interval and on failure kickstarts the agent AND re-inits the
      bd-client connection. Confirm RED.
- [ ] T012b [US2] Implement `backend/src/services/dolt-supervisor.ts` + boot wiring until T012a is GREEN.
      Depends on T011b.
- [ ] T013a [P] [US2] Write failing regression test in `backend/tests/unit/dolt-autocommit.test.ts`:
      with the supervised server configured `auto-commit` on, a `bd create` is immediately visible to a
      `bd list` (HEAD) read WITHOUT a manual `bd dolt commit` (mock the dolt config + bd seam). Confirm RED.
- [ ] T013b [US2] Set `behavior.autocommit`/`dolt.auto-commit` on in the generated `.beads/dolt/config.yaml`
      (supervisor config) until T013a is GREEN.

## Phase 3 — Worktree + multi-project sweep + bd upgrade (US3, `adj-182.3`)

- [ ] T014a [US3] Write failing tests for the worktree pin in
      `backend/tests/unit/provision-worktree-dolt.test.ts` (seams): provisioning a worktree exports the
      pinned `BEADS_DOLT_SERVER_PORT` from the main repo registry and asserts no stray worktree dolt
      data-dir is created. Confirm RED.
- [ ] T014b [US3] Update `scripts/provision-worktree.sh` (and any TS helper it calls) until T014a is GREEN.
      Depends on T001b.
- [ ] T015a [US3] Write failing tests for the fleet installer in
      `backend/tests/unit/fleet-install-dolt.test.ts` (seams): iterates `hasBeads` projects in
      `~/.adjutant/projects.json`, allocates+pins+installs per project, idempotent, `--dry-run` performs
      no writes and lists planned actions. Confirm RED.
- [ ] T015b [US3] Implement the fleet sweep (`cli/lib/fleet-install-dolt.ts` + `scripts/fleet-install-dolt.sh`)
      until T015a is GREEN. Depends on T004b.
- [ ] T016 [docs] [US3] Author `specs/057-bd-dolt-stability/runbook-bd-upgrade.md`: upgrade `bd`
      0.60.0 → 1.0.4 fleet-wide (avoid gated v1.0.5), verify `bd dolt status` = `running (external)` on the
      pinned port for each project, and retest issue #2073. Record results.

## Phase 4 — Remote / shared tier (US4, optional, `adj-182.4`)

- [ ] T017a [US4] Write failing tests for shared-SQL opt-in in
      `backend/tests/unit/dolt-shared-server.test.ts`: a registry `doltShared:true` flag makes the
      generator bind `0.0.0.0:<PORT>` and emit `bd dolt set host/port` config + a Dolt user; default
      (flag absent) stays `127.0.0.1`. Confirm RED.
- [ ] T017b [US4] Implement the shared-SQL branch in `cli/lib/dolt-supervisor.ts` until T017a is GREEN.
- [ ] T018a [US4] Write failing tests for the systemd `--user` unit generator + doctor degradation in
      `backend/tests/unit/dolt-systemd.test.ts`: `renderSystemdUnit()` is valid; `checkDolt()` on a
      no-launchd/no-systemd host reports "supervisor not installed (manual)" rather than failing hard.
      Confirm RED.
- [ ] T018b [US4] Implement the systemd path + doctor degradation until T018a is GREEN.
- [ ] T019 [docs] [US4] Author `specs/057-bd-dolt-stability/spike-unix-socket.md`: evaluate Dolt
      `--socket` (unix-domain) transport as a port-allocation-free local tier; decide keep-TCP-default
      vs adopt-socket on bd 1.0.4 (connector socket support). Record the decision.
