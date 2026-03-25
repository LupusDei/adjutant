---
name: code-review
description: Automated code review analyzing diffs for test coverage, code quality, architecture conformance, and security. Produces structured findings and optionally creates beads for issues found. Use when user says "review code", "code review", "review my changes", "check this branch", "/code-review", or wants automated quality analysis before merging.
---

# Code Review

Perform an automated code review on the current branch or a specified diff target. Analyze all changes for test coverage, code quality, architecture conformance, security, and error handling. Produce structured findings and optionally create beads for issues.

## Usage

```
/code-review                          # Review current branch diff against main
/code-review <branch-name>            # Review a specific branch
/code-review --bead <bead-id>         # Review and create child beads for findings
/code-review --staged                 # Review only staged changes
```

## Instructions

### Step 1: Determine the Diff Target

Parse the user's input to determine what to review:

1. **If a branch name is provided**: Use `git diff main...<branch-name>`
2. **If `--staged` is provided**: Use `git diff --staged`
3. **If a bead ID is provided with `--bead`**: Store it for bead creation in Step 5. Still determine diff target from other args or default.
4. **Default (no args)**: Check if on a non-main branch:
   - If on a feature branch: `git diff main...HEAD`
   - If on main with staged changes: `git diff --staged`
   - If on main with no staged changes: `git diff HEAD~1` (last commit)

Run the diff command and capture the output. If the diff is empty, report "No changes to review" and stop.

### Step 2: Gather Context

For each changed file in the diff:

1. **Identify the file type and role**: Is it a route, service, component, hook, test, type definition, config, etc.?
2. **Find related test files**: For a source file like `src/services/foo.ts`, look for:
   - `tests/unit/foo.test.ts`
   - `tests/unit/foo.spec.ts`
   - `__tests__/foo.test.ts`
   - Any test file that imports from the changed file
3. **Read the full file** (not just the diff) to understand context around changes.
4. **Check if test files were also modified** in the same diff.

Build a map of: `{ sourceFile -> testFile (or null), changeType (added/modified/deleted), functions changed }`.

### Step 3: Analyze Each Changed File

For every changed file, evaluate these categories:

#### 3a. Test Coverage

- **New functions/methods**: Does each new exported function have at least one test?
- **Modified functions**: Were existing tests updated to cover the new behavior?
- **Edge cases**: Are error paths, boundary conditions, and null/undefined cases tested?
- **Test file existence**: Does a test file exist at all for the changed source file?
- **Mock correctness**: Do test mocks match real data shapes? (See adj-067: mocks must match actual CLI/API output, not just TypeScript types)

Severity:
- **Critical**: New public API endpoint or destructive operation with zero tests
- **Warning**: New utility function without tests, or modified function with no test update
- **Suggestion**: Missing edge case tests for non-critical paths

#### 3b. Code Quality

- **Naming**: Do variables, functions, and types follow project naming conventions? (kebab-case files, PascalCase components, camelCase hooks with `use` prefix)
- **DRY violations**: Is there duplicated logic that should be extracted?
- **Complexity**: Are there functions longer than ~50 lines or deeply nested conditionals that should be decomposed?
- **Type safety**: Any use of `any` without justification comment? Any unsafe type assertions without explanation?
- **Dead code**: Are there commented-out blocks, unused imports, or unreachable branches?

Severity:
- **Warning**: `any` without comment, DRY violations, overly complex functions
- **Suggestion**: Minor naming issues, style inconsistencies

#### 3c. Architecture Conformance

- **Layered architecture**: Do changes respect the route -> service -> store layering? Is business logic leaking into routes or components?
- **Import direction**: Are lower layers importing from higher layers (forbidden)?
- **State management**: Is complex state management being introduced where simple local state would suffice?
- **API boundaries**: Are Zod schemas used for runtime validation at API boundaries?

Severity:
- **Critical**: Business logic in route handlers, stores importing from routes
- **Warning**: Missing Zod validation at API boundary, state management overkill

#### 3d. Security

