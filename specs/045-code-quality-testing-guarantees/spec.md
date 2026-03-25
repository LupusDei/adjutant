# Feature Specification: Code Quality & Testing Guarantees

**Feature Branch**: `045-code-quality-testing-guarantees`
**Created**: 2026-03-24
**Status**: Draft

## User Scenarios & Testing

### User Story 1 - Enforced Test Coverage (Priority: P1)

Every agent working in the Adjutant codebase must write unit tests alongside implementation code. Coverage thresholds are enforced at build time — code that drops coverage below the minimum cannot be committed or pushed.

**Why this priority**: Without enforced coverage, agents routinely ship code with no tests. The existing "TDD is mandatory" rule in `.claude/rules/03-testing.md` is advisory — nothing prevents an agent from skipping tests. This is the highest-leverage fix.

**Independent Test**: Run `npm run test:coverage` and verify it fails when coverage drops below 80%.

**Acceptance Scenarios**:

1. **Given** an agent writes a new service with 0% test coverage, **When** they run `npm run build`, **Then** the build fails with a clear message showing which files lack coverage.
2. **Given** an agent writes tests achieving 85% coverage for their new code, **When** they run `npm run build`, **Then** the build succeeds.
3. **Given** an agent modifies existing code and deletes tests, **When** they run `npm test`, **Then** coverage drops below threshold and the command exits non-zero.
4. **Given** a root-level `npm test` command, **When** run from the project root, **Then** it runs both backend and frontend test suites and exits non-zero if either fails.

---

### User Story 2 - Pre-Push Lint & Test Gate (Priority: P1)

Git hooks enforce that lint and tests pass before any code is pushed. This cannot be bypassed by agents (the spawn prompt explicitly forbids `--no-verify`). The `npm run build` command includes linting so agents can't accidentally skip it.

**Why this priority**: Currently `npm run build` only runs `tsc` and `vite build` — lint is a separate command that agents forget. CI has lint as `continue-on-error: true`. This means broken lint ships regularly.

**Independent Test**: Introduce a lint error, attempt `git push`, verify it's blocked.

**Acceptance Scenarios**:

1. **Given** code with ESLint errors, **When** an agent runs `git push`, **Then** the pre-push hook blocks the push with lint error output.
2. **Given** failing tests, **When** an agent runs `git push`, **Then** the pre-push hook blocks the push with test failure output.
3. **Given** clean code (lint passes, tests pass), **When** an agent runs `git push`, **Then** the push proceeds normally.
4. **Given** `npm run build` is invoked, **When** it completes, **Then** linting has also been verified (either inline or as a prerequisite step).

---

### User Story 3 - Automated Code Review (Priority: P1)

A formalized code review mechanism ensures every significant change is reviewed before merging to main. This includes an automated review skill that any agent can invoke, plus mandatory review as part of squad execution.

**Why this priority**: Currently there's no review gate. Agents merge to main after `npm run build && npm test` passes, but nobody checks for architectural issues, code style problems, missing edge cases, or test quality.

**Independent Test**: Run the code review skill on a branch with known issues, verify it catches them.

**Acceptance Scenarios**:

1. **Given** a branch with changes, **When** an agent invokes the code review skill, **Then** it produces a structured review covering: test coverage, code quality, architectural conformance, and security.
2. **Given** a squad execution, **When** the squad completes, **Then** the QA sentinel and code reviewer agents have run and created beads for any issues found.
3. **Given** a review that finds critical issues, **When** the review completes, **Then** bug beads are created under the parent epic and the squad leader is notified.
4. **Given** a review finds no issues, **When** the review completes, **Then** the merge proceeds and the review result is recorded.

**Note**: No human approval gate. Code review is fully automated — the skill and QA sentinel agents are the review mechanism.

---

### User Story 4 - Testing Constitution & Agent Spawn Rules (Priority: P1)

The project's testing rules are strengthened into a comprehensive constitution that is injected into every agent spawn prompt. Every agent — squad leaders, squad members, teammates — knows exactly what testing standards are required and follows them mechanically.

**Why this priority**: Current rules in `.claude/rules/03-testing.md` are high-level guidelines. Agents need mechanical, step-by-step instructions: "For every new function, write a test file at X, test Y scenarios, run Z command."

**Independent Test**: Spawn a teammate agent, verify the testing constitution is in their prompt, verify they write tests.

**Acceptance Scenarios**:

