# iOS Deployment Setup Guide

This guide walks through setting up TestFlight CI/CD for the Adjutant iOS app.

## Prerequisites

1. Active Apple Developer Program membership ($99/year)
2. Access to App Store Connect
3. GitHub repository with Actions enabled

## One-Time Setup

### 1. App Store Connect API Key

The recommended authentication method for CI is App Store Connect API keys:

1. Go to [App Store Connect > Users and Access > Keys](https://appstoreconnect.apple.com/access/api)
2. Click the "+" button to generate a new key
3. Name: `CI-TestFlight` (or similar)
4. Access: `App Manager` (minimum required for TestFlight uploads)
5. Download the `.p8` key file (you can only download it once!)
6. Note the **Key ID** and **Issuer ID**

### 2. Certificate Repository (Match)

Match stores encrypted certificates in a private git repository:

1. Create a private repository (e.g., `github.com/your-org/ios-certificates`)
2. Generate a deploy key:
   ```bash
   ssh-keygen -t ed25519 -C "match-deploy-key" -f match_deploy_key
   ```
3. Add the public key (`match_deploy_key.pub`) to the certificate repo as a deploy key with write access
4. Save the private key for GitHub Secrets

### 3. Initialize Match (First Time Only)

Run locally to create initial certificates:

```bash
cd ios

# Install fastlane
bundle install

# Set up environment
cp fastlane/.env.default fastlane/.env
# Edit fastlane/.env with your values

# Initialize match (creates certs and profiles)
bundle exec fastlane match init
bundle exec fastlane match appstore
```

### 4. GitHub Secrets

Add these secrets to your GitHub repository:

| Secret Name | Description |
|-------------|-------------|
| `APP_STORE_CONNECT_API_KEY_ID` | Key ID from App Store Connect |
| `APP_STORE_CONNECT_API_ISSUER_ID` | Issuer ID from App Store Connect |
| `APP_STORE_CONNECT_API_KEY_BASE64` | Base64-encoded .p8 key file |
| `MATCH_GIT_URL` | SSH URL of certificate repository |
| `MATCH_PASSWORD` | Encryption password for match |
| `MATCH_DEPLOY_KEY` | SSH private key for certificate repo |

To encode the API key:
```bash
base64 -i AuthKey_XXXXXXXX.p8 | pbcopy
```

### 5. App Configuration in App Store Connect

1. Go to [App Store Connect > Apps](https://appstoreconnect.apple.com/apps)
2. Click "+" and create a new app:
   - Platform: iOS
   - Bundle ID: `com.jmm.Adjutant`
   - Name: `Adjutant`
3. Configure TestFlight:
   - Add internal testers (your team)
   - Optionally set up external testing groups

## Usage

### Automatic Deployment

Push to `main` with changes in `ios/` directory triggers automatic TestFlight deployment.

### Manual Deployment

1. Go to Actions > "Deploy to TestFlight"
2. Click "Run workflow"
3. Optionally enter changelog text
4. Click "Run workflow"

### Local Testing

```bash
cd ios

# Install dependencies
bundle install

# Run tests
bundle exec fastlane test

# Build and upload to TestFlight (requires .env configured)
bundle exec fastlane beta
```

## Troubleshooting

### "No signing certificate" error

Ensure match has created certificates:
```bash
bundle exec fastlane match appstore --readonly
```

If certificates don't exist, run without `--readonly` to create them.

### Build number conflicts

The Fastfile automatically increments build numbers based on the latest TestFlight build. If you get conflicts:
```bash
bundle exec fastlane bump_build
```

### API Key Authentication Fails

1. Verify the key hasn't expired in App Store Connect
2. Check the key has sufficient permissions (App Manager)
3. Ensure base64 encoding is correct (no line breaks)

### Match Repository Access

Ensure the deploy key:
1. Is added to the certificate repo with write access
2. Is correctly set as `MATCH_DEPLOY_KEY` secret
3. Has no passphrase (or passphrase is also stored)

## Security Notes

- **Never commit** `.env` files, `.p8` keys, or certificates to the main repo
- Certificate repository should be **private**
- Rotate API keys periodically
- Use minimal permissions for CI keys
