# Upstream Issues (external — not fixable in this repo)

Issues that live in third-party tools (Claude Code harness, `bd`/dolt, etc.). We
track them here with repro steps so they can be reported upstream and so our
in-repo mitigations have a paper trail. Each entry links to the Adjutant bead.

---

## UI-1 — Claude Code Task tool: resuming a background worktree agent resets cwd to the main repo

- **Adjutant bead:** adj-c2bbv (split from adj-iqyqw)
- **Component:** Claude Code — Agent/Task tool with `isolation: "worktree"`, background agents (`run_in_background: true`), resumed via `SendMessage`
- **Observed version:** Claude Code v2.1.156
- **Severity:** High — silent data loss (file edits land in the shared main repo, clobbering other agents' work, with no error)
- **Status:** open upstream; mitigated on our side (see "Our mitigation")

### Summary
A sub-agent spawned with `isolation: "worktree"` correctly runs in its own git
worktree (`.claude/worktrees/agent-<id>`) on first run. But once that background
agent completes (or errors) and is **resumed** via `SendMessage`, the resumed
turn runs with the process cwd set to the **main repository root**, not the
agent's worktree. Every `Bash` tool call on the resumed turn therefore starts a
fresh shell in the main repo, so any relative file write lands in the shared
working tree instead of the isolated worktree — silently, with no warning.

### Expected behavior
A resumed worktree-isolated agent should resume with its cwd set to its
worktree (the same cwd it had on its first run), preserving the isolation
guarantee for the agent's entire lifetime.

### Actual behavior
- First run: cwd = `.../.claude/worktrees/agent-<id>` (correct, persists across Bash calls).
- Resumed run: cwd = `.../<main-repo-root>` (wrong); file edits leak into the main repo.

### Reproduction
Environment: a git repo, Claude Code v2.1.156.

1. Spawn a background worktree agent that runs six **separate** Bash calls and reports each one's raw stdout:
   ```
   Agent({
     isolation: "worktree",
     run_in_background: true,
     prompt: "Run these as SEPARATE Bash calls and report each stdout:
              1) pwd
              2) git rev-parse --show-toplevel
              3) echo marker > probe.txt && pwd && ls -la probe.txt
              4) pwd
              5) git rev-parse --show-toplevel && git status --short
              6) realpath probe.txt"
   })
   ```
   **Result (correct):** all six report cwd = `.../.claude/worktrees/agent-<id>`; `probe.txt` is created inside the worktree; the main repo `git status` is clean.

2. After it completes, **resume** the same agent with the same instruction via `SendMessage({ to: "<agentId>", message: "Run the six Bash calls again ..." })`.
   **Result (bug):** all six report cwd = `.../<main-repo-root>`; `probe.txt` is created in the **main repo**; the main repo `git status` now shows `probe.txt` as untracked.

This contrast (same agent, fresh vs resumed) isolates the defect to the resume path.

### Impact
In a multi-agent squad, a coordinator that re-engages a finished worktree agent
(e.g. to assign a follow-up fix) causes that agent to edit the shared tree. In
Adjutant this produced real incidents (adj-iqyqw): an agent's work committed to
the wrong tree, later destroyed by a `git reset --hard` during recovery (~1–2
engineer-days lost per incident).

Worse, the leaked cwd is not limited to file writes: a leaked `git checkout -b`
moves the **main repo's HEAD** onto a stray branch (adj-laz97). Subsequent
coordinator merges then land on the stray branch and `git push origin main`
reports "up-to-date" while main is silently wrong — a whole-squad corruption
vector, not just one agent's lost edits. (Caught and recovered with zero loss in
the adj-164 squad via a branch-verify-before-merge guard.)

Note: we verified the FRESH-spawn path still isolates correctly on Claude Code
v2.1.156 (probes: a fresh background worktree agent — both `general-purpose` and a
custom `subagent_type` — reports `git-dir` under `.claude/worktrees/…` on its
first turn). So a leak from a "fresh" spawn means either the spawn did not
actually carry `isolation: "worktree"`, or the agent was resumed (this bug). Our
in-repo mitigation now forbids worktree agents from running `git checkout -b` at
all and asserts worktree residence before any git write, so the vector is closed
regardless of which sub-case occurs.