1. **Given** the updated `.claude/rules/03-testing.md`, **When** any agent reads project rules, **Then** they see specific, mechanical testing instructions (not just "TDD is mandatory").
2. **Given** the squad-execute skill, **When** a squad is spawned, **Then** every team member's prompt includes the full testing protocol.
3. **Given** an agent completing a task, **When** they run the verification checklist, **Then** it includes test coverage check, not just build+lint.

**Portability**: The testing constitution, code review skill, and verification scripts are designed to work in ANY repo managed by Adjutant agents — not just the Adjutant codebase itself. Rules are written generically (referencing `npm test`, `npm run build`, `npm run lint`) so they apply to any Node.js project. The `.claude/rules/` files and skills are part of the Adjutant package.

---

### User Story 5 - Integration Test Infrastructure (Priority: P2)

Integration tests verify cross-service boundaries: REST API routes calling services, MCP tools interacting with the message store, WebSocket chat flow, and bd-client CLI wrapper operations. These run as part of the standard test suite.

**Why this priority**: Unit tests with mocks can pass while real integrations fail (see adj-067 lesson about mocking real data shapes). Integration tests catch the boundaries where things actually break.

**Independent Test**: Run `npm run test:integration` and verify it exercises real service interactions.

**Acceptance Scenarios**:

1. **Given** a backend integration test suite, **When** run, **Then** it tests real HTTP requests against Express routes with a test database.
2. **Given** MCP tool integration tests, **When** run, **Then** they exercise the full path: tool handler → service → SQLite store.
3. **Given** a WebSocket integration test, **When** run, **Then** it connects a real WS client, sends messages, and verifies broadcast delivery.
4. **Given** `npm test` at the root, **When** run, **Then** both unit and integration tests execute.

---

### User Story 6 - CI Pipeline Hardening (Priority: P2)

GitHub Actions CI runs the full quality gate: build, lint (blocking), tests, and coverage reporting. No more `continue-on-error` on lint. Tests actually run in CI.

**Why this priority**: The current CI pipeline only builds and lints (non-blocking). Tests don't run at all. This means PRs can merge with broken tests.

**Independent Test**: Push a PR with a failing test, verify CI fails.

**Acceptance Scenarios**:

1. **Given** a PR with failing tests, **When** CI runs, **Then** the pipeline fails and blocks merge.
2. **Given** a PR with lint errors, **When** CI runs, **Then** the pipeline fails (no `continue-on-error`).
3. **Given** a clean PR, **When** CI runs, **Then** build, lint, and tests all pass and the pipeline succeeds.
4. **Given** CI completes, **When** results are available, **Then** coverage report is attached as an artifact.

---

### Edge Cases

- What happens when an agent needs to push a WIP branch for collaboration? (Answer: WIP branches skip pre-push hooks via branch name convention `wip/*`)
- How do integration tests handle the bd CLI dependency? (Answer: Use test fixtures with real CLI output format, per adj-067 lesson)
- What if coverage threshold is too aggressive for legacy code? (Answer: Per-file exclusions in vitest config for grandfathered files, with a bead to add tests later)

## Requirements

### Functional Requirements

- **FR-001**: Root-level `npm test` MUST run both backend and frontend test suites
- **FR-002**: Root-level `npm run test:coverage` MUST enforce 80% line coverage minimum
- **FR-003**: `npm run build` MUST include lint verification
- **FR-004**: Pre-push git hook MUST run lint and tests, blocking push on failure
- **FR-005**: Code review skill MUST produce structured review with actionable findings
- **FR-006**: Agent spawn prompts MUST include mechanical testing instructions
- **FR-007**: CI pipeline MUST run build, lint (blocking), and tests
- **FR-008**: Integration test suite MUST cover REST, MCP, and WebSocket boundaries
- **FR-009**: Coverage reports MUST be generated in CI and available as artifacts

### Key Entities

- **Quality Gate**: The set of checks (build, lint, test, coverage) that must pass before code ships
- **Code Review**: Structured analysis of a changeset covering tests, quality, architecture, security
- **Testing Constitution**: The comprehensive rules document injected into all agent prompts

## Success Criteria

- **SC-001**: Zero untested features ship — every new service/hook/tool has corresponding tests
- **SC-002**: Coverage never drops below 80% on any CI run
- **SC-003**: No lint errors in main branch (CI blocks them)
- **SC-004**: Every squad execution includes automated code review
- **SC-005**: Integration tests catch at least 1 boundary bug that unit tests miss (within 30 days)
