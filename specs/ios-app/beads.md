# iOS App Development Beads

## Epic: Project Setup and Architecture
### adj-ios-setup: Initialize iOS Project with SwiftUI
**Type:** task
**Priority:** P0
**Labels:** ios, setup, epic:ios-foundation

Create the foundational Xcode project for the Adjutant iOS app.

**Requirements:**
- Create new Xcode project with SwiftUI App lifecycle
- Minimum iOS 17.0 deployment target
- Configure project structure: App/, Features/, Core/, Services/, Resources/
- Add SwiftLint for code quality
- Configure build configurations (Debug, Release)
- Set up Git hooks for formatting
- Create README with setup instructions

**Acceptance Criteria:**
- [ ] Project builds and runs on simulator
- [ ] SwiftLint runs on build
- [ ] Project structure follows best practices
- [ ] Documentation in README

---

### adj-ios-arch: Implement App Architecture (MVVM + Coordinator)
**Type:** task
**Priority:** P0
**Labels:** ios, architecture, epic:ios-foundation

Set up clean architecture patterns for the app.

**Requirements:**
- Implement MVVM pattern with ObservableObject ViewModels
- Create Router/Coordinator for navigation
- Set up dependency injection container
- Create base protocols: ViewModelProtocol, ServiceProtocol
- Implement AppState for global state management

**Acceptance Criteria:**
- [ ] BaseViewModel with common functionality
- [ ] Navigation coordinator working
- [ ] DI container configured
- [ ] Unit tests for architecture components

---

## Epic: Networking Layer
### adj-ios-network: Create API Client and Networking Layer
**Type:** task
**Priority:** P0
**Labels:** ios, networking, epic:ios-networking

Build the networking layer for API communication.

**Requirements:**
- Create APIClient using async/await and URLSession
- Implement ApiResponse<T> generic wrapper matching backend
- Create all request/response Codable models
- Handle error codes: INTERNAL_ERROR, VALIDATION_ERROR, NOT_FOUND, RATE_LIMITED
- Implement request retry logic with exponential backoff
- Add request/response logging for debug builds

**Acceptance Criteria:**
- [ ] APIClient with all HTTP methods
- [ ] All data models implemented
- [ ] Error handling complete
- [ ] Unit tests with mocked responses

---

### adj-ios-models: Implement All Data Models
**Type:** task
**Priority:** P0
**Labels:** ios, models, epic:ios-networking

Create Swift Codable models for all API types.

**Requirements:**
- Message, MessagePriority, MessageType
- CrewMember, CrewMemberStatus, AgentType
- GastownStatus, RigStatus
- Convoy, ConvoyBead
- BeadInfo, BeadStatus, BeadPriority
- TunnelStatus, PowerState
- VoiceConfig, VoiceSynthesisRequest/Response

**Acceptance Criteria:**
- [ ] All models match API contract spec
- [ ] CodingKeys for snake_case conversion
- [ ] Unit tests for JSON parsing

---

## Epic: Design System
### adj-ios-theme: Implement CRT Theme and Design System
**Type:** task
**Priority:** P1
**Labels:** ios, design, epic:ios-design

Create the retro CRT visual design system.

**Requirements:**
- Implement 6 color themes: green, red, blue, tan, pink, purple
- Create ThemeManager with @AppStorage persistence
- Define typography: Share Tech Mono font family
- Create CRT visual effects: scanlines, flicker, glow, noise
- Implement theme-aware Color extensions

**Acceptance Criteria:**
- [ ] All 6 themes working
- [ ] Theme persists across launches
- [ ] CRT effects render smoothly
- [ ] Previews work with all themes

---

### adj-ios-components: Build Shared UI Components
**Type:** task
**Priority:** P1
**Labels:** ios, components, epic:ios-design

Create reusable SwiftUI components.

**Requirements:**
- CRTText with glow effect
- CRTButton with press animations
- CRTCard container view
- CRTTextField and CRTTextEditor
- LoadingIndicator with CRT style
- ErrorBanner component
- BadgeView for counts/status

