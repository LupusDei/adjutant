# Implementation Plan: Code Quality & Testing Guarantees

**Branch**: `045-code-quality-testing-guarantees` | **Date**: 2026-03-24
**Epic**: `adj-120` | **Priority**: P1

## Summary

Harden the Adjutant development pipeline so that untested, unlinted, or unreviewed code cannot reach main. This involves: enforcing coverage thresholds in vitest configs, adding root-level test/lint scripts, creating git pre-push hooks, building an automated code review skill, strengthening the testing constitution in `.claude/rules/`, adding integration tests for cross-service boundaries, and hardening the CI pipeline to block on all quality gates.

## Bead Map

- `adj-120` - Root: Code Quality & Testing Guarantees
  - `adj-120.1` - Build & Script Infrastructure
    - `adj-120.1.1` - Add root-level npm test/lint/coverage scripts
    - `adj-120.1.2` - Add lint step to npm run build
    - `adj-120.1.3` - Configure coverage thresholds in vitest configs
    - `adj-120.1.4` - Tests for build infrastructure changes
  - `adj-120.2` - Git Hook Enforcement
    - `adj-120.2.1` - Create pre-push hook running lint + tests
    - `adj-120.2.2` - WIP branch bypass convention
    - `adj-120.2.3` - Tests for hook behavior
  - `adj-120.3` - Testing Constitution & Agent Rules
    - `adj-120.3.1` - Rewrite .claude/rules/03-testing.md with mechanical instructions
    - `adj-120.3.2` - Update PRIME.md spawn prompt testing block
    - `adj-120.3.3` - Update squad-execute skill with testing requirements
  - `adj-120.4` - Automated Code Review
    - `adj-120.4.1` - Create /code-review skill
    - `adj-120.4.2` - Integrate review into squad-execute completion flow
    - `adj-120.4.3` - Tests for review skill
  - `adj-120.5` - Integration Test Infrastructure
    - `adj-120.5.1` - Create integration test harness (test server, test DB)
    - `adj-120.5.2` - REST API integration tests
    - `adj-120.5.3` - MCP tool integration tests
    - `adj-120.5.4` - WebSocket integration tests
  - `adj-120.6` - CI Pipeline Hardening
    - `adj-120.6.1` - Update .github/workflows/ci.yml with tests + blocking lint
    - `adj-120.6.2` - Add coverage artifact upload
    - `adj-120.6.3` - Verify CI catches failures

## Technical Context

**Stack**: TypeScript 5.x, Vitest, ESLint, Prettier, GitHub Actions
**Storage**: N/A (config changes only)
**Testing**: Vitest (unit + integration), @testing-library/react (frontend)
**Constraints**: Must not break existing 189 tests; must work with beads git hooks

## Architecture Decisions

### Why pre-push instead of pre-commit?
Pre-commit hooks that run full test suites are too slow for iterative development. Agents commit frequently during TDD (red-green-refactor). Pre-push is the right gate — it runs before code leaves the local machine but doesn't slow down the commit cycle. Lint can optionally run on pre-commit (fast), but tests run on pre-push.

### Why 80% coverage threshold?
80% is aggressive enough to catch skipped tests but not so strict that it forces testing trivial code. Per-file exclusions handle grandfathered legacy code. The threshold applies globally, not per-file, so a well-tested new service compensates for a slightly under-tested utility.

### Why a code-review skill instead of PR-based review?
Agents don't always use PRs — many merge directly to main after verification. A skill that runs on the diff (staged or branch diff) works in both flows. It can also be invoked by QA sentinel agents during squad execution without requiring GitHub infrastructure. No human approval gate — review is fully automated.

### Why portable across all adjutant-managed repos?
The testing constitution, code review skill, and verification scripts are part of the Adjutant package — not hardcoded to this repo. Rules reference generic commands (`npm test`, `npm run build`, `npm run lint`) so they work in any Node.js project. The `.claude/rules/` files and skills ship with Adjutant and are injected into every agent working in any Adjutant-managed repo.

### Why integration tests alongside unit tests (not separate CI step)?
Integration tests should run as part of `npm test` so agents catch boundary bugs locally, not just in CI. They use vitest's environment to spin up test servers and databases, keeping the developer experience unified.

## Files Changed

