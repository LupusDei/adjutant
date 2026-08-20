#!/usr/bin/env bash
#
# Install Adjutant's git hook guards (adj-mtzot step 2).
#
# THE PROBLEM THIS SOLVES. .git/hooks/post-checkout is owned by beads: everything between
#   # --- BEGIN BEADS INTEGRATION vX ---  ...  # --- END BEADS INTEGRATION vX ---
# is rewritten wholesale whenever `bd` regenerates the hook. A worktree guard placed inside that
# block is therefore silently deleted on the next regeneration — which is exactly how the guard
# went missing before. This installer writes the guard ABOVE the beads block, in its own marked
# region, where regeneration cannot reach it.
#
# WHAT THE GUARD DOES. Beads/dolt panics on concurrent access, and every linked worktree shares
# the canonical repo's hooks directory — so a checkout in any of the parallel agent worktrees
# fires this hook against the same dolt database. In a linked worktree `.git` is a FILE (a gitfile
# pointer); in the canonical repo it is a DIRECTORY. Testing for that is the whole guard.
#
# Idempotent: re-running replaces the guard region rather than stacking copies. Hooks are not
# version-controlled, so this script is the tracked source of truth — run it after cloning, and
# after any `bd init` that regenerates hooks.
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "install-git-hooks: not a git repository." >&2
  exit 1
}

# --git-common-dir points at the CANONICAL .git even when invoked from a worktree, so the guard
# always lands in the one hooks directory every worktree shares.
GIT_COMMON=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || git rev-parse --git-common-dir)
case "$GIT_COMMON" in
  /*) ;;
  *) GIT_COMMON="$REPO_ROOT/$GIT_COMMON" ;;
esac

HOOK_DIR="$GIT_COMMON/hooks"
HOOK="$HOOK_DIR/post-checkout"

GUARD_BEGIN="# --- BEGIN ADJUTANT WORKTREE GUARD (adj-mtzot) ---"
GUARD_END="# --- END ADJUTANT WORKTREE GUARD ---"

mkdir -p "$HOOK_DIR"

SHEBANG="#!/usr/bin/env sh"
BODY=""
if [ -f "$HOOK" ]; then
  FIRST_LINE=$(head -n 1 "$HOOK")
  case "$FIRST_LINE" in
    "#!"*) SHEBANG="$FIRST_LINE"; BODY=$(tail -n +2 "$HOOK") ;;
    *)     BODY=$(cat "$HOOK") ;;
  esac
fi

# Drop any previously installed guard region so this is a replace, never an append.
BODY=$(printf '%s\n' "$BODY" | awk -v b="$GUARD_BEGIN" -v e="$GUARD_END" '
  index($0, b) { skip = 1; next }
  index($0, e) { skip = 0; next }
  !skip { print }
')

TMP=$(mktemp)
{
  printf '%s\n' "$SHEBANG"
  printf '%s\n' "$GUARD_BEGIN"
  printf '%s\n' "# Managed by scripts/install-git-hooks.sh — do NOT move this inside the beads markers."
  printf '%s\n' "# bd rewrites its own block on regeneration and would delete this guard with it."
  printf '%s\n' "# In a linked worktree .git is a FILE; in the canonical repo it is a DIRECTORY."
  printf '%s\n' "# dolt panics on concurrent access, so the hook must do nothing inside a worktree."
  printf '%s\n' 'if [ -f .git ]; then exit 0; fi'
  printf '%s\n' "$GUARD_END"
  printf '%s\n' "$BODY"
} > "$TMP"

mv "$TMP" "$HOOK"
chmod +x "$HOOK"

echo "install-git-hooks: worktree guard installed above the beads block in $HOOK"
