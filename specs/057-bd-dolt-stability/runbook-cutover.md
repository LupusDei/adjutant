# Runbook: Adjutant Dolt live cutover (adj-182.1.7 / T007)

**Epic**: `adj-182` · **Spec**: `specs/057-bd-dolt-stability/spec.md` (US1) ·
**Plan**: `specs/057-bd-dolt-stability/plan.md`

This runbook migrates the **running adjutant project** from a bd-managed,
ephemeral-port Dolt server to a **supervised, pinned-port** server with beads in
**externally-managed** mode — with **no data loss** and the backend re-init'd on
the pinned port.

> ## OPERATOR-ONLY — DO NOT SELF-EXECUTE
>
> The live cutover stops and restarts the one shared Dolt server backing **every
> agent on this project** (~14 live at peak). It is a deliberate, coordinated
> **operator** action, owned by the coordinator (**karax**) and validated with
> **raynor**. No engineer agent runs it as part of normal task work.
>
> The orchestration codepath `doltLiveCutover()`
> (`cli/lib/dolt-supervisor.ts`, adj-182.1.6) is exercised in CI **only via
> injected seams** — never against the live server. There is exactly ONE
> acceptable live run, gated by this runbook.

---

## 0. Preconditions

- [ ] Phase 1 code merged to `main`: port registry (`adj-182.1.1`), pin writer
      (`adj-182.1.2`), supervisor generator (`adj-182.1.3`), `installSupervisor()`
      + `scripts/install-dolt-supervisor.sh` (`adj-182.1.4`), bd-doctor
      kickstart/rogue-kill (`adj-182.1.5`), `doltLiveCutover()` (`adj-182.1.6`).
- [ ] `dolt` binary located: `which dolt` (expected `/usr/local/bin/dolt`).
- [ ] You are on macOS with `launchctl` available (`launchctl print gui/$(id -u)`
      succeeds). On Linux substitute the `systemctl --user` equivalents
      (Phase 4 / `renderSystemdUnit`).
- [ ] No deploy/merge train in flight; coordinator has paused new agent spawns.
- [ ] A current Dolt backup exists (see Step 1).
- [ ] `project_id` is present in `.beads/metadata.json` (the supervisor label is
      `com.adjutant.dolt.<project_id>`):
      ```bash
      grep project_id .beads/metadata.json
      ```

## 1. Quiesce + back up (no destructive action yet)

1. Coordinator announces a brief beads freeze and pauses agent spawns.
2. Snapshot the current state so the cutover is reversible:
   ```bash
   bd dolt status                     # record current port + (managed) state
   cat .beads/dolt-server.port        # record the CURRENT ephemeral port
   cp -r .beads/backup .beads/backup.pre-cutover.$(date +%s)   # if present
   ```
3. Verify reads work right now so any post-cutover failure is unambiguous:
   ```bash
   bd list >/dev/null && echo "bd OK pre-cutover"
   ```

`doltLiveCutover()` performs an internal quiesce as its FIRST step; this manual
quiesce is the human-coordinated freeze around it.

## 2. Allocate + pin the stable port + install the supervisor (idempotent)

The pinned port is allocated once from band **17000–17999** and persisted in
`~/.adjutant/projects.json` (`doltPort`). It is written into the three places
beads actually reads:

- `.beads/metadata.json` → `dolt_server_port`
- `.beads/dolt/config.yaml` → `listener.port`
- project env → `BEADS_DOLT_SERVER_PORT`

Setting `dolt_server_port` puts beads into **externally-managed** mode
(`IsAutoStartDisabled()` true) — bd connects, never spawns/kills. The thin
entrypoint does allocate + pin + write-plist + `launchctl bootout`→`bootstrap` +
SQL-probe verify in one idempotent step (`installSupervisor()`, adj-182.1.4):

```bash
./scripts/install-dolt-supervisor.sh           # allocate+pin+plist+load+verify (idempotent)
grep dolt_server_port .beads/metadata.json     # EXPECT: the pinned port (17000–17999)
grep -A1 listener .beads/dolt/config.yaml      # EXPECT: port: <pinned>
launchctl print gui/$(id -u)/com.adjutant.dolt.$(grep -o '"project_id"[^,]*' .beads/metadata.json | sed -E 's/.*: *"?([^",}]+).*/\1/')
```

`install-dolt-supervisor.sh` exits non-zero if the supervised server does not
verify on the pinned port — in that case STOP and go to Step 5 (rollback).

## 3. The cutover sequence (`doltLiveCutover()`)

`doltLiveCutover()` (`cli/lib/dolt-supervisor.ts`, adj-182.1.6) enforces this
exact order and **aborts before touching the backend if the supervised server
fails its SQL probe**:

1. **Quiesce** — pause writes (coordinator freeze, Step 1).
2. **Stop the lazy/managed server** — the old bd-spawned server on the ephemeral
   port is shut down cleanly. (Clean exit; the supervised LaunchAgent is a
   *different label*, so its `KeepAlive` does not fight this shutdown.)
3. **Start the supervised server on the pinned port** — `launchctl bootstrap`
   (or `kickstart -k`) the LaunchAgent `com.adjutant.dolt.<projectId>`, which runs
   `dolt sql-server --config <.beads/dolt/config.yaml>` on the pinned port.
