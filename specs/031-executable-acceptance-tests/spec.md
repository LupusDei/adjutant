# Feature Specification: Executable Acceptance Test Generation

**Feature Branch**: `031-executable-acceptance-tests`
**Created**: 2026-03-06
**Status**: Draft

## Overview

Upgrade the acceptance test generator (adj-035) to produce real executable test code instead of TODO stubs. The generator should detect API patterns in GWT text, wire step definitions from the registry, and generate working supertest calls with assertions. UI-only and agent-behavior scenarios get `it.skip()` with clear markers.

## User Scenarios & Testing

### User Story 1 - Smart Code Generation for API Scenarios (Priority: P1, MVP)

As a developer, I want the generator to produce working test code for API-testable scenarios so that generated acceptance tests actually execute and return pass/fail without manual implementation.

**Why this priority**: This is the core gap — the generator currently produces TODO stubs. Without this, the framework is scaffolding, not an executable spec.

**Independent Test**: Run `npm run acceptance:generate -- ../specs/017-agent-proposals`, then `npm run acceptance -- ../specs/017-agent-proposals`. API scenarios (US1: POST/GET/PATCH proposals) should execute with real pass/fail results.

**Acceptance Scenarios**:

1. **Given** a spec with scenario "When a proposal is created via POST /api/proposals, Then it is persisted with status pending", **When** the generator runs, **Then** the generated test contains a real `harness.post("/api/proposals", {...})` call and `expect(res.body.data.status).toBe("pending")` assertion.

2. **Given** a spec with scenario "When GET /api/proposals is called with ?status=pending", **When** the generator runs, **Then** the generated test contains a real `harness.get("/api/proposals", { status: "pending" })` call with response assertions.

3. **Given** a spec with scenario "When PATCH /api/proposals/:id with { status: accepted }", **When** the generator runs, **Then** the generated test seeds a proposal first, then patches it, then asserts the status changed.

4. **Given** a spec with scenario referencing a UI interaction like "When the user clicks Accept", **When** the generator runs, **Then** the test is generated as `it.skip("...", ...)` with a comment `// Requires browser — not API-testable`.

---

### User Story 2 - Step Registry Wiring (Priority: P1)

As a developer, I want generated tests to use the step definition registry so that common GWT patterns are automatically resolved to working implementations.

**Why this priority**: The step registry has 11 definitions that are never used. Wiring them makes generation smarter without duplicating logic.

**Independent Test**: Register a step "Given proposals exist", generate a test that references this pattern, run it, verify the step executes and seeds proposals.

**Acceptance Scenarios**:

1. **Given** the step registry has a definition for "Given the database is initialized", **When** the generator encounters this pattern, **Then** the generated test calls `await executeStep("given", "the database is initialized", harness)`.

2. **Given** the step registry has a regex pattern for "Given a pending proposal", **When** the generator encounters matching text, **Then** the generated test calls `executeStep` which resolves to the registered step function.

3. **Given** a GWT clause has no matching step definition, **When** the generator runs, **Then** it falls back to generating inline code (for API patterns) or a TODO stub (for unrecognizable patterns).

---

### User Story 3 - Test Database Lifecycle (Priority: P1)

As a developer, I want acceptance tests to use properly isolated test databases with complete setup and teardown so that tests are reliable and don't leak state.

**Why this priority**: Without proper DB lifecycle, tests may cross-contaminate or leave temp files behind.

**Independent Test**: Run acceptance tests multiple times, verify no temp directories accumulate, verify each test starts with a clean database.

**Acceptance Scenarios**:

1. **Given** an acceptance test starts, **When** the harness `setup()` runs, **Then** a fresh SQLite database is created in a unique temp directory with all migrations applied.

2. **Given** an acceptance test finishes (pass or fail), **When** the harness `destroy()` runs, **Then** the database file and temp directory are removed with no orphaned resources.

3. **Given** multiple acceptance tests run in parallel, **When** each creates its own harness, **Then** they use separate databases and temp directories with no cross-contamination.

4. **Given** an acceptance test throws an error mid-execution, **When** Vitest afterEach triggers, **Then** the harness still cleans up properly (destroy is safe to call in any state).

---

### User Story 4 - Intelligent Pattern Detection (Priority: P2)

As a developer, I want the generator to detect common API patterns in GWT text so that it can produce the right HTTP method, path, payload, and assertions automatically.

**Why this priority**: Pattern detection is what makes the generated code actually work without manual intervention.

**Independent Test**: Parse a variety of GWT texts containing REST API patterns, verify the detector extracts method, path, query params, and expected response fields.

**Acceptance Scenarios**:

1. **Given** the text "a proposal is created via POST /api/proposals", **When** the pattern detector runs, **Then** it extracts `{ method: "POST", path: "/api/proposals" }`.

2. **Given** the text "GET /api/proposals is called with ?status=pending", **When** the pattern detector runs, **Then** it extracts `{ method: "GET", path: "/api/proposals", query: { status: "pending" } }`.

3. **Given** the text "PATCH /api/proposals/:id with { status: accepted }", **When** the pattern detector runs, **Then** it extracts `{ method: "PATCH", path: "/api/proposals/:id", body: { status: "accepted" } }`.

4. **Given** the text "it is persisted with status pending and a generated UUID", **When** the assertion detector runs, **Then** it extracts expected fields: `[{ path: "data.status", value: "pending" }, { path: "data.id", assertion: "toBeTruthy" }]`.

---

### Edge Cases

- What if a When clause mentions an endpoint that doesn't exist in the harness? Generate the code anyway — it will fail at runtime with a clear 404.
- What if a Then clause is too complex to auto-detect assertions? Fall back to a TODO comment for just that assertion.
- What if the same endpoint is called with different payloads across scenarios? Each test is independent — different payloads are fine.
- What about scenarios that need precondition data (Given proposals exist)? The generator should emit seed calls before the API call.

## Requirements

### Functional Requirements

- **FR-001**: Generator MUST produce executable supertest calls for scenarios containing REST API patterns (POST, GET, PATCH, DELETE + /api/ paths)
- **FR-002**: Generator MUST wire step registry definitions into generated test code via `executeStep()` calls
- **FR-003**: Generator MUST mark UI-only and agent-behavior scenarios as `it.skip()` with a reason comment
- **FR-004**: Generator MUST detect HTTP method, path, query parameters, and request body from GWT text
- **FR-005**: Generator MUST detect expected response fields and status codes from Then clauses
- **FR-006**: Generator MUST emit precondition seed calls for Given clauses that require data setup
- **FR-007**: Test harness MUST create isolated SQLite databases per test with full migration
- **FR-008**: Test harness MUST clean up all resources even when tests throw errors

## Success Criteria

- **SC-001**: `npm run acceptance:generate -- ../specs/017-agent-proposals` followed by `npm run acceptance` produces at least 4 passing API tests from US1 without manual implementation
- **SC-002**: UI-only scenarios (US3, US4) are skipped, not failing
- **SC-003**: No temp directories or DB files left behind after test runs
- **SC-004**: Generated test files pass `npm run build` (valid TypeScript)
