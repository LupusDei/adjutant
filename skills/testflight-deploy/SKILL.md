---
name: testflight-deploy
description: Set up automatic TestFlight deployment for iOS projects via Fastlane and GitHub Actions. Auto-detects project structure, generates CI/CD configuration files, and provides a step-by-step manual setup guide. Use when the user says "set up TestFlight", "configure CI/CD for iOS", "automate TestFlight builds", or wants to add TestFlight deployment to any iOS project.
---

# TestFlight Deploy

Set up automatic TestFlight deployment for any iOS project. Generates Fastlane configuration, GitHub Actions workflow, and a step-by-step manual setup guide.

## Phase 1: Discovery

Before generating any files, gather all the information needed to configure the deployment pipeline.

### Step 1: Find iOS Project

Use Glob to search for Xcode project files:

1. Search for `**/*.xcworkspace` and `**/*.xcodeproj` at the project root and common subdirectories (`ios/`, `app/`, `Sources/`).
2. If an `.xcworkspace` is found alongside a `Podfile` in the same directory, prefer the workspace.
3. If multiple projects/workspaces are found, ask the user to pick one.
4. If none are found, ask the user for the path to their Xcode project.

Record the project/workspace filename and its directory path relative to the repository root.

### Step 2: Detect Dependency Manager

Check for the presence of these files in the project directory and repository root:

- `Podfile` — CocoaPods
- `Package.swift` — Swift Package Manager (SPM)
- `Cartfile` — Carthage

If multiple are found, use this precedence: CocoaPods > SPM > Carthage. Record the primary dependency manager.

### Step 3: Detect Shared Schemes

Glob for scheme files:

- `<project>.xcodeproj/xcshareddata/xcschemes/*.xcscheme`
- `<workspace>.xcworkspace/xcshareddata/xcschemes/*.xcscheme`

Extract scheme names by stripping the `.xcscheme` extension from filenames. If multiple schemes are found, ask the user to pick the one used for TestFlight builds. If none are found, ask the user for the scheme name.

### Step 4: Detect Xcode Version

Attempt to determine the Xcode version:

1. Check for a `.xcode-version` file in the repository root.
2. If not found, read `project.pbxproj` and look for `SWIFT_VERSION` or `LastUpgradeCheck` values.
3. Map to GitHub Actions runner:
   - Xcode 15.x — `macos-14`
   - Xcode 16.x — `macos-15`
4. If detection fails, default to `macos-15` / Xcode 16.2 and inform the user of the default.

### Step 5: Determine Project-Relative Paths

If the Xcode project lives in a subdirectory (e.g., `ios/MyApp.xcodeproj`), record the relative path from the repository root. This affects:

- The `working-directory` setting in GitHub Actions
- The `project` or `workspace` argument in the Fastfile

If the project is at the repository root, the working directory is empty (no override needed).

### Step 6: Collect User Inputs

Ask the user all of the following in a single question:

