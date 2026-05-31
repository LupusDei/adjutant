# RFC: Per-Agent Repository Clones for Parallel Squad Isolation

- **Status**: Draft / proposal (awaiting General's acceptance)
- **Author**: rory-swann (coordinator)
- **Date**: 2026-05-31
- **Supersedes**: the shared-`.git` worktree isolation model (`.claude/rules/07-team-isolation.md`)
- **Related**: adj-181 squad run (where the failure modes below were observed first-hand)

## 1. Problem

A multi-agent squad needs **N agents working N features simultaneously**. The current
mechanism is `git worktree` under one shared `.git`. Worktrees isolate the *working
directory* but **share the object store, the ref namespace, and git's
one-branch-checked-out-in-one-place-at-a-time invariant.** Development is isolated;
*ref operations and integration are not.* During the adj-181 run this produced repeated,
expensive failures:

1. **Stolen `main`.** A worktree can hold a given branch only once. When an engineer ran
   `git checkout main` inside its worktree (to self-merge), it yanked `main` away from the
   coordinator's working dir, leaving the coordinator parked on a stale feature branch.
   This happened **3+ times** and each time looked like "the merged code is missing."
2. **Ref-namespace collisions / mis-targeted pushes.** All worktrees share one ref
   namespace, so a feature branch (`feat/adj-181-qa-fixes`) ended up pointing at an
   unrelated commit on origin; the engineer's work was stranded on its local worktree
   branch and had to be recovered by hand.
3. **Working-tree file bleed.** Adjacent working trees under one repo let edits leak: an
   unrelated chat fix and a `tsconfig` change appeared **staged** in the coordinator's tree,
   and a generated config file landed as untracked litter.
4. **Integration in a contended tree.** Every merge happened in the coordinator's local
   working tree, which other agents could perturb — the source of most of the lost time.

**Root cause:** worktrees share `.git`. Isolation of *files* is not isolation of *refs,
objects, or HEAD*.

## 2. Goals

- **True parallel isolation**: N agents → N independent repos with zero cross-talk in refs,
  objects, or working files. `git checkout main` in one is structurally invisible to others.
- **Safe integration**: no agent can corrupt another agent's state or the coordinator's `main`.
- **Preserve** what works: cheap/fast provisioning, a single shared beads DB, the existing
  tmux/lifecycle spawn flow, and dashboard visibility.
- **Compose** with the mechanical build gate (tsc/CI) already in motion.

## 3. Non-goals

- Replacing tmux agent sessions or the MCP/messaging layer.
- Selecting a specific CI provider (tracked separately; this RFC assumes "merge via origin").
- Eliminating worktrees everywhere — they remain fine for a *single* agent's own use.

## 4. Current architecture (baseline)

- `LifecycleManager.createSession` creates `git worktree add .claude/worktrees/agent-<id>`
  and launches tmux with `-c <worktree>` (locked by regression tests in
  `lifecycle-manager.test.ts` / `swarm-service.test.ts`, adj-iqyqw).
- The `.beads/` dolt DB lives in the **main repo**; agents are pointed at it for `bd`.
- The coordinator runs in the **main repo** and merges branches locally.
- Known sharp edges already documented: cwd-leak on resume (adj-iqyqw), dolt post-checkout
  hook crash in worktrees (adj-hq2q), stale-branch conflicts (adj-yzvk).

## 5. Proposed architecture: per-agent clones

Each agent gets its **own full clone** (its own `.git`), created with **object sharing** so
it is as cheap as a worktree:

```
git clone --reference <canonical-repo> --shared <canonical-repo> <agent-clone>
# objects are borrowed from the canonical repo's object store (hardlink/alternates);
# only the working tree + index + refs are private to the clone.
```

- Separate `HEAD`, refs, and working tree ⇒ an agent may `checkout main` freely; it cannot
  affect any other clone or the coordinator. Failure modes #1–#4 become **structurally
  impossible**, not discipline-enforced.
- Agents commit on their own branch and **push to the shared remote (`origin`)**. They never
  merge locally and never touch a shared working tree.

### 5.1 Key design decisions

**D1 — Object sharing strategy.** Use `--reference <canonical>` (borrow objects via
`objects/info/alternates`). Near-zero copy, fast setup. **Hazard:** if the canonical repo
runs `git gc`, it can prune objects a clone still references. **Mitigation:** disable
auto-gc on the canonical repo for the duration of a squad run (`git config gc.auto 0`), or
pay disk for `--dissociate`. Recommend `--reference` + gc-disabled canonical; reconcile on
teardown.

**D2 — Single shared beads DB (critical).** Clones must **not** each get their own `.beads`.
The dolt DB is the single source of truth and already serializes via a mutex. Options:
(a) symlink each clone's `.beads` → canonical `.beads`; (b) have agents run all `bd` with an
absolute path to the canonical repo (today's pattern). **Recommend (a) symlink**, plus keep
the bd mutex and the dolt-hook guard (adj-hq2q) so concurrent `bd` from N clones can't panic
dolt. Each clone's local hooks must **skip** the dolt post-checkout hook (reuse the existing
`[ -f .git ]` guard logic, generalized to "not the canonical repo").

**D3 — Integration via origin, not a local tree.** Agents push feature branches; the
coordinator integrates **through the remote** — ideally a PR + required-status-check + merge
queue, or at minimum a coordinator that merges inside *its own dedicated clone* that nothing
else touches. This is the same conclusion as the merge-model discussion: keep the *merge
point* off any contended working tree. Branch names should include the agent id to remove
any residual collision risk.

**D4 — Lifecycle integration.** `LifecycleManager.createSession` gains a provisioner branch:
`git clone` instead of `git worktree add`; tmux still launched with `-c <clone-path>`
(preserving the adj-iqyqw `-c` contract). Cleanup becomes `rm -rf <clone>` (after confirming
the branch is pushed/merged) instead of `git worktree remove`. The session registry stores
the clone path exactly where it stored the worktree path — `ManagedSession` is unchanged in
shape.

**D5 — Stale-base discipline (unchanged).** A clone branches from the latest `origin/main`
it fetched; multi-phase epics still spawn phase N after phase N-1 merges (adj-yzvk).

### 5.2 Disk & performance

- With `--reference`, a clone copies the **working tree + index + refs only** — objects are
  borrowed. That is roughly the same disk a worktree uses (both materialize one working
  tree). `--local`/reference clones are created via hardlinks, so setup is fast (hundreds of
  ms range, comparable to `worktree add`).
- N=8 agents ⇒ 8 working trees either way; clones add small private `.git` metadata.
- **Net:** clones cost ≈ worktrees when object-shared, while removing the entire shared-ref
  failure class.

## 6. Migration plan (incremental, reversible)

1. **Provisioner abstraction** behind a flag `SQUAD_ISOLATION = worktree | clone` (default
   `worktree`). Add `clone` provisioning + teardown.
2. **LifecycleManager** wired to the provisioner; registry/cleanup updated; **regression
   tests** added in `lifecycle-manager.test.ts` / `swarm-service.test.ts` mirroring the
   existing `-c`-flag locks (clone path used, `-c <clone>` preserved, `.beads` symlinked,
   teardown removes the clone).
3. **Docs/spawn prompts**: update `.claude/rules/07-team-isolation.md` and the
   `squad-execute` spawn template — agents work in their clone, push branch only, never
   `checkout main`/`merge` (now structurally safe, but keep the rule for clarity).
4. **Integration**: wire origin-based merge (PR + required CI check / merge queue), composing
   with the tsc gate (adj-x76mf) and the planned CI required-check.
5. **Bake-in → default**: flip default to `clone`, keep `worktree` available one release, then
   remove.

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Canonical `gc` prunes borrowed objects | Disable auto-gc on canonical during runs; reconcile on teardown |
| Concurrent `bd` from N clones panics dolt | Shared `.beads` symlink + keep bd mutex + dolt-hook guard (adj-hq2q) |
| Disk blowup if someone full-clones | Enforce `--reference`/`--shared` in the provisioner; assert in a test |
| Clone leak on crash/decommission | `rm -rf` on teardown; startup reconciler removes orphaned clones |
| Stale base → conflicts | Fetch latest `origin/main` before branching; phase gating (adj-yzvk) |

## 8. Alternatives considered

- **Worktrees-done-right** (one dedicated coordinator `main` worktree + a hook blocking
  `checkout main` elsewhere): smaller change, but the shared ref namespace remains, so it's
  discipline-enforced rather than structurally safe. Keep as the fallback if clones are
  rejected.
- **Remote-only integration, keep worktrees**: fixes merge collisions but **not** dev-tree
  file bleed (#3).
- **Recommended hybrid**: per-agent clones for development (#5) **+** origin/merge-queue for
  integration (D3). Clones kill the ref/object/file cross-talk; remote integration kills the
  contended-merge-tree class. Together they retire every failure observed in adj-181.

## 9. Open questions for the General

1. Is a CI provider + merge queue available (enables the strongest D3), or should the
   coordinator integrate in a dedicated clone for now?
2. Canonical source: keep the current main repo as canonical, or stand up a **bare** mirror
   as the canonical object store (cleaner alternates, no working tree to perturb)?
3. Disk budget for N concurrent object-shared clones (sizing the MAX_SESSIONS cap)?

## 10. Recommendation

Adopt **per-agent object-shared clones + coordinator-owned integration**, rolled out behind
the `SQUAD_ISOLATION` flag with the regression-test locks above. It is roughly
disk/time-neutral versus worktrees and eliminates the shared-`.git` failure class that cost
the most time in the adj-181 run.

## 11. Decisions (locked by the General — 2026-05-31)

These resolve §9 and pin the design:

1. **Integration → coordinator-managed merge from a dedicated clone.** Squad agents push
   their feature branch; the **coordinator** integrates by merging into the **main repo**
   from a dedicated clone (that nothing else touches) when the work is **complete OR
   MVP-shippable** — at which point the remainder may be continued directly on `main`. No CI
   merge queue for now (it stays a future upgrade to D3; the required-status-check / tsc gate
   still applies at the coordinator's merge step).
2. **Canonical source → the current main repo** (no bare mirror). Clones use it as the
   `--reference` object store; keep `gc.auto 0` on it during squad runs (D1).
3. **Concurrency cap → 10 concurrent clones** (aligned with `MAX_SESSIONS=10`). The
   coordinator / squad-leader **removes each clone after the agent's work completes**
   (`rm -rf` on decommission), with a startup reconciler to sweep orphans.

**Consequence for the design:** the integration story is the simpler "coordinator merges in
a dedicated clone" path (not the merge-queue path) — so the epic must include the
coordinator's dedicated integration clone and an explicit, gated merge step, and the
provisioner must enforce the 10-clone cap + reliable teardown.

## 12. Review v2 — improvements after integrating the decisions

Re-reviewing §5 against the locked decisions surfaced concrete improvements. Where a point
**supersedes** an earlier section, that is called out.

**12.1 Use `git clone --local` (hardlinks), NOT `--reference`/`--shared` (alternates).
[supersedes D1]** The original D1 borrowed objects via `objects/info/alternates`. But the
canonical is the *live, actively-mutated main repo* (D2) — the coordinator commits merges
there, and `bd`/dolt run against it. If that repo ever repacks or `gc`s, it can prune objects
a clone's alternates still reference → **clone corruption**. `git clone --local <canonical>`
instead **hardlinks** existing objects. Git objects are immutable + content-addressed, and a
hardlink keeps its inode alive even if canonical unlinks its copy during a repack — so the
clone is **gc-safe** with no need to freeze `gc.auto` on canonical. Same near-zero disk +
hardlink-fast setup, without the fragility. (Requires same filesystem — true here.)

**12.2 Agents don't push; the coordinator FETCHES from the agent's clone path. [refines
D1/D3]** Rather than agents pushing branches (which raises "push where? with what auth?" and
re-introduces a shared ref namespace), the coordinator pulls directly from the agent's local
clone directory:
```
git -C <canonical> fetch <agent-clone-path> <branch>:refs/squad/<agentId>/<branch>
git -C <canonical> merge --no-ff refs/squad/<agentId>/<branch>   # on main
<run verify-before-push.sh gate>                                 # tsc + tests at the merge
git -C <canonical> push origin main                              # durability to GitHub
```
Agents now only ever **commit in their own clone** — they never touch canonical, not even a
ref push. Maximal isolation, no per-agent auth, ref collisions impossible. The
`refs/squad/<agentId>/…` namespacing keeps integration refs tidy. Teardown (`rm -rf` clone)
happens **after** the fetch+merge.

**12.3 Neutralize git hooks in clones via `core.hooksPath`. [NEW — fixes a latent bug the
original RFC missed]** The dolt post-checkout hook crash (adj-hq2q) is currently guarded by
`[ -f .git ]`, which is true only for *worktrees* (their `.git` is a file). A **clone's
`.git` is a directory**, so that guard does NOT fire — every `git clone`/checkout would run
the dolt post-checkout hook, and **10 concurrent clone checkouts = concurrent dolt access =
panic.** Clones don't need any hooks (they target canonical's `.beads`), so provision them
with hooks disabled:
```
git clone --local --config core.hooksPath=/dev/null <canonical> <clone>
```
This sidesteps the entire hook-contention class at the source — cleaner than extending the
`[ -f .git ]` guard.

**12.4 Shared beads: reuse the proven "bd targets the canonical path" pattern. [refines
D2]** Don't symlink `.beads` per clone. The existing spawn-prompt contract already has agents
run `bd` against the canonical repo path, and `--local` won't copy `.beads` if it's untracked
(verify this during the spike — if any `.beads` files ARE tracked, add `.beads` to a
clone-time sparse-exclude so clones never carry a stale dolt copy). Keep the bd mutex; with
12.3 the dolt-hook panic is gone.

**12.5 Add a Phase 0 de-risking spike BEFORE the abstraction. [improves §6]** Prove the
risky core on this repo first: (a) measure `git clone --local` disk + wall-time at 10
concurrent; (b) confirm zero dolt-hook panics with `core.hooksPath=/dev/null`; (c) validate
the fetch-from-clone → merge → gate → push flow end-to-end on a throwaway branch. Only build
the provisioner once these hold. (Prove-the-risky-thing-first.)

**12.6 Make teardown/reconciler + cap + gated-merge first-class phases. [improves §6/§7]**
The 10-clone cap (D3) is only real if teardown is reliable. Promote to explicit phases:
(a) `rm -rf` clone on agent decommission *after* its merge; (b) a **startup reconciler** that
sweeps `.claude/clones/*` with no live session (orphans from crashes) so disk + the cap can't
silently exhaust; (c) the coordinator's merge step **runs the full gate** (now incl. tsc) in
canonical before `push origin main` — this is where build-green becomes a merge precondition,
since there's no CI merge queue yet.

**12.7 (Future optimization, not v1) APFS `clonefile`.** On macOS the dev box is APFS, so
`cp -c` (copy-on-write clonefile) could provision a *complete* repo+worktree snapshot near-
instantly. Deferred: it's platform-coupled and `.beads` would need explicit exclusion to stay
a single source of truth. `git clone --local` is portable and sufficient for v1.

### Net effect of v2
The revised core is: **`git clone --local --config core.hooksPath=/dev/null` per agent →
agent commits in its clone → coordinator fetches from the clone path, merges to `main` in
canonical, runs the gate, pushes to origin → `rm -rf` the clone (+ startup reconciler).**
Simpler than v1 (no alternates, no agent push/auth, no `gc` freeze), safer (gc-safe,
hook-safe), and it closes a latent dolt-panic bug that v1 would have shipped.