- **Injection risks**: String concatenation in SQL, shell commands, or HTML without sanitization?
- **Hardcoded secrets**: API keys, passwords, tokens, connection strings in source code?
- **Auth/authz**: Are new endpoints missing authentication or authorization checks?
- **Data exposure**: Are sensitive fields being logged or returned in API responses unnecessarily?
- **Input validation**: Is user input validated and sanitized before use?

Severity:
- **Critical**: SQL injection, hardcoded secrets, missing auth on destructive endpoints, XSS vectors
- **Warning**: Missing input validation, overly permissive CORS, verbose error messages in production

#### 3e. Error Handling

- **Async functions**: Do all async functions have try/catch or propagate errors intentionally?
- **API responses**: Do error paths return structured error objects (`{ success: false, error: { code, message } }`)?
- **User-facing errors**: Are error messages user-friendly (not raw stack traces)?
- **Failure recovery**: For operations that can fail mid-way (multi-step writes, transactions), is there rollback or cleanup?
- **Edge cases**: What happens on network timeout, disk full, invalid input, concurrent access?

Severity:
- **Critical**: Unhandled promise rejection in production path, missing error handling for destructive operations (data loss risk)
- **Warning**: Generic catch blocks that swallow errors, missing user-friendly error messages
- **Suggestion**: Could add retry logic, could improve error specificity

### Step 4: Compile Findings

Collect all findings and categorize them. Count totals by severity. Sort findings within each category by severity (Critical first, then Warning, then Suggestion).

For each finding, record:
- **File path and line number** (or line range) from the diff
- **Category**: test-coverage, code-quality, architecture, security, error-handling
- **Severity**: critical, warning, suggestion
- **Description**: What the issue is and why it matters
- **Recommendation**: How to fix it (be specific)

### Step 5: Create Beads for Findings (if bead ID provided)

If the user provided a `--bead <bead-id>` argument:

1. **For Critical findings**: Create bug beads
   ```bash
   bd create --id=<bead-id>.review.N --title="Bug: <finding summary>" --type=bug --priority=1
   bd dep add <bead-id> <bead-id>.review.N
   ```

2. **For Warning findings**: Create task beads
   ```bash
   bd create --id=<bead-id>.review.N --title="Review: <finding summary>" --type=task --priority=2
   bd dep add <bead-id> <bead-id>.review.N
   ```

3. **Suggestions do not get beads** — they are informational only.

Number the review beads sequentially: `.review.1`, `.review.2`, etc.

### Step 6: Output the Review

Output the review in this exact markdown format:

```markdown
## Code Review: <branch-name or "staged changes" or "last commit">

### Summary
- **Files changed**: N
- **Critical issues**: N
- **Warnings**: N
- **Suggestions**: N

### Critical Issues
- [ ] **[path/to/file.ts:42]** (category) Description of issue. *Recommendation: how to fix.*

### Warnings
- [ ] **[path/to/file.ts:88]** (category) Description of warning. *Recommendation: how to fix.*

### Suggestions
- **[path/to/file.ts:15]** (category) Description of suggestion.

### Test Coverage Assessment
- **New functions without tests**: list each function and its source file
- **Test files that should exist but don't**: list expected test file paths
- **Modified functions with no test updates**: list each function
- **Coverage impact**: qualitative estimate (e.g., "3 new public functions have no tests — estimated coverage decrease of ~5%")
```

If a section has no items (e.g., no critical issues), still include the heading with "None found." underneath.

If beads were created, append:

```markdown
### Beads Created
- `<bead-id>.review.1` — Bug: <title>
- `<bead-id>.review.2` — Review: <title>
```

## Key Principles

- **Be specific, not vague**: "Missing null check on `user.email` at line 42" is useful. "Could improve error handling" is not.
- **Cite line numbers**: Every finding must reference a file and line (or line range).
- **Prioritize correctly**: Only use Critical for actual bugs, security holes, or data loss risks. Do not inflate severity.
- **Respect existing patterns**: If the codebase has a consistent pattern (even if imperfect), don't flag every instance — flag the pattern once as a suggestion.
- **No false positives over completeness**: It is better to miss a minor suggestion than to flag correct code as problematic.
- **Portable**: This skill works in any repo, not just Adjutant. Do not hardcode project-specific paths or tools.
