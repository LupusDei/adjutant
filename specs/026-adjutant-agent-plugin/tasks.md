# Tasks: Adjutant Agent Plugin

**Epic**: `adj-026`

## Phase 1: Scaffold

- [ ] T001 Create `.claude-plugin/marketplace.json` with plugin name, owner, and 6 skill paths
- [ ] T002 Create `.claude-plugin/plugin.json` with SessionStart/PreCompact hooks

## Phase 2: Move Skills

- [ ] T003 Copy `.claude/skills/adjutant-agent/` → `skills/mcp-tools/`, rename `name` field to `mcp-tools`
- [ ] T004 [P] Copy `.claude/skills/adjutant-agent/references/` → `skills/mcp-tools/references/`
- [ ] T005 [P] Copy `.claude/skills/epic-planner/` → `skills/epic-planner/` (SKILL.md + references/)
- [ ] T006 [P] Copy `.claude/skills/broadcast-prompt/SKILL.md` → `skills/broadcast-prompt/SKILL.md`
- [ ] T007 [P] Copy `.claude/skills/direct-message/SKILL.md` → `skills/direct-message/SKILL.md`
- [ ] T008 [P] Copy `.claude/skills/discuss-proposal/SKILL.md` → `skills/discuss-proposal/SKILL.md`
- [ ] T009 Copy `.claude/skills/execute-proposal/SKILL.md` → `skills/execute-proposal/SKILL.md`, update `/epic-planner` ref to `adjutant-agent:epic-planner`

## Phase 3: Update References

- [ ] T010 Update `cli/commands/doctor.ts:66-71` — change skill check to `fileExists(skills/mcp-tools/SKILL.md)`
- [ ] T011 Update `backend/tests/unit/cli-doctor.test.ts:104-108` — update mock for new path
- [ ] T012 Update `docs/adjutant-agent-setup.md` — 12+ path references

## Phase 4: Cleanup

- [ ] T013 Delete `.claude/skills/adjutant-agent/`, `epic-planner/`, `broadcast-prompt/`, `direct-message/`, `discuss-proposal/`, `execute-proposal/`, `dist/`
- [ ] T014 `git rm -r --cached .claude/skills/` for git-tracked files

## Phase 5: Verify

- [ ] T015 `npm run build` passes
- [ ] T016 `npm test` passes
- [ ] T017 Skills discoverable as `adjutant-agent:*`

## Dependencies

- T003-T009 depend on T001-T002 (scaffold first)
- T013-T014 depend on T003-T009 (move before deleting)
- T015-T017 depend on T010-T014 (all changes before verification)

| T-ID | Title | Bead |
|------|-------|------|
| T001-T002 | Plugin scaffold | adj-026.1 |
| T003-T009 | Move skills | adj-026.2 |
| T010-T012 | Update references | adj-026.3 + adj-026.5 |
| T013-T014 | Cleanup | adj-026.4 |
| T015-T017 | Verification | adj-026.6 |