**Acceptance Criteria:**
- [ ] All components themed
- [ ] Accessibility labels
- [ ] SwiftUI Previews
- [ ] Documentation comments

---

## Epic: Dashboard Feature
### adj-ios-dashboard: Implement Dashboard View
**Type:** task
**Priority:** P1
**Labels:** ios, feature, epic:ios-dashboard

Build the main dashboard overview screen.

**Requirements:**
- Dashboard tab with widget grid layout
- Mail widget showing unread count and recent messages
- Crew widget showing agent statuses
- Convoy widget showing active convoy progress
- Pull-to-refresh functionality
- Polling for updates (configurable interval)

**Acceptance Criteria:**
- [ ] All 3 widgets displaying data
- [ ] Pull-to-refresh working
- [ ] Navigation to detail views
- [ ] Unit tests for DashboardViewModel

---

## Epic: Mail Feature
### adj-ios-mail-list: Implement Mail List View
**Type:** task
**Priority:** P1
**Labels:** ios, feature, epic:ios-mail

Build the mail inbox list screen.

**Requirements:**
- List view with message previews
- Show: from, subject, date, priority indicator, read status
- Swipe actions: mark read/unread, delete
- Pull-to-refresh
- Filter by: all, unread, priority
- Search functionality

**Acceptance Criteria:**
- [ ] List displays all messages
- [ ] Swipe actions work
- [ ] Filtering works
- [ ] Unit tests for MailListViewModel

---

### adj-ios-mail-detail: Implement Mail Detail View
**Type:** task
**Priority:** P1
**Labels:** ios, feature, epic:ios-mail

Build the mail message detail screen.

**Requirements:**
- Full message display with header and body
- Thread view showing conversation history
- Reply button launching compose
- Mark as read on view
- Play audio button for TTS

**Acceptance Criteria:**
- [ ] Message displays correctly
- [ ] Threading works
- [ ] Reply navigates to compose
- [ ] Audio playback works

---

### adj-ios-mail-compose: Implement Mail Compose View
**Type:** task
**Priority:** P1
**Labels:** ios, feature, epic:ios-mail

Build the compose/reply mail screen.

**Requirements:**
- Recipient selector with autocomplete from crew list
- Subject and body text fields
- Priority selector (optional)
- Send button with loading state
- Voice input for dictation
- Reply-to threading support

**Acceptance Criteria:**
- [ ] Can send new messages
- [ ] Can reply to threads
- [ ] Voice input works
- [ ] Unit tests for ComposeViewModel

---

## Epic: Chat Feature
### adj-ios-chat: Implement Mayor Chat View
**Type:** task
**Priority:** P1
**Labels:** ios, feature, epic:ios-chat

Build the direct chat interface with the Mayor agent.

**Requirements:**
- SMS-style bubble interface
- Message input with send button
- Voice input option
- Auto-scroll to latest message
- Typing indicator
- Pull to load history

**Acceptance Criteria:**
- [ ] Can send/receive messages
- [ ] UI matches chat style
- [ ] Voice input works
- [ ] Unit tests for ChatViewModel

---

## Epic: Convoys Feature
### adj-ios-convoys: Implement Convoys View
**Type:** task
**Priority:** P2
**Labels:** ios, feature, epic:ios-convoys

Build the convoy tracking screen.

**Requirements:**
- List of active convoys
- Progress bar showing completion
- Expand to see individual beads
- Status indicators per bead
- Filter by rig

**Acceptance Criteria:**
- [ ] Convoy list displays
- [ ] Progress accurate
- [ ] Bead details accessible
- [ ] Unit tests

---

## Epic: Crew Feature
### adj-ios-crew-list: Implement Crew List View
**Type:** task
**Priority:** P2
**Labels:** ios, feature, epic:ios-crew

Build the crew management list screen.

