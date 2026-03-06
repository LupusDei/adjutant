# Implementation Plan: Executable Acceptance Test Generation

**Branch**: `031-executable-acceptance-tests` | **Date**: 2026-03-06
**Epic**: `adj-039` | **Priority**: P1

## Summary

Upgrade the acceptance test generator to produce real executable test code. Add a GWT pattern detector that extracts HTTP methods/paths/assertions from scenario text, wire the step registry into generated code, and ensure test database lifecycle is robust. The generator transforms from a scaffolding tool into an executable specification engine.

## Bead Map

- `adj-039` - Root: Executable Acceptance Test Generation
  - `adj-039.1` - Setup: Types & pattern detector foundation
    - `adj-039.1.1` - Define pattern detector types and API pattern regexes
    - `adj-039.1.2` - Write pattern detector unit tests
  - `adj-039.2` - Foundational: GWT Pattern Detector
    - `adj-039.2.1` - Build When-clause API pattern detector (method, path, query, body)
    - `adj-039.2.2` - Build Then-clause assertion detector (expected fields, status codes)
    - `adj-039.2.3` - Build Given-clause precondition detector (seed requirements)
    - `adj-039.2.4` - Write detector unit tests
  - `adj-039.3` - US1: Smart Code Generator (MVP)
    - `adj-039.3.1` - Rewrite generateTestContent to emit real supertest calls for API scenarios
    - `adj-039.3.2` - Add it.skip() generation for UI-only and agent-behavior scenarios
    - `adj-039.3.3` - Wire step registry lookups into generation (executeStep calls)
    - `adj-039.3.4` - Write generator unit tests
  - `adj-039.4` - US2: Test DB Lifecycle Hardening
    - `adj-039.4.1` - Audit and harden TestHarness setup/destroy for error resilience
    - `adj-039.4.2` - Add cleanup verification (no orphaned temp dirs)
    - `adj-039.4.3` - Write lifecycle unit tests
  - `adj-039.5` - Proof of Concept: Generate + Run 017-agent-proposals
    - `adj-039.5.1` - Regenerate 017 acceptance tests with new generator
    - `adj-039.5.2` - Verify US1 scenarios pass, US3/US4 skipped
    - `adj-039.5.3` - Fix any issues and finalize

## Technical Context

**Stack**: TypeScript 5.x, Vitest, Express, supertest, better-sqlite3
**Existing code**: `backend/src/acceptance/` (types, spec-parser, test-generator, test-harness, step-registry, cli, reporter)
**Testing**: Vitest (unit + acceptance configs)

## Architecture Decision

**Inline code generation with registry fallback**, not pure registry wiring.

The generator should produce readable, self-contained test code — not opaque `executeStep()` calls everywhere. Strategy:

1. **API patterns detected in GWT text** → generate inline supertest calls (readable, debuggable)
2. **Registered step definitions match** → generate `executeStep()` calls (reusable)
3. **UI/agent scenarios** → generate `it.skip()` with reason
4. **Unrecognized patterns** → generate TODO stub (fallback)

This keeps tests readable while leveraging the registry for common patterns.

## Files Changed

| File | Change |
|------|--------|
| `backend/src/acceptance/pattern-detector.ts` | NEW: Detect API patterns in GWT text |
| `backend/src/acceptance/test-generator.ts` | REWRITE: Emit real code instead of TODOs |
| `backend/src/acceptance/test-harness.ts` | HARDEN: Error-resilient setup/destroy |
| `backend/src/acceptance/types.ts` | ADD: Pattern detector types |
| `backend/src/acceptance/steps/common-steps.ts` | UPDATE: Expand step coverage |
| `backend/tests/unit/pattern-detector.test.ts` | NEW: Detector tests |
| `backend/tests/unit/test-generator.test.ts` | UPDATE: Test new generation |
| `backend/tests/unit/test-harness.test.ts` | UPDATE: Lifecycle tests |
| `backend/tests/acceptance/agent-proposals-system.acceptance.test.ts` | REGENERATE: Real executable tests |

## Phase 1: Setup

Define types for detected patterns (DetectedApiCall, DetectedAssertion, DetectedPrecondition). Create the regex patterns for common REST API text. These types drive the code generator.

## Phase 2: Foundational — GWT Pattern Detector

New module `pattern-detector.ts` with three functions:
- `detectApiCall(whenText)` → extracts HTTP method, path, query params, body from When clauses
- `detectAssertions(thenText)` → extracts expected field paths, values, status codes from Then clauses
- `detectPrecondition(givenText)` → determines what seed data is needed (proposals, messages, agents)

Pattern detection uses regexes matching the exact GWT syntax in existing specs.

## Phase 3: US1 — Smart Code Generator (MVP)

Rewrite `generateTestContent()` to use the pattern detector:

For each scenario:
1. Classify: API-testable, step-registry-matched, UI-only, agent-behavior, or unknown
2. Generate appropriate code:
   - **API-testable**: Inline supertest calls with assertions
   - **Step-matched**: `executeStep()` calls
   - **UI-only**: `it.skip("requires browser")`
   - **Agent-behavior**: `it.skip("requires agent simulation")`
   - **Unknown**: TODO stub (last resort)

## Phase 4: US2 — Test DB Lifecycle Hardening

Audit TestHarness for edge cases:
- `destroy()` safe to call multiple times
- `destroy()` works even if `setup()` partially failed
- No temp directory leaks on test failure
- Parallel instance isolation verified

## Phase 5: Proof of Concept

Regenerate the 017-agent-proposals acceptance tests. Run them. The 4 US1 scenarios (REST API CRUD) should pass. US3/US4 (frontend) and US5 (agent behavior) should be skipped. This proves the framework works end-to-end.

## Parallel Execution

- Phase 1 → Phase 2 → Phase 3 (serial, each depends on prior)
- Phase 4 (harness hardening) can run in parallel with Phases 2-3
- Phase 5 depends on Phase 3 + Phase 4

## Verification Steps

- [ ] `npm run build` passes
- [ ] `npm test` passes (existing tests unaffected)
- [ ] `npm run acceptance:generate -- ../specs/017-agent-proposals` produces tests with real code
- [ ] `npm run acceptance -- ../specs/017-agent-proposals` shows 4+ passing, UI scenarios skipped
- [ ] No orphaned temp directories after test run
- [ ] Generated files are valid TypeScript
