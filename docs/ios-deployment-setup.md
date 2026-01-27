# iOS Deployment Setup Guide

This guide covers TestFlight CI/CD and Push Notifications setup for the Adjutant iOS app.

## Current Status

### What's Implemented
- [x] Fastlane configuration (`ios/fastlane/`)
- [x] GitHub Actions workflow (`testflight.yml`)
- [x] Backend APNs service (`backend/src/services/apns-service.ts`)
- [x] Device token registration endpoint
- [x] iOS app push notification entitlements

### What's NOT Set Up Yet
- [ ] App Store Connect API Key (secrets not configured)
- [ ] Match certificate repository (needs private repo)
- [ ] GitHub Secrets for CI
- [ ] APNs key file for push notifications
- [ ] App registered in App Store Connect

---

## Part 1: TestFlight Deployment

### Prerequisites

1. Active Apple Developer Program membership ($99/year)
2. Access to App Store Connect
3. GitHub repository with Actions enabled

### Step-by-Step Setup

#### 1. Create App in App Store Connect

1. Go to [App Store Connect > Apps](https://appstoreconnect.apple.com/apps)
2. Click "+" and create a new app:
   - Platform: iOS
   - Bundle ID: `com.jmm.Adjutant`
   - Name: `Adjutant`
3. Configure TestFlight:
   - Add internal testers (your team)
   - Optionally set up external testing groups

#### 2. Generate App Store Connect API Key

1. Go to [App Store Connect > Users and Access > Integrations > Keys](https://appstoreconnect.apple.com/access/integrations/api)
2. Click "+" to generate a new key
3. Name: `CI-TestFlight`
4. Access: `App Manager` (minimum required)
5. **Download the `.p8` key file** (you can only download it once!)
6. Note the **Key ID** and **Issuer ID**

#### 3. Create Certificate Repository (Match)

Match stores encrypted certificates in a private git repository:

```bash
# Create a private repository on GitHub (e.g., github.com/your-org/ios-certificates)

# Generate a deploy key
ssh-keygen -t ed25519 -C "match-deploy-key" -f match_deploy_key -N ""

# Add the public key (match_deploy_key.pub) to the cert repo as a deploy key with WRITE access
# Save the private key content for GitHub Secrets
```

#### 4. Initialize Match (One-Time Local Setup)

```bash
cd ios

# Install fastlane
bundle install

# Create local .env from template
cp fastlane/.env.default fastlane/.env

# Edit fastlane/.env with your values:
# - APP_STORE_CONNECT_API_KEY_ID=<your key id>
# - APP_STORE_CONNECT_API_ISSUER_ID=<your issuer id>
# - MATCH_GIT_URL=git@github.com:your-org/ios-certificates.git
# - MATCH_PASSWORD=<strong encryption password>

# Place your AuthKey_XXXXX.p8 file in fastlane/AuthKey.p8

# Initialize match (creates certs and profiles in the cert repo)
bundle exec fastlane match appstore
```

#### 5. Configure GitHub Secrets

Go to your GitHub repo > Settings > Secrets > Actions and add:

| Secret Name | Value | How to Get It |
|-------------|-------|---------------|
| `APP_STORE_CONNECT_API_KEY_ID` | Key ID | From App Store Connect when creating API key |
| `APP_STORE_CONNECT_API_ISSUER_ID` | Issuer ID | From App Store Connect API keys page |
| `APP_STORE_CONNECT_API_KEY_BASE64` | Base64-encoded .p8 | `base64 -i AuthKey_XXXXX.p8 \| pbcopy` |
| `MATCH_GIT_URL` | `git@github.com:your-org/ios-certificates.git` | Your private cert repo SSH URL |
| `MATCH_PASSWORD` | Encryption password | Same password used in local match init |
| `MATCH_DEPLOY_KEY` | SSH private key | Content of `match_deploy_key` file |

#### 6. Trigger Deployment

**Automatic:** Push to `main` with changes in `ios/` directory

**Manual:**
1. Go to Actions > "Deploy to TestFlight"
2. Click "Run workflow"
3. Optionally enter changelog text
4. Click "Run workflow"

---

## Part 2: Push Notifications (APNs)

### Prerequisites

1. Apple Developer account with push notification capability
2. App ID configured for push notifications

### Step-by-Step Setup

#### 1. Enable Push Notifications in App ID

1. Go to [Apple Developer > Identifiers](https://developer.apple.com/account/resources/identifiers/list)
2. Select your App ID (`com.jmm.Adjutant`)
3. Enable "Push Notifications" capability
4. Save

#### 2. Create APNs Key

1. Go to [Apple Developer > Keys](https://developer.apple.com/account/resources/authkeys/list)
2. Click "+" to create a new key
3. Name: `Adjutant APNs`
4. Enable "Apple Push Notifications service (APNs)"
5. Continue and Register
6. **Download the `.p8` key file** (one-time download!)
7. Note the **Key ID**

#### 3. Configure Backend Environment

Add to your backend `.env` file (or server environment):

```bash
# APNs Configuration
APNS_TEAM_ID=2BRYAM5Q52
APNS_KEY_ID=<your APNs key ID>
APNS_BUNDLE_ID=com.jmm.Adjutant
APNS_KEY_PATH=/path/to/APNsKey.p8
APNS_ENVIRONMENT=development  # or "production" for App Store builds
```

#### 4. Deploy APNs Key

For local development:
```bash
# Place the .p8 file somewhere secure (NOT in git)
cp AuthKey_XXXXXX.p8 ~/secrets/adjutant-apns.p8

# Update APNS_KEY_PATH in .env
APNS_KEY_PATH=/Users/yourname/secrets/adjutant-apns.p8
```

For production:
- Store the .p8 file securely on your server
- Or use a secrets manager (AWS Secrets Manager, Vault, etc.)
- Set environment variables appropriately

#### 5. Test Push Notifications

```bash
# Start backend with APNs configured
npm run dev

# Check APNs status
curl http://localhost:3001/api/push/status

# Response should show:
# { "configured": true, "environment": "development", "bundleId": "com.jmm.Adjutant" }
```

### iOS App Requirements

The app already has push notification code, but ensure:

1. **Entitlements** - `ios/Adjutant/Adjutant.entitlements` includes:
   ```xml
   <key>aps-environment</key>
   <string>development</string>
   ```

2. **Request Permission** - App requests notification permission on launch

3. **Register Token** - App sends device token to backend after permission granted

---

## Troubleshooting

### TestFlight Issues

**"No signing certificate" error**
```bash
bundle exec fastlane match appstore --readonly
# If certs don't exist, remove --readonly to create them
```

**Build number conflicts**
```bash
bundle exec fastlane bump_build
```

**API Key Authentication Fails**
1. Verify the key hasn't expired in App Store Connect
2. Check the key has sufficient permissions (App Manager)
3. Ensure base64 encoding has no line breaks: `base64 -w 0`

### Push Notification Issues

**"APNs not configured"**
- Check all 4 env vars are set: `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_BUNDLE_ID`, `APNS_KEY_PATH`
- Verify the .p8 file exists at `APNS_KEY_PATH`

**Notifications not arriving**
- Check `APNS_ENVIRONMENT` matches your build (development vs production)
- TestFlight builds use production APNs environment
- Verify device token is registered (check `/api/push/tokens` endpoint)

**"BadDeviceToken" error**
- Token was generated for different APNs environment
- Reinstall app or toggle notifications off/on to get new token

---

## Quick Reference

### Environment Variables Summary

**TestFlight (GitHub Secrets):**
```
APP_STORE_CONNECT_API_KEY_ID
APP_STORE_CONNECT_API_ISSUER_ID
APP_STORE_CONNECT_API_KEY_BASE64
MATCH_GIT_URL
MATCH_PASSWORD
MATCH_DEPLOY_KEY
```

**Push Notifications (Backend .env):**
```
APNS_TEAM_ID=2BRYAM5Q52
APNS_KEY_ID=<key id>
APNS_BUNDLE_ID=com.jmm.Adjutant
APNS_KEY_PATH=<path to .p8>
APNS_ENVIRONMENT=development|production
```

### Key Files

| File | Purpose | Where |
|------|---------|-------|
| `AuthKey_XXX.p8` | App Store Connect API key | GitHub Secrets (base64) |
| `APNsKey_XXX.p8` | Push notification key | Backend server |
| `fastlane/.env` | Local fastlane config | Local only, gitignored |

### Useful Commands

```bash
# Local TestFlight build
cd ios && bundle exec fastlane beta

# Run iOS tests
cd ios && bundle exec fastlane test

# Check match certificates
cd ios && bundle exec fastlane match appstore --readonly

# Verify APNs status
curl http://localhost:3001/api/push/status
```

---

## Security Notes

- **Never commit** `.env` files, `.p8` keys, or certificates to the main repo
- Certificate repository should be **private**
- Rotate API keys periodically
- Use minimal permissions for CI keys
- Store APNs keys securely (not in git, use secrets manager in production)