**Requirements:**
- Hierarchical list: Mayor > Deacons > Witnesses > Polecats
- Status indicators (idle, working, stuck, offline)
- Unread mail badge per agent
- Filter by rig
- Search by name

**Acceptance Criteria:**
- [ ] All agent types display
- [ ] Status updates live
- [ ] Navigation to detail
- [ ] Unit tests

---

### adj-ios-crew-detail: Implement Crew Detail/Terminal View
**Type:** task
**Priority:** P2
**Labels:** ios, feature, epic:ios-crew

Build the agent detail and terminal view.

**Requirements:**
- Agent info header
- Terminal output view (read-only)
- Auto-scroll terminal
- Copy terminal text
- Refresh button

**Acceptance Criteria:**
- [ ] Terminal displays output
- [ ] Auto-scroll works
- [ ] Copy works
- [ ] Unit tests

---

## Epic: Beads Feature
### adj-ios-beads: Implement Beads Tracker View
**Type:** task
**Priority:** P2
**Labels:** ios, feature, epic:ios-beads

Build the beads/issues tracker screen.

**Requirements:**
- List view with bead cards
- Show: ID, title, status, priority, assignee
- Filter by: status, priority, assignee, rig
- Search by title/description
- Tap for detail view
- Actions: close, reopen, assign

**Acceptance Criteria:**
- [ ] Bead list displays
- [ ] Filters work
- [ ] Actions work
- [ ] Unit tests

---

## Epic: Settings Feature
### adj-ios-settings: Implement Settings View
**Type:** task
**Priority:** P2
**Labels:** ios, feature, epic:ios-settings

Build the settings configuration screen.

**Requirements:**
- Theme selector with preview
- Tunnel control (start/stop, status)
- Notification toggle
- Voice settings (voice selection, volume)
- Rig filter default
- About section with version

**Acceptance Criteria:**
- [ ] All settings persist
- [ ] Theme changes immediately
- [ ] Tunnel control works
- [ ] Unit tests

---

## Epic: Voice Features
### adj-ios-voice-tts: Implement Text-to-Speech Playback
**Type:** task
**Priority:** P1
**Labels:** ios, voice, epic:ios-voice

Build TTS audio playback for notifications and messages.

**Requirements:**
- AVAudioPlayer for audio playback
- Queue management for multiple notifications
- Background audio session configuration
- Volume control
- Skip/pause functionality

**Acceptance Criteria:**
- [ ] Audio plays correctly
- [ ] Queue works
- [ ] Background playback works
- [ ] Unit tests

---

### adj-ios-voice-stt: Implement Speech-to-Text Input
**Type:** task
**Priority:** P2
**Labels:** ios, voice, epic:ios-voice

Build speech recognition for voice input.

**Requirements:**
- SFSpeechRecognizer integration
- Microphone permission handling
- Real-time transcription display
- Start/stop recording UI
- Error handling for permissions

**Acceptance Criteria:**
- [ ] Speech recognition works
- [ ] Permissions handled gracefully
- [ ] UI provides feedback
- [ ] Unit tests

---

## Epic: Testing and Polish
### adj-ios-tests: Comprehensive Unit Test Suite
**Type:** task
**Priority:** P1
**Labels:** ios, testing, epic:ios-quality

Create unit tests for all modules.

**Requirements:**
- Test all ViewModels
- Test API client with mocked responses
- Test data model parsing
- Test navigation/routing
- Minimum 80% code coverage

**Acceptance Criteria:**
- [ ] All ViewModels tested
- [ ] API client tested
- [ ] Models tested
- [ ] CI runs tests

---

### adj-ios-docs: Code Documentation
**Type:** task
**Priority:** P2
**Labels:** ios, docs, epic:ios-quality

Document all public interfaces.

**Requirements:**
- DocC documentation for public types
- README with architecture overview
- Setup guide for new developers
- API usage examples

**Acceptance Criteria:**
- [ ] All public types documented
- [ ] README complete
- [ ] DocC builds successfully
