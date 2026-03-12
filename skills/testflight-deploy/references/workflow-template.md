# GitHub Actions Workflow Template

Template for `.github/workflows/testflight.yml`. Replace `{{PLACEHOLDER}}` values with detected project values.

**IMPORTANT**: Do NOT replace GitHub Actions expressions like `${{ secrets.* }}` or `${{ hashFiles(...) }}` — those are runtime expressions, not template placeholders. Only replace `{{ALL_CAPS_PLACEHOLDERS}}`.

## Runner Selection

| Xcode Version | Runner | Notes |
|---------------|--------|-------|
| 15.0 – 15.4 | `macos-14` | M1 runner |
| 16.0 – 16.2+ | `macos-15` | M2 runner |

If Xcode version cannot be detected, default to `macos-15` with `xcode-version: '16.2'`.

## Base Workflow

```yaml
name: TestFlight Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:
  # Uncomment for tag-based triggers:
  # push:
  #   tags: ['v*']

concurrency:
  group: testflight-deploy
  cancel-in-progress: false  # Don't cancel in-flight uploads

jobs:
  deploy:
    name: Build & Deploy to TestFlight
    runs-on: {{MACOS_RUNNER}}
    timeout-minutes: 30
    {{WORKING_DIRECTORY_DEFAULT}}

    steps:
      - uses: actions/checkout@v4

      - uses: maxim-lobanov/setup-xcode@v1
        with:
          xcode-version: '{{XCODE_VERSION}}'

      - uses: ruby/setup-ruby@v1
        with:
          ruby-version: '3.3'
          bundler-cache: true

{{DEP_MANAGER_STEPS}}

      - name: Deploy to TestFlight
        run: bundle exec fastlane beta
        env:
          ASC_KEY_ID: ${{ secrets.ASC_KEY_ID }}
          ASC_ISSUER_ID: ${{ secrets.ASC_ISSUER_ID }}
          ASC_KEY: ${{ secrets.ASC_KEY_CONTENT }}
          MATCH_GIT_PRIVATE_KEY: ${{ secrets.MATCH_GIT_PRIVATE_KEY }}
          MATCH_PASSWORD: ${{ secrets.MATCH_PASSWORD }}
```

### {{WORKING_DIRECTORY_DEFAULT}} Substitution

If the iOS project is in a subdirectory (e.g., `ios/`):
```yaml
    defaults:
      run:
        working-directory: {{WORKING_DIRECTORY}}
```

If at project root, remove this block entirely.

## Dependency Manager Steps

Select ONE of the following blocks based on the detected dependency manager:

### CocoaPods (Podfile detected)

```yaml
      - name: Cache CocoaPods
        uses: actions/cache@v4
        with:
          path: {{WORKING_DIRECTORY}}Pods
          key: ${{ runner.os }}-pods-${{ hashFiles('{{WORKING_DIRECTORY}}Podfile.lock') }}
          restore-keys: |
            ${{ runner.os }}-pods-

      - name: Install CocoaPods
        run: bundle exec pod install
```

### SPM (Package.swift detected, no Podfile)

```yaml
      - name: Cache SPM packages
        uses: actions/cache@v4
        with:
          path: |
            ~/Library/Developer/Xcode/DerivedData/**/SourcePackages
            ~/Library/Caches/org.swift.swiftpm
          key: ${{ runner.os }}-spm-${{ hashFiles('{{WORKING_DIRECTORY}}*.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved', '{{WORKING_DIRECTORY}}Package.resolved') }}
          restore-keys: |
            ${{ runner.os }}-spm-
```

### Carthage (Cartfile detected)

```yaml
      - name: Cache Carthage
        uses: actions/cache@v4
        with:
          path: {{WORKING_DIRECTORY}}Carthage/Build
          key: ${{ runner.os }}-carthage-${{ hashFiles('{{WORKING_DIRECTORY}}Cartfile.resolved') }}
          restore-keys: |
            ${{ runner.os }}-carthage-

      - name: Install Carthage dependencies
        run: carthage bootstrap --use-xcframeworks --cache-builds
```

### No dependency manager detected

Omit the dependency manager steps entirely.
