#!/usr/bin/env bash
#
# Alarm when local `main` is AHEAD of origin/main (adj-mtzot step 3).
#
# WHY THIS EXISTS. The canonical repo was found with `main` carrying six commits from another
# project's feature branch — committed locally, never pushed — while simultaneously sitting one
# commit BEHIND origin/main. Two failures came out of that single state:
#   * a merged fix ran nowhere for a day, because the live backend serves from that checkout;
#   * a plain `git push` from the canonical repo would have put six unreviewed commits on main.
# Neither was visible until someone went looking. This check makes it a one-line answer.
#
# CONTRACT. `main` should only ever FAST-FORWARD. Behind is normal (you just have not pulled).
# Ahead is drift, and drift is what nobody notices. So: ahead -> exit 1; anything else -> exit 0.
#
# Runs from any worktree: refs/heads/main and refs/remotes/origin/main are shared across all of
# them, so a worktree checks the canonical repo's state without touching it.
set -uo pipefail

MAIN_REF="refs/heads/main"
REMOTE_REF="refs/remotes/origin/main"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "main-divergence: not a git repository — skipping."
  exit 0
fi

# Best-effort refresh so a stale remote ref cannot raise a false alarm. Never fatal: this check
# must not fail a push just because the network blipped.
git fetch --quiet origin main 2>/dev/null || true

if ! git show-ref --verify --quiet "$MAIN_REF"; then
  echo "main-divergence: no local 'main' branch — nothing to check."
  exit 0
fi

if ! git show-ref --verify --quiet "$REMOTE_REF"; then
  echo "main-divergence: no origin/main to compare against — skipping."
  exit 0
fi

AHEAD=$(git rev-list --count "$REMOTE_REF..$MAIN_REF" 2>/dev/null || echo 0)
BEHIND=$(git rev-list --count "$MAIN_REF..$REMOTE_REF" 2>/dev/null || echo 0)

if [ "$AHEAD" -eq 0 ]; then
  if [ "$BEHIND" -gt 0 ]; then
    echo "main-divergence: ok — local main is in sync with origin/main (behind by $BEHIND, which is normal; pull to catch up)."
  else
    echo "main-divergence: ok — local main matches origin/main."
  fi
  exit 0
fi

echo ""
echo "!!! MAIN DIVERGENCE — local 'main' is AHEAD of origin/main by $AHEAD commit(s) !!!"
echo ""
echo "  main should only ever fast-forward. Commits sitting on local main are unpushed drift:"
echo "  they are invisible to everyone else, and a plain 'git push' would publish them to main"
echo "  without review. If the live backend serves from this checkout, it may also be running"
echo "  code that does not match origin/main."
echo ""
git log --oneline --no-decorate "$REMOTE_REF..$MAIN_REF" | sed 's/^/    /'
echo ""
echo "  If those commits belong on a feature branch (check first — they may already be pushed"
echo "  there), reset main to the remote:"
echo "      git checkout main && git reset --hard origin/main"
echo "  Verify they are safe FIRST:"
echo "      git branch -r --contains <sha>"
echo ""
exit 1