1. **Bundle ID** — e.g., `com.company.appname`
2. **Apple Developer Team ID** — 10-character alphanumeric string, found at [developer.apple.com/account](https://developer.apple.com/account)
3. **App Store Connect Team ID** — numeric, found at [appstoreconnect.apple.com](https://appstoreconnect.apple.com) under Users and Access
4. **Match certificate Git repo URL** — must be a private repository (e.g., `git@github.com:org/certs.git`)
5. **Apple ID email** — the email associated with the Apple Developer account

### Step 7: Confirm Values

Before proceeding to file generation, display a summary table of all detected and user-provided values:

```
| Setting                  | Value                              | Source        |
|--------------------------|------------------------------------|---------------|
| Xcode project/workspace  | MyApp.xcworkspace                  | Auto-detected |
| Dependency manager        | CocoaPods                          | Auto-detected |
| Scheme                    | MyApp                              | Auto-detected |
| Xcode version             | 16.2                               | Auto-detected |
| macOS runner              | macos-15                           | Derived       |
| Working directory         | ios/                               | Derived       |
| Bundle ID                 | com.company.myapp                  | User input    |
| Apple Developer Team ID   | ABCDE12345                         | User input    |
| App Store Connect Team ID | 123456789                          | User input    |
| Match cert repo           | git@github.com:org/certs.git       | User input    |
| Apple ID email            | dev@company.com                    | User input    |
```

Ask the user to confirm or correct any values before proceeding.

## Phase 2: File Generation

Read each template from `references/`, replace all `{{PLACEHOLDER}}` values with the discovered/provided values, and write the result to the target path. Generate files in the order listed below.

### 1. Gemfile (project root)

- **If Gemfile exists**: Read it. If `gem "fastlane"` is NOT present, use Edit to append `gem "fastlane"` after the last `gem` line. If already present, skip.
- **If Gemfile does not exist**: Create it from the template in `references/fastlane-templates.md`, section "Gemfile".

### 2. fastlane/Appfile

- Create the `fastlane/` directory if it does not exist (`mkdir -p fastlane`).
- Generate from `references/fastlane-templates.md`, section "Appfile".
- Replace: `{{BUNDLE_ID}}`, `{{APPLE_ID}}`, `{{ITC_TEAM_ID}}`, `{{TEAM_ID}}`.

### 3. fastlane/Matchfile

- Generate from `references/fastlane-templates.md`, section "Matchfile".
- Replace: `{{MATCH_GIT_URL}}`, `{{BUNDLE_ID}}`.

### 4. fastlane/Fastfile

- Generate from `references/fastlane-templates.md`, section "Fastfile".
- Replace: `{{SCHEME}}`, `{{WORKSPACE_OR_PROJECT}}`.
- For `{{WORKSPACE_OR_PROJECT}}`:
  - If CocoaPods: use `,\n      workspace: "<name>.xcworkspace"`
  - If standalone project: use `,\n      project: "<name>.xcodeproj"`
  - If the project is in a subdirectory, prepend the relative path (e.g., `ios/MyApp.xcworkspace`).

### 5. .github/workflows/testflight.yml

- Create the `.github/workflows/` directory if it does not exist (`mkdir -p .github/workflows`).
- Generate from `references/workflow-template.md`.
- Replace: `{{MACOS_RUNNER}}`, `{{XCODE_VERSION}}`, `{{DEP_MANAGER_STEPS}}`, `{{WORKING_DIRECTORY}}`.
- For `{{DEP_MANAGER_STEPS}}`: select the appropriate conditional block from the template based on the detected dependency manager (CocoaPods, SPM, or Carthage).
- **IMPORTANT**: Do NOT replace `${{ secrets.* }}` or `${{ hashFiles(...) }}` — those are GitHub Actions runtime expressions, not template placeholders.

### 6. docs/testflight-setup.md

- Create the `docs/` directory if it does not exist (`mkdir -p docs`).
- Generate from `references/setup-guide-template.md`.
- Replace: `{{APP_NAME}}`, `{{BUNDLE_ID}}`, `{{MATCH_GIT_URL}}`.

### Handling Existing Files

Before writing each file, check whether it already exists and handle accordingly:

- **Existing Gemfile**: Read the file first. If `gem "fastlane"` is already present, skip it entirely. If the gem is missing, use Edit to append `gem "fastlane"` after the last `gem` line. Do not overwrite or remove other gems.

- **Existing fastlane/Fastfile**: Read the file first. If a `beta` lane already exists, warn the user and ask whether to overwrite the existing lane or skip generation. If no `beta` lane exists, append the new `beta` lane block to the end of the existing file (inside the `platform :ios do` block if present). Do not replace existing lanes.

- **Existing .github/workflows/testflight.yml**: Warn the user that the workflow file already exists. Ask whether to overwrite it or skip. Do not silently overwrite.

- **Existing fastlane/Appfile or fastlane/Matchfile**: Warn the user that the file exists and ask whether to overwrite. These files are simple key-value configurations where merging is not practical — it is safer to replace entirely or skip.

- **No fastlane/ directory**: This is the default happy path. Create the directory and all files fresh without prompting.

## Phase 3: Verification & Summary

After all files are generated, verify and summarize the results.

### Step 1: List Generated Files

List all files that were created or modified, with their full paths relative to the repository root. Example:

```
Created:
  - Gemfile
  - fastlane/Appfile
  - fastlane/Matchfile
  - fastlane/Fastfile
  - .github/workflows/testflight.yml
  - docs/testflight-setup.md

Modified:
  - Gemfile (added gem "fastlane")
```

### Step 2: Configuration Summary

Display the final configuration values used:

- Bundle ID
- Scheme
- macOS runner and Xcode version
- Dependency manager
- Project path (if subdirectory)

### Step 3: Manual Setup Reminder

Print the key manual steps the user must complete before the pipeline will work. These come from `docs/testflight-setup.md`:

1. **Register Bundle ID** in the Apple Developer Portal
2. **Create the app** in App Store Connect
3. **Create an App Store Connect API key** and download the `.p8` file
4. **Set up the match certificate repository** and run `fastlane match appstore` locally to generate initial certificates
5. **Configure GitHub repository secrets**:
   - `MATCH_PASSWORD` — passphrase for match encryption
   - `ASC_KEY_ID` — App Store Connect API key ID
   - `ASC_ISSUER_ID` — App Store Connect API issuer ID
   - `ASC_KEY_CONTENT` — Base64-encoded `.p8` key file contents
   - `MATCH_GIT_BASIC_AUTHORIZATION` — Base64-encoded `username:token` for the match cert repo
6. **Switch to manual code signing** in Xcode project settings (disable "Automatically manage signing")

### Step 4: Next Steps

Suggest to the user:

> Follow `docs/testflight-setup.md` for detailed instructions on each step. Once complete, push to `main` to trigger your first TestFlight build.

## Placeholders Reference

All templates use `{{PLACEHOLDER}}` syntax. Replace every placeholder before writing files.

| Placeholder | Source | Example |
|-------------|--------|---------|
| `{{BUNDLE_ID}}` | User input | `com.company.myapp` |
| `{{APPLE_ID}}` | User input | `dev@company.com` |
| `{{TEAM_ID}}` | User input | `ABCDE12345` |
| `{{ITC_TEAM_ID}}` | User input | `123456789` |
| `{{MATCH_GIT_URL}}` | User input | `git@github.com:org/certs.git` |
| `{{SCHEME}}` | Auto-detected | `MyApp` |
| `{{XCODE_VERSION}}` | Auto-detected | `16.2` |
| `{{MACOS_RUNNER}}` | Derived from Xcode version | `macos-15` |
| `{{WORKSPACE_OR_PROJECT}}` | Derived from dep manager | workspace or project arg |
| `{{DEP_MANAGER_STEPS}}` | Derived from dep manager | CocoaPods/SPM/Carthage steps |
| `{{WORKING_DIRECTORY}}` | Derived from project path | `ios/` or empty |
| `{{APP_NAME}}` | Derived from scheme name | `MyApp` |

## Key Rules

- Templates use `{{PLACEHOLDER}}` syntax — replace ALL placeholders before writing files
- Never write files with unreplaced `{{...}}` placeholders
- Always create parent directories before writing files (`mkdir -p`)
- The skill generates files — it does NOT run fastlane, bundle install, or any build commands
- All generated Ruby code must be valid syntax
- All generated YAML must use correct indentation (2 spaces for YAML)
- GitHub Actions `${{ }}` expressions must NOT be replaced — they are runtime expressions
- If the user cancels during discovery, stop gracefully without generating partial files

## References

- [fastlane-templates.md](references/fastlane-templates.md) - Appfile, Matchfile, Fastfile, Gemfile templates
- [workflow-template.md](references/workflow-template.md) - GitHub Actions workflow with conditional dep manager steps
- [setup-guide-template.md](references/setup-guide-template.md) - Manual prerequisites checklist
