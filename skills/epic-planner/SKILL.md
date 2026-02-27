---
name: epic-planner
description: Create structured epic hierarchies for new features, major refactorings, and large tasks. Generates speckit-style artifacts (spec.md, plan.md, tasks.md, beads-import.md) in specs/ and creates real beads via `bd` CLI with wired dependencies. Use when the user says things like "Create a new epic for ...", "I want to do a major refactoring ...", "Time for a new plan", "Let's add a new feature", "New epic", or any request to plan and track a significant body of work.
---

# Epic Planner

Plan and scaffold a complete epic hierarchy: from idea to beads-tracked, dependency-wired tasks ready for multi-agent execution.

## Spec → Bead Mapping

Every spec artifact maps to a bead hierarchy level. Use the project's beads prefix (e.g. `adj-` for adjutant, `gt-` for gastown) — shown here as `bd-` generically.

| Spec Artifact | Section | Bead Level | Bead ID | Bead Type |
|---|---|---|---|---|
| spec.md | User Story N (Priority: PN) | Sub-Epic | `bd-xxx.N` | epic |
| plan.md | Phase N heading | Sub-Epic | `bd-xxx.N` | epic |
| tasks.md | `T001` task line under Phase N | Task | `bd-xxx.N.M` | task |
| beads-import.md | Task table row | Task | `bd-xxx.N.M` | task |
| *(created during impl)* | Bug fix / refactor / extra tests | Improvement | `bd-xxx.N.M.P` | task\|bug |

**T-IDs vs Bead IDs**: `T001`, `T002` etc. are authoring-time identifiers used in tasks.md for readability. Bead IDs (`bd-xxx.N.M`) are the runtime tracking identifiers that replace them once beads are created. The beads-import.md table maps between them.

**Phase-to-sub-epic numbering**: Phases in tasks.md and sub-epics in beads share the same sequential numbering. Phase 1 = `.1`, Phase 2 = `.2`, etc. If you skip a phase (e.g. no Setup needed), skip that sub-epic number too — keep them in sync.

## Workflow

### Phase 0: Discover & Clarify

Before generating anything, ask 3-5 targeted questions using `AskUserQuestion`. Good areas to probe:

1. **Scope** - What's in, what's explicitly out?
2. **Tracks** - Are there natural parallel streams (backend/frontend, infra/feature, data/UI)?
3. **MVP** - Which user story is the minimum viable delivery?
4. **Constraints** - Performance targets, platform requirements, dependencies on external systems?
5. **Priority** - P0 (critical) through P4 (backlog)?

Skip questions whose answers are obvious from the user's description.

### Phase 1: Setup Feature Directory

Determine the next feature number by scanning `specs/` for existing directories:

```
ls specs/ | sort -n | tail -1   # e.g., 007-push-notifications
# Next number: 008
```

Create directory: `specs/###-feature-name/`

### Phase 2: Generate Artifacts

Generate four files in order. Use the templates in `references/templates.md` as the structural guide — fill them with content derived from the user's description and your clarification answers.

1. **spec.md** - What to build (user stories with acceptance criteria, requirements, success criteria)
2. **plan.md** - How to build (architecture decisions, file paths, phases, parallel opportunities)
3. **tasks.md** - Executable task checklist (T001 format with [P] and [US] markers, exact file paths)
4. **beads-import.md** - Bead hierarchy mapping (root epic, sub-epics per phase, task tables)

Write all four files to `specs/###-feature-name/`.

**Small features (< 5 tasks)**: Skip sub-epics entirely. Use the simplified template variant in templates.md. Tasks go directly under the root epic (`bd-xxx.1`, `bd-xxx.2` as tasks, not sub-epics).

### Phase 3: Create Beads

Use `bd` CLI to create real beads matching the hierarchy in beads-import.md. See `references/beads-workflow.md` for the exact commands and conventions.

**Hierarchy pattern** (using project prefix, e.g. `adj-`):
```
bd-xxx           (root epic, type=epic)
  bd-xxx.1       (sub-epic: Setup, type=epic)
  bd-xxx.2       (sub-epic: Foundational, type=epic)
  bd-xxx.3       (sub-epic: US1, type=epic)
    bd-xxx.3.1   (task under US1, type=task)
    bd-xxx.3.2   (task under US1, type=task)
  bd-xxx.4       (sub-epic: US2, type=epic)
  ...
```

Steps:
1. Find next available root ID: `bd list --status=all` and pick next sequential root
2. Create root epic: `bd create --id=bd-xxx --title="..." --description="..." --type=epic --priority=N`
3. Create sub-epics for each phase (Setup, Foundational, US1, US2..., Polish)
4. Create tasks under each sub-epic
5. **Wire dependencies immediately** (MANDATORY — see beads-workflow.md)

### Phase 4: Update Artifacts with Bead IDs

After creating beads, update beads-import.md and plan.md with the actual bead IDs. Add a bead map block to plan.md:

```markdown
## Bead Map

- `bd-xxx` - Root epic: [Title]
  - `bd-xxx.1` - Setup
    - `bd-xxx.1.1` - [Task title]
  - `bd-xxx.2` - Foundational
  - `bd-xxx.3` - US1: [Title]
    - `bd-xxx.3.1` - [Task title]
```

### Phase 5: Summary

Report to the user:
- Feature directory path
- Root epic ID and total bead count
- Bead hierarchy overview (the bead map)
- Suggested next step: "Run `bd ready` to see unblocked tasks, or assign work to team agents"

## Improvements (Post-Planning)

Improvements are Level 4 beads (`bd-xxx.N.M.P`) created **during implementation**, not during planning. They cover:
- Bug fixes discovered while building a task
- Refactors needed after initial implementation
- Extra tests identified during code review

Create them as children of the affected task. Example: while implementing `bd-012.3.1`, you discover a bug → create `bd-012.3.1.1` as type=bug. Wire it: `bd dep add bd-012.3.1 bd-012.3.1.1`.

Do NOT pre-plan improvements in the spec artifacts — they emerge organically.

## Key Rules

- **One root epic per feature** — never create multiple roots
- **Wire deps immediately** after creating beads — not as an afterthought
- **Exact file paths** in every task description
- **[P] marker** only when tasks touch different files with no dependencies
- **Sequential IDs** within each level (`.1`, `.2`, `.3`, not random)
- **Phase numbers = sub-epic numbers** — keep them in sync
- **Skip sub-epics** for tiny features (< 5 tasks) — put tasks directly under root

## References

- [templates.md](references/templates.md) - Speckit-compatible templates for all four artifacts
- [beads-workflow.md](references/beads-workflow.md) - `bd` CLI commands, dependency wiring, and ID conventions
