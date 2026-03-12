# Implementation Plan: TestFlight Deploy Skill

**Branch**: `042-testflight-deploy-skill` | **Date**: 2026-03-11
**Epic**: `adj-076` | **Priority**: P2

## Summary

Create a Claude Code skill (`testflight-deploy`) in the Adjutant plugin that automates TestFlight CI/CD setup for any iOS project. The skill is a directive SKILL.md with reference templates — when invoked, Claude auto-detects project structure, collects user inputs, and generates Fastlane + GitHub Actions files plus a manual setup guide. No backend/frontend changes needed — this is pure skill authoring.

## Bead Map

- `adj-076` - Root: TestFlight Deploy Skill
  - `adj-076.1` - Phase 1: Skill Scaffold & Registration
    - `adj-076.1.1` - Create SKILL.md with discovery + generation instructions
    - `adj-076.1.2` - Register skill in marketplace.json
  - `adj-076.2` - Phase 2: File Templates
    - `adj-076.2.1` - Fastlane templates (Appfile, Matchfile, Fastfile)
    - `adj-076.2.2` - GitHub Actions workflow template
    - `adj-076.2.3` - Manual setup guide template
    - `adj-076.2.4` - Gemfile template / append logic
  - `adj-076.3` - Phase 3: Existing Setup Handling
    - `adj-076.3.1` - Document existing-file detection and merge instructions in SKILL.md
  - `adj-076.4` - Phase 4: Verification & Polish
    - `adj-076.4.1` - End-to-end walkthrough on a test iOS project
    - `adj-076.4.2` - Review all templates for correctness and completeness

## Technical Context

**Stack**: Claude Code skill (Markdown directives + reference templates)
**Storage**: N/A — skill generates files in user's project
**Testing**: Manual verification by invoking the skill on test projects
**Constraints**: Must work across project structures (standalone xcodeproj, workspace with pods, SPM-only, subdirectory layouts)

## Architecture Decision

This is a **directive skill** (like epic-planner), not executable code. The SKILL.md contains step-by-step instructions that Claude follows at runtime. Templates live in `references/` and are filled with detected/user-provided values.

**Why directive over code**: Skills are stateless instruction sets — they leverage Claude's ability to read project files, run shell commands (to detect Xcode version, list schemes), and generate files via Write tool. No custom runtime needed.

**Template approach**: Each generated file has a parameterized template in `references/`. Parameters use `{{PLACEHOLDER}}` syntax that the SKILL.md instructions tell Claude to replace. This keeps templates maintainable and auditable separately from the skill logic.

## Files Changed

| File | Change |
|------|--------|
| `skills/testflight-deploy/SKILL.md` | New — main skill directive |
| `skills/testflight-deploy/references/fastlane-templates.md` | New — Appfile, Matchfile, Fastfile templates |
| `skills/testflight-deploy/references/workflow-template.md` | New — GitHub Actions workflow template |
| `skills/testflight-deploy/references/setup-guide-template.md` | New — Manual prerequisites guide template |
| `.claude-plugin/marketplace.json` | Modified — add testflight-deploy skill path |

## Phase 1: Skill Scaffold & Registration

Create the SKILL.md with three runtime phases:

**Phase 1 (Discovery)**:
- Glob for `*.xcodeproj`, `*.xcworkspace` at root and `ios/`, `app/`
- Check for `Podfile`, `Package.swift`, `Cartfile` to detect dep manager
- Parse `*.xcodeproj/xcshareddata/xcschemes/*.xcscheme` for shared schemes
- Read Xcode project settings for version (or ask user)
- Use AskUserQuestion for: bundle ID, team ID, ASC team ID, match repo URL
- Confirm all auto-detected values with user before proceeding

**Phase 2 (Generation)**: Generate/append each file using templates with substituted values.

**Phase 3 (Verification)**: Summarize what was created, list manual steps remaining.

## Phase 2: File Templates

Four reference documents with parameterized templates:

1. **fastlane-templates.md**: Appfile (identifiers), Matchfile (Git URL, storage mode, app ID), Fastfile (beta lane with setup_ci → match → increment_build_number → build_app → upload_to_testflight, plus test lane)
2. **workflow-template.md**: Full GitHub Actions YAML with conditional dep manager steps, runner selection, caching, secret env vars, concurrency groups
3. **setup-guide-template.md**: Checklist-format guide covering Apple Developer Portal, App Store Connect, match repo, GitHub secrets, Xcode signing settings
4. **Gemfile logic**: Instructions for appending vs creating, duplicate detection

## Phase 3: Existing Setup Handling

The SKILL.md must include instructions for:
- Checking if `fastlane/` directory exists
- Checking if Gemfile already has `fastlane` gem
- Checking if Fastfile already has a `beta` lane
- Merge strategy: append new lanes, don't duplicate gems, warn about conflicts

## Phase 4: Verification & Polish

- Invoke the skill on a test project (or describe how to verify)
- Review all templates against current Fastlane docs and GitHub Actions runner matrix
- Ensure YAML indentation is correct in workflow template
- Verify Fastfile Ruby syntax

## Parallel Execution

- Phase 2 tasks (templates) can all be written in parallel — they're independent files
- Phase 1 and Phase 3 are serial (SKILL.md must exist before testing merge instructions)
- Phase 4 is serial (requires all files to exist)

## Verification Steps

- [ ] Invoke `/testflight-deploy` on a fresh iOS project — all 6 files generated correctly
- [ ] Invoke on a project with existing Gemfile — fastlane appended, not duplicated
- [ ] Invoke on a project with .xcodeproj in `ios/` subdirectory — paths adjusted correctly
- [ ] Workflow YAML passes `yamllint` validation
- [ ] Fastfile passes `ruby -c` syntax check
- [ ] Setup guide covers all manual prerequisites with actionable steps
