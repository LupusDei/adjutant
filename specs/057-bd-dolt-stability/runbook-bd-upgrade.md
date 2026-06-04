# Runbook: Fleet upgrade bd 0.60.0 → 1.0.4 (adj-182.3.3 / T016; CORRECTED adj-182.3.5.1)

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
> **De-risked 2026-06-04 (raynor-prep, adj-182.3.3)** in **bd-managed** mode.
> **CORRECTED 2026-06-04 (raynor-prep2, adj-182.3.5.1)** after the first LIVE
> attempt FAILED + was rolled back: the original §3 sequence migrated a COPY in
> bd-managed mode and did NOT replicate the live **externally-managed + launchd +
> pinned-port** topology — which is exactly where it broke. This revision
> reproduces that topology against COPIES, identifies the true root cause, and
> gives the verified sequence. Findings in §7 / §8.

---

## 0. Target version — and the v1.0.5 trap

| Item | Value |
|---|---|
| **Target** | **bd v1.0.4** (GitHub "Latest" / stable; honors externally-managed mode) |
| **AVOID** | **bd v1.0.5** (GitHub **pre-release**; migration `0043` can *silently and unrecoverably* break multi-machine `bd dolt` sync — upstream #4259) |
| Install mechanism | Versioned binary over the brew path (NOT `brew upgrade`) |
| Repo | `github.com/steveyegge/beads` (redirects to `gastownhall/beads`) |

> ### ⚠️ HOMEBREW STABLE IS ALREADY 1.0.5 — `brew upgrade beads` LANDS THE BAD ONE
>
> As of 2026-06-04 `brew info beads` reports `0.60.0 → stable 1.0.5`. A plain
> `brew upgrade beads` will install **1.0.5**, NOT 1.0.4. You MUST install the
> pinned 1.0.4 binary (Step 2). Re-check `brew info beads` before every run — if
> stable has moved to ≥1.0.6 with the #4259 fix, re-validate against a copy (§8
> harness) and update this runbook before proceeding.

---

## 1. Preconditions (per machine)

- [ ] No deploy/merge train in flight; coordinator has **paused new agent spawns**
      and announced a beads freeze for this machine.
- [ ] **NO OTHER `bd` ACTIVITY ANYWHERE ON THIS MACHINE during the upgrade window.**
      See the §7.A hard finding: bd 0.60.0's "orphan dolt cleanup" is
      **process-global**, not project- or HOME-scoped. ANY `bd` invocation (even a
      fully isolated `HOME=/tmp/... bd init` for an unrelated project) will kill the
      live **unsupervised** pinned server and disturb every other project's dolt
      server on the box. While the launchd supervisor is DISABLED (current state),
      the live server is unprotected. Freeze ALL projects' bd usage, not just
      adjutant's.
