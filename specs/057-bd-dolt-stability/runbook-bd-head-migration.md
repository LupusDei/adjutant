# Runbook: migrate beads to the fixed bd (HEAD #4170) + schema `0043`

**Status:** VALIDATED 2026-06-12. Proven on an isolated scratch copy, then run live
across all 11 fleet projects, then encoded + fixture-tested in `adjutant doctor`
(`checkBdSchema`/`fixBdSchema`, adj-7h8ve). HEAD bd `HEAD-1825cf3`; `0043` applied;
server-mode `bd create` ~2–3s; `dependencies` PK restructured; zero data loss.

> ### ⚠️ Two refinements learned during the live rollout (supersede the steps below)
> 1. **Trigger the migration with a WRITE, not a read.** `bd list` *starts* the 0043
>    chain but a read never **commits** it — it leaves `schema_migrations` + tables
>    modified (a dirty half-migration), and the next write then fails with
>    `pre-existing dirty tables changed during schema migration`. Use `bd create`
>    (+`bd close`): a write applies AND commits 0043 in one op (autocommit).
> 2. **If a DB is already dirty, `dolt reset --hard` first** (in the repo dir
>    `.beads/dolt/<db>`, which routes to the live server — no need to stop it), then
>    migrate-via-write. `reset --hard` only discards the uncommitted half-migration;
>    committed issues survive.
>
> Both are now automated: **`adjutant doctor --fix`** does backup → reset-if-dirty →
> migrate-via-write → verify, idempotently. `adjutant doctor` (no `--fix`) reports
> whether a project is on the pre-0043 schema, dirty, or current. This is the
> one-command path for other machines.

## Why this is needed

bd `1.0.4` (release commit `ce242a879`) has a **server-mode write bug** (upstream #4245):
every write runs a pre-write `auto-import issues.jsonl "into empty database"` that hangs.
The fix is **#4170 "auto-import: gate server mode at call site"** (commit `4990c8309`,
2026-05-26). That fix only exists in builds **after** the `0043` schema migration
(`0043_drop_dependencies_generated_column`, commit `d15c7572f`, 2026-05-19). So:

> **You cannot adopt the #4170 write-fix without also applying `0043`.** They are
> entangled — the fix merged a week after the migration. There is no clean pre-`0043`
> commit with the fix (verified with `git merge-base --is-ancestor`).

`0043` restructures the `dependencies` table: drops the polymorphic `depends_on_id`
column + old PK, adds a surrogate `id CHAR(36)` PK + typed UNIQUE keys (part of the
chain `0043 → 0044 → … → 0050`, where `0050` makes the id deterministic for cross-clone
merge-safety). It is **guarded/idempotent** (only acts if not already migrated). Its
`.down.sql` is an intentional no-op — **forward-only**, so backups are the rollback.
Its only documented risk is **cross-machine Dolt sync**, which is **moot for us**
(single-machine, `Remotes: (none)`).

## Root-cause of the live migration failure (and the fix)

A naive HEAD-bd write on live adjutant errored:
`schema migration: pre-existing dirty tables changed during schema migration: dependencies`.
That is caused **only** by (a) an uncommitted/dirty working set and (b) **concurrent
writes during the migration** (the backend hammering the DB). The scratch proof confirmed:
on a **quiesced** copy with a clean working set, `0043` applies with no error and writes
work. So the procedure is **quiesce → (commit working set) → migrate**.

## Procedure (per machine, under a freeze)

> Run under a freeze. The hard requirement is **no concurrent bd writes during the migration**.

0. **Install the fixed bd** (HEAD until upstream tags a release with #4170):
   ```sh
   HOMEBREW_NO_REQUIRE_TAP_TRUST=1 HOMEBREW_NO_AUTO_UPDATE=1 brew install --HEAD beads
   # → /usr/local/Cellar/beads/HEAD-<sha>/bin/bd   (e.g. HEAD-1825cf3)
   # If `brew install` says "already installed": `brew unlink beads` first.
   ```
1. **Back up** each project's DB + jsonl (the `.down` is a no-op, so this is the rollback):
   ```sh
   cp -r .beads/dolt .beads/dolt.pre-0043.$(date +%s)
   cp .beads/issues.jsonl .beads/issues.jsonl.pre-0043.$(date +%s)
   ```
2. **Quiesce all writers**: stop the adjutant backend and pause every agent. No `bd`
   write may touch the project during the migration. (Reads are fine.)
3. **Commit a dirty working set** (only if `dolt_status` shows changes), so the migration
   starts clean:
   ```sh
   # via the running server connection (NOT embedded — avoids the cwd-repo trap):
   bd dolt commit -m "pre-0043 quiesce"      # or a DOLT_COMMIT('-Am',…) over the server
   ```
4. **Swap `bd` → HEAD** (back up the old binary first):
   ```sh
   sudo mv /usr/local/bin/bd /usr/local/bin/bd.1.0.4.bak
   sudo ln -sf /usr/local/Cellar/beads/HEAD-<sha>/bin/bd /usr/local/bin/bd
   ```
5. **Migrate**: run one HEAD-bd op per project to trigger the `0043` chain on the quiesced DB:
   ```sh
   ( cd <project> && bd list )   # applies 0043 → 0050; idempotent; clean since quiesced
   ```
6. **Verify** per project:
   - `bd create --title=zz-verify` completes (NO "auto-importing into empty database");
   - `dependencies` table has the new `id` column (0043 applied);
   - `bd list` returns the expected issues (data intact);
   - look for `auto-export: skipping — server mode` on writes (the #4170 gate is active).
7. **Resume** the backend + agents.

## `adjutant doctor` integration (for other machines)

The whole flow folds into the existing dolt health-check so a teammate pulling adjutant
on a new machine runs **one command**:

- **`adjutant doctor` checkDolt** — detect (a) system `bd` older than #4170 / not the
  pinned HEAD, and (b) a project still on the pre-`0043` schema (the `dependencies` table
  still has `depends_on_id`). Report both.
- **`adjutant doctor --fix`** — automate steps 0–6: install/point-to HEAD bd, back up,
  **refuse unless writers are quiesced** (or stop them itself), commit any dirty working
  set, run the migration per project, and verify. Idempotent (skips already-migrated DBs
  via the `0043` guard).
- New machine: `git pull` adjutant → `adjutant doctor --fix` → fixed bd + migrated beads.

## Gotchas

- **PROJECT IDENTITY MISMATCH guard** (new in HEAD bd): bd refuses to connect if
  `metadata.json` `project_id` ≠ the DB's embedded id. On a real project these match;
  only a wrong-`project_id` scratch copy trips it. Don't "fix" it with `bd init`.
- **Do NOT run `dolt sql` inside `.beads/dolt`** during this — it re-creates a stray
  `.dolt` cwd-repo (an empty `dolt` default DB) that confuses connections.
- **Temporary:** revert step 0/4 to plain `brew install beads` (stable) once upstream
  ships a tagged release containing #4170, so we're not pinned to a HEAD build.
