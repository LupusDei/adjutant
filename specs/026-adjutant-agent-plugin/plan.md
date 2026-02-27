# Implementation Plan: Adjutant Agent Plugin

**Branch**: `main` | **Date**: 2026-02-27
**Epic**: `adj-026` | **Priority**: P2

## Summary

Move 6 skills from `.claude/skills/` to `skills/` at repo root, create `.claude-plugin/` scaffold for Claude Code plugin discovery, update the CLI doctor check, and clean up old directories.

## Bead Map

- `adj-026` - Root: Consolidate skills into adjutant-agent plugin
  - `adj-026.1` - Create plugin scaffold
  - `adj-026.2` - Move skills to skills/
  - `adj-026.3` - Update CLI doctor check
  - `adj-026.4` - Delete old .claude/skills/
  - `adj-026.5` - Update docs
  - `adj-026.6` - Verify build + tests

## Files Changed

| File | Change |
|------|--------|
| `.claude-plugin/marketplace.json` | Create — plugin declaration |
| `.claude-plugin/plugin.json` | Create — hooks metadata |
| `skills/mcp-tools/SKILL.md` | Create — copy from adjutant-agent, rename `name` field |
| `skills/mcp-tools/references/*` | Create — copy tool-catalog.md, generate-proposal.md |
| `skills/epic-planner/**` | Create — copy SKILL.md + references/ |
| `skills/broadcast-prompt/SKILL.md` | Create — copy |
| `skills/direct-message/SKILL.md` | Create — copy |
| `skills/discuss-proposal/SKILL.md` | Create — copy |
| `skills/execute-proposal/SKILL.md` | Create — copy, update `/epic-planner` ref |
| `cli/commands/doctor.ts:66-71` | Edit — change skill check path |
| `backend/tests/unit/cli-doctor.test.ts:104-108` | Edit — update mock |
| `docs/adjutant-agent-setup.md` | Edit — update 12+ path references |
| `.claude/skills/**` | Delete — all old skill dirs + dist/ |

## Execution Order

1. Create `.claude-plugin/` scaffold (adj-026.1)
2. Copy+adjust skills to `skills/` (adj-026.2)
3. Update doctor.ts + test (adj-026.3) — parallel with step 4 & 5
4. Delete old `.claude/skills/` (adj-026.4)
5. Update docs (adj-026.5)
6. Verify build + tests (adj-026.6)

## Verification Steps

- [ ] `npm run build` exits 0
- [ ] `npm test` all green
- [ ] Skills listed as `adjutant-agent:*` in Claude Code
- [ ] `adjutant doctor` passes plugin check
- [ ] `.claude/skills/` no longer in git
