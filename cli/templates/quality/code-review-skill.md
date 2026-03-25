---
name: code-review
description: Automated code review analyzing diffs for test coverage, code quality, architecture conformance, and security. Produces structured findings and optionally creates beads for issues found.
---

# Code Review

Perform an automated code review on the current branch or a specified diff target. Analyze all changes for test coverage, code quality, architecture conformance, security, and error handling. Produce structured findings.

## Usage

```
/code-review                          # Review current branch diff against main
/code-review <branch-name>            # Review a specific branch
/code-review --staged                 # Review only staged changes
```

## Instructions

### Step 1: Determine the Diff Target

Parse the user's input to determine what to review:

1. **If a branch name is provided**: Use `git diff main...<branch-name>`
2. **If `--staged` is provided**: Use `git diff --staged`
3. **Default (no args)**: Check if on a non-main branch:
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

### Step 3: Analyze Each Changed File

For every changed file, evaluate these categories:

#### 3a. Test Coverage
- **New functions/methods**: Does each new exported function have at least one test?
- **Modified functions**: Were existing tests updated to cover the new behavior?
- **Edge cases**: Are error paths, boundary conditions, and null/undefined cases tested?
- **Test file existence**: Does a test file exist at all for the changed source file?
- **Mock correctness**: Do test mocks match real data shapes?

#### 3b. Code Quality
- **Naming**: Do variables, functions, and types follow project naming conventions?
- **DRY violations**: Is there duplicated logic that should be extracted?
- **Complexity**: Are there functions longer than ~50 lines or deeply nested conditionals?
- **Type safety**: Any use of `any` without justification comment?
- **Dead code**: Commented-out blocks, unused imports, unreachable branches?

#### 3c. Architecture Conformance
- **Layered architecture**: Do changes respect the route -> service -> store layering?
- **Import direction**: Are lower layers importing from higher layers (forbidden)?
- **API boundaries**: Are validation schemas used at API boundaries?

#### 3d. Security
- **Injection risks**: String concatenation in SQL, shell commands, or HTML without sanitization?
- **Hardcoded secrets**: API keys, passwords, tokens in source code?
- **Auth/authz**: Are new endpoints missing authentication or authorization checks?
- **Input validation**: Is user input validated and sanitized before use?

#### 3e. Error Handling
- **Async functions**: Do all async functions have try/catch or propagate errors intentionally?
- **API responses**: Do error paths return structured error objects?
- **User-facing errors**: Are error messages user-friendly (not raw stack traces)?

### Step 4: Compile Findings

Collect all findings and categorize them by severity:

For each finding, record:
- **File path and line number** (or line range) from the diff
- **Category**: test-coverage, code-quality, architecture, security, error-handling
- **Severity**: critical, warning, suggestion
- **Description**: What the issue is and why it matters
- **Recommendation**: How to fix it (be specific)

### Step 5: Output the Review

Output the review in this markdown format:

```markdown
## Code Review: <branch-name or "staged changes" or "last commit">

### Summary
- **Files changed**: N
- **Critical issues**: N
- **Warnings**: N
- **Suggestions**: N

### Critical Issues
- [ ] **[path/to/file.ts:42]** (category) Description. *Recommendation: how to fix.*

### Warnings
- [ ] **[path/to/file.ts:88]** (category) Description. *Recommendation: how to fix.*

### Suggestions
- **[path/to/file.ts:15]** (category) Description.

### Test Coverage Assessment
- **New functions without tests**: list each
- **Test files that should exist but don't**: list expected paths
- **Modified functions with no test updates**: list each
```

If a section has no items, still include the heading with "None found." underneath.

## Key Principles

- **Be specific, not vague**: "Missing null check on `user.email` at line 42" is useful. "Could improve error handling" is not.
- **Cite line numbers**: Every finding must reference a file and line (or line range).
- **Prioritize correctly**: Only use Critical for actual bugs, security holes, or data loss risks.
- **Respect existing patterns**: If the codebase has a consistent pattern, don't flag every instance.
- **No false positives over completeness**: Better to miss a minor suggestion than flag correct code.
- **Portable**: This skill works in any repo. Do not hardcode project-specific paths or tools.
