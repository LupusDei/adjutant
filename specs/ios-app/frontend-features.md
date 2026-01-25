# Adjutant iOS App - Frontend Feature Specification

## Overview

This document provides a comprehensive specification for building a native iOS app based on the Adjutant web application. Adjutant is a retro-terminal themed dashboard for monitoring and controlling Gastown, a multi-agent orchestration system.

The app uses a distinctive "Pip-Boy" aesthetic with CRT-style visuals, phosphorescent green/amber colors, and monospace typography.

---

## Design System

### Theme Colors

The app supports 6 color themes. Colors are based on CSS custom properties:

| Theme ID | Theme Name | Primary Color |
|----------|------------|---------------|
| `green` | GAS-BOY | `#20C20E` |
| `red` | BLOOD-BAG | `#FF3333` |
| `blue` | VAULT-TEC | `#00AAFF` |
| `tan` | WASTELAND | `#D2B48C` |
| `pink` | PINK-MIST | `#FF69B4` |
| `purple` | RAD-STORM | `#BF94FF` |

**Color Palette Variables (per theme):**
- `--crt-phosphor`: Primary text/border color
- `--crt-phosphor-dim`: Secondary/muted text
- `--crt-phosphor-bright`: Highlighted/active elements
- `--crt-phosphor-glow`: Glow/shadow effects
- `--crt-amber`: Accent color for warnings/alerts

**Background Colors:**
- Main background: `#0A0A0A`
- Panel background: `#050505`
- Error: `#FF4444`

### Typography

- Primary font: "Share Tech Mono" (monospace)
- Fallback: "Courier New", monospace
- Letter spacing: `0.05em` to `0.2em` depending on context
- All-caps for headers and labels

### Visual Effects (Optional)

The web app includes CRT visual effects that could be implemented as optional features:
- Scanlines overlay
- Screen flicker
- Phosphor glow (shadows/blurs)
- Boot sequence animation

---

## App Structure

### Tab Navigation

The app has 7 main tabs accessible from a tab bar:

| Tab | Label | Description |
|-----|-------|-------------|
| Dashboard | OVERVIEW | System snapshot with widgets |
| Mail | MAIL | Message inbox with split view |
| Chat | CHAT | Direct conversation with Mayor |
| Convoys | CONVOYS | Work package tracking |
| Crew | CREW | Agent status dashboard |
| Beads | BEADS | Issue/task tracker |
| Settings | SETTINGS | App configuration |

---

## Feature 1: Dashboard (Overview Tab)

### Purpose
Provides a real-time snapshot of system status across mail, crew, and convoys.

### Layout
Grid of 3 widgets:
1. **Mail Widget** - Recent messages
2. **Crew & Polecats Widget** - Active agents
3. **Convoys Widget** - Unfinished work packages (full width)

### Mail Widget

**Header:**
- Title: "MAIL"
- Stats: "{total} total | {unread} unread"

**Content:**
- List of 5 most recent messages
- Each item shows:
  - Subject line (truncated)
  - From address (without trailing slash)
  - Relative timestamp ("now", "5m ago", "2h ago", "3d ago", "Jan 15")

### Crew & Polecats Widget

**Header:**
- Title: "CREW & POLECATS"
- Stats: "{total} total | {active} active"

**Content:**
- Alert banners for stuck/blocked agents
- Grid of crew cards showing:
  - Agent name (uppercase)
  - Type badge (uppercase)
  - Rig name (if applicable)
  - Status indicator with color:
    - `working`/`active`: Bright green, pulsing
    - `idle`: Standard green
    - `blocked`: Amber `#FFB000`
    - `stuck`: Red `#FF4444`
    - `offline`: Gray `#666666`
  - Last message preview (if available)
  - Current task (if working)

### Convoys Widget

**Header:**
- Title: "UNFINISHED CONVOYS"

**Content:**
- List of convoy cards (see Convoys feature for card details)
- Shows only incomplete convoys

---

## Feature 2: Mail Tab

### Purpose
Email-style interface for viewing and composing messages.

### Layout
Split-view interface:
- **Left Panel** (1/3 width): Message list
- **Right Panel** (2/3 width): Message detail or compose view

**Mobile:** Full-screen list, navigate to detail view

### Header Bar

**Left side:**
- Unread badge: "{count} UNREAD" (if any unread)
- Overseer toggle (infrastructure filter)

