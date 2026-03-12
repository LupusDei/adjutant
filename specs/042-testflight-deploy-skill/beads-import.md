# TestFlight Deploy Skill - Beads

**Feature**: 042-testflight-deploy-skill
**Generated**: 2026-03-11
**Source**: specs/042-testflight-deploy-skill/tasks.md

## Root Epic

- **ID**: adj-076
- **Title**: TestFlight Deploy Skill
- **Type**: epic
- **Priority**: 2
- **Description**: Claude Code skill that automates TestFlight CI/CD setup for any iOS project — generates Fastlane config, GitHub Actions workflow, and manual setup guide

## Epics

### Phase 1 — Skill Scaffold & Registration
- **ID**: adj-076.1
- **Type**: epic
- **Priority**: 1
- **Tasks**: 4

### Phase 2 — File Templates
- **ID**: adj-076.2
- **Type**: epic
- **Priority**: 1
- **Blocks**: Phase 3
- **Tasks**: 4

### Phase 3 — Existing Setup Handling
- **ID**: adj-076.3
- **Type**: epic
- **Priority**: 2
- **Tasks**: 1

### Phase 4 — Verification & Polish
- **ID**: adj-076.4
- **Type**: epic
- **Priority**: 2
- **Depends**: Phase 3
- **Tasks**: 3

## Tasks

### Phase 1 — Skill Scaffold & Registration

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Create SKILL.md Phase 1 (Discovery) instructions | skills/testflight-deploy/SKILL.md | adj-076.1.1 |
| T002 | Add SKILL.md Phase 2 (Generation) instructions | skills/testflight-deploy/SKILL.md | adj-076.1.2 |
| T003 | Add SKILL.md Phase 3 (Verification) instructions | skills/testflight-deploy/SKILL.md | adj-076.1.3 |
| T004 | Register skill in marketplace.json | .claude-plugin/marketplace.json | adj-076.1.4 |

### Phase 2 — File Templates

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T005 | Create Fastlane templates (Appfile, Matchfile, Fastfile) | skills/testflight-deploy/references/fastlane-templates.md | adj-076.2.1 |
| T006 | Create GitHub Actions workflow template | skills/testflight-deploy/references/workflow-template.md | adj-076.2.2 |
| T007 | Create manual setup guide template | skills/testflight-deploy/references/setup-guide-template.md | adj-076.2.3 |
| T008 | Add Gemfile template/append logic to Fastlane templates | skills/testflight-deploy/references/fastlane-templates.md | adj-076.2.4 |

### Phase 3 — Existing Setup Handling

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T009 | Add existing-setup detection and merge instructions | skills/testflight-deploy/SKILL.md | adj-076.3.1 |

### Phase 4 — Verification & Polish

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T010 | Review templates against Fastlane docs | skills/testflight-deploy/references/fastlane-templates.md | adj-076.4.1 |
| T011 | Review workflow template against GH Actions runner matrix | skills/testflight-deploy/references/workflow-template.md | adj-076.4.2 |
| T012 | End-to-end skill review and walkthrough | skills/testflight-deploy/SKILL.md | adj-076.4.3 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Skill Scaffold | 4 | 1 | adj-076.1 |
| 2: File Templates | 4 | 1 | adj-076.2 |
| 3: Existing Setup | 1 | 2 | adj-076.3 |
| 4: Verification | 3 | 2 | adj-076.4 |
| **Total** | **12** | | |

## Dependency Graph

Phase 1: Scaffold (adj-076.1)
    |
    +---> T004 (marketplace.json) [parallel, no deps]
    |
Phase 2: Templates (adj-076.2) [T005-T008 parallel]
    |
Phase 3: Existing Setup (adj-076.3)
    |
Phase 4: Verification (adj-076.4) [T010-T011 parallel, T012 serial]

## Improvements

Improvements (Level 4: adj-076.N.M.P) are NOT pre-planned here. They are created
during implementation when bugs, refactors, or extra tests are discovered.