| File | Change |
|------|--------|
| `package.json` | Add root-level test, lint, test:coverage, test:integration scripts |
| `backend/vitest.config.ts` | Add coverage thresholds (80% lines, 70% branches) |
| `frontend/vitest.config.ts` | Add coverage thresholds (80% lines, 70% branches) |
| `backend/package.json` | Add `test:integration` script, update `build` to include lint |
| `frontend/package.json` | Update `build` to include lint |
| `.git/hooks/pre-push` | New: run lint + tests before push |
| `.claude/rules/03-testing.md` | Rewrite with mechanical testing instructions |
| `.claude/rules/08-code-review.md` | New: code review protocol |
| `.claude/skills/code-review/SKILL.md` | New: automated code review skill |
| `backend/tests/integration/` | New: integration test directory and harness |
| `backend/tests/integration/api-routes.test.ts` | New: REST API integration tests |
| `backend/tests/integration/mcp-tools.test.ts` | New: MCP tool integration tests |
| `backend/tests/integration/ws-chat.test.ts` | New: WebSocket integration tests |
| `.github/workflows/ci.yml` | Add test step, make lint blocking, add coverage artifact |
| PRIME.md (spawn prompt sections) | Update testing block in team agent protocol |

## Phase 1: Build & Script Infrastructure

Set up the foundation: root-level scripts, lint-in-build, coverage thresholds. This unblocks everything else because agents need `npm test` and `npm run build` to work correctly before hooks and CI can rely on them.

Key decisions:
- Root `npm test` runs `npm run test --workspace=backend && npm run test --workspace=frontend` (or cd-based equivalent)
- `npm run build` becomes: lint → tsc → vite build (fail-fast on lint errors)
- Coverage thresholds: 80% lines, 70% branches, 60% functions (pragmatic starting points)

## Phase 2: Git Hook Enforcement

Create a pre-push hook that runs the quality gate. Must coexist with existing beads hooks.

Key decisions:
- Hook runs: `npm run lint && npm test` (not coverage — that's for CI)
- WIP branches (`wip/*`) bypass the hook for collaboration scenarios
- Hook is a shell script in `.git/hooks/pre-push` — not managed by beads (beads hooks are separate)
- Agents are explicitly forbidden from `--no-verify` in spawn prompts

## Phase 3: Testing Constitution & Agent Rules

Rewrite the testing rules from guidelines into mechanical instructions. Update all spawn prompt templates.

Key decisions:
- `.claude/rules/03-testing.md` becomes a comprehensive testing constitution with exact commands
- Every agent spawn prompt includes the testing checklist verbatim
- The constitution specifies: what to test, how many tests per function, naming conventions, file locations

## Phase 4: Automated Code Review

Build a `/code-review` skill that analyzes diffs for quality, tests, architecture, and security.

Key decisions:
- Skill reads git diff, analyzes each changed file
- Produces structured output: findings by category (critical, warning, suggestion)
- Creates bug beads for critical findings
- Integrated into squad-execute as a post-implementation step

## Phase 5: Integration Test Infrastructure

Create a test harness for cross-service integration tests.

Key decisions:
- Test harness spins up a real Express server with test SQLite database
- Integration tests live in `backend/tests/integration/`
- Separate vitest config for integration tests (longer timeouts, real I/O)
- Run via `npm run test:integration` (included in root `npm test`)

## Phase 6: CI Pipeline Hardening

Update GitHub Actions to run the full quality gate.

Key decisions:
- Remove `continue-on-error: true` from lint steps
- Add `npm test` step after build
- Add `npm run test:coverage` with artifact upload
- Pipeline fails on any step failure

## Parallel Execution

- Phase 1 (Build infra) blocks all other phases
- After Phase 1: Phases 2, 3, 4, 5, 6 can ALL run in parallel
  - Phase 2 (hooks) — independent shell script work
  - Phase 3 (constitution) — documentation/rules changes
  - Phase 4 (code review) — new skill, independent
  - Phase 5 (integration tests) — new test files, independent
  - Phase 6 (CI) — GitHub Actions config, independent

## Verification Steps

- [ ] `npm test` at root runs both backend and frontend tests
- [ ] `npm run build` fails when lint errors exist
- [ ] `npm run test:coverage` fails when coverage is below 80%
- [ ] `git push` is blocked when tests fail (unless branch is `wip/*`)
- [ ] Code review skill produces structured output on a test diff
- [ ] Integration tests catch a real boundary issue
- [ ] CI pipeline fails on lint errors (no `continue-on-error`)
- [ ] CI pipeline fails on test failures
- [ ] CI produces coverage artifact
