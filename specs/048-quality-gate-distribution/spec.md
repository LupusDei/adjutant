# Feature Specification: Quality Gate Distribution via Init & Upgrade

**Feature Branch**: `048-quality-gate-distribution`
**Created**: 2026-03-24
**Status**: Draft

## User Scenarios & Testing

### User Story 1 - Init Scaffolds Quality Gates (Priority: P1)

When a user runs `adjutant init` in a new project, Adjutant scaffolds the full code quality system alongside PRIME.md and .mcp.json. This includes testing rules, code review protocol, the code-review skill, a pre-push verification script, and a CI template.

**Why this priority**: The adj-120 quality gates only exist in the Adjutant repo. New projects managed by Adjutant agents get PRIME.md but none of the quality enforcement — agents skip tests, ignore lint, and merge broken code.

**Independent Test**: Run `adjutant init` in a fresh directory, verify all quality files are scaffolded.

**Acceptance Scenarios**:

1. **Given** a new project directory with no Adjutant files, **When** `adjutant init` is run, **Then** `.claude/rules/03-testing.md` is created with the testing constitution.
2. **Given** a new project, **When** `adjutant init` is run, **Then** `.claude/rules/08-code-review.md` is created with code review protocol.
3. **Given** a new project, **When** `adjutant init` is run, **Then** `.claude/skills/code-review/SKILL.md` is created.
4. **Given** a new project, **When** `adjutant init` is run, **Then** `scripts/verify-before-push.sh` is created and marked executable.
5. **Given** a new project without `.github/workflows/ci.yml`, **When** `adjutant init` is run, **Then** a CI template is scaffolded.
6. **Given** a new project with an existing `.github/workflows/ci.yml`, **When** `adjutant init` is run, **Then** the existing CI file is NOT overwritten (skip with message).
7. **Given** `adjutant init` has already been run, **When** it is run again, **Then** existing quality files are skipped (idempotent).
8. **Given** `adjutant init --force`, **When** run, **Then** all quality files are overwritten with latest versions.

---

### User Story 2 - Upgrade Syncs Quality Files (Priority: P1)

When a user runs `adjutant upgrade`, outdated quality files are updated to the latest versions from the Adjutant package. User customizations are preserved unless `--force` is used.

**Why this priority**: Quality standards evolve. Without upgrade support, projects get stuck on the original version of the testing constitution and never get improvements.

**Independent Test**: Modify a quality file, run `adjutant upgrade`, verify it's updated.

**Acceptance Scenarios**:

1. **Given** a project with outdated `.claude/rules/03-testing.md`, **When** `adjutant upgrade` is run, **Then** the file is updated to the latest version.
2. **Given** a project with quality files matching the latest version, **When** `adjutant upgrade` is run, **Then** files report "up to date" (no writes).
3. **Given** a project missing quality files (e.g., init was run before quality gates existed), **When** `adjutant upgrade` is run, **Then** missing files are created.
4. **Given** `adjutant upgrade` updates files, **When** the upgrade completes, **Then** each updated file shows a status line (e.g., "updated (42 -> 58 lines)").

---

### User Story 3 - Plugin Warns on Missing Quality Files (Priority: P2)

The Adjutant Claude Code plugin (SessionStart hook) warns agents when quality files are missing from the project. This doesn't block agent startup but ensures agents are aware of the gap.

**Why this priority**: Nice safety net but not critical — init/upgrade are the primary distribution mechanisms.

**Independent Test**: Delete a quality file, start a Claude Code session, verify the warning appears.

**Acceptance Scenarios**:

1. **Given** a project missing `.claude/rules/03-testing.md`, **When** a Claude Code session starts (triggering `adjutant prime`), **Then** the output includes a warning: "Quality files missing. Run: adjutant upgrade".
2. **Given** a project with all quality files present, **When** a session starts, **Then** no warning is shown.

---

### User Story 4 - Doctor Checks Quality Gates (Priority: P2)

`adjutant doctor` verifies all quality gate files are present and reports missing or outdated files.

**Why this priority**: Diagnostic tool — useful but not the primary mechanism.

**Independent Test**: Delete a quality file, run `adjutant doctor`, verify it reports the missing file.

**Acceptance Scenarios**:

1. **Given** a project with all quality files, **When** `adjutant doctor` is run, **Then** each quality file shows "pass".
2. **Given** a project missing `scripts/verify-before-push.sh`, **When** `adjutant doctor` is run, **Then** it reports "fail" with "run adjutant upgrade".
3. **Given** a project with outdated quality files, **When** `adjutant doctor` is run, **Then** it reports "warn" with "outdated — run adjutant upgrade".

---

### User Story 5 - Template System for Project Types (Priority: P2)

Quality file templates adapt to different project types. The default is Node.js/vitest (matching the current quality gates), but the system is extensible for future project types.

**Why this priority**: Templates must exist for init/upgrade to work, but only the Node.js template is needed now.

**Independent Test**: Init a project, verify templates reference generic commands (`npm test`, `npm run build`).

**Acceptance Scenarios**:

1. **Given** a new project with a `package.json`, **When** `adjutant init` runs, **Then** templates use Node.js conventions (npm test, vitest, etc.).
2. **Given** a project without `package.json`, **When** `adjutant init` runs, **Then** quality files are still scaffolded with generic commands.
3. **Given** template files in `cli/templates/quality/`, **When** a developer adds a new template, **Then** the system supports it without modifying init/upgrade logic.

---

### Edge Cases

- What if `.claude/` directory doesn't exist? (Answer: init creates it, like it creates `.adjutant/`)
- What if the user has custom `.claude/rules/03-testing.md`? (Answer: upgrade shows "differs from package" and skips without --force)
- What about the code-review skill directory structure? (Answer: init creates `.claude/skills/code-review/` recursively)
- What if `scripts/` directory doesn't exist? (Answer: init creates it)

## Requirements

### Functional Requirements

- **FR-001**: `adjutant init` MUST scaffold all quality gate files into the project
- **FR-002**: `adjutant upgrade` MUST update outdated quality files to latest versions
- **FR-003**: `adjutant upgrade` MUST NOT overwrite user customizations without `--force`
- **FR-004**: `adjutant doctor` MUST check presence of all quality gate files
- **FR-005**: Quality file templates MUST be stored in the Adjutant package, not hardcoded inline
- **FR-006**: Init MUST skip existing CI config files (`.github/workflows/ci.yml`)
- **FR-007**: All scaffolded files MUST use generic commands (`npm test`, `npm run build`) for portability
- **FR-008**: `adjutant prime` SHOULD warn when quality files are missing

### Key Entities

- **Quality Gate Files**: The set of files that enforce code quality standards
  - `.claude/rules/03-testing.md` — Testing constitution
  - `.claude/rules/08-code-review.md` — Code review protocol
  - `.claude/skills/code-review/SKILL.md` — Automated review skill
  - `scripts/verify-before-push.sh` — Pre-push verification script
  - `.github/workflows/ci.yml` — CI pipeline template
- **Template Registry**: Mapping of quality file names to their source templates in the Adjutant package
- **Version Tracking**: Content-based comparison (like PRIME.md upgrade) — no version numbers needed

## Success Criteria

- **SC-001**: `adjutant init` in a fresh project creates all 5 quality gate files
- **SC-002**: `adjutant upgrade` updates outdated files and creates missing ones
- **SC-003**: `adjutant doctor` reports missing/outdated quality files
- **SC-004**: Quality files are generic enough to work in any Node.js project
- **SC-005**: Existing user customizations are preserved during upgrade (unless --force)
