# Feature Specification: Acceptance Test Fixture Framework

**Feature Branch**: `030-acceptance-test-fixtures`
**Created**: 2026-03-04
**Status**: Draft

## Overview

An executable specification framework that parses Given/When/Then acceptance criteria from spec.md files and auto-generates Vitest test files backed by a real-services test harness. Transforms "spec says X" into "test proves X" with pass/fail outcomes.

## User Scenarios & Testing

### User Story 1 - Generate Acceptance Tests from Spec (Priority: P1, MVP)

As a developer, I want to run a CLI command against a spec.md file and get auto-generated Vitest test files with Given/When/Then scaffolding so that every acceptance scenario has a corresponding executable test.

**Why this priority**: This is the core value — connecting specs to tests. Without this, acceptance criteria remain unverified prose.

**Independent Test**: Run the generator against an existing spec.md (e.g., `specs/017-agent-proposals/spec.md`), verify it produces .test.ts files with one `describe` per User Story and one `it` per acceptance scenario.

**Acceptance Scenarios**:

1. **Given** a spec.md file with 3 User Stories containing acceptance scenarios, **When** I run the spec parser, **Then** it returns a structured array of UserStory objects each containing an array of Scenario objects with given/when/then strings.

2. **Given** a parsed spec with acceptance scenarios, **When** I run the test generator, **Then** it produces a .test.ts file with `describe('US1 - [Title]')` blocks and `it('should [scenario summary]')` test stubs for each scenario.

3. **Given** a generated test file, **When** I open it in an editor, **Then** each test contains commented GWT steps as documentation and a `// TODO: implement` marker, plus imports for the test fixture harness.

4. **Given** a spec.md with functional requirements (FR-001, FR-002), **When** the parser runs, **Then** each requirement ID is extracted and associated with the user stories that reference it.

---

### User Story 2 - Test Fixture Harness with Real Services (Priority: P1)

As a developer writing acceptance tests, I want a reusable test harness that spins up a real Express server with SQLite database so that my tests verify actual API behavior end-to-end.

**Why this priority**: Without a harness, every test file duplicates boilerplate setup/teardown. This is the foundation all acceptance tests build on.

**Independent Test**: Import the harness in a test file, call `createTestHarness()`, make an HTTP request to a real endpoint, verify the response.

**Acceptance Scenarios**:

1. **Given** a test file imports the acceptance harness, **When** `createTestHarness()` is called in `beforeEach`, **Then** it returns an object with a supertest-compatible `request` client, a fresh SQLite database, and a cleanup function.

2. **Given** a running test harness, **When** I make a POST request to `/api/messages`, **Then** the message is persisted in the test database and the response matches the production API schema.

3. **Given** a test harness with an active test, **When** the `afterEach` cleanup runs, **Then** the temporary database and server are destroyed with no resource leaks.

4. **Given** multiple test files running in parallel, **When** each creates its own harness, **Then** they use isolated databases and ports with no cross-contamination.

---

### User Story 3 - Step Definition Registry (Priority: P2)

As a developer, I want reusable step definitions for common Given/When/Then patterns so that I don't rewrite the same setup and assertion logic across acceptance tests.

**Why this priority**: Reusability reduces test maintenance burden. Common patterns like "Given an agent is connected" appear across many specs.

**Independent Test**: Register a step definition, reference it from a generated test, run the test, verify the step executes correctly.

**Acceptance Scenarios**:

1. **Given** I define a step `Given("an agent is connected", async (harness) => { ... })`, **When** a generated test references this step pattern, **Then** the step function executes during the test and sets up a real MCP agent connection.

2. **Given** multiple specs share the step "Given a message exists in the store", **When** tests from both specs run, **Then** they both resolve to the same step definition without duplication.

3. **Given** a generated test has a GWT step with no matching step definition, **When** the test runs, **Then** it fails with a clear error: `No step definition found for: "Given [step text]"` and suggests creating one.

---

### User Story 4 - CLI Runner with Pass/Fail Reporting (Priority: P2)

As the project mayor, I want a single CLI command that parses specs, runs acceptance tests, and reports pass/fail per scenario so I can see which acceptance criteria are verified.

**Why this priority**: Ties the framework together into a usable workflow. Without this, the pieces exist but require manual orchestration.

**Independent Test**: Run the CLI command against a spec directory, verify it outputs a summary table showing scenarios with pass/fail/pending status.

**Acceptance Scenarios**:

1. **Given** a spec directory with spec.md and generated test files, **When** I run `npm run acceptance -- specs/017-agent-proposals`, **Then** it executes all acceptance tests and prints a summary grouped by User Story.

2. **Given** acceptance tests where 3 pass, 1 fails, and 2 are pending (TODO), **When** the runner completes, **Then** the output shows: `3 passed, 1 failed, 2 pending` with the failing scenario's error details.

3. **Given** I run the acceptance command with `--generate` flag, **When** test files don't exist yet, **Then** it first generates the test files from spec.md, then runs them (all pending initially).

---

### Edge Cases

- What happens when spec.md has no acceptance scenarios? Parser returns empty array, generator produces no test file.
- What happens when GWT format is malformed (missing When/Then)? Parser logs a warning with line number and skips the malformed scenario.
- What happens when the test harness port conflicts? Use port 0 for random available port assignment.
- What if a spec.md references requirements (FR-xxx) not covered by any scenario? Parser includes them in output as uncovered requirements.

## Requirements

### Functional Requirements

- **FR-001**: System MUST parse spec.md files and extract structured Given/When/Then acceptance scenarios
- **FR-002**: System MUST generate Vitest-compatible .test.ts files from parsed scenarios
- **FR-003**: System MUST provide a test harness that spins up real Express + SQLite for API-level testing
- **FR-004**: System MUST support a step definition registry for reusable Given/When/Then implementations
- **FR-005**: System MUST provide a CLI command to generate tests, run them, and report pass/fail per scenario
- **FR-006**: System MUST extract and track functional requirement IDs (FR-xxx) from specs

### Key Entities

- **Scenario**: A single Given/When/Then acceptance criterion with parent user story context
- **UserStory**: A collection of scenarios with title, priority, and independent test description
- **StepDefinition**: A reusable function bound to a GWT pattern string
- **TestHarness**: An isolated test environment with real Express app, SQLite DB, and cleanup

## Success Criteria

- **SC-001**: Running `npm run acceptance` against any spec with GWT scenarios produces pass/fail output
- **SC-002**: Generated test files follow existing Vitest patterns and pass `npm run build` (type-check)
- **SC-003**: Test harness provides full API-level isolation (no shared state between tests)
- **SC-004**: At least one existing spec (e.g., 017-agent-proposals) has fully implemented acceptance tests as proof-of-concept
