# Code Review Protocol

## When Reviews Happen
- **Squad execution**: Code reviewer agent runs after engineers complete, before merge to main
- **Solo work**: Agent invokes /code-review skill on their branch diff before merging
- **CI**: Automated lint + test gate (but not structural review)

## What Reviews Check
1. **Test Coverage**: Every new function has tests. Coverage doesn't drop.
2. **Test Quality**: Tests verify behavior, not implementation. No brittle mocks.
3. **Code Quality**: Naming, structure, DRY. No copy-paste.
4. **Architecture**: Changes follow the layered architecture (routes -> services -> stores).
5. **Security**: No injection risks, no leaked secrets, no auth bypasses.
6. **Error Handling**: Failures handled gracefully. User-facing errors are clear.

## Review Output Format
Reviews produce structured findings:
- **Critical**: Must fix before merge (bugs, security, data loss)
- **Warning**: Should fix (code quality, missing edge case tests)
- **Suggestion**: Nice to have (style, naming, minor improvements)

## Automated Review (No Human Gate)
All review is automated — no human approval required. The code review skill and QA sentinel agents ARE the review mechanism. The CI pipeline is the hard gate.
