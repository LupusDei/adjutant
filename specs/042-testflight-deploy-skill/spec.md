# Feature Specification: TestFlight Deploy Skill

**Feature Branch**: `042-testflight-deploy-skill`
**Created**: 2026-03-11
**Status**: Draft

## User Scenarios & Testing

### User Story 1 - Core Pipeline Setup (Priority: P1)

A developer working on an iOS project invokes `/testflight-deploy` and the skill auto-detects their project structure (Xcode project location, dependency manager, shared schemes, Xcode version), asks for required identifiers (bundle ID, team IDs, match repo URL), and generates all Fastlane + GitHub Actions files needed for automatic TestFlight deployment on push to main.

**Why this priority**: This is the entire value proposition — zero to TestFlight CI/CD in one skill invocation.

**Independent Test**: Invoke the skill on a sample iOS project. Verify all 6 files are generated with correct values substituted. Verify the GitHub Actions workflow is syntactically valid YAML. Verify the Fastfile uses correct lane structure.

**Acceptance Scenarios**:

1. **Given** an iOS project with a .xcodeproj at root, **When** user invokes `/testflight-deploy`, **Then** the skill detects the project, asks for identifiers, and generates Gemfile, fastlane/Appfile, fastlane/Matchfile, fastlane/Fastfile, .github/workflows/testflight.yml, and docs/testflight-setup.md with all values correctly substituted.

2. **Given** an iOS project using CocoaPods (Podfile present), **When** the skill generates the GitHub Actions workflow, **Then** the workflow includes `pod install` step and caches `Pods/` keyed on `Podfile.lock`.

3. **Given** an iOS project using SPM only (Package.swift, no Podfile), **When** the skill generates the workflow, **Then** the workflow caches SPM directories and does not include pod install steps.

4. **Given** an Xcode project with multiple shared schemes, **When** the skill detects schemes, **Then** it presents the list and asks the user to pick one for the beta lane.

5. **Given** an iOS project in a subdirectory (`ios/`), **When** the skill scans for .xcodeproj, **Then** it finds it in the subdirectory and adjusts all paths accordingly.

---

### User Story 2 - Manual Prerequisites Guide (Priority: P1)

After generating CI/CD files, the skill produces a comprehensive `docs/testflight-setup.md` that walks the developer through every manual step required in Apple Developer Portal, App Store Connect, and GitHub — with exact instructions, links, and a checklist format.

**Why this priority**: Without the manual steps guide, generated files are useless — the developer won't know what secrets to configure or what Apple portal actions are needed.

**Independent Test**: Read the generated setup guide. Verify it covers: Apple Developer Program enrollment, Bundle ID registration, App Store Connect app creation, API key generation, match cert repo creation, initial match run, and GitHub secrets configuration. Verify each step has actionable instructions.

**Acceptance Scenarios**:

1. **Given** the skill has generated all files, **When** the user reads docs/testflight-setup.md, **Then** they can follow the checklist from top to bottom and have a working TestFlight pipeline without consulting external documentation.

2. **Given** a developer who has never used Fastlane Match, **When** they read the Match setup section, **Then** they understand they need a private Git repo, how to run match locally the first time, and what the encryption password is for.

---

### User Story 3 - Existing Setup Handling (Priority: P2)

When invoked on a project that already has some Fastlane configuration (e.g., existing Gemfile, existing Fastfile), the skill detects the existing setup and appends/modifies rather than overwriting.

**Why this priority**: Many real projects will have partial CI/CD setup. Overwriting existing config would destroy working lanes.

**Independent Test**: Create a project with an existing Gemfile and Fastfile with a `release` lane. Invoke the skill. Verify the Gemfile gets `fastlane` appended (not duplicated), and the Fastfile gets the `beta` lane added without removing the existing `release` lane.

**Acceptance Scenarios**:

1. **Given** a project with an existing Gemfile that already includes fastlane, **When** the skill runs, **Then** it does not add a duplicate fastlane entry.

2. **Given** a project with an existing Fastfile containing other lanes, **When** the skill generates the beta lane, **Then** it appends the beta lane without removing existing lanes.

3. **Given** a project with no fastlane/ directory, **When** the skill runs, **Then** it creates the directory and all files from scratch.

---

### Edge Cases

- What happens when no .xcodeproj or .xcworkspace is found? → Skill asks the user to provide the path.
- What happens when the project uses Carthage? → Skill detects Cartfile and includes `carthage bootstrap` step, but warns that Carthage is deprecated.
- What happens when Xcode version can't be detected from project settings? → Skill asks the user or defaults to latest stable (macos-15 / Xcode 16.x).
- What if the project uses automatic code signing? → Skill warns that CI requires manual signing and provides instructions to switch.

## Requirements

### Functional Requirements

- **FR-001**: Skill MUST auto-detect iOS project location by scanning for .xcodeproj/.xcworkspace at root and common subdirectories (ios/, app/, Sources/)
- **FR-002**: Skill MUST auto-detect dependency manager from presence of Package.swift, Podfile, Cartfile
- **FR-003**: Skill MUST auto-detect shared Xcode schemes by parsing xcshareddata/xcschemes/
- **FR-004**: Skill MUST ask user for bundle ID, Apple Team ID, App Store Connect Team ID, and match repo URL
- **FR-005**: Skill MUST generate syntactically valid Fastlane files (Appfile, Matchfile, Fastfile)
- **FR-006**: Skill MUST generate a valid GitHub Actions workflow YAML with correct runner, caching, and secret references
- **FR-007**: Skill MUST generate a comprehensive manual prerequisites guide
- **FR-008**: Skill MUST handle existing Gemfile/Fastfile gracefully (append, not overwrite)
- **FR-009**: Skill MUST select the correct macOS runner based on detected Xcode version
- **FR-010**: Skill MUST use `latest_testflight_build_number + 1` for build number auto-increment
- **FR-011**: Skill MUST configure workflow triggers for push to main and workflow_dispatch

### Key Entities

- **Skill Directive** (`SKILL.md`): The instruction set Claude follows when the skill is invoked
- **File Templates** (`references/`): Parameterized templates for each generated file
- **Project Context**: Auto-detected values (project path, scheme, dep manager, Xcode version)
- **User-Provided Values**: Bundle ID, team IDs, match repo URL, match password hint

## Success Criteria

- **SC-001**: A developer can go from zero CI/CD to a working TestFlight pipeline by invoking the skill and following the generated guide — no external tutorials needed
- **SC-002**: Generated files are production-quality (not boilerplate that needs heavy editing)
- **SC-003**: The skill works on at least 3 project structures: standalone .xcodeproj, .xcworkspace with CocoaPods, and SPM-only
- **SC-004**: All generated YAML and Ruby files are syntactically valid
