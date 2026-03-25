# Tasks: Quality Gate Distribution via Init & Upgrade

**Epic**: adj-123 | **Spec**: 048-quality-gate-distribution

## Phase 1 — Template Infrastructure (blocks all)

- [ ] T001 [US5] Create quality file templates in cli/templates/quality/
  - Copy `.claude/rules/03-testing.md` → `cli/templates/quality/03-testing.md`
  - Copy `.claude/rules/08-code-review.md` → `cli/templates/quality/08-code-review.md`
  - Copy `.claude/skills/code-review/SKILL.md` → `cli/templates/quality/code-review-skill.md`
  - Copy `scripts/verify-before-push.sh` → `cli/templates/quality/verify-before-push.sh`
  - Create `cli/templates/quality/ci.yml` from `.github/workflows/ci.yml` (genericized)

- [ ] T002 [US5] Create template registry module in cli/lib/quality-templates.ts
  - Export `QUALITY_FILES` manifest array (templateName, destPath, description, skipIfExists, executable)
  - Export `loadTemplate(templateName)` — reads template from cli/templates/quality/
  - Export `getQualityFilePaths()` — returns all dest paths for doctor checks
  - Resolve template directory relative to module location (like getPackageRoot pattern)

- [ ] T003 [US5] Tests for template infrastructure in backend/tests/unit/quality-templates.test.ts
  - Test: all templates in manifest exist on disk
  - Test: loadTemplate returns content for each template
  - Test: getQualityFilePaths returns expected paths
  - Test: manifest destPaths are valid relative paths

## Phase 2 — Extend Init (after Phase 1)

- [ ] T004 [US1] Add quality file scaffolding to init in cli/commands/init.ts
  - Import `QUALITY_FILES` and `loadTemplate` from quality-templates
  - After existing init steps, iterate QUALITY_FILES:
    - Create parent directories (mkdirSync recursive)
    - If file exists and !force: skip with message
    - If skipIfExists and file exists: always skip (ci.yml)
    - Otherwise: write template content
    - If executable: chmod +x
  - Print check results using printCheck()

- [ ] T005 [US1] Tests for init quality scaffolding in backend/tests/unit/init-quality.test.ts
  - Test: fresh init creates all 5 quality files
  - Test: re-running init skips existing files
  - Test: --force overwrites quality files (except ci.yml)
  - Test: ci.yml is never overwritten even with --force
  - Test: verify-before-push.sh is executable after init
  - Test: .claude/ and scripts/ directories are created if missing

## Phase 3 — Extend Upgrade (after Phase 1)

- [ ] T006 [P] [US2] Add quality file syncing to upgrade in cli/commands/upgrade.ts
  - Import `QUALITY_FILES` and `loadTemplate` from quality-templates
  - After existing upgrade steps, iterate QUALITY_FILES:
    - If skipIfExists (ci.yml): always skip
    - If file doesn't exist: create it (like missing PRIME.md)
    - If file exists and content matches template: skip ("up to date")
    - If file exists and content differs: overwrite and report line count change
  - Respect existing --force behavior

- [ ] T007 [P] [US2] Tests for upgrade quality syncing in backend/tests/unit/upgrade-quality.test.ts
  - Test: upgrade creates missing quality files
  - Test: upgrade skips up-to-date files
  - Test: upgrade updates outdated files with line count diff
  - Test: ci.yml is never touched
  - Test: --force behavior

## Phase 4 — Doctor Checks & Plugin Warning (after Phase 1)

- [ ] T008 [P] [US4] Add quality file checks to doctor in cli/commands/doctor.ts
  - Import `getQualityFilePaths` from quality-templates
  - Add a "Quality Gates" section after existing file checks
  - For each quality file: exists → pass, missing → fail ("run adjutant upgrade")

- [ ] T009 [P] [US3] Add missing-quality-files warning to adjutant prime output
  - In `cli/commands/prime.ts` or `cli/lib/prime.ts`:
    - After outputting PRIME.md content, check for quality file presence
    - If any missing: append warning line to stdout
  - Warning is informational only — exit code unchanged

- [ ] T010 [P] [US3,US4] Tests for doctor and prime in backend/tests/unit/doctor-quality.test.ts
  - Test: doctor reports pass for present quality files
  - Test: doctor reports fail for missing quality files
  - Test: prime warns when quality files are missing
  - Test: prime doesn't warn when all quality files are present

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Template Infrastructure | 3 | 1 | adj-123.1 |
| 2: Extend Init | 2 | 1 | adj-123.2 |
| 3: Extend Upgrade | 2 | 1 | adj-123.3 |
| 4: Doctor & Plugin | 3 | 2 | adj-123.4 |
| **Total** | **10** | | |

## Dependency Graph

```
Phase 1: Template Infrastructure (adj-123.1)
    |
    +--- blocks all --->
    |                   |                    |
Phase 2: Init        Phase 3: Upgrade     Phase 4: Doctor & Plugin
(adj-123.2)          (adj-123.3)          (adj-123.4)
[parallel]           [parallel]           [parallel]
```