### Suggested fix (upstream)
On resume of a worktree-isolated agent, restore the agent's cwd to its worktree
before executing the turn (persist the worktree path with the agent's session
state and `chdir` into it on resume), so isolation holds for the agent's full
lifecycle — not just its first run.

### Our mitigation (in-repo, until upstream fixes it)
- `skills/squad-execute/SKILL.md`: squad leaders must NOT `SendMessage`-resume a
  completed worktree agent for file work — spawn a fresh worktree agent instead;
  if a resume is unavoidable, the message must instruct `cd <worktree> &&` before
  every Bash call and verify the main-repo `git status` stays clean.
- `skills/squad-execute/squad-member-context.md`: every squad member is told that
  on a resumed turn it may be in the main repo, to `cd` back into its worktree (or
  refuse file edits and ask for a fresh spawn), and to verify the shared tree
  stays clean.
- `backend/tests/unit/squad-isolation-rule.test.ts`: asserts the rule text is
  present in both templates so the mitigation can't be silently dropped.
- Note: Adjutant's own tmux-based spawn path (`createSwarm` / `LifecycleManager`)
  is unaffected — it sets `tmux new-session -c <worktree>`, so the shell stays in
  the worktree across the agent's lifetime (locked by tests in adj-iqyqw).

---

## UI-2 — Claude Code Task tool: a fresh worktree agent's FIRST command can run in the main repo (first-command cwd race)

- **Adjutant bead:** adj-laz97
- **Component:** Claude Code — Agent/Task tool with `isolation: "worktree"`, `run_in_background: true`, under heavy concurrent spawn load
- **Observed version:** Claude Code v2.1.156
- **Severity:** High — silent data loss / shared-state corruption (a leaked `git checkout -b` moves the main repo's HEAD)
- **Confidence:** Medium — reconstructed from git reflogs of a live incident; NOT yet deterministically reproduced (a single-agent probe under light load did not trigger it — it appears load/timing dependent)

### Summary
Distinct from UI-1 (resume). Here a FRESH background worktree agent's worktree IS
created correctly, but the agent's **first** `Bash` command runs with cwd = the
**main repo** (the worktree `chdir` had not yet taken effect for the first shell);
subsequent commands run correctly in the worktree. If that first command is the
agent's customary "create my feature branch" step (`git checkout -b <branch>`), it
executes against the main working tree and moves **main's HEAD** onto the new
branch.

### Evidence (adj-laz97, reconstructed from reflogs)
A squad iOS agent (worktree `agent-a94c22cccecd72776`):
- worktree `logs/HEAD`: created at `t0`, then three task commits at `t0+5m…`, all
  on its harness branch `worktree-agent-a94c22cccecd72776` (correct, in-worktree).
- main `.git/logs/HEAD`: `checkout: moving from main to feat/adj-164.3-dm-ios` at
  `t0+94s` — i.e. between worktree creation and the agent's first in-worktree
  commit. The agent's later commits ran in the worktree; only the first git
  command leaked to main.
- Net effect: main HEAD moved to a stray branch; a coordinator merge then landed
  on the stray branch and `git push origin main` reported "up-to-date" while main
  was wrong. Recovered with zero loss via a branch-verify-before-merge guard.

### Expected behavior
A worktree-isolated agent's cwd must be its worktree for its **first** command, not
just subsequent ones — establish the worktree chdir before the agent runs anything.

### Suggested fix (upstream)
Ensure the worktree `chdir` is applied before the agent's first tool call executes
(await worktree setup completion before the first turn), so there is no window in
which the first command inherits the parent (main repo) cwd — especially under
concurrent multi-agent spawn load.

### Our mitigation (in-repo)
Same as the adj-laz97 in-repo fix: worktree agents are forbidden from running
`git checkout -b` / switching branches (they commit on their harness branch and
`git push -u origin HEAD`), and must assert `git-dir` is under `.claude/worktrees`
before any git write (else abort + report). The coordinator verifies
`git branch --show-current` == `main` before every merge/push. These close the
vector regardless of whether the leak came from a resume (UI-1) or this
first-command race (UI-2).
