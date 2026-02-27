# Beads Workflow Reference

**All work uses BEADS library with strictly hierarchical beads.**

## Identifier Format

- Root epic: `bd-xxx` where `bd` represents the beads prefix for the project
  (e.g. `adj-` for adjutant, `gt-` for gastown)
  `xxx` = **sequential numeric** (e.g. `bd-001`, `bd-002`, `bd-003`)
- Sub-levels: append `.n` (sequential integers starting at 1)
  Examples: `bd-001.1`, `bd-042.1.3`, `bd-138.2.4.1`

Levels:
1. **Epic**     `bd-xxx`       type=epic     Major feature/refactor/theme
2. **Sub-Epic** `bd-xxx.n`     type=epic     Phases/parallel paths (skip if small)
3. **Task**     `bd-xxx.n.m`   type=task     Deliverable work unit (use `bd-xxx.m` if no sub-epics)
4. **Improvement** `bd-xxx.n.m.p` type=task|bug
   Only for: bug fix / refactor / extra tests
   If broader, scope under sub-epic/epic: `bd-xxx.n.p`

**Rules**
- Sequential root IDs
- Create before implementation
- Reference IDs in commits/PRs/logs/comments
- Improvements = quality artifacts only
- Max depth ~4
- **Epics auto-close**: Do NOT manually `bd close` an epic — epics auto-complete when all children are closed (via `bd epic close-eligible`). Manually closing an epic will fail with EPIC_CLOSE_BLOCKED.
- Always link dependencies when order matters

## Finding Next Root ID

```bash
bd list --status=all | grep "bd-" | head -20
# Look for highest bd-xxx root ID, use next number
```

## Creating Beads

### Root Epic
```bash
bd create --id=bd-012 \
  --title="Feature Name" \
  --description="Why this epic exists and what it delivers" \
  --type=epic \
  --priority=2
```

### Sub-Epics (one per phase)
```bash
bd create --id=bd-012.1 --title="Setup: Initialize project" --description="..." --type=epic --priority=1
bd create --id=bd-012.2 --title="Foundational: Core types" --description="..." --type=epic --priority=1
bd create --id=bd-012.3 --title="US1: [Story title]" --description="..." --type=epic --priority=1
bd create --id=bd-012.4 --title="US2: [Story title]" --description="..." --type=epic --priority=2
bd create --id=bd-012.5 --title="Polish: Cross-cutting" --description="..." --type=epic --priority=3
```

### Tasks (under sub-epics)
```bash
bd create --id=bd-012.3.1 --title="Create Widget model" --description="..." --type=task --priority=1
bd create --id=bd-012.3.2 --title="Add Widget service" --description="..." --type=task --priority=1
```

## Hierarchy Wiring (MANDATORY)

After creating any set of hierarchical beads, you MUST wire dependencies **immediately** — not later, not as an afterthought.

```bash
# Example: after creating bd-001 (epic) with sub-epics .1, .2, .3
bd dep add bd-001 bd-001.1    # root depends on sub-epic 1
bd dep add bd-001 bd-001.2    # root depends on sub-epic 2
bd dep add bd-001 bd-001.3    # root depends on sub-epic 3

# After creating tasks under sub-epic bd-001.1
bd dep add bd-001.1 bd-001.1.1   # sub-epic depends on task 1
bd dep add bd-001.1 bd-001.1.2   # sub-epic depends on task 2
```

**Rules:**
- Every child bead must be linked to its parent via `bd dep add <parent> <child>`
- Do this in the same step as `bd create`, not after
- `bd show <parent>` must display all children — verify this
- Parent epics auto-close when all children are closed (enforced by deps) — do NOT close them manually

### Cross-phase blocking (Foundational blocks user stories)
```bash
# At epic level:
bd dep add bd-012.3 bd-012.2     # US1 epic blocked by Foundational epic
# Or at task level:
bd dep add bd-012.3.1 bd-012.2   # US1 task 1 blocked by Foundational
```

### Sequential task dependencies
```bash
# Task B depends on Task A (A must finish first)
bd dep add bd-012.3.2 bd-012.3.1
```

### Verification

After wiring, verify the hierarchy:
```bash
bd show bd-012       # Should list all sub-epics as dependencies
bd show bd-012.3     # Should list its tasks as dependencies
bd blocked           # Should show cross-phase blocking relationships
```

## How Spec Artifacts Map to Beads

| Spec Phase | Bead Level | Numbering |
|---|---|---|
| Phase 1: Setup | Sub-Epic `.1` | Phase N = sub-epic `.N` |
| Phase 2: Foundational | Sub-Epic `.2` | Always in sync |
| Phase 3: US1 | Sub-Epic `.3` | Skip unused numbers together |
| Task T005 under Phase 3 | Task `.3.1` | Sequential within sub-epic |
| Bug found during T005 impl | Improvement `.3.1.1` | Created during impl, not planning |

**T-IDs → Bead IDs**: Tasks.md uses `T001`-style IDs for authoring. Beads-import.md maps each T-ID to its bead ID (`bd-xxx.N.M`). Once beads exist, the bead ID is the source of truth.

## Planning & Execution

1. Create root epic (`bd create ... --type=epic`)
2. Break into sub-epics (`.1`, `.2`, ...) — one per spec phase
3. Break into tasks (`.1`, `.2`, ...) — one per T-ID in that phase
4. During/after, spawn `.p` improvements under affected task (or sub-epic)

## Priority Mapping

| Phase | Priority |
|-------|----------|
| Setup | 1 |
| Foundational | 1 |
| US1 (MVP) | 1 |
| US2 | 2 |
| US3 | 3 |
| Polish | highest US priority + 1 |

Use numeric priorities only (0-4): 0=critical, 1=high, 2=medium, 3=low, 4=backlog.

## Status Transitions

```
open -> in_progress -> closed
```

- `bd update bd-012.3.1 --status=in_progress` when starting
- `bd close bd-012.3.1` when done
- **Epics auto-close** when all children are closed — do NOT manually `bd close` an epic

## Commit Message Format

**Commit example**: `fix: bd-032.1.2.1 token expiry race`, `task: bd-002.1.3 new login form with all field checks`

## Efficiency Tips

- Create beads in bulk — run multiple `bd create` commands in sequence
- Wire all parent-child deps in one batch after creating a level
- Use `bd close id1 id2 id3` to close multiple at once
- Run `bd sync` after major changes to push to git

Keep hierarchy clean, shallow, and sequentially-rooted.