**Right side:**
- Compose button: "NEW"
- Refresh button: "REFRESH" / "SYNCING..."

### Message List

**Panel Header:**
- Title: "INBOX"
- Message count: "{count} MSG"

**List Items:**
Each message shows:
- Priority indicator (colored dot/icon)
  - P0 (Urgent): Red `#FF4444`
  - P1 (High): Amber `#FFB000`
  - P2 (Normal): Green (theme color)
  - P3 (Low): Dim green
  - P4 (Lowest): Gray `#666666`
- Sender name (without trailing slash)
- Subject line (truncated)
- Relative timestamp
- Unread indicator (if not read)

**Grouping:**
Messages are grouped by thread (threadId).

### Message Detail View

**Header:**
- Back button (mobile only)
- Subject line
- Reply button

**Metadata:**
- From: sender address
- To: recipient address
- CC: (if any)
- Time: Full timestamp
- Priority badge
- Type badge (task/notification/reply/scavenge)

**Body:**
- Full message text
- Monospace font
- Support for newlines

**Thread Messages:**
If part of a thread, show related messages in chronological order.

### Compose Message View

**Form Fields:**

1. **Recipient Selector**
   - Default: "mayor/"
   - Autocomplete from known agents
   - Manual entry allowed

2. **Subject** (required)
   - Text input
   - Max length: 200 characters

3. **Priority** (dropdown)
   - Options: "!!! URGENT" (0), "!! HIGH" (1), "NORMAL" (2), "LOW" (3), "LOWEST" (4)
   - Default: NORMAL (2)

4. **Message Body** (required)
   - Multi-line text area
   - Voice input button for dictation (if voice enabled)
   - Character count display

**Actions:**
- Cancel button
- Send button (disabled until valid)

**Reply Mode:**
- Pre-fills recipient from original sender
- Pre-fills subject with "RE: {original subject}"
- Sets type to 'reply'
- Includes replyTo field

---

## Feature 3: Chat Tab (Mayor Direct Line)

### Purpose
SMS-style conversation interface with the Mayor agent.

### Layout
Chat bubble interface with input area at bottom.

### Header
- Title: "MAYOR DIRECT LINE"
- Message count: "{count} MESSAGES"

### Message Display

**Message Bubbles:**
- User messages: Right-aligned, one style
- Mayor messages: Left-aligned, different style

**Each bubble shows:**
- Sender label ("YOU" or "MAYOR")
- Play button for TTS (if voice enabled)
- Message text
- Relative timestamp

### Input Area

- Voice record button (microphone icon)
- Text input field
- Send button

**Voice Recording:**
- Tap to start recording (icon changes to stop)
- Transcribed text appends to input
- Processing indicator while transcribing

**Send Behavior:**
- Enter key sends message
- Messages sent to "mayor/" with type 'reply'

---

## Feature 4: Convoys Tab

### Purpose
Track multi-issue work packages (convoys) with progress visualization.

### Header
- Title: "CONVOY TRACKING"
- Sort dropdown:
  - "LATEST ACTIVITY" (default)
  - "URGENCY (P0-P4)"
  - "LEAST COMPLETE"
  - "CONVOY ID"

### Convoy List

**Convoy Card:**

**Header:**
- Convoy ID
- Title
- Rig badge (if rig-specific)

**Progress Bar:**
- Visual progress indicator
- Text: "{completed}/{total} COMPLETE"

**Status Badge:**
- Color-coded status

**Tracked Issues (expandable):**
List of issues within the convoy:
- Issue ID
- Title
- Status badge
- Assignee (if assigned)
- Priority indicator
- Updated timestamp

---

## Feature 5: Crew Tab

### Purpose
Hierarchical display of all agents in the Gastown system.

### Header
- Title: "CREW MANIFEST"
- Show All toggle (for inactive polecats)
- Sync status indicator: "LIVE" / "SYNCING..." / "OFFLINE"

### Hierarchy Structure

**Town Command Section:**
- Mayor agent card
- Deacon agent card

**Per-Rig Sections:**
Each rig has:
- Rig header: "RIG: {NAME}" with "{active}/{total} ACTIVE"
- Subsections:
  - CREW: Worker agents
  - INFRASTRUCTURE: Witness & Refinery agents
  - POLECATS: Ephemeral workers with spawn button

