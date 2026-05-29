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
