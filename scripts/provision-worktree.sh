#!/usr/bin/env bash
# provision-worktree.sh — instantly provision node_modules into a git worktree
# by SYMLINKING them from the main repo (adj-pd49t).
#
# Why: root/backend/frontend node_modules are gitignored, so `git worktree add`
# creates a worktree WITHOUT them. A fresh worktree engineer then runs a slow
# `npm install` that trips the 600s spawn watchdog and stalls. Symlinking is
# O(1) and Node resolves modules through the symlink fine (pnpm-style).
#
# Safe + idempotent:
#   - skips a target that already exists (real dir OR symlink) — never clobbers
#     an agent's own `npm install` output
#   - skips a source that doesn't exist in the main repo
#   - re-running is a no-op
#
# Usage:
#   scripts/provision-worktree.sh <worktree-path> [main-repo-path]
# main-repo-path defaults to this script's own repo root, so worktree agents can
# run `scripts/provision-worktree.sh .` as their first setup step.

set -u

WORKTREE="${1:-}"
if [ -z "$WORKTREE" ]; then
  echo "usage: provision-worktree.sh <worktree-path> [main-repo-path]" >&2
  exit 2
fi

if [ ! -d "$WORKTREE" ]; then
  echo "FAIL: worktree path does not exist: $WORKTREE" >&2
  exit 1
fi

# Resolve the main repo path:
#   1. explicit 2nd arg wins (swarm-service passes projectPath)
#   2. else auto-detect from the worktree's git-common-dir — for a LINKED
#      worktree this is the main repo's .git, so its parent is the main repo.
#      This lets a Task-tool agent just run `provision-worktree.sh .`.
#   3. else fall back to the repo this script lives in (<root>/scripts/..).
DEFAULT_MAIN="$(cd "$(dirname "$0")/.." && pwd -P)"
if [ -n "${2:-}" ]; then
  MAIN="$2"
else
  common="$(git -C "$WORKTREE" rev-parse --git-common-dir 2>/dev/null || true)"
  if [ -n "$common" ]; then
    case "$common" in
      /*) common_abs="$common" ;;
      *)  common_abs="$WORKTREE/$common" ;;
    esac
    MAIN="$(cd "$common_abs/.." 2>/dev/null && pwd -P || echo "$DEFAULT_MAIN")"
  else
    MAIN="$DEFAULT_MAIN"
  fi
fi

if [ ! -d "$MAIN" ]; then
  echo "FAIL: main repo path does not exist: $MAIN" >&2
  exit 1
fi

# Absolute paths so the symlinks resolve from any worktree depth.
WORKTREE_ABS="$(cd "$WORKTREE" && pwd -P)"
MAIN_ABS="$(cd "$MAIN" && pwd -P)"

green() { printf "\033[32m%s\033[0m\n" "$1"; }
yellow() { printf "\033[33m%s\033[0m\n" "$1"; }

linked=0
skipped=0
for rel in node_modules backend/node_modules frontend/node_modules; do
  src="$MAIN_ABS/$rel"
  dst="$WORKTREE_ABS/$rel"

  # Skip if the target already exists (real directory OR an existing symlink) —
  # never clobber an agent's own install.
  if [ -e "$dst" ] || [ -L "$dst" ]; then
    echo "  skip $rel (already present)"
    skipped=$((skipped + 1))
    continue
  fi
  # Skip if there's nothing to link from.
  if [ ! -d "$src" ]; then
    echo "  skip $rel (no source in main repo)"
    skipped=$((skipped + 1))
    continue
  fi

  mkdir -p "$(dirname "$dst")"
  ln -s "$src" "$dst"
  green "  linked $rel -> $src"
  linked=$((linked + 1))
done

if [ "$linked" -eq 0 ] && [ "$skipped" -gt 0 ]; then
  yellow "provision-worktree: nothing to link (all present or no sources)"
else
  green "provision-worktree: $linked symlink(s) created, $skipped skipped"
fi
exit 0
