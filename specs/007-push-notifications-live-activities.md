# Push Notifications & Live Activities for Adjutant iOS

## Overview

Add push notifications for new mail and Live Activities for home screen status display.

**Strategy:** Start with local notifications (works without Apple Developer paid account), add APNs later.

---

## Phase 1: Notification Foundation

### New Files

| File | Purpose |
|------|---------|
| `ios/Adjutant/App/AppDelegate.swift` | Handle notification registration, background tasks |
| `ios/Adjutant/Core/Services/NotificationService.swift` | Permission requests, local notification scheduling |
| `ios/Adjutant/Core/Services/BackgroundTaskService.swift` | BGTaskScheduler for background mail checks |

### Modifications

**`ios/Adjutant/App/AdjutantApp.swift`**
- Add `@UIApplicationDelegateAdaptor(AppDelegate.self)` for notification handling

**`ios/Adjutant/Resources/Info.plist`**
- Add `UIBackgroundModes`: fetch, processing, remote-notification
- Add `BGTaskSchedulerPermittedIdentifiers`: com.gastown.adjutant.refresh

**`ios/Adjutant/Core/State/AppState.swift`**
- Add `notificationPermissionStatus: UNAuthorizationStatus`
- Add `knownMailIds: Set<String>` for new mail detection

---

## Phase 2: Local Mail Notifications

### NotificationService Implementation

```swift
@MainActor
final class NotificationService: ObservableObject {
    static let shared = NotificationService()

    func requestPermission() async -> Bool
    func scheduleMailNotification(for message: Message)
    func processNewMessages(_ messages: [Message]) async
}
```

### Integration Points

1. **DashboardViewModel.swift** - Call `NotificationService.processNewMessages()` after polling
2. **MailListViewModel.swift** - Update known mail IDs on fetch
3. **AppCoordinator.swift** - Handle notification tap deep linking

---

## Phase 3: Background Refresh

### BackgroundTaskService

```swift
static let refreshTaskIdentifier = "com.gastown.adjutant.refresh"

func registerBackgroundTasks()      // Call in AppDelegate
func scheduleAppRefresh()           // Call when entering background
func handleAppRefresh(task:)        // Check mail, send local notifications
```

### Scene Phase Handling

In ContentView, schedule background refresh when `scenePhase == .background`

---

## Phase 4: Live Activities (Widget Extension)

### New Target: AdjutantWidgets

Create Widget Extension in Xcode with:

| File | Purpose |
|------|---------|
| `AdjutantWidgets.swift` | Widget bundle entry point |
| `AdjutantLiveActivity.swift` | Live Activity with Dynamic Island |
| `SharedTypes.swift` | Shared attributes between app and widget |

### Activity Attributes

```swift
struct GastownActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var powerState: String
        var unreadMailCount: Int
        var activeAgents: Int
        var lastUpdated: Date
    }
    var townName: String
}
```

### New Service

**`ios/Adjutant/Core/Services/LiveActivityService.swift`**
- `startLiveActivity()` - Begin showing status on lock screen
- `updateLiveActivity()` - Update from polling
- `endLiveActivity()` - Clean up when app closes

### Configuration

- Add App Group capability for shared data: `group.com.gastown.adjutant`
- Add ActivityKit entitlement

---

## Phase 5: Settings UI

**`ios/Adjutant/Features/Settings/NotificationSettingsView.swift`**

- Permission status and request button
- Live Activity toggle
- Notification type toggles (new mail, urgent only)
- Background refresh interval picker

---

## Phase 6 (Future): APNs Backend

### Backend Files

| File | Purpose |
|------|---------|
| `backend/src/routes/devices.ts` | POST /api/devices/register, DELETE /api/devices/:token |
| `backend/src/services/apns-service.ts` | Send push via @parse/node-apn |
| `backend/src/services/device-token-service.ts` | Store tokens in beads/JSON |

### Mail Service Integration

Trigger push notification in `mail-service.ts` after successful send.

### iOS Changes

- Register device token in AppDelegate
- Add `APIClient+Devices.swift` for token registration endpoint

---

## Implementation Order

1. **AppDelegate + NotificationService** - Permission flow
2. **Info.plist updates** - Background modes
3. **Local notifications** - Trigger on new mail during polling
4. **BackgroundTaskService** - Check mail in background
5. **Widget Extension target** - Live Activity
6. **LiveActivityService** - Start/update/end lifecycle
7. **Settings UI** - User preferences
8. **(Later) APNs backend** - Real push notifications

---

## Critical Files

| File | Action |
|------|--------|
| `ios/Adjutant/App/AdjutantApp.swift` | Add AppDelegate adaptor |
| `ios/Adjutant/Resources/Info.plist` | Add background modes |
| `ios/Adjutant/Core/State/AppState.swift` | Add notification state |
| `ios/Adjutant/Features/Dashboard/DashboardViewModel.swift` | Trigger notifications |
| `ios/Adjutant.xcodeproj` | Add Widget Extension target |

---

## Verification

1. **Permissions**: Request notification permission, verify alert appears
2. **Local notifications**: Background app, trigger mail poll, verify notification
3. **Background refresh**: Use debugger command to simulate background task
4. **Live Activity**: Start activity, verify Dynamic Island and Lock Screen
5. **Deep linking**: Tap notification, verify navigation to mail detail
