# Adjutant Product Guide

> A comprehensive guide to every feature, interaction, and strategy for getting the most out of Adjutant.

## What is Adjutant?

Adjutant is a retro terminal themed dashboard for orchestrating AI coding agents. It gives you real-time visibility into what your agents are doing, what they're working on, and how to direct them — from your browser or your phone.

At its core, Adjutant connects three systems:
- **Messaging** — persistent chat between you and your agents (SQLite-backed, WebSocket-delivered)
- **Beads** — hierarchical issue tracking (epics, tasks, bugs with dependencies)
- **MCP** — the protocol agents use to report status, send messages, and manage work

---

## Table of Contents

- [The Dashboard](#the-dashboard)
- [Chat](#chat)
- [Beads (Work Board)](#beads-work-board)
- [Epics](#epics)
- [Crew (Agents)](#crew-agents)
- [Personas](#personas)
- [Timeline](#timeline)
- [Proposals](#proposals)
- [Settings](#settings)
- [iOS App](#ios-app)
- [Voice Features](#voice-features)
- [Remote Access](#remote-access)
- [Keyboard Shortcuts & Hidden Interactions](#keyboard-shortcuts--hidden-interactions)
- [Strategies for Effective Use](#strategies-for-effective-use)

---

## The Dashboard

The **DASHBOARD** tab is your command center — a single-screen overview of everything happening across your projects.

### Widgets

**Agents** — Shows every connected agent with their status (WORKING/IDLE/BLOCKED/OFFLINE), current task (truncated to 60 chars), project, and unread message count. Click any agent row to jump directly to a chat with them.

**Unread Messages** — Agents with pending messages you haven't read. Shows the agent name, a preview of their latest message (80 chars), and the unread count. Click to jump to that conversation.

**Tasks** — Two sections: *In Progress* (up to 7) showing active work with priority badges (P0-P4), and *Recently Completed* (up to 5) with completion timestamps.

**Epics** — Active epics with visual progress bars showing child completion ratios (e.g., "5/10 (50%)"). Progress bars are color-coded: green at 100%, cyan above 50%, amber above 0%, dim at 0%. Recently completed epics show below with timestamps.

### Interactions

| Action | Result |
|--------|--------|
| Click agent row | Navigate to Chat with that agent selected |
| Click task row | Navigate to bead detail |
| Click epic row | Navigate to epic detail |

### Timestamps

The dashboard uses smart relative timestamps:
- Today: "8:23pm"
- Yesterday: "Yesterday 8:23pm"
- This week: "Wed 8:23pm"
- Older: "Feb 26 8:23pm"

---

## Chat

The **CHAT** tab is an SMS-style conversation interface for talking to your agents.

### Agent Selector

The dropdown at the top shows "TO: [AGENT_NAME]" with an unread badge. Open it to:
- Type to filter agents by name or ID
- Select "USER (BROADCAST)" to send to all agents
- See unread counts per agent
- The filter input auto-focuses when opened

### Message Display

Messages appear as bubbles — yours on the right, agent messages on the left. Each message shows:
- Sender name in the header
- Play button for voice playback (if voice is configured)
- Message body with markdown rendering
- Delivery status: SENDING / DELIVERED / FAILED
- Timestamp

**System messages** (announcements) appear centered without bubbles.

**Streaming messages** show a blinking cursor (`_`) and a STREAMING indicator as the agent's response arrives in real-time.

**Typing indicators** show `. . .` with the agent's name when they're composing.

### Sending Messages

- Type in the input field at the bottom
- **Enter** sends the message (no modifier needed)
- **Shift+Enter** inserts a newline
- The microphone button records audio for voice-to-text transcription
- Messages are sent optimistically — you see them immediately as "SENDING", then they update to "DELIVERED" or "FAILED"
- On failure, your message text is preserved so you can retry

### Search

The search bar at the top performs full-text search across all messages. Type a query and press Enter. Results replace the message list. Press Escape or click the clear button to return to the conversation.

### Infinite Scroll

Scroll to the top to load older messages. A "SCROLL UP FOR MORE" indicator appears as you approach the boundary. Messages load automatically via cursor-based pagination.

### Connection Indicator

The header shows your current connection method:
- **WS** (green) — WebSocket, best for real-time
- **SSE** (blue) — Server-Sent Events fallback
- **HTTP** (gray) — Polling fallback
- **RECONNECTING** (amber) — Attempting to reconnect
- **OFFLINE** (red) — No connection

### Quick Input (Floating Action Button)

A floating button in the bottom-right corner expands into a quick text input. Use it to fire off a fast message without switching to the full chat view:
- Click the FAB to expand
- Type your message
- **Ctrl/Cmd+Enter** to send
- Supports voice input via mic button
- Auto-collapses after successful send (2s delay)
- On error, your text is preserved

---

## Beads (Work Board)

The **BEADS** tab is your task management surface with three complementary views.

### View Modes

Toggle between views using the buttons in the header:
- **BOARD** — Kanban drag-and-drop columns
- **GRAPH** — Dependency visualization network
- **EPICS** — Hierarchical epic progress view

### Controls (All Views)

**Overseer Toggle** — The eye icon filters out operational/infrastructure beads (wisp, witness, sync, heartbeat, merge tasks, etc.) so you see only the work that matters. Persisted to localStorage.

**Search** — Fuzzy search across bead ID, title, and assignee. Results filter in real-time.

**Source Filter** — Switch between ALL sources, specific projects, or the town database. Persisted.

**Sort** — Choose from: Last Updated, Priority, Created, A-Z, or Assignee. Persisted.

### Kanban Board

Six columns: **OPEN**, **BACKLOG**, **IN PROGRESS**, **IN REVIEW**, **BLOCKED**, **DONE**.

Each card shows:
- Bead ID and priority badge (color-coded P0-P4)
- Title (truncated, hover for full text)
- Type (epic/task/bug) and assignee

**Drag and drop** cards between columns to change status. The card goes translucent with a green glow while dragging. The target column highlights on hover. Status updates are optimistic — the UI moves the card immediately, then confirms with the server. If the server rejects, the card snaps back with an error toast.

**Special behavior**: Dragging a card to IN PROGRESS without an assignee triggers an assignment modal so you can pick who owns the work.

**Click** any card to open the detail panel.

**Assignee dropdown** on each card lets you reassign work inline. It fetches the current list of idle/working agents when opened.

### Dependency Graph

An interactive node network powered by React Flow with dagre auto-layout.

- **Pan**: Click and drag the background
- **Zoom**: Scroll wheel or pinch
- **Fit**: Use the control buttons (bottom-left) to fit the graph to your viewport
- **Mini-map**: Bottom-right corner shows a preview of the full graph
- **Click** a node to see its details in the side panel
- **Critical Path**: Toggle this in the graph controls to highlight the longest dependency chain. Critical nodes and edges brighten; everything else dims.

Edges show dependency relationships — which beads block which. This is invaluable for understanding what's holding up your project.

### Bead Detail Panel

Click any bead (in any view) to open a slide-out panel on the right:
- Full bead ID, title, status badge, priority, type
- Assignee with re-assignment option
- Markdown-rendered description
- Created/updated/closed timestamps
- **Dependencies**: BLOCKS (what this bead is holding up) and BLOCKED BY (what's holding this bead up) — each link is clickable for navigation

### Priority Colors

| Priority | Color | Meaning |
|----------|-------|---------|
| P0 | Red | Critical — drop everything |
| P1 | Amber/Gold | High — address soon |
| P2 | Green | Normal — standard work |
| P3 | Dim green | Low — when time permits |
| P4 | Gray | Backlog — someday |

---

## Epics

The **EPICS** tab shows project-level progress tracking.

### Epic Cards

Each card displays:
- Epic ID and status badge (COMPLETE / IN PROGRESS)
- Title
- Visual progress bar: `[filled] X/Y (ZZ%)` showing child bead closure ratio
- Color-coded: green (100%), cyan (>50%), amber (>0%), dim (0%)

### Controls

- **Overseer Toggle** — Same as beads, filters operational items
- **Project Filter** — Scope to a specific project
- **Sort**: Activity, Priority, Created, A-Z, or Completion %

### Epic Detail

Click an epic to see:
- Full bead details (same as bead detail panel)
- Child beads list showing all tasks under this epic
- Progress visualization
- Dependency hierarchy
- Navigation between parent and child epics

---

## Crew (Agents)

The **CREW** tab shows all your agents grouped by status.

### Status Groups (in display order)

1. **WORKING** (green) — Actively executing a task
2. **BLOCKED** (amber) — Stuck, needs intervention
3. **STUCK** (red) — Critical issue
4. **IDLE** (green) — Available for work
5. **OFFLINE** (gray) — No active session

Within each group, agents are sorted by last activity (most recent first).

### Agent Cards

Each card shows:
- Status indicator dot (pulsing for working agents)
- Agent name (uppercase)
- Project scope
- Current task/bead (if working)
- Git branch and worktree path (if in a swarm)
- Progress bar for active work
- Unread message count and preview

### Card Actions

**Kill (D2)** — Terminate a connected agent. Shows a confirmation prompt before executing. Only available for online, non-coordinator agents.

**Assign (D3)** — Assign an idle agent to a task. Opens a picker showing available beads.

### Terminal Streaming

Expand an agent card to see live terminal output from their session. The terminal streams via WebSocket with a polling fallback. Features:
- Real-time output as the agent works
- Copy-to-clipboard button
- Auto-scroll toggle
- Collapsible view

---

## Personas

The **PERSONAS** tab lets you create reusable agent personality profiles.

### Persona Roster

A responsive grid of persona cards, each showing:
- Name and description
- Trait distribution visualization
- Budget gauge (points spent out of 100)

**Actions per card:**
- **EDIT** — Open the full persona editor
- **DEPLOY** — Spawn a new agent with this persona's traits injected
- **DELETE** — Remove (with confirmation)

### Persona Editor

**Left column (60%)**: Name, description, and trait groups with stepped sliders (0-5 scale). Each group shows points spent. A budget gauge at the top tracks total allocation against the 100-point limit.

**Right column (40%)**: Live preview of the generated system prompt. Updates as you adjust traits. The prompt text is copyable.

**Save** is enabled only when: the name is non-empty and you're within budget.

---

## Timeline

The **TIMELINE** tab is a chronological stream of all agent activity.

### Event Types

- **Status Changes** — Agent went from WORKING to IDLE
- **Progress Reports** — Agent is 50% done with task X
- **Announcements** — Completions, blockers, questions
- **Messages** — Chat activity
- **Bead Updates** — Status or assignee changes

Events are grouped by date (TODAY, YESTERDAY, specific days) and color-coded by type.

### Filtering

Filter by:
- Event type (all / status_change / progress / announcement / message / bead_update)
- Agent (all or specific)
- Date range (today / this week / this month / all time)

Filters are combinable and update in real-time. Scroll to the bottom for infinite loading of older events.

---

## Proposals

The **PROPOSALS** tab manages design and improvement proposals.

### Proposal Types

- **Product** — UX and product improvements
- **Engineering** — Refactoring and architecture improvements

### Status Workflow

Proposals move through: **PENDING** → **ACCEPTED** → **COMPLETED** (or **DISMISSED**)

### Proposal Cards

Each card shows: ID, title, type badge, status badge, author, created date, and a summary preview. Filter by status and type using the button bar.

### Actions

- **Click** a card to see the full proposal detail
- **ACCEPT** / **DISMISS** / **COMPLETE** — Change proposal status
- **SEND TO AGENT** — Route a proposal to an agent for implementation
- **DISCUSS** — Send to an agent for review and feedback

The **Send to Agent** modal lets you pick which agent receives the proposal and whether the mode is "execute" (implement it) or "discuss" (review it).

---

## Settings

The **SETTINGS** tab controls themes, communication, remote access, and more.

### Themes

Four built-in themes:

| Theme | Aesthetic | CRT Effects |
|-------|-----------|-------------|
| **PIP-BOY** | Classic green phosphor terminal | Yes (flicker, scanlines, noise) |
| **DOCUMENT** | Clean, professional black & white | No |
| **STARCRAFT** | Sci-fi electric cyan | Yes |
| **FRIENDLY** | Playful purple, multi-color | No |

Click a theme card to switch instantly. Your selection persists across sessions.

### Communication Priority

Controls how the dashboard stays in sync with the backend:

| Mode | Method | Polling | Use Case |
|------|--------|---------|----------|
| **Real-Time** | WebSocket + SSE | 10s | Active monitoring and chat |
| **Efficient** | SSE only | 30s | Background monitoring, saves battery |
| **Polling** | HTTP only | 120s | Restricted networks |

### Tunnel / Remote Access

- Status display: CONNECTED / NOT RUNNING / STARTING / ERROR
- Public URL with copy button (with "COPIED!" feedback)
- QR code for quick mobile access — tap to expand
- Start/stop toggle

### API Key

- Secure input field for your API key
- Save/Clear buttons
- Stored in browser session storage (cleared on logout)

### Notifications

- Enable/disable audio notifications
- Volume slider (0-100%)
- iOS audio unlock button (Web Audio requires a user gesture on iOS)

---

## iOS App

The Adjutant iOS companion app mirrors the web dashboard on your phone with native gestures and push notifications.

### Tabs

The iOS app has 8 tabs: **OVERVIEW**, **CHAT**, **CREW**, **PROJECTS**, **BEADS**, **TIMELINE**, **PROPOSALS**, **SETTINGS**.

### Overview

The overview screen shows agents, unread messages, tasks, and epics — same data as the web dashboard but optimized for mobile.

**Key interactions:**
- **Tap** any agent row → navigate to agent detail
- **Long-press** an agent row → jump directly to chat with that agent
- **"START AGENT" button** → tap to spawn a random-callsign agent; **long-press (0.5s)** to open a callsign picker for custom names
- **"TRIGGER UPDATE"** → pings all agents for a status refresh
- **Pull-to-refresh** → reload all data

**Stale data banner**: When the connection fails but cached data exists, a yellow warning banner appears with a RETRY button.

### Chat

SMS-style conversation with agent selector dropdown:
- Session picker button shows session name + status dot (green=connected, red=offline)
- Pulse animation for working agents
- "FULL" button opens a fullscreen session view
- Send on return key
- Stop/interrupt button (red) for running agents

### Crew

Full agent roster with filtering:

**Workload summary bar**: Shows TOTAL, WORKING, IDLE, OFFLINE counts and active beads.

**Filter bar**: Search by name + status filter chips (ALL, WORKING, IDLE, BLOCKED, OFFLINE) with counts.

**Agent rows**: Tap to navigate to detail; long-press to jump to chat.

**Swipe actions**:
- **Swipe left** → CHAT button (blue, full-swipe enabled)
- **Swipe right** → TERMINATE button (red, partial-swipe)

### Agent Detail (3 tabs)

**INFO**: Status card, live terminal display (if session exists), agent type, current task, ASSIGN BEAD button, TERMINATE button with confirmation alert.

**BEADS**: Active beads and recently completed, tappable for navigation.

**MESSAGES**: Chat bubbles with quick reply input. Text selection enabled on message bubbles.

### Beads

Three view modes matching the web: **BOARD** (Kanban), **GRAPH** (dependency network), **EPICS** (hierarchy).

**Kanban**: 4 columns (OPEN, HOOKED, IN PROGRESS, CLOSED). Cards are draggable between columns with optimistic updates and error toasts. Responsive: on iPhone shows ~1.7 columns with horizontal scroll; on iPad shows up to 3.3 columns.

**Graph**: Interactive dependency visualization with pan (drag), pinch (zoom), and tap (navigate to detail).

### Proposals

Swipe actions on proposal cards:
- **Swipe left** → SEND TO AGENT (blue)
- **Swipe right** → APPROVE/REJECT (green/red)

### Settings

- **4 themes** with animated preview cards (scale animation on selection, blinking cursor on Pip-Boy theme)
- **Server**: Custom API endpoint field (for ngrok tunnel URL)
- **API Key**: Secure field with save/clear
- **Communication Priority**: Real-Time (10s), Efficient (30s), Polling Only (120s)
- **Push Notifications**: Master toggle with custom CRT-styled switch
- **Voice**: Type selection (FEMALE/MALE/NEUTRAL), volume slider
- **About**: Version and build info

### Push Notifications

The iOS app supports rich push notifications with categories:

| Category | Actions |
|----------|---------|
| NEW_MAIL | View, Mark Read, Dismiss |
| CHAT_MESSAGE | View, Dismiss |
| AGENT_MESSAGE | View, Dismiss |
| TASK_UPDATE | View, Dismiss |
| SYSTEM_ALERT | View, Dismiss |
| REMINDER | View, Snooze (15 min), Dismiss |

**Smart foreground suppression**: If you're already viewing a specific agent's chat, notifications from that agent are suppressed (badge still updates).

**Deep linking**: Tapping a notification navigates directly to the relevant conversation, bead, or agent.

### Offline Behavior

- Offline indicator banner persists across all tabs
- Cached data displayed with yellow "stale data" warning
- Manual refresh buttons and pull-to-refresh on most screens
- Automatic reconnection with exponential backoff

---

## Voice Features

Adjutant integrates with ElevenLabs for voice input and output.

### Voice Input (Record & Transcribe)

The microphone button in the chat input:
1. **Tap** to start recording (button shows `||`)
2. **Tap again** to stop and transcribe (button shows `?` while processing)
3. Transcript is inserted into the text field

Supports multi-segment recording — each transcript appends to existing text.

### Voice Playback (Text-to-Speech)

Each chat message has a play button:
- **`>`** — Tap to synthesize and play the message
- **`||`** — Tap to stop playback
- **`?`** — Loading/synthesizing

### Voice Configuration

In Settings > Voice:
- Voice type selection (Female/Male/Neutral)
- Speed slider (0.5x - 2.0x)
- Stability and similarity boost sliders
- Preview button to test current settings
- Per-agent voice overrides via the API

### Voice Announcements (iOS)

The iOS app can announce events via TTS:
- New mail, bead status changes, agent status updates, system alerts
- Priority levels: Low, Normal, High, Urgent (urgent interrupts the queue)
- Respects device silent mode

---

## Remote Access

Adjutant uses ngrok to make your local dashboard accessible from anywhere.

### How It Works

When you run `adjutant` (or `npm run dev`), an ngrok tunnel starts automatically if ngrok is installed. The public URL is displayed in the terminal and available in Settings.

### From the Dashboard

The Settings tab shows:
- Tunnel status (CONNECTED / NOT RUNNING)
- Public URL with a copy button
- QR code — tap to expand, scan from your phone
- Start/stop toggle

### Connecting the iOS App

1. Start Adjutant on your machine
2. Open Settings in the iOS app
3. Enter your ngrok URL in the "Server" field (or scan the QR code)
4. Save — the app connects to your remote dashboard

### Limits (Free Tier)

- 2-hour sessions (restart to get a new URL)
- Interstitial page on first visit
- 1 tunnel at a time

---

## Keyboard Shortcuts & Hidden Interactions

### Web — Keyboard

| Context | Shortcut | Action |
|---------|----------|--------|
| Chat input | **Enter** | Send message |
| Chat input | **Shift+Enter** | Insert newline |
| Quick Input FAB | **Ctrl/Cmd+Enter** | Send message |
| Search field | **Enter** | Execute search |
| Search field | **Escape** | Clear search |
| Dropdowns | **Escape** | Close dropdown |
| Dropdowns | **Arrow keys** | Navigate options |
| Buttons (focused) | **Space/Enter** | Activate |

### Web — Mouse & Touch

| Context | Gesture | Action |
|---------|---------|--------|
| Kanban card | **Drag** | Move between status columns |
| Kanban card | **Click** | Open detail panel |
| Dependency graph | **Scroll** | Zoom in/out |
| Dependency graph | **Click + drag background** | Pan |
| Dependency graph | **Click node** | Select and show details |
| Agent card (dashboard) | **Click** | Navigate to chat |
| Bead card | **Click** | Open detail panel |
| Bead ID (detail panel) | **Click** | Copy to clipboard |
| Agent Kill button | **Click** | Shows confirmation; click again to execute |

### iOS — Gestures

| Context | Gesture | Action |
|---------|---------|--------|
| START AGENT button | **Long-press (0.5s)** | Open callsign picker |
| Agent row (Overview) | **Tap** | Navigate to agent detail |
| Agent row (Overview) | **Long-press** | Jump to chat with agent |
| Agent row (Crew) | **Tap** | Navigate to agent detail |
| Agent row (Crew) | **Long-press** | Jump to chat with agent |
| Agent row (Crew) | **Swipe left** | Reveal CHAT button |
| Agent row (Crew) | **Swipe right** | Reveal TERMINATE button |
| Bead card | **Tap** | Navigate to bead detail |
| Bead card (Kanban) | **Drag** | Move between columns |
| Dependency graph | **Pan (drag)** | Move viewport |
| Dependency graph | **Pinch** | Zoom in/out |
| Proposal card | **Swipe left** | Reveal SEND TO AGENT |
| Proposal card | **Swipe right** | Reveal APPROVE/REJECT |
| Tab bar | **Swipe down (>20pt)** | Dismiss keyboard |
| Chat scroll | **Scroll down** | Interactive keyboard dismiss |
| Session picker | **Tap** | Open sessions sheet (.medium/.large detents) |
| Theme card | **Tap** | Select theme (scale animation) |
| Settings slider | **Drag** | Adjust value |
| Settings toggle | **Tap** | Toggle state |
| Most list views | **Pull down** | Refresh data |
| Terminal content | **Long-press text** | Enable text selection |

---

## Strategies for Effective Use

### 1. Use the Dashboard as Your Home Base

Start every session on the Dashboard tab. It gives you a single-glance summary of:
- Which agents are working vs idle
- What messages you haven't read
- What tasks are in progress
- How your epics are progressing

Don't dig into individual tabs until the dashboard tells you something needs attention.

### 2. Keep the Overseer Toggle On

When you're focused on project delivery (not infrastructure), enable the Overseer toggle in Beads and Epics. It hides operational noise — sync beads, merge slots, infrastructure tasks — and shows only the work that moves your project forward.

### 3. Use Epics for Project Tracking, Beads for Task Management

**Epics** give you the big picture: how far along is this feature? How many tasks remain? Use the progress bars to identify which epics are stalled.

**Beads Kanban** is for daily work management: what's open, what's in progress, what's blocked. Drag cards between columns to direct agent work in real-time.

**The Dependency Graph** is for understanding bottlenecks. Toggle on Critical Path Analysis to see the longest chain of blocking dependencies — that's where delays propagate.

### 4. Direct Agents via Chat

Agents read your messages and act on them. Use chat to:
- Give specific instructions: "Focus on adj-042.3 next"
- Ask for status: "What's blocking you?"
- Provide context: "The API changed, here's the new schema..."
- Redirect work: "Stop what you're doing and fix this bug"

Use the agent selector to target specific agents, or broadcast to all.

### 5. Monitor Blocked Agents

Blocked agents show in amber/red on the dashboard and crew view. When you see a blocked agent:
1. Check their latest chat messages — they usually explain what's wrong
2. Look at the Timeline for recent events from that agent
3. Either resolve the blocker or reassign the work

### 6. Use Proposals for Non-Urgent Improvements

When you notice something that should change but isn't urgent:
1. Create a proposal (Product or Engineering type)
2. Let it sit — review proposals periodically
3. When ready, use "Send to Agent" to route an accepted proposal for implementation
4. Use "Discuss" to get an agent's analysis before committing

### 7. Leverage the iOS App for Async Monitoring

The iOS app is ideal for checking on agent progress when you're away from your desk:
- Push notifications alert you to completions, blockers, and questions
- Quick message replies from notifications
- The Overview tab gives the same dashboard summary on your phone
- Set Communication Priority to "Efficient" on mobile to save battery

### 8. Use Personas for Consistent Agent Behavior

If you spawn agents frequently for similar work, create Personas:
- Define trait profiles (thoroughness, communication style, domain expertise)
- Deploy agents with a persona to get consistent behavior
- Iterate on persona prompts based on agent performance

### 9. Remote Access for Team Visibility

Use ngrok + the iOS app to give your team visibility into agent activity:
1. Start Adjutant with remote access enabled
2. Share the QR code or URL from Settings
3. Team members can monitor progress from their phones
4. Use the "Efficient" communication priority for read-only monitoring

### 10. Timeline for Post-Mortems

When something goes wrong (agent got stuck, wrong work was done, dependencies were missed):
1. Open the Timeline tab
2. Filter to the relevant agent and time range
3. Walk through the event sequence: status changes, progress reports, announcements
4. Identify where things diverged from the plan

The timeline is your audit trail — every status change, message, and bead update is recorded with timestamps.

---

## Agent Communication Protocol

Understanding how agents communicate helps you debug issues and direct work effectively.

### How Agents Connect

Agents connect to Adjutant via MCP (Model Context Protocol) over SSE:
1. Agent sends an initialize request to `/mcp`
2. Server creates a session and returns available tools
3. Agent uses tools to send messages, report status, and manage beads

### Tools Available to Agents

| Tool | Purpose |
|------|---------|
| `send_message` | Send message to user or another agent |
| `read_messages` | Read conversation history |
| `set_status` | Report working/blocked/idle/done |
| `report_progress` | Report task completion percentage |
| `announce` | Make a completion/blocker/question announcement |
| `create_bead` | Create a new task/bug/epic |
| `update_bead` | Change bead status/assignee |
| `close_bead` | Mark a bead as complete |
| `list_beads` | Query available work |
| `show_bead` | Get bead details |
| `list_agents` | See who else is connected |
| `get_project_state` | Get dashboard summary |
| `search_messages` | Full-text search messages |
| `create_proposal` | Submit an improvement proposal |

### What You See

Every tool call an agent makes is reflected in the dashboard:
- `set_status` → Agent card updates, Timeline event
- `send_message` → Chat message appears, push notification
- `announce` → Announcement banner, Timeline event, push notification
- `update_bead` / `close_bead` → Kanban board updates, epic progress recalculates

---

## API Reference

For developers integrating with Adjutant or building custom tooling:

### Core Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/messages` | GET | List messages (filters: agentId, threadId, before, limit) |
| `/api/messages` | POST | Send message |
| `/api/messages/unread` | GET | Unread counts per agent |
| `/api/messages/broadcast` | POST | Status update request to all agents |
| `/api/agents` | GET | List all agents |
| `/api/agents/spawn` | POST | Create new agent session |
| `/api/beads` | GET | List beads (filters: project, status, type, sort) |
| `/api/beads/:id` | PATCH | Update bead |
| `/api/beads/graph` | GET | Dependency graph (nodes + edges) |
| `/api/beads/epics-with-progress` | GET | Epics with completion percentages |
| `/api/overview` | GET | Global overview across all projects |
| `/api/proposals` | GET/POST | List or create proposals |
| `/api/events` | SSE | Real-time event stream |
| `/api/tunnel/status` | GET | Tunnel status |
| `/ws/chat` | WebSocket | Real-time chat |

### Event Stream (SSE)

Connect to `/api/events` for real-time updates:
- `bead_update` — Bead created/updated/closed
- `agent_status` — Agent status changes
- `mail_received` / `mail_read` — Message events
- `session_cost` / `session_cost_alert` — Cost tracking
- `session_permission` — Permission prompts
- `mcp_agent_connected` / `mcp_agent_disconnected` — Agent lifecycle

Supports `Last-Event-ID` header for gap recovery. Heartbeat every 15 seconds.

---

## Cost Tracking

Adjutant tracks API costs per session, project, and model:
- View costs at `/api/costs`
- Set alert thresholds at `/api/costs/threshold`
- SSE events fire when thresholds are exceeded
- Per-project and per-model breakdowns available
