# QA Sentinel Report: adj-058 Acceptance Testing Framework

**Date**: 2026-03-09
**Reviewer**: sentinel-1
**Scope**: All acceptance framework source files, unit tests, acceptance tests, and cross-spec generation

## Summary

Reviewed 9 source files, 4 test files, 1 generated acceptance test, and 2 feature specs. Ran 112 unit tests (all passing) and 18 acceptance tests (4 passing, 14 skipped). Stress-tested generation against 3 additional specs (008, 029, 033). Filed 10 bugs (3x P2, 4x P3, 3x P4).

## Test Results

### Unit Tests (112/112 passing)
- spec-parser.test.ts: 10 passing
- pattern-detector.test.ts: 29 passing
- test-generator.test.ts: 33 passing
- acceptance-cli.test.ts: 15 passing
- step-registry (in test-generator.test.ts): 13 passing
- common-steps (in test-generator.test.ts): 2 passing
- reporter (in acceptance-cli.test.ts): 8 passing

### Acceptance Tests (4/4 passing, 14 skipped)
- agent-proposals-system.acceptance.test.ts: All 4 API-testable scenarios pass
- 14 correctly skipped (UI-only and agent-behavior)

### Stress-Test Generation
- specs/008-agent-mcp-bridge: 5 stories, 16 scenarios -- all skipped (agent/UI only, no API patterns)
- specs/033-persistent-memory: 5 stories, 11 scenarios -- mix of TODO stubs and skips
- specs/029-agent-personas: 5 stories, 22 scenarios -- revealed P2 bug (literal :id in paths)

## Bugs Filed

### P2 (Incorrect Behavior)

| ID | Title | File |
|---|---|---|
| adj-058.9 | resolvePath only replaces first `:id`, leaves other path params as literals | test-generator.ts:534 |
| adj-058.11 | PUT/DELETE generate raw supertest calls, not typed harness wrappers | test-generator.ts:417-422 |
| adj-058.12 | escapeDoubleQuotes doesn't escape backslashes in generated test strings | test-generator.ts:521 |
| adj-058.17 | Generated persona tests use literal `:id` in path instead of seeded variable | pattern-detector.ts (precondition patterns) |

### P3 (Edge Case)

| ID | Title | File |
|---|---|---|
| adj-058.10 | Query param parsing truncates values containing `=` sign | pattern-detector.ts:79 |
| adj-058.13 | Step registry global state leaks between test suites via module cache | step-registry.ts (module-level state) |
| adj-058.14 | Generated test descriptions are ungrammatical (may overlap adj-058.4) | test-generator.ts:493-515 |
| adj-058.18 | UI_KEYWORDS regex false-positive on `views` and `filters` in non-UI contexts | pattern-detector.ts:247 |

### P4 (Minor/Cosmetic)

| ID | Title | File |
|---|---|---|
| adj-058.15 | Reporter padRight truncates long feature names, breaking box alignment | reporter.ts:65 |
| adj-058.16 | CLI isEntryPoint detection fragile with worktrees and symlinks | cli.ts:232 |

## Detailed Findings

### 1. Path Parameter Resolution (adj-058.9, adj-058.17)

`resolvePath()` only handles `:id` via `path.replace(":id", ...)` which:
- Only replaces the FIRST occurrence (String.prototype.replace behavior)
- Ignores other named params like `:childId`, `:projectId`
- Only triggers when precondition type is `proposal`, `message`, or `agent` -- not for personas, events, or other entity types

The precondition detector has a fixed set of 6 patterns. Any spec using entity types outside that set (personas, beads, events, settings) gets `type: "none"`, so `:id` stays literal.

**Repro**: Generate tests from specs/029-agent-personas. Line 43-46 of generated file: `harness.get("/api/personas/:id")` sends literal `:id`.

### 2. Query Parameter Parsing (adj-058.10)

`pair.split("=")` destructures as `[key, value]`. JavaScript split returns ALL segments, but destructuring only captures the first two. So `filter=a=b` becomes `key="filter"`, `value="a"`, losing `=b`.

Fix: Use `pair.indexOf("=")` + `substring` or `pair.split("=", 2)` followed by rejoining.

### 3. PUT/DELETE Code Generation (adj-058.11)

TestHarness has typed wrappers for GET, POST, PATCH returning `{ status: number; body: T }`. But the generator emits:
- PUT: `harness.request.put(path).send({})`
- DELETE: `harness.request.delete(path)`

These return raw supertest `Response` objects with different property access patterns. Assertions like `res.body.data.status` work on the typed wrapper but fail on raw responses.

### 4. String Escaping (adj-058.12)

`escapeDoubleQuotes()` only does `s.replace(/"/g, '\\"')`. If spec text contains backslash-quote sequences, the generated code can have broken string literals. Also: newlines in spec text are not escaped, though the parser joins multi-line text with spaces so this is mitigated in practice.

### 5. Step Registry Isolation (adj-058.13)

The registry is a module-level `let registry: StepDefinition[] = []`. `common-steps.ts` registers steps as import side effects. Problem:
1. If test A imports common-steps, steps are registered
2. If test A calls `clearSteps()` in beforeEach, steps are gone
3. Re-importing common-steps is a no-op (module cache)
4. Steps from common-steps are permanently lost for the rest of the test run

The current test workaround is to manually re-register patterns in each test. This works but defeats the purpose of the common-steps module.

### 6. Generated Description Grammar (adj-058.14)

`generateItDescription()` strips leading pronouns then prepends "should". Examples of bad output:
- `should only pending proposals are returned` (should be: "should return only pending proposals")
- `should proposal status updates to "accepted"` (should be: "should update proposal status to accepted")
- `should receives all proposals` (should be: "should receive all proposals")

The function handles "is/are" -> "be" at the start but not verbs deeper in the sentence.

### 7. Classification False Positives (adj-058.18)

UI_KEYWORDS regex includes `views?`, `filters?`, `selects?`, `opens?` which can match non-UI usage:
- "the agent views the project state" -> classified as UI
- "results are filtered by status" -> would match `filters?`

Since api-testable outranks ui-only, this only matters for scenarios without API patterns but with common verbs.

## Architecture Observations (Not Bugs)

1. **No `harness.put()` or `harness.delete()` methods**: Only GET/POST/PATCH have typed wrappers. Adding PUT and DELETE would be trivial.

2. **Precondition detector is proposal-centric**: Only 6 patterns are defined, all centered around proposals/messages/agents. New entity types require manual pattern additions.

3. **Generated files include `expect` import but may not use it**: When all scenarios are skipped (like spec 008), the import is unused. Not a runtime issue since vitest doesn't enforce this.

4. **`res.body` type safety**: The harness returns `body: T` defaulting to `Record<string, unknown>`. Generated code accesses `res.body.data.status` which requires the caller to know the shape. TypeScript strict mode would flag this as `unknown` access.

## Conclusion

The framework's core is solid -- the spec parser, pattern detector, and test harness all work correctly for the primary use case (specs/017-agent-proposals). The bugs found are mostly edge cases that surface when generating tests for specs outside the original design scope (personas, memory, MCP bridge). The highest priority fixes are adj-058.9 (path params), adj-058.11 (PUT/DELETE wrappers), and adj-058.17 (precondition detection).