### Agent Card

**Header:**
- Type icon (emoji)
- Agent name (uppercase)
- Unread mail badge (if any)

**Body:**
- Status indicator (colored dot with glow)
- Status text (uppercase)
- Mail preview (first unread subject/sender)
- Current task (if working)
- Branch name (if polecat)

### Polecat Card (Expandable)

**Collapsed View:**
- Polecat icon
- Name
- Status indicator
- Status text
- Unread mail badge
- Expand arrow

**Expanded View:**
- Terminal pane showing tmux session output
- Supports ANSI escape codes for colors
- Close button

### Spawn Polecat Button

- "+" icon button next to POLECATS header
- States:
  - Idle: Shows "+"
  - Loading: Shows spinner
  - Success: Shows checkmark (green)
  - Error: Shows X (red) with tooltip

### Footer Statistics
- AGENTS: {total count}
- ONLINE: {running count} (green)
- OFFLINE: {not running count} (gray)

---

## Feature 6: Beads Tab

### Purpose
Issue/task tracker with filtering and search.

### Header
- Title: "BEADS TRACKER"
- Overseer toggle (filter operational beads)
- Search input
- Status filter dropdown:
  - DEFAULT (open + in_progress + blocked)
  - OPEN
  - HOOKED
  - IN PROGRESS
  - BLOCKED
  - DEFERRED
  - CLOSED
  - ALL

### Beads Table

**Grouped by Source:**
Collapsible sections by source database (Town, then alphabetical rigs)

**Group Header:**
- Collapse/expand chevron
- Source name
- Count: "[{count}]"

**Table Columns:**
| Column | Width | Content |
|--------|-------|---------|
| ID | 80px | Bead ID (highlighted if matches search) |
| PRI | 40px | Priority badge (P0-P4 with color) |
| TYPE | 60px | Issue type (uppercase) |
| TITLE | flex | Title (truncated, highlighted if matches search) |
| STATUS | 70px | Status badge with background color |
| ASSIGNEE | 80px | Short assignee name |
| UPDATED | 70px | Relative date |
| ACTION | 60px | Action menu |

**Status Colors:**
- OPEN: Theme green
- ACTIVE (in_progress): Bright cyan-green `#00FF88`
- BLOCKED: Warning orange `#FF6B35`
- HOOKED: Amber `#FFB000`
- DEFER: Gray `#888888`
- DONE (closed): Dark gray `#555555`

**Action Menu:**
Dropdown with options:
- SLING: Request assignment to polecat (only if unassigned, not closed)
- DELETE: Request deletion (only if not closed)

Both actions send mail to mayor.

### Search

- Fuzzy search across ID, title, and assignee
- Matching characters highlighted in results
- "NO MATCHES FOR '{query}'" if no results

---

## Feature 7: Settings Tab

### Remote Access Section

**Tunnel Toggle:**
- ON/OFF switch
- Status indicator:
  - "CHECKING..." (loading)
  - "STARTING..." (starting)
  - "ACTIVE" (connected, with glow)
  - "NOT RUNNING" (stopped)
  - "ERROR" (error state)

**When Connected:**
- Public URL display
- Copy button
- QR code button (shows modal with QR)

### System Theme Section

- Grid of 6 theme buttons
- Each shows:
  - Color preview swatch
  - Theme label
- Selected theme has highlighted border and glow

### Audio Settings Section

**Notification Settings:**
- Master enable/disable toggle
- Volume slider (0-1)
- Priority filters (toggles for urgent/high/normal/low)
- Source filters (toggles for mail/system/agent)

### Voice Configuration Section

**Default Voice:**
- Voice selector (dropdown of available voices)
- Speed slider (0.5-2.0)
- Stability slider (0-1)
- Similarity slider (0-1)
- Preview button

**Agent Voices:**
- List of agents with custom voice configs
- Add new agent button
- Per-agent edit/delete

---

## Feature 8: Quick Input (Floating Action Button)

### Purpose
Quick message composer accessible from any screen.

### Collapsed State (FAB)
- Bottom-right corner
- Chat icon
- Tap to expand

### Expanded State

**Header:**
- "TO: MAYOR" badge
- "FROM: {identity}" badge
- Status feedback ("MESSAGE SENT" / "ERROR SENDING")
- Close button

