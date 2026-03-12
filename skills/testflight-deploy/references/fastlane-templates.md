# Fastlane Templates

Templates for Fastlane configuration files. Replace `{{PLACEHOLDER}}` values with detected/user-provided values at runtime.

## Gemfile

If a Gemfile already exists, check if it contains `gem "fastlane"`. If not, append the gem line. If no Gemfile exists, create this:

```ruby
source "https://rubygems.org"

gem "fastlane"
```

## Appfile

Write to `fastlane/Appfile`:

```ruby
app_identifier("{{BUNDLE_ID}}")   # Bundle ID (e.g., com.company.appname)
apple_id("{{APPLE_ID}}")          # Apple ID email for the developer account
itc_team_id("{{ITC_TEAM_ID}}")    # App Store Connect Team ID (numeric)
team_id("{{TEAM_ID}}")            # Apple Developer Portal Team ID (10-char alphanumeric)
```

## Matchfile

Write to `fastlane/Matchfile`:

```ruby
git_url("{{MATCH_GIT_URL}}")      # Private repo URL for encrypted certificates
storage_mode("git")
type("appstore")
app_identifier(["{{BUNDLE_ID}}"])
# username("{{APPLE_ID}}")        # Uncomment if not using API key auth
```

## Fastfile

Write to `fastlane/Fastfile`:

```ruby
default_platform(:ios)

platform :ios do
  desc "Push a new beta build to TestFlight"
  lane :beta do
    setup_ci

    app_store_connect_api_key(
      key_id: ENV["ASC_KEY_ID"],
      issuer_id: ENV["ASC_ISSUER_ID"],
      key_content: ENV["ASC_KEY"],
      is_key_content_base64: false
    )

    match(
      type: "appstore",
      readonly: true
    )

    increment_build_number(
      build_number: latest_testflight_build_number + 1
    )

    build_app(
      scheme: "{{SCHEME}}",
      export_method: "app-store"{{WORKSPACE_OR_PROJECT}}
    )

    upload_to_testflight(
      skip_waiting_for_build_processing: true
    )
  end

  desc "Run tests"
  lane :test do
    scan(
      scheme: "{{SCHEME}}"{{WORKSPACE_OR_PROJECT}}
    )
  end
end
```

### {{WORKSPACE_OR_PROJECT}} Substitution

This placeholder controls how Xcode finds the project:

- **CocoaPods** (`.xcworkspace` exists): Replace with `,\n      workspace: "{{PROJECT_PATH}}{{WORKSPACE_NAME}}.xcworkspace"`
- **Standalone project**: Replace with `,\n      project: "{{PROJECT_PATH}}{{PROJECT_NAME}}.xcodeproj"`
- **SPM-only** (no workspace, no xcodeproj with pods): Replace with `,\n      project: "{{PROJECT_PATH}}{{PROJECT_NAME}}.xcodeproj"`

Where `{{PROJECT_PATH}}` is the relative subdirectory path (e.g., `ios/`) or empty string if at root.
