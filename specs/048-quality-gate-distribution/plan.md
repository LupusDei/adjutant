# Implementation Plan: Quality Gate Distribution via Init & Upgrade

**Branch**: `048-quality-gate-distribution` | **Date**: 2026-03-24
**Epic**: `adj-123` | **Priority**: P1

## Summary

Extend `adjutant init`, `adjutant upgrade`, `adjutant doctor`, and the plugin hook to distribute the code quality system (from adj-120) into any Adjutant-managed project. Quality files are stored as templates in the Adjutant package and scaffolded/synced via CLI commands.

## Bead Map

- `adj-123` - Root: Quality Gate Distribution via Init & Upgrade
  - `adj-123.1` - Template Infrastructure
    - `adj-123.1.1` - Create template directory and quality file templates
    - `adj-123.1.2` - Create template registry with file manifest
    - `adj-123.1.3` - Tests for template loading and registry
  - `adj-123.2` - Extend Init
    - `adj-123.2.1` - Add quality file scaffolding to init command
    - `adj-123.2.2` - Handle existing files, --force, directory creation
    - `adj-123.2.3` - Tests for init quality scaffolding
  - `adj-123.3` - Extend Upgrade
    - `adj-123.3.1` - Add quality file syncing to upgrade command
    - `adj-123.3.2` - Content-based diff detection (skip if unchanged, update if outdated)
    - `adj-123.3.3` - Tests for upgrade quality syncing
  - `adj-123.4` - Doctor Checks & Plugin Warning
    - `adj-123.4.1` - Add quality file checks to doctor command
    - `adj-123.4.2` - Add missing-quality-files warning to adjutant prime
    - `adj-123.4.3` - Tests for doctor checks and prime warning

## Technical Context

**Stack**: TypeScript 5.x, Node.js CLI (cli/ directory)
**Testing**: Vitest
**Constraints**: Must be idempotent, must not break existing init/upgrade behavior, must not clobber user customizations

## Architecture Decisions

### Why content-based comparison instead of version numbers?

PRIME.md upgrade already uses content-based comparison (read file, compare to canonical, overwrite if different). This is simple, proven, and requires no version metadata. Quality files follow the same pattern — no version headers or tracking files needed.

### Why templates in cli/templates/ instead of inline strings?

Inline template strings (like `PRIME_MD_CONTENT` in `cli/lib/prime.ts`) work for a single file but don't scale to 5+ files. Templates stored as actual files are easier to edit, diff, and review. The template registry maps filenames to their destination paths.

### Why skip existing CI config?

CI workflows are highly project-specific. Overwriting an existing `ci.yml` could break a project's entire deployment pipeline. Init only scaffolds if the file doesn't exist. Upgrade never touches CI files — projects are expected to customize their own CI.

### Why warn in plugin hook instead of block?

Blocking agent startup on missing quality files would break existing projects that haven't run `adjutant upgrade`. A warning in the `adjutant prime` output is sufficient — agents see it and the user can act on it.

### Quality file manifest

The template registry is a simple array of objects:

```typescript
interface QualityFile {
  templateName: string;     // e.g., "03-testing.md"
  destPath: string;         // e.g., ".claude/rules/03-testing.md"
  description: string;      // e.g., "Testing constitution"
  skipIfExists: boolean;    // true for ci.yml, false for others
  executable: boolean;      // true for verify-before-push.sh
}
```

## Files Changed

| File | Change |
|------|--------|
| `cli/templates/quality/03-testing.md` | New: testing constitution template |
| `cli/templates/quality/08-code-review.md` | New: code review protocol template |
| `cli/templates/quality/code-review-skill.md` | New: code review skill template |
| `cli/templates/quality/verify-before-push.sh` | New: pre-push script template |
| `cli/templates/quality/ci.yml` | New: CI pipeline template |
| `cli/lib/quality-templates.ts` | New: template registry and loading functions |
| `cli/commands/init.ts` | Extend: scaffold quality files after existing init steps |
| `cli/commands/upgrade.ts` | Extend: sync quality files after existing upgrade steps |
| `cli/commands/doctor.ts` | Extend: check quality file presence |
| `cli/commands/prime.ts` (or lib/prime.ts) | Extend: warn on missing quality files |
| `backend/tests/unit/quality-templates.test.ts` | New: template registry tests |
| `backend/tests/unit/init-quality.test.ts` | New: init scaffolding tests |
| `backend/tests/unit/upgrade-quality.test.ts` | New: upgrade syncing tests |
| `backend/tests/unit/doctor-quality.test.ts` | New: doctor check tests |

## Phase 1: Template Infrastructure

Create the template files and a registry module that knows how to find and load them.

Key decisions:
- Templates live in `cli/templates/quality/` as real files (not inline strings)
- Registry in `cli/lib/quality-templates.ts` exports the file manifest and loading functions
- Template content is copied from the adj-120 quality files already in the repo

## Phase 2: Extend Init

Add quality file scaffolding to `adjutant init`. Runs after existing PRIME.md + .mcp.json + plugin steps.

Key decisions:
- Each quality file: check if exists → skip (unless --force) → create parent dirs → write file
- `verify-before-push.sh` gets `chmod +x` after write
- `.github/workflows/ci.yml` always skips if exists (even with --force) — too dangerous
- Print check results using existing `printCheck()` infrastructure

## Phase 3: Extend Upgrade

Add quality file syncing to `adjutant upgrade`. Same pattern as PRIME.md upgrade.

Key decisions:
- Read canonical template → read existing file → compare → skip/update
- Missing files are created (like PRIME.md when it doesn't exist)
- CI file is never touched by upgrade (skip always)
- `--force` flag already exists on upgrade — respect it for quality files too

## Phase 4: Doctor Checks & Plugin Warning

Add quality file presence checks to doctor. Add a warning to `adjutant prime` output.

Key decisions:
- Doctor checks each quality file: exists → pass, missing → fail ("run adjutant upgrade")
- No outdated detection in doctor (would require loading templates at runtime — overkill for diagnostics)
- Plugin warning: `adjutant prime` checks for quality files and appends a warning line if any are missing
- Warning is informational only — does not change exit code

## Parallel Execution

- Phase 1 (Templates) blocks all other phases
- After Phase 1: Phases 2, 3, 4 can ALL run in parallel
  - Phase 2 (Init) — cli/commands/init.ts changes
  - Phase 3 (Upgrade) — cli/commands/upgrade.ts changes
  - Phase 4 (Doctor + Plugin) — cli/commands/doctor.ts and prime changes

## Verification Steps

- [ ] `adjutant init` in a fresh directory creates all 5 quality gate files
- [ ] `adjutant init` again skips existing files (idempotent)
- [ ] `adjutant init --force` overwrites quality files
- [ ] `adjutant upgrade` updates outdated quality files
- [ ] `adjutant upgrade` skips up-to-date files
- [ ] `adjutant upgrade` creates missing quality files
- [ ] `adjutant doctor` reports missing quality files as "fail"
- [ ] `adjutant prime` warns when quality files are missing
- [ ] `scripts/verify-before-push.sh` is executable after init
- [ ] `.github/workflows/ci.yml` is never overwritten
- [ ] All existing init/upgrade behavior is preserved
- [ ] All tests pass: `npm test`