4. **SQL probe gate** — `SELECT 1`/TCP connect against the **pinned port** (never
   the PID — the #2670 fix). **If the probe FAILS: ABORT. Do NOT clear circuit
   files. Do NOT re-init the backend.** Roll back (Step 5). This abort is enforced
   in code and covered by `dolt-live-cutover.test.ts`.
5. **Clear stale circuit files** — `rm -f /tmp/beads-dolt-circuit-*.json` so bd
   stops failing fast against the dead ephemeral port. Only reached after the
   probe passes.
6. **Trigger backend re-init** — the backend re-reads the pinned endpoint and
   reconnects (Phase 2 reconnecting bd-client, `adj-182.2.4`/`.2.5`). **Until
   Phase 2 lands, restart the backend process manually** after this step.

### How the operator drives the sequence today

`doltLiveCutover()` is a tested library function with injected seams; a
first-class `adjutant dolt cutover` CLI command is **not** part of Phase 1
(it is wired in a later phase). For the one coordinated live run, the operator
drives the equivalent steps explicitly — each maps 1:1 to a `doltLiveCutover()`
step and the same SAFETY-ABORT gate applies:

```bash
# 1. Quiesce: coordinator freeze (Step 1) is the quiesce.

# 2. Stop the lazy/managed server (record the ephemeral PID/port first):
bd dolt stop || true                 # or kill the recorded ephemeral PID cleanly

# 3 + 4. Start supervised on the pinned port AND verify (single idempotent step):
./scripts/install-dolt-supervisor.sh
#   → exits non-zero (ABORT) if the SQL probe fails. STOP here and roll back.

# 5. Clear stale breaker files (ONLY after the probe passed in step 3+4):
rm -f /tmp/beads-dolt-circuit-*.json

# 6. Re-init the backend (manual until Phase 2 reconnecting bd-client lands):
#    restart the adjutant backend process so it re-reads the pinned endpoint.
```

> When the `adjutant dolt cutover` command ships (later phase), replace the
> manual block above with the single invocation; the ordering + abort semantics
> are identical because they call the same `doltLiveCutover()`.

## 4. Verify (acceptance — record results in Step 6)

```bash
bd dolt status                       # EXPECT: running (external) on the pinned port
cat .beads/dolt-server.port          # EXPECT: == pinned port (17000–17999)
bd list >/dev/null && echo OK        # EXPECT: works within seconds, no breaker error
ls /tmp/beads-dolt-circuit-*.json    # EXPECT: none (cleared) or freshly closed
pgrep -fa 'dolt sql-server'          # EXPECT: exactly ONE for this data-dir
```

Then the two hardening checks from the US1 acceptance criteria:

- **Forced kill**: `kill -9` the supervised `dolt sql-server` PID, wait a few
  seconds; launchd `KeepAlive{Crashed:true}` restarts it; `bd list` recovers,
  **port unchanged**, no breaker error.
- **Sleep/wake**: `pmset sleepnow` (or close the lid), wake, run `bd list`;
  recovers within seconds, **port unchanged**, no breaker error.

## 5. Rollback (if Step 2/3 probe fails or Step 4 regresses)

The cutover is designed to be safe-by-abort: a failed probe leaves the backend
untouched and circuit files intact.

1. Boot out the supervised agent:
   ```bash
   launchctl bootout gui/$(id -u)/com.adjutant.dolt.<projectId> || true
   ```
2. Remove the pin to fall back to bd-managed mode (restore from the snapshot):
   ```bash
   # restore metadata.json / config.yaml from .beads/backup.pre-cutover.* if needed
   ```
3. Let bd respawn its own server, confirm `bd list` works, and notify the
   coordinator. File a bug bead against `adj-182.1` with the probe failure logs
   (`.beads/dolt-server.log`).

**NEVER delete `.dolt/**/LOCK`.** Double-open of the data-dir risks corruption;
single-instance is enforced by the launchd singleton + `.beads/dolt-server.lock`.

## 6. Acceptance validation record

> **TBD — populated at the live run.** The live cutover is the **operator-only**
> step coordinated with **karax** (validated with **raynor**); it has NOT been
> executed as of this runbook landing (Phase 1). Fill this table in at the
> coordinated live run and commit it alongside this runbook. Record date,
> operator, `projectId`, and the allocated pinned port.

| Check | Expected | Result | Notes |
|---|---|---|---|
| `bd dolt status` | `running (external)` on pinned port | _TBD_ | |
| `.beads/dolt-server.port` == pinned | yes | _TBD_ | pinned port: _TBD_ |
| `bd list` post-cutover | works, no breaker | _TBD_ | |
| Exactly one `dolt sql-server` for data-dir | yes | _TBD_ | |
| Forced `kill -9` → recovery | `bd list` recovers, port unchanged | _TBD_ | |
| Sleep/wake → recovery | `bd list` recovers, port unchanged | _TBD_ | |
| Backend reconnect (no manual restart, Phase 2) | auto | _TBD_ | |

Date: _TBD_ · Operator: _TBD_ · projectId: _TBD_ · pinned port: _TBD_
