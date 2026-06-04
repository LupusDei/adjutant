# Runbook: Fleet upgrade bd 0.60.0 → 1.0.4 (adj-182.3.3 / T016)

**Epic**: `adj-182` · **Spec**: `specs/057-bd-dolt-stability/spec.md` ·
**Plan**: `specs/057-bd-dolt-stability/plan.md` ·
**Gates**: `adj-182.3.4` (re-enable launchd dolt supervisor) is BLOCKED on this.

> ## OPERATOR-ONLY — REQUIRES A COORDINATED FREEZE (like the live cutover)
>
> `brew upgrade beads` replaces the **one shared `bd` binary** used by **every
> agent on this machine** (~14 live at peak). The first `bd` invocation against
> each project's `.beads` after the upgrade runs a **one-time, in-place schema
> migration** (events/comments/snapshots `id` → CHAR(36) UUID, etc.). Concurrent
> agents hitting an un-migrated DB mid-upgrade is the hazard this freeze prevents.
>
> This is a deliberate, coordinated **operator** action owned by the coordinator
> (**karax**), validated with **raynor**, scheduled by the **General**. No engineer
> agent runs it as part of normal task work. Do NOT self-execute.
>
> **De-risked 2026-06-04 (raynor-prep, adj-182.3.3)** against COPIES — never the
> live DB. Findings in §7. The live upgrade itself is still UNEXECUTED.

---

## 0. Target version — and the v1.0.5 trap

