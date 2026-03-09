# Implementation Plan: Persona Agent Files

**Branch**: `036-persona-agent-files` | **Date**: 2026-03-09
**Epic**: `adj-oo3o` | **Priority**: P1

## Summary

Replace the fragile paste-buffer persona prompt injection with native Claude Code `--agent` file loading. When deploying a persona, write the generated prompt to `.claude/agents/<name>.md` in the target project directory, then start Claude with `--agent <name>`. This eliminates the 3-second init delay, timing race conditions, and the semantic mismatch of persona instructions arriving as a user message.

## Technical Context

**Stack**: TypeScript, Node.js, Express
**Storage**: Filesystem (`.claude/agents/*.md` in target project)
**Testing**: Vitest
**Constraints**: Agent file must exist before claude command runs; persona name must be filesystem-safe

## Architecture Decision

Write agent files at spawn time (not pre-synced). This is stateless — no daemon or sync process needed. The file is always regenerated from current persona traits, so edits to personas are automatically reflected on next deploy. Writing to the target project's `.claude/agents/` is correct because Claude Code resolves `--agent` from CWD.

## Files Changed

| File | Change |
|------|--------|
| `backend/src/services/agent-file-writer.ts` | NEW: `writeAgentFile()` utility + `sanitizePersonaName()` |
| `backend/src/routes/agents.ts` | Use `writeAgentFile` + `--agent` flag instead of `initialPrompt` |
| `backend/src/routes/sessions.ts` | Same as agents.ts |
| `backend/tests/unit/agent-file-writer.test.ts` | NEW: Unit tests for file writer |
| `backend/tests/unit/spawn-persona-integration.test.ts` | Update assertions: `--agent` instead of `initialPrompt` |

## Bead Map

- `adj-oo3o` - Root: Persona agent files (--agent flag)
  - `adj-bue4` - T001: writeAgentFile utility + tests
  - `adj-n22v` - T002: Update spawn routes (depends on adj-bue4)
  - `adj-necz` - T003: Update integration tests (depends on adj-n22v)
  - `adj-sgr6` - T004: QA edge case testing

## Verification Steps

- [ ] Deploy persona from iOS → verify `.claude/agents/<name>.md` exists in target project
- [ ] Verify Claude Code starts with `--agent` flag (check tmux pane content)
- [ ] Deploy persona with special chars in name → verify kebab-case filename
- [ ] Deploy same persona twice → verify file is overwritten cleanly
- [ ] All tests pass: `npx vitest run`