- [ ] `which bd` → `/usr/local/bin/bd`; `bd version` → `0.60.0` (the from-version).
- [ ] `which dolt` → present. **Note its version** (`dolt version`). Our fleet runs
      dolt **1.83.5**; 1.0.4 is fine on it. (v1.0.5 reordered migrations for "Dolt
      2.0.6" — another reason to avoid 1.0.5 on older dolt.)
- [ ] A current Dolt backup exists for each project being upgraded
      (`cp -r .beads/dolt .beads/dolt.pre-bd104.$(date +%s)` — copy the data-dir,
      not just `backup/`).
- [ ] **Record the live topology for each project — esp. the THREE port sources,
      which MUST agree (this is the root cause of the failed first attempt; §7.B):**
      ```bash
      cat .beads/dolt-server.port                       # (1) PORT FILE — bd 1.0.4's authority
      grep dolt_server_port .beads/metadata.json        # (2) METADATA pin (externally-managed signal)
      grep -A2 '^listener:' .beads/dolt/config.yaml | grep port   # (3) launchd server's listener port
      lsof -nP -iTCP:$(cat .beads/dolt-server.port) -sTCP:LISTEN   # is the server ACTUALLY on the port-file port?
      ```
      **All three MUST be the SAME number, AND a `dolt sql-server` MUST actually be
      listening on it.** If the port file disagrees with the running server, fix it
      BEFORE upgrading (Step 3.0) — a stale port file is what poisoned the first
      live attempt.
- [ ] Note current state: adjutant is **bd-managed on pinned port 17000**, launchd
      supervisor **DISABLED** (`*.plist.disabled`). Do NOT re-enable the supervisor
      in this runbook — that is `adj-182.3.4`, gated on a successful upgrade here.

---

## 2. Install `bd` exactly 1.0.4 (NOT 1.0.5)

Install the official 1.0.4 release binary OVER the brew path. Do **not**
`brew upgrade beads` (that installs 1.0.5). **Verify `bd version` prints `1.0.4`
before doing anything else.**

```bash
# 1. Download + checksum-verify the 1.0.4 binary for this arch (amd64 shown):
TMP=$(mktemp -d); cd "$TMP"
gh release download v1.0.4 --repo steveyegge/beads \
  --pattern 'beads_1.0.4_darwin_amd64.tar.gz' --pattern 'checksums.txt'
shasum -a 256 -c <(grep darwin_amd64 checksums.txt)   # MUST print "OK"
# Verified good 2026-06-04 (raynor-prep2):
#   8a52f7e54fe038d369cc9ea0e65f76853b75f5469c70c9c693d64671623c4ce9  beads_1.0.4_darwin_amd64.tar.gz
tar xzf beads_1.0.4_darwin_amd64.tar.gz
./bd version                                          # MUST print: bd version 1.0.4 (ce242a879...)

# 2. Replace the binary brew links to (back up the old one first for rollback):
cp "$(brew --prefix)/bin/bd" /tmp/bd-0.60.0.bak
install -m 0755 ./bd "$(brew --prefix)/bin/bd"
bd version                                            # MUST print: bd version 1.0.4
```

> arm64 machines: use `beads_1.0.4_darwin_arm64.tar.gz`. Linux: the matching
> `linux_*` asset. Always checksum-verify against `checksums.txt`.

---

## 3. Per-project first-use migration + verify — TOPOLOGY-ACCURATE (one project at a time)

> ### ROOT CAUSE OF THE FAILED FIRST ATTEMPT (read this first)
>
> The migration did **NOT** fail on the data-dir write-lock. It failed because of
> a **stale `.beads/dolt-server.port` file** (§7.B, proven on a copy):
>
> 1. **bd 1.0.4 treats `.beads/dolt-server.port` as authoritative for the port,
>    IGNORING the `dolt_server_port` pin in `metadata.json`** (the pin only flips
>    externally-managed *mode*; it does NOT supply the port to 1.0.4). If the port
>    file points at a dead/wrong port, bd 1.0.4 fails `connection refused` and —
>    because it honors externally-managed — does **not** auto-start a server to
>    recover.
> 2. **`.local_version` is bumped to `1.0.4` EAGERLY, even when that first call
>    FAILED to connect** (verified: a failed `bd list` AND even `bd migrate
>    --inspect` both poisoned `.local_version`).
> 3. On the next call bd sees `.local_version == 1.0.4` → **SKIPS the migration** →
>    queries the new (1.0.4) schema against the still-0.60.0 DB →
>    `Error 1105 (HY000): column "started_at" could not be found in any table in
>    scope`. The DB was never migrated.
>
> **The fix is therefore: make the port file point at the live launchd server
> BEFORE the first 1.0.4 call, and keep `.local_version` honest.** With those two
> things true, bd 1.0.4 migrates **cleanly THROUGH the externally-managed launchd
> server** — no lock fight, no competitor spawn, live server untouched (§7.C, the
> WINNING sequence; verified end-to-end on copies for proj-b and proj-c).

For EACH project (start with a low-traffic one), with ALL bd activity frozen:

### 3.0 — Reconcile the three port sources (PREVENTS the poison)

```bash
cd <project>
PF=$(cat .beads/dolt-server.port)
PIN=$(grep -oE '"dolt_server_port"[[:space:]]*:[[:space:]]*[0-9]+' .beads/metadata.json | grep -oE '[0-9]+')
echo "port-file=$PF  metadata-pin=$PIN"
lsof -nP -iTCP:"$PF" -sTCP:LISTEN     # MUST show a dolt sql-server listening on $PF
# If NOT listening on $PF, set the port file to the port the launchd/live server is
# ACTUALLY on, e.g.:
#   printf '17000' > .beads/dolt-server.port
# DO NOT proceed until port-file == the actually-listening dolt port.
```

### 3.1 — Confirm `.local_version` is honest (0.60.0), repair if a prior attempt poisoned it

```bash
cat .beads/.local_version            # MUST read 0.60.0 BEFORE the first 1.0.4 call.
# If a FAILED prior attempt already bumped it to 1.0.4 while the DB is still
# 0.60.0-schema (symptom: bd 1.0.4 errors 'column "started_at" could not be
# found' once the port is reachable), RESET it so migration runs:
#   printf '0.60.0' > .beads/.local_version
# (Verified recovery, §7.D: reset → next 1.0.4 call migrates cleanly.)
```

### 3.2 — Run the first-use migration THROUGH the live (launchd/pinned) server

```bash
# Preconditions now true: port file → the running server; .local_version == 0.60.0;
# the externally-managed server (launchd-supervised OR the current bd-managed pinned
# server) is UP and listening on that port.
bd list                              # triggers migration; watch for "migration NNN:" lines
#   EXPECT: "migration 010: <table>.id migrated to CHAR(36) UUID successfully" for
#           events, comments, issue_snapshots, compaction_snapshots, wisp_events,
#           wisp_comments — then the issue list.
cat .beads/.local_version            # AFTER: 1.0.4
```

> The migration runs as SQL **over the existing server connection** — it does NOT
> need exclusive embedded/file-lock access to `.beads/dolt`, so the launchd server
> holding the data-dir lock is **NOT** a problem (verified: zero lock errors in the
> server log; the server PID is unchanged and keeps listening throughout). This is
> the key correction to the prior runbook's assumption.

### 3.3 — Confirm data integrity + CRUD on the migrated DB

```bash
bd list | wc -l                      # count matches pre-upgrade expectation (no loss)
bd show <a-known-bead-id>            # spot-check a known bead survived intact
bd create -t task "bd-1.0.4 upgrade smoke" >/tmp/smoke && cat /tmp/smoke
bd update <that-new-id> --status in_progress
bd close  <that-new-id> --reason "upgrade smoke"
# Durability: data survives a server restart (verified §7.C).
```

> **Migration is one-way.** Rolling back to 0.60.0 AFTER a project's DB has been
> migrated to the 1.0.4 schema requires restoring from the §1 backup — 0.60.0
> cannot read the 1.0.4 schema. Roll back the binary BEFORE migrating if you abort.

> **Auto-export/auto-import is ON by default in 1.x.** You will see
> `auto-importing N bytes from .beads/issues.jsonl ...` on writes — this is
> expected (the JSONL ↔ Dolt round-trip), not data loss.

#### Fallback ONLY IF 3.2 cannot reach a server (no launchd, no pinned server up)

If — and only if — you cannot get an externally-managed server listening on the
port file, you may migrate in **bd-managed** mode instead. This works (verified
§7.E) BUT **re-enables bd's process-global kill-stale-servers behavior** and WILL
kill other projects' unsupervised dolt servers on the box. Use only under a
machine-wide freeze (§1), and expect to restore other projects' servers after
(`bd list` from each project root respawns them):

```bash
# 1. Un-externally-manage: remove the metadata pin so 1.0.4 will self-start a server.
#    (Keep a note of the port to re-pin.)
python3 - <<'PY'
import json; p=".beads/metadata.json"; m=json.load(open(p)); m.pop("dolt_server_port",None)
open(p,"w").write(json.dumps(m,indent=2)+"\n")
PY
# 2. bd-managed first-use → self-starts a server (fresh port) AND migrates:
bd list                              # EXPECT the migration 010 lines + list
cat .beads/.local_version            # 1.0.4
# 3. Stop the bd-managed server, RE-PIN the metadata + port file, and bring the
#    externally-managed (launchd/pinned) server back — then go to §4 (the GATE).
```

---

## 4. THE GATE — externally-managed on 1.0.4 (re-validates adj-182.3.4)

This proves the launchd supervisor can be re-enabled. After §3 the DB is migrated;
now confirm bd 1.0.4 operates **externally-managed** against the launchd/pinned
server with no competitor and no lock-fight. **bd 1.0.4 honors externally-managed:
it connects to the running server and does NOT auto-spawn a competitor
`dolt sql-server -H/-P` (the 0.60.0 lock-fight is gone).** Re-confirmed green for
the migrated copy in §7.C.

```bash
# Preconditions: metadata pin present (dolt_server_port), port file == that port,
# the externally-managed server is UP and listening on it.
PORT=$(cat .beads/dolt-server.port)

# 1. bd connects + reads/writes through the existing server, NO new process:
ps -ax -o pid,command | grep 'dolt sql-server' | grep -v grep   # snapshot BEFORE
bd list >/dev/null && echo "BD_OK"
ID=$(bd create -t task "gate smoke" --json | grep -oE '"id":"[^"]+"' | head -1)  # write path
for i in $(seq 1 10); do bd list >/dev/null; bd show <known-id> >/dev/null; done  # stress
ps -ax -o pid,command | grep 'dolt sql-server' | grep -v grep   # snapshot AFTER
#   EXPECT: exactly ONE dolt sql-server for this data-dir, SAME PID before/after.
#   FAIL if a second `dolt sql-server -H 127.0.0.1 -P <PORT>` competitor appears.
#   Verified §7.C: 8-op stress → zero competitor spawns, launchd PID unchanged,
#   the live (other-project) server survived.

# 2. No data-dir lock conflict in the server log:
grep -iE 'lock|locked|another dolt|fatal' .beads/dolt-server.log | tail
#   EXPECT: no NEW "database ... is locked by another dolt process" lines.
#   Verified §7.C: none during migration OR steady-state ops.
```

> ### ⚠️ Do NOT trust `bd dolt status` text on 1.0.4
>
> `bd dolt status` still reports **"not running"** on 1.0.4 even when the server is
> up and bd is connecting fine — the PID-not-connectivity cosmetic (upstream #2670).
> The SQL-probe fix only landed in **1.0.5** (which we avoid). **Verify
> functionally** via `bd list`/`bd create` success + the competitor/lock checks
> above, and via adjutant's own SQL probe (`adjutant doctor` → `checkDolt`).

> ### ⚠️ REQUIRED CODE FOLLOW-UP before re-enabling the supervisor (adj-182.3.4 / adj-182.3.6)
>
> bd 1.0.4 **deprecates `dolt_server_port` in `metadata.json`**:
> > `Warning: dolt_server_port in metadata.json is deprecated (can cause
> > cross-project data leakage). The port file (.beads/dolt-server.port) is now the
> > primary source. Remove dolt_server_port from .beads/metadata.json to silence.`
>
> **This is not cosmetic for our topology — it is the SAME mechanism that caused the
> failed first attempt.** bd 1.0.4 reads the **port file**, not the metadata pin,
> for the port (§7.B). Adjutant currently writes/relies on the metadata pin
> (`cli/lib/dolt-pin.ts`, `cli/lib/dolt-supervisor.ts`, `cli/commands/doctor.ts`,
> `backend/src/services/bd-client.ts`).
>
> **Interaction with the upgrade (adj-182.3.6):** the metadata pin still safely
> flips externally-managed *mode* on 1.0.4, so it does NOT have to be removed for
> the upgrade to succeed — BUT the port FILE must be the source of truth for the
> *port value*, and the two must agree. **Action (do WITH or BEFORE the supervisor
> re-enable, adj-182.3.4):** make `installSupervisor()` /
> `install-dolt-supervisor.sh` (a) always write `.beads/dolt-server.port` as the
> authoritative port, (b) stop relying on `dolt_server_port` in metadata for the
> port value (keep it, if at all, only as the externally-managed flag), and
> (c) keep `doctor.ts`'s dual-read as the compatibility bridge. Low-risk; the port
> file already exists in the live setup.

---

## 5. Rollback

### 5a. Binary-only rollback (project NOT yet migrated)

```bash
install -m 0755 /tmp/bd-0.60.0.bak "$(brew --prefix)/bin/bd"   # or reinstall the 0.60.0 bottle
bd version                                                       # expect 0.60.0
```

### 5b. Poisoned-version-only recovery (DB still 0.60.0, `.local_version` got bumped)

If a failed first-use bumped `.local_version` to 1.0.4 but the DB was never
actually migrated (symptom: `column "started_at" could not be found`):

```bash
printf '0.60.0' > .beads/.local_version     # de-poison
# reconcile the port file (§3.0) so the server is reachable, then:
bd list                                     # migration 010 now runs; .local_version → 1.0.4
```

This is the cleanest recovery and does NOT require the backup (verified §7.D).

### 5c. Full rollback (project ALREADY migrated to 1.0.4 schema)

The 1.0.4 schema is NOT readable by 0.60.0. To revert:

1. Stop bd activity on the project (coordinator freeze still in effect).
2. Restore the pre-upgrade `.beads/dolt` from the §1 backup
   (`.beads/dolt.pre-bd104.*`).
3. Roll back the binary (5a).
4. `bd list` → confirms the 0.60.0 DB reads again; notify coordinator; file a bug
   bead under `adj-182.3` with `.beads/dolt-server.log` + the migration output.

**NEVER delete `.dolt/**/LOCK` or `.beads/dolt-server.lock`.** Double-open of the
data-dir risks corruption.

> ⚠️ A `bd init`, `bd dolt stop`, or any bd-managed (auto-start ENABLED) invocation
> from ANY bd version may "clean up orphaned dolt sql-server processes" **globally**
> and kill the live bd-managed server — and other projects' servers (observed
> repeatedly during de-risk, §7.A; bd 0.60.0 `bd dolt stop` killed the live 17000
> server AND a different project's server). Until the launchd supervisor is
> re-enabled (adj-182.3.4), the live server is unprotected — do rollback work in an
> isolated temp dir, never near the live `.beads`, and re-check the live server
> after (`bd list` from the project root respawns it).

---

## 6. Acceptance validation record (fill in at live execution)

| Check | Expected | Result | Notes |
|---|---|---|---|
| Machine-wide bd freeze in effect | no other bd activity | ⬜ | §1 / §7.A — global kill |
| Port sources reconciled | port-file == pin == running server | ⬜ | §3.0 — root cause |
| `.local_version` honest before run | `0.60.0` | ⬜ | §3.1 |
| `bd version` after install | `1.0.4` (NOT 1.0.5) | ⬜ | |
| Migration ran THROUGH live server | `migration 010: ... successfully` ×6 | ⬜ | §3.2 |
| `.local_version` after migrate | `1.0.4` | ⬜ | |
| No data-dir lock error in log | none | ⬜ | §3.2 / §4 |
| Bead count / known bead intact | no loss | ⬜ | §3.3 |
| CRUD on 1.0.4 | create/update/close OK | ⬜ | §3.3 |
| Externally-managed: no competitor spawn | 1 server, same PID, no lock errors | ⬜ | THE GATE (§4) |
| Backend reconnects on pinned port | `bd list` OK, no breaker | ⬜ | |

Date: ____ · Operator: ____ · projectId: ____ · pinned port: ____

---

## 7. De-risk findings — TOPOLOGY-ACCURATE (raynor-prep2, 2026-06-04, adj-182.3.5.1)

All tests used the verified 1.0.4 release binary in a TEMP path against
throwaway 0.60.0 seed DBs in a temp `$HOME`, with a **launchd-stand-in**
`dolt sql-server --config <pinned config.yaml>` holding the data-dir lock on a
band port (17555/17666/17777) — i.e. the REAL live topology (externally-managed +
launchd + pinned). The live adjutant `.beads` (port 17000) was never upgraded and
was verified healthy (`.local_version` still `0.60.0`, port file == pin == running
server) after every step.

**A. The "orphan dolt cleanup" in bd 0.60.0 is PROCESS-GLOBAL.** A fully isolated
`HOME=/tmp/... XDG_*=... bd init` for an unrelated throwaway project STILL killed
the live 17000 server (twice) and, on a `bd dolt stop`, also killed a *different*
project's (bloomfolio) dolt server. Externally-managed mode in 0.60.0 does NOT
prevent it — 0.60.0 ignores the pin, kills everything, self-manages on a random
port. ⇒ Hard precondition §1: machine-wide bd freeze, not just adjutant.

**B. ROOT CAUSE of the failed live attempt = stale `.beads/dolt-server.port`,
not the data-dir lock.** bd 1.0.4 reads the **port file** as authoritative for the
port and IGNORES the `dolt_server_port` metadata pin. With the port file pointing
at a dead port: first-use → `connection refused`; and `.local_version` is bumped
to `1.0.4` **anyway** (verified for both `bd list` and `bd migrate --inspect`).
Next call sees 1.0.4 → SKIPS migration → queries the new schema on the un-migrated
DB → `Error 1105: column "started_at" could not be found`. Exact live error,
reproduced deterministically (proj-c).

**C. THE WINNING SEQUENCE (candidate "a-prime"): migrate THROUGH the launchd
server.** With the launchd-stand-in server UP and the port file pointing AT IT
(and `.local_version == 0.60.0`), a single `bd list` with the 1.0.4 binary ran
`migration 010` across all six tables (events/comments/issue_snapshots/
compaction_snapshots/wisp_events/wisp_comments) **cleanly through the existing
externally-managed connection** — ZERO lock errors in the server log, NO competitor
`-H/-P` server spawned, the launchd server PID unchanged and still listening, the
live (other-project) 17000 server untouched, both seed beads intact, and a `bd
create` write succeeded. Data was durable across a launchd server restart. An 8-op
stress loop produced zero competitor spawns and zero lock conflicts — the GATE
(§4) passes. **This is the sequence the runbook §3.2/§4 now prescribes.**

**D. RECOVERY from a poisoned `.local_version` is trivial and non-destructive:**
`printf '0.60.0' > .beads/.local_version` then re-run `bd list` → migration 010
runs to completion (proj-c, after deliberately reproducing the "started_at"
failure). No backup restore needed for this case.

**E. Candidate "a" (un-externally-manage → bd-managed migrate → re-pin) ALSO
migrates correctly**, but the bd-managed window re-enables the process-global
kill-stale-servers behavior: during it, bd 1.0.4 (auto-start ENABLED) killed the
live 17000 server and disturbed bloomfolio's. It is the documented FALLBACK only
when no externally-managed server can be made reachable, and only under a
machine-wide freeze. Candidate "b" (embedded migrate with NO server up) does NOT
work: 1.0.4 honoring externally-managed refuses to auto-start a server, so it just
fails `connection refused`.

**F. Explicit-command notes (candidate "c"):** 1.0.4 exposes `bd migrate` (no
subcommand = "checks and updates database metadata to current version", with
`--dry-run`, `--inspect`, `--json`). `--inspect` is NOT a safe read-only probe — it
poisoned `.local_version` on a failed connect just like `bd list`. The actual
schema migration is the same first-use migration `bd list` triggers; there is no
separate "migrate without touching the version marker" path. Treat any first 1.0.4
invocation as the migration trigger, and gate it on §3.0/§3.1.

**G. GOTCHA — `dolt_server_port` in metadata.json is deprecated on 1.0.4** and is
the SAME mechanism behind the failure (B). Port file is primary. The metadata pin
still flips externally-managed *mode*, so it need not be removed for the upgrade —
but the port FILE must own the port value and the two must agree. Code follow-up in
§4 callout / adj-182.3.6.

**H. GOTCHA — `bd dolt status` still cosmetically wrong on 1.0.4** ("not running"
while connected; #2670). Verify externally-managed functionally, not via status
text (§4).

**Verdict: bd 1.0.4 is SAFE to upgrade to and DOES honor externally-managed mode.
The first live attempt failed on a STALE PORT FILE + an eagerly-poisoned
`.local_version`, NOT on the data-dir lock.** With the §3.0 port reconciliation and
§3.1 version check as gates, the §3.2 "migrate THROUGH the launchd server" sequence
is the correct, verified path; it leaves bd 1.0.4 working externally-managed
against the launchd supervisor (§4 GATE green), unblocking adj-182.3.4. Required:
(a) pin to 1.0.4 (NOT brew-stable 1.0.5), (b) a MACHINE-WIDE bd freeze (§7.A),
(c) reconcile port-file/pin/running-server before the first call (§7.B), and
(d) address the `dolt_server_port` deprecation with the supervisor re-enable
(adj-182.3.6).

---

## 8. De-risk test harness (re-run before any future bd upgrade)

This is the topology-accurate harness raynor-prep2 used (the prior bd-managed-only
de-risk is what let the live failure through). Re-run it against a COPY whenever the
target version changes. Never touch the live `.beads`.

```bash
# 0. Verified 1.0.4 binary in a temp path (NEVER install over system bd for de-risk):
DERISK=$(mktemp -d); cd "$DERISK"
gh release download v1.0.4 --repo steveyegge/beads \
  --pattern 'beads_1.0.4_darwin_amd64.tar.gz' --pattern 'checksums.txt'
shasum -a 256 -c <(grep darwin_amd64 checksums.txt)   # OK
tar xzf beads_1.0.4_darwin_amd64.tar.gz               # → ./bd (run as "$DERISK/bd")

# 1. Seed a 0.60.0 DB in an ISOLATED temp HOME (this step triggers the §7.A global
#    kill — do it under freeze and restore live after with `bd list` from main repo):
THOME="$DERISK/home"; PROJ="$DERISK/proj"; mkdir -p "$THOME" "$PROJ"; cd "$PROJ"
git init -q; git config user.email d@l; git config user.name d
env HOME="$THOME" XDG_CONFIG_HOME="$THOME/.config" XDG_DATA_HOME="$THOME/.local/share" \
  /usr/local/bin/bd init --prefix tst
env HOME="$THOME" XDG_CONFIG_HOME="$THOME/.config" XDG_DATA_HOME="$THOME/.local/share" \
  /usr/local/bin/bd create -t task "seed 1"   # add a couple beads
# >>> restore live: (cd <main repo> && bd list >/dev/null) ; verify 17000 listening <<<

# 2. Reproduce the LIVE topology: pin metadata + config to a band port, start a
#    launchd-stand-in `dolt sql-server --config` on it (holds the data-dir lock),
#    and set the port FILE to the SAME port:
#      metadata.json    dolt_server_port: 17555
#      dolt/config.yaml listener.port: 17555  +  behavior.autocommit: true
#      dolt-server.port 17555
#    nohup dolt sql-server --config "$PROJ/.beads/dolt/config.yaml" &

# 3. Migrate THROUGH it (the WINNING path): .local_version must be 0.60.0, port file
#    must point at the running launchd server, then:
env HOME="$THOME" ... "$DERISK/bd" list      # EXPECT migration 010 ×6 + list, no lock errors

# 4. NEGATIVE control (must reproduce the live failure): set the port file to a dead
#    port, run "$DERISK/bd" list  → connection refused + .local_version bumps to 1.0.4;
#    fix the port file → "started_at" error; reset .local_version to 0.60.0 → re-run
#    migrates cleanly (the §5b recovery).

# 5. GATE: with the launchd server up + externally-managed, stress `bd list`/`bd
#    create` ×10 and assert: ONE server, SAME PID, no competitor `-H/-P`, no lock
#    errors, live (other-project) server survives.

# 6. Tear down: kill the stand-in server(s); verify live 17000 still listening;
#    rm -rf "$DERISK".
```