**Input:**
- Multi-line text area
- Voice record button
- Send button

**Behavior:**
- Cmd/Ctrl+Enter to send
- Escape to collapse
- Auto-collapse after successful send

---

## Feature 9: Power Button

### Purpose
Control Gastown power state from header.

### States

| State | Visual | Interactive |
|-------|--------|-------------|
| Running | "ON" position, glowing | Can toggle off |
| Stopped | "OFF" position | Can toggle on |
| Starting | "..." position | Disabled |
| Stopping | "..." position | Disabled |
| Unknown | "?" position | Disabled |

### Layout
- Toggle switch style
- "TOWN" label
- ON/OFF track labels

---

## Feature 10: Rig Filter

### Purpose
Filter all views by selected rig.

### Location
Header, next to power button.

### Behavior
- Dropdown showing all available rigs
- "All Rigs" option
- Selection persists across tab changes
- Affects: Mail, Beads views

---

## Feature 11: Overseer Toggle

### Purpose
Filter to show only user-relevant items (hide infrastructure/operational content).

### Location
Header area of Mail and Beads tabs.

### Behavior
- Toggle switch
- Persisted to storage per view
- Filters out:
  - Infrastructure messages
  - Operational beads (witness, wisp, sync, etc.)

---

## Feature 12: Notification Status Indicator

### Purpose
Show notification/voice system status in header.

### States
- Available: Shows indicator
- Unavailable: Hidden or dimmed
- Muted: Shows mute icon

---

## Voice Features

### Text-to-Speech Playback

Available on:
- Message detail view
- Chat message bubbles

**Play Button States:**
- Idle: Play icon
- Loading: Spinner
- Playing: Stop icon

### Voice Input (Speech-to-Text)

Available on:
- Compose message
- Chat input
- Quick input

**Microphone Button States:**
- Idle: Microphone icon
- Recording: Stop icon (pulsing red)
- Processing: Spinner

---

## Data Polling

| View | Endpoint | Interval | Notes |
|------|----------|----------|-------|
| Dashboard | `/api/mail`, `/api/convoys`, `/api/agents` | 30s | Via hooks |
| Mail | `/api/mail` | 30s | When tab active |
| Chat | `/api/mail` | 30s | Filtered for mayor messages |
| Convoys | `/api/convoys` | 30s | When tab active |
| Crew | `/api/agents` | 60s | When tab active |
| Beads | `/api/beads` | 30s | When tab active |
| Power | `/api/status` | 60s | For power state |

---

## Responsive Design

### Breakpoints
- Mobile: <= 768px
- Tablet/Desktop: > 768px

### Mobile Adaptations

**Mail:**
- Single panel view
- List -> Detail navigation
- Back button in detail

**Dashboard:**
- Single column widgets
- Stacked layout

**Crew:**
- Single column cards
- Condensed agent info

**Beads:**
- Horizontal scroll for table
- Collapsible columns

**Settings:**
- Full-width sections
- Larger touch targets (44px minimum)

---

## Error Handling

### Error Banner
- Full-width banner below header
- Red border and background
- Error icon and message
- Dismissible (if applicable)

### Loading States
- Spinner animation
- "LOADING..." text
- Skeleton placeholders (optional)

### Empty States
- Centered message
- Dim text
- Appropriate message per view:
  - "NO MESSAGES"
  - "NO ACTIVE CONVOYS"
  - "NO AGENTS CONFIGURED"
  - "NO BEADS FOUND"
  - "NO MATCHES FOR '{query}'"

### Network Errors
- "CONNECTION ERROR: {message}"
- Retry option
- Offline indicator

---

## Accessibility

### Requirements
- VoiceOver support
- Dynamic Type support
- Sufficient color contrast
- Touch targets >= 44pt
- All interactive elements labeled
- Role attributes (button, switch, list, etc.)
- Expanded/collapsed states announced

---

## Persistence

### Local Storage
- Selected theme
- Show all polecats preference
- Overseer view toggles (per view)
- Notification settings

---

## Animation Guidelines

### Transitions
- Tab switches: 200ms ease
- Expand/collapse: 200ms ease-out
- Loading spinners: 1s linear infinite
- Status pulses: 1s ease-in-out infinite

### Haptic Feedback (suggested)
- Button taps
- Toggle switches
- Send success
- Error states