| Item | Value |
|---|---|
| **Target** | **bd v1.0.4** (GitHub "Latest" / stable; honors externally-managed mode) |
| **AVOID** | **bd v1.0.5** (GitHub **pre-release**; migration `0043` can *silently and unrecoverably* break multi-machine `bd dolt` sync — upstream #4259) |
| Install mechanism | Homebrew (`brew`), formula `beads` |
| Repo | `github.com/steveyegge/beads` (redirects to `gastownhall/beads`) |

> ### ⚠️ HOMEBREW STABLE IS ALREADY 1.0.5 — `brew upgrade beads` LANDS THE BAD ONE
>
> As of 2026-06-04 `brew info beads` reports `0.60.0 → stable 1.0.5`. A plain
> `brew upgrade beads` will install **1.0.5**, NOT 1.0.4. You MUST pin to 1.0.4
> (Step 2). Re-check `brew info beads` before every run — if stable has moved to
> ≥1.0.6 with the #4259 fix, re-validate against a copy (§ de-risk) and update this
> runbook before proceeding.

---

## 1. Preconditions (per machine)

- [ ] No deploy/merge train in flight; coordinator has **paused new agent spawns**
      and announced a beads freeze for this machine.
- [ ] `which bd` → `/usr/local/bin/bd`; `bd version` → `0.60.0` (the from-version).
- [ ] `which dolt` → present. **Note its version** (`dolt version`). Our fleet runs
      dolt **1.83.5**; 1.0.4 is fine on it. (v1.0.5 reordered migrations for "Dolt
      2.0.6" — another reason to avoid 1.0.5 on older dolt.)
- [ ] A current Dolt backup exists for each project being upgraded
      (`cp -r .beads/backup .beads/backup.pre-bd104.$(date +%s)` if present).
- [ ] Record the live topology for each project:
      ```bash
      bd dolt status                 # record port + state (0.60.0 prints exit 64 — cosmetic)
      cat .beads/dolt-server.port    # record the pinned port (expect 17000–17999)
      grep -E 'dolt_server_port|project_id' .beads/metadata.json
      ```
- [ ] Note current state: adjutant is **bd-managed on pinned port 17000**, launchd
      supervisor **DISABLED** (`*.plist.disabled`). Do NOT re-enable the supervisor
      in this runbook — that is `adj-182.3.4`, gated on a successful upgrade here.

---

## 2. Upgrade `bd` to exactly 1.0.4 (NOT 1.0.5)

Pick ONE. **Verify `bd version` prints `1.0.4` before doing anything else.**

### Option A — Homebrew pinned formula (preferred IF a versioned formula exists)

```bash
# Only if a versioned formula `beads@1.0.4` is published. If NOT, use Option B —
# do NOT `brew upgrade beads` (that installs 1.0.5).
brew info beads@1.0.4 2>/dev/null && brew install beads@1.0.4 && brew link --overwrite beads@1.0.4
bd version   # MUST print 1.0.4
```

### Option B — install the official 1.0.4 release binary over the brew path

```bash
# 1. Download + checksum-verify the 1.0.4 binary for this arch (amd64 shown):
TMP=$(mktemp -d); cd "$TMP"
gh release download v1.0.4 --repo steveyegge/beads \
  --pattern 'beads_1.0.4_darwin_amd64.tar.gz' --pattern 'checksums.txt'
shasum -a 256 -c <(grep darwin_amd64 checksums.txt)   # MUST print "OK"
# Verified good 2026-06-04: 8a52f7e5...23c4ce9  beads_1.0.4_darwin_amd64.tar.gz
tar xzf beads_1.0.4_darwin_amd64.tar.gz
./bd version                                          # MUST print: bd version 1.0.4

# 2. Replace the binary brew links to (back up the old one first for rollback):
cp "$(brew --prefix)/bin/bd" /tmp/bd-0.60.0.bak
install -m 0755 ./bd "$(brew --prefix)/bin/bd"
bd version                                            # MUST print: bd version 1.0.4
```

> arm64 machines: use `beads_1.0.4_darwin_arm64.tar.gz`. Linux: the matching
> `linux_*` asset. Always checksum-verify against `checksums.txt`.

---

## 3. Per-project first-use migration + verify (one project at a time)

The first `bd` call against each `.beads` runs the migration **in place,
automatically, and idempotently**. De-risk (§7) confirmed it is non-destructive.

For EACH project (start with a low-traffic one), with agents still frozen:

```bash
cd <project>
cat .beads/.local_version            # BEFORE: expect 0.60.0
bd list                              # triggers migration; watch for "migration NNN:" lines
#   EXPECT: "migration 010: ... migrated ... successfully" (and any others), then the list
cat .beads/.local_version            # AFTER:  expect 1.0.4
```

Then confirm data integrity + CRUD on the migrated DB:

```bash
bd list | wc -l                      # count matches pre-upgrade expectation (no loss)
bd show <a-known-bead-id>            # spot-check a known bead survived intact
bd create -t task "bd-1.0.4 upgrade smoke" >/tmp/smoke && cat /tmp/smoke
bd update <that-new-id> --status in_progress
bd close  <that-new-id> --reason "upgrade smoke"
```

> **Migration is one-way.** Rolling back to 0.60.0 AFTER a project's DB has been
> migrated to the 1.0.4 schema requires restoring from the §1 backup — 0.60.0
> cannot read the 1.0.4 schema. Roll back the binary BEFORE migrating if you abort.

> **Auto-export/auto-import is ON by default in 1.x.** You will see
> `auto-importing N bytes from .beads/issues.jsonl ...` on writes — this is
> expected (the JSONL ↔ Dolt round-trip), not data loss. Durable state survives a
> server restart (verified §7).

---

## 4. THE GATE — externally-managed on 1.0.4 (re-validates adj-182.3.4)

This is the check that proves the launchd supervisor can be re-enabled. **bd 1.0.4
honors externally-managed mode — it connects to a running server and does NOT
auto-spawn a competitor `dolt sql-server -H/-P` (the 0.60.0 lock-fight is gone).**
De-risked green in §7; re-confirm live for the adjutant project:

```bash
# With the (currently bd-managed) pinned server up on 17000:
PORT=$(cat .beads/dolt-server.port)            # expect 17000

# 1. bd connects + reads/writes through the existing server, NO new process:
ps -ax -o pid,command | grep 'dolt sql-server' | grep -v grep   # snapshot BEFORE
bd list >/dev/null && echo "BD_OK"
for i in $(seq 1 10); do bd list >/dev/null; bd show <known-id> >/dev/null; done  # stress
ps -ax -o pid,command | grep 'dolt sql-server' | grep -v grep   # snapshot AFTER
#   EXPECT: exactly ONE dolt sql-server for this data-dir, SAME PID before/after.
#   FAIL if a second `dolt sql-server -H 127.0.0.1 -P <PORT>` competitor appears.

# 2. No data-dir lock conflict in the server log:
grep -iE 'lock|locked|another dolt|fatal' .beads/dolt-server.log | tail
#   EXPECT: no NEW "database ... is locked by another dolt process" lines.
```

> ### ⚠️ Do NOT trust `bd dolt status` text on 1.0.4
>
> `bd dolt status` still reports **"not running"** on 1.0.4 even when the server is
> up and bd is connecting fine — the PID-not-connectivity cosmetic (upstream #2670).
> The SQL-probe fix (`bd dolt status probes SQL when externally-managed`) only
> landed in **1.0.5** (which we avoid). **Verify functionally** via `bd list`
> success + the competitor/lock checks above, and via adjutant's own SQL probe
> (`adjutant doctor`, which calls `checkDolt`/`dolt-supervisor.ts` — connectivity,
> not PID). `running (external)` as a *status string* is NOT expected on 1.0.4.

> ### ⚠️ REQUIRED CODE FOLLOW-UP before re-enabling the supervisor (adj-182.3.4)
>
> bd 1.0.4 **deprecates `dolt_server_port` in `metadata.json`**:
> > `Warning: dolt_server_port in metadata.json is deprecated (can cause
> > cross-project data leakage). The port file (.beads/dolt-server.port) is now the
> > primary source. Remove dolt_server_port from .beads/metadata.json to silence.`
>
> Adjutant currently writes/relies on that key (`cli/lib/dolt-pin.ts`,
> `cli/lib/dolt-supervisor.ts`, `cli/commands/doctor.ts`,
> `backend/src/services/bd-client.ts`). On 1.0.4 the **`.beads/dolt-server.port`
> file is authoritative** — de-risk confirmed bd 1.0.4 connects to the external
> server using the port file alone, with no metadata pin and no deprecation noise.
> **Action (track as a new bead under adj-182.3, do it WITH or BEFORE the supervisor
> re-enable):** make `installSupervisor()` / `install-dolt-supervisor.sh` stop
> writing `dolt_server_port` to metadata, treat the port file as primary, and keep
> `doctor.ts`'s existing dual-read as the compatibility bridge. Low-risk — the port
> file already exists in the live setup; this just drops a deprecated, leakage-prone
> pin.

---

## 5. Rollback

### 5a. Binary-only rollback (project NOT yet migrated)

```bash
install -m 0755 /tmp/bd-0.60.0.bak "$(brew --prefix)/bin/bd"   # or reinstall the 0.60.0 bottle
bd version                                                       # expect 0.60.0
```

### 5b. Full rollback (project ALREADY migrated to 1.0.4 schema)

The 1.0.4 schema is NOT readable by 0.60.0. To revert:

1. Stop bd activity on the project (coordinator freeze still in effect).
2. Restore the pre-upgrade `.beads` from the §1 backup
   (`.beads/backup.pre-bd104.*` / your own `cp -r` snapshot).
3. Roll back the binary (5a).
4. `bd list` → confirms the 0.60.0 DB reads again; notify coordinator; file a bug
   bead under `adj-182.3` with `.beads/dolt-server.log` + the migration output.

**NEVER delete `.dolt/**/LOCK` or `.beads/dolt-server.lock`.** Double-open of the
data-dir risks corruption.

> ⚠️ A `bd init` or `bd dolt stop` from ANY bd version (incl. 0.60.0) may
> "clean up orphaned dolt sql-server processes" **globally** and kill the live
> bd-managed server (observed during de-risk, §7). Until the launchd supervisor is
> re-enabled (adj-182.3.4), the live server is unprotected — do rollback work in an
> isolated temp dir, never near the live `.beads`, and re-check the live server
> after (`bd list` from the project root respawns it).

---

## 6. Acceptance validation record (fill in at live execution)

| Check | Expected | Result | Notes |
|---|---|---|---|
| `bd version` after upgrade | `1.0.4` (NOT 1.0.5) | ⬜ | |
| `.local_version` per project | `0.60.0` → `1.0.4` | ⬜ | |
| Migration ran, no errors | `migration NNN: ... successfully` | ⬜ | |
| Bead count / known bead intact | no loss | ⬜ | |
| CRUD on 1.0.4 | create/update/close OK | ⬜ | |
| Externally-managed: no competitor spawn | 1 server, same PID, no lock errors | ⬜ | THE GATE (§4) |
| Backend reconnects on pinned port | `bd list` OK, no breaker | ⬜ | |

Date: ____ · Operator: ____ · projectId: ____ · pinned port: ____

---

## 7. De-risk findings (raynor-prep, 2026-06-04 — against COPIES, live untouched)

All tests used the 1.0.4 release binary in a TEMP path against throwaway/copy
DBs. The live adjutant `.beads` (port 17000) was never upgraded; verified healthy
after each test.

1. **Target confirmed.** GitHub: v1.0.4 = "Latest" (stable), v1.0.5 = "Pre-release"
   with an explicit upstream banner that its migration `0043` can silently break
   multi-machine `bd dolt` sync (#4259). Homebrew `stable` already points at 1.0.5
   — so `brew upgrade` is unsafe; must pin to 1.0.4 (Step 2).

2. **Migration: PASS, non-destructive, automatic, idempotent.** Inited a DB with
   0.60.0 (2 beads), ran 1.0.4 → it auto-ran `migration 010` (bigint→CHAR(36) UUID
   across events/comments/issue_snapshots/compaction_snapshots/wisp_events/
   wisp_comments), `.local_version` 0.60.0→1.0.4, both 0.60.0 beads survived intact,
   and create/update/close all worked. Data persisted across a full server
   stop/restart — no loss. (0.60.0→1.0.4 crosses the 1.0.0 schema bump to v11 for
   custom_statuses/custom_types; also idempotent per changelog.)

3. **THE GATE: PASS — bd 1.0.4 honors externally-managed.** Started a manual
   `dolt sql-server --config` (launchd supervisor stand-in) on a pinned port, set
   externally-managed config, ran bd 1.0.4: it **connected and read AND wrote
   through the existing server, and never auto-spawned a `-H/-P` competitor**.
   Confirmed both via `dolt_server_port` in metadata AND via the
   `.beads/dolt-server.port` file alone. A 20-op stress loop (the 0.60.0 "under
   load/reconnect" trigger) produced **zero competitor spawns and zero data-dir
   lock conflicts**. This is exactly the 0.60.0 crash-loop failure mode — and it
   does NOT reproduce on 1.0.4. Upstream backing: 1.0.4 changelog `ApplyCLIAutoStart
   respects ServerModeExternal` (#3473) + `KillStaleServers respects
   IsAutoStartDisabled` (GH#2641). **adj-182.3.4 is unblocked by the upgrade.**

4. **GOTCHA — `dolt_server_port` in metadata.json is deprecated on 1.0.4.** Port
   file is now primary. Requires a small adjutant code change (see §4 callout)
   alongside the supervisor re-enable. Not a blocker for the upgrade itself.

5. **GOTCHA — `bd dolt status` still cosmetically wrong on 1.0.4** ("not running"
   while connected; #2670). The SQL-probe fix is only in 1.0.5. Verify externally-
   managed functionally, not via status text (§4). Adjutant's own `checkDolt` SQL
   probe is the correct primitive and is unaffected.

6. **GOTCHA — any bd `init`/`dolt stop` can kill the live unsupervised server.**
   0.60.0's "cleaned up N orphaned dolt sql-server process(es)" killed the live
   17000 server during de-risk; `bd list` from the project root respawned it. Until
   the launchd supervisor is back (adj-182.3.4), keep ALL upgrade/rollback
   experimentation in isolated temp dirs and re-check the live server afterward.

**Verdict: bd 1.0.4 is SAFE to upgrade to and DOES honor externally-managed mode.**
The upgrade is the correct unblock for re-enabling the launchd supervisor
(adj-182.3.4), provided (a) the version is pinned to 1.0.4 (NOT brew-stable 1.0.5),
(b) it runs under a coordinated freeze, and (c) the `dolt_server_port` metadata
deprecation is addressed with the supervisor re-enable.
