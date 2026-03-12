# Tasks: TestFlight Deploy Skill

**Input**: Design documents from `/specs/042-testflight-deploy-skill/`
**Epic**: `adj-076`

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs for this document
- **Bead IDs** (adj-076.N.M): Assigned in beads-import.md after bead creation
- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1, US2, etc.)

## Phase 1: Skill Scaffold & Registration

**Purpose**: Create the SKILL.md directive and register the skill in the plugin

- [ ] T001 [US1] Create SKILL.md with Phase 1 (Discovery) instructions — auto-detect project location, dep manager, schemes, Xcode version; collect user inputs via AskUserQuestion; confirm detected values in `skills/testflight-deploy/SKILL.md`
- [ ] T002 [US1] Add Phase 2 (Generation) instructions to SKILL.md — file generation sequence, template substitution, existing-file detection, output summary in `skills/testflight-deploy/SKILL.md`
- [ ] T003 [US1] Add Phase 3 (Verification) instructions to SKILL.md — post-generation summary, manual steps reminder, next-steps guidance in `skills/testflight-deploy/SKILL.md`
- [ ] T004 [P] [US1] Register testflight-deploy skill in marketplace.json in `.claude-plugin/marketplace.json`

---

## Phase 2: File Templates

**Purpose**: Create parameterized reference templates for all generated files

- [ ] T005 [P] [US1] Create Fastlane templates reference — Appfile ({{BUNDLE_ID}}, {{APPLE_ID}}, {{TEAM_ID}}, {{ITC_TEAM_ID}}), Matchfile ({{MATCH_GIT_URL}}, {{BUNDLE_ID}}), Fastfile (beta lane with setup_ci, match, increment_build_number, build_app, upload_to_testflight; test lane with scan) in `skills/testflight-deploy/references/fastlane-templates.md`
- [ ] T006 [P] [US1] Create GitHub Actions workflow template — conditional steps for SPM/CocoaPods/Carthage caching, runner selection based on {{XCODE_VERSION}}, secret env vars, concurrency group, workflow_dispatch + push triggers in `skills/testflight-deploy/references/workflow-template.md`
- [ ] T007 [P] [US2] Create manual setup guide template — checklist for Apple Developer enrollment, Bundle ID registration, App Store Connect app creation, API key generation, match cert repo setup, initial local match run, GitHub secrets configuration, Xcode manual signing setup in `skills/testflight-deploy/references/setup-guide-template.md`
- [ ] T008 [P] [US1] Create Gemfile template/instructions — new Gemfile creation vs appending to existing, duplicate detection logic in `skills/testflight-deploy/references/fastlane-templates.md` (append to T005 file)

**Checkpoint**: All templates written — skill can generate files

---

## Phase 3: Existing Setup Handling

**Purpose**: Ensure skill handles projects with partial existing CI/CD config

- [ ] T009 [US3] Add existing-setup detection and merge instructions to SKILL.md Phase 2 — check for existing fastlane/ dir, existing Gemfile with fastlane gem, existing Fastfile with beta lane, existing .github/workflows/testflight.yml; define merge vs skip vs warn behavior for each case in `skills/testflight-deploy/SKILL.md`

---

## Phase 4: Verification & Polish

**Purpose**: Ensure correctness and completeness of all skill artifacts

- [ ] T010 [P] Review all templates against current Fastlane docs — verify Fastfile lane syntax, Matchfile options, Appfile fields are current for Fastlane 2.x in `skills/testflight-deploy/references/fastlane-templates.md`
- [ ] T011 [P] Review workflow template against GitHub Actions runner matrix — verify macos runner versions, setup-xcode action version, ruby/setup-ruby version, caching strategy in `skills/testflight-deploy/references/workflow-template.md`
- [ ] T012 End-to-end skill review — read SKILL.md start to finish simulating invocation, verify instructions are unambiguous, all edge cases handled, all templates referenced correctly in `skills/testflight-deploy/SKILL.md`

---

## Dependencies

- Phase 1 (Scaffold) blocks Phase 2 (Templates) — SKILL.md must exist to reference templates
  - Exception: T004 (marketplace.json) and T005-T008 (templates) can start in parallel since they're independent files
- Phase 2 (Templates) blocks Phase 3 (Existing Setup) — need templates to define merge behavior
- Phase 3 (Existing Setup) blocks Phase 4 (Verification) — need complete skill to review

## Parallel Opportunities

- T004 (marketplace.json) can run in parallel with T001-T003 (SKILL.md phases)
- T005, T006, T007 can all run in parallel (independent reference files)
- T010, T011 can run in parallel (independent review tasks)
- After Phase 1 + Phase 2 complete, Phase 3 and Phase 4 are serial
