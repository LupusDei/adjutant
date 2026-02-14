# AdjutantMode: Multi-Mode Operation & Communication Architecture

## Overview

Adjutant operates in three distinct modes that determine how the system coordinates
agents, communicates with the backend, and presents information to the user. This
document defines each mode, the communication channels available, how to switch
between modes seamlessly, and the implementation changes needed across iOS, Frontend,
and Backend.

---

## The Three Modes

### 1. Gas Town Mode (GT Mode)

**What it is**: Full multi-agent infrastructure with a Mayor coordinator, Deacon,
Witness, Refinery, and Polecats. Multiple rigs run concurrently. The Mayor
coordinates all work through the beads system.

**How it operates**:
- Mayor acts as the central coordinator
- Work is organized into rigs (project containers) with epics, tasks, and bugs
- Polecats (short-lived worker agents) handle individual implementation tasks
- Refinery processes merge queues and code review
- Witness monitors system health with patrol cycles
- Deacon handles scheduled maintenance and cleanup
- Communication flows through `gt mail` (beads-backed messaging)
- Power control available (start/stop the entire infrastructure)

**Advantages**:
- Maximum parallelism: multiple agents work simultaneously across rigs
- Built-in quality gates (refinery review, witness monitoring)
- Full audit trail through beads system
- Resilient: agents can restart and pick up where they left off via hooks
- Scales to multiple projects/rigs

**Disadvantages**:
- Highest resource consumption (multiple tmux sessions, processes)
- Requires Gas Town infrastructure (mayor/, town.json, rig directories)
- Most complex setup
- Overkill for simple single-task work

**Setup needed**:
- Gas Town initialized (`gt init`)
- Town root with mayor/, rigs, .beads/ per rig
- Daemon running or direct mode configured
- Tunnel (ngrok/cloudflare) for remote access

**Pages visible**: Dashboard, Mail, Chat, Epics, Crew, Beads (Kanban), Settings
**Crew tab shows**: Mayor, Deacon, Witness, Refinery status + all Polecats per rig

---

### 2. Single Agent Mode

**What it is**: One agent working on one project. No rigs, no coordinator hierarchy.
The user talks directly to the agent through the chat interface. Think of it as
"Claude in a project directory."

**How it operates**:
- Single agent process runs in the project directory
- User sends messages directly to the agent via chat
- Agent reads/writes to local .beads/ for task tracking
- No power control (agent is always available when backend is running)
- No rigs concept - everything is in one flat workspace

**Advantages**:
- Simplest setup: just point Adjutant at a project directory
- Lowest resource consumption (one agent process)
- Fastest response time (no coordination overhead)
- Ideal for: quick tasks, pair programming, code review, learning

**Disadvantages**:
- No parallelism (one task at a time)
- No quality gates (no refinery, no witness)
- No persistent coordination (no mayor to track context across sessions)
- Limited to one project at a time

**Setup needed**:
- Project directory with .beads/ initialized (`bd init`)
- Backend running with `ADJUTANT_MODE=standalone` or auto-detected
- No Gas Town infrastructure required

**Pages visible**: Chat, Beads, Settings
**Hidden in this mode**: Dashboard (no multi-agent overview), Crew (only one agent),
Epics (simplified to flat task list in Beads), Mail (chat replaces it)

---

### 3. Swarm Mode

**What it is**: Multiple agents working together WITHOUT Gas Town's formal hierarchy.
Agents coordinate peer-to-peer through beads mail. No mayor, no refinery - just
a team of agents that communicate directly.

**How it operates**:
- Multiple agent processes run in the same project directory
- Agents discover each other via shared .beads/ database
- Communication through `bd` mail (direct, no `gt` wrapper)
- User can message any agent directly
- Agents can message each other for coordination
- No formal roles - any agent can pick up any task

**Advantages**:
- Multi-agent parallelism without Gas Town overhead
- Flexible: agents self-organize around work
- Simpler than GT mode (no mayor/deacon/witness infrastructure)
- Good for: focused sprints on a single project with multiple workers

**Disadvantages**:
- No central coordinator (can lead to duplicate work or conflicts)
- No quality gates (no refinery for code review)
- No health monitoring (no witness patrols)
- Harder to track overall progress (no mayor providing status reports)
- Conflict resolution is manual

**Setup needed**:
- Project directory with .beads/ initialized
- Backend running with `ADJUTANT_MODE=swarm`
- Multiple agent sessions started manually or via backend

**Pages visible**: Chat, Crew, Beads, Settings
**Crew tab shows**: All active agent sessions (flat list, no hierarchy)
**Hidden in this mode**: Dashboard (no rig overview), Epics (flat tasks only)

---

## Communication Channels

### Channel Overview

| Channel | Direction | Latency | Use Case | Available In |
|---------|-----------|---------|----------|--------------|
| **HTTP/REST** | Request/Response | ~100ms | CRUD operations, file uploads, config | All modes |
| **WebSocket** | Bidirectional | ~50ms | Chat messages, streaming, typing indicators | All modes |
| **SSE** | Server → Client | ~50ms | System events, bead updates, agent status | All modes |
| **APNs** | Server → Client | ~1-5s | Background/offline push notifications | iOS only |
| **Mail (Beads)** | Store & Forward | ~1-30s | Persistent agent-to-agent/user communication | GT & Swarm |

### Communication Priority (User-Configurable)

Users select their preferred communication priority in Settings. This determines
which channel the app prefers for real-time data:

#### Priority: Real-Time (Default)
```
WebSocket → SSE → HTTP Polling → APNs (background)
```
- Best for: active use, pair programming, chat-heavy workflows
- Chat uses WebSocket for instant delivery + streaming
- System events use SSE for live updates
- Falls back to HTTP polling if WS/SSE disconnect
- APNs for background notifications only

#### Priority: Efficient
```
SSE → HTTP Polling → APNs (background)
```
- Best for: monitoring, occasional check-ins, battery conservation
- No persistent WebSocket connection (saves resources)
- SSE provides one-way event stream for updates
- Chat uses HTTP POST to send, SSE to receive
- Lower battery drain than Real-Time

#### Priority: Polling Only
```
HTTP Polling → APNs (background)
```
- Best for: unreliable networks, firewall restrictions, debugging
- Classic request/response pattern only
- No persistent connections
- Configurable poll interval (5s / 15s / 30s / 60s)
- Most compatible with network restrictions

### Chat Communication Method Indicator

The Chat view displays a small indicator showing the active communication method:

```
┌──────────────────────────────────┐
│  CHAT                    ◉ WS   │  ← Green dot + "WS" = WebSocket connected
│──────────────────────────────────│
│  ...messages...                  │
└──────────────────────────────────┘

┌──────────────────────────────────┐
│  CHAT                    ◎ SSE  │  ← Yellow dot + "SSE" = SSE fallback
│──────────────────────────────────│

┌──────────────────────────────────┐
│  CHAT                    ○ HTTP │  ← Gray dot + "HTTP" = Polling mode
│──────────────────────────────────│
```

Indicator states:
- `◉ WS` (green, pulsing) — WebSocket connected, real-time bidirectional
- `◎ SSE` (yellow) — SSE connected, real-time receive / HTTP send
- `○ HTTP` (gray) — Polling mode, periodic refresh
- `◉ WS ⚡` (green + bolt) — WebSocket + actively streaming agent response
- `⚠ RECONNECTING` (orange, flashing) — Connection lost, attempting recovery

---

## Mode Switching

### How It Works

Mode is determined by the backend's workspace detection and can be overridden:

1. **Auto-detection** (default): Backend checks for Gas Town markers
   - `mayor/town.json` exists → GT Mode
   - Multiple agent sessions detected → Swarm Mode
   - Neither → Single Agent Mode

2. **Explicit override**: `ADJUTANT_MODE` environment variable
   - `gastown`, `standalone`, or `swarm`

3. **Runtime switching** (new): Settings UI allows mode change
   - Backend exposes `POST /api/mode` to switch
   - Triggers workspace provider swap
   - Clients receive `mode_changed` SSE event and adapt UI

### Seamless Mode Switching Flow

```
User taps "GT Mode" in Settings
    ↓
iOS sends POST /api/mode { mode: "gastown" }
    ↓
Backend validates (GT infrastructure exists?)
    ↓
Backend swaps providers (workspace, topology, transport, status)
    ↓
Backend emits SSE event: mode_changed { mode: "gastown", features: [...] }
    ↓
iOS receives event, updates AppState.deploymentMode
    ↓
UI reflows: tabs appear/hide, pages adapt content
    ↓
ConnectionManager adjusts (e.g., enables WebSocket for GT mode)
```

### Page Adaptations by Mode

| Page | GT Mode | Single Agent | Swarm |
|------|---------|-------------|-------|
| **Dashboard** | Full overview: rigs, crew stats, mail summary, recent activity | Hidden | Hidden |
| **Mail** | Full mail UI: compose, threads, recipients | Hidden (use Chat) | Visible (agent-to-agent mail) |
| **Chat** | Chat with Mayor or any crew member | Direct chat with agent | Chat with any swarm agent |
| **Epics** | Hierarchical: epics → stories → tasks per rig | Hidden | Hidden |
| **Crew** | Hierarchical: Mayor, Deacon, Witness, Refinery, Polecats | Hidden (single agent) | Flat list of active agents |
| **Beads** | Kanban with rig filter, priorities, labels | Simple task list | Task list with agent assignments |
| **Settings** | Full settings + mode selector + rig filter + tunnel control | Simplified + mode selector | Mode selector + agent config |

---

## Implementation Plan

### Phase 1: Backend Mode API & Communication Infrastructure

**Goal**: Expose mode switching API, implement EventBus, WebSocket, and SSE endpoints.

#### 1.1 Mode Switching API
- Add `POST /api/mode` endpoint to change deployment mode at runtime
- Add `GET /api/mode` to query current mode and available features
- Validate mode transitions (e.g., can't switch to GT if no town.json)
- Emit `mode_changed` event on switch

#### 1.2 EventBus Service
- Create in-process EventBus using Node.js EventEmitter
- Wire existing services to emit events:
  - `mail-service` → `mail:received`, `mail:read`
  - `beads-service` → `bead:created`, `bead:updated`, `bead:closed`
  - `agents-service` → `agent:status_changed`
  - `power-service` → `power:state_changed`
- Add `mode:changed` event type

#### 1.3 WebSocket Server
- Add `ws` package to Express backend
- Create `/ws/chat` endpoint with auth handshake
- Message routing: client → target agent (via transport layer)
- Sequence numbering for gap recovery
- Replay buffer (last 1000 messages or 1 hour)
- Ping/pong keepalive (30s interval)
- Rate limiting (60 msgs/min, 30 typing events/min)

#### 1.4 SSE Endpoint
- Create `GET /api/events` SSE endpoint
- Subscribe to EventBus, fan out to connected clients
- Event types: `bead_update`, `agent_status`, `power_state`, `mail_received`, `mode_changed`
- `Last-Event-ID` support for automatic gap recovery
- 15s heartbeat keepalive comments

#### 1.5 Streaming Bridge
- Create `.beads/streams/` directory convention
- Backend watches for stream files via `fs.watch()`
- Relay stream tokens over WebSocket to subscribed client
- Clean up completed stream files

---

### Phase 2: iOS Communication Layer

**Goal**: Build ConnectionManager, integrate all communication channels, add Settings UI.

#### 2.1 ConnectionManager
- New `@Observable` class managing WebSocket + SSE lifecycle
- Auto-reconnect with exponential backoff (1s → 2s → 4s → ... → 30s cap)
- Outbound message queue (survives reconnects)
- Sequence tracking for gap detection
- Connection state published to UI

#### 2.2 Communication Priority in Settings
- Add "COMMUNICATION" section to SettingsView
- Three priority options: Real-Time / Efficient / Polling Only
- Persist selection to UserDefaults
- ConnectionManager reads priority and connects accordingly

#### 2.3 Chat Communication Indicator
- Add connection status badge to ChatView header
- Show method (WS/SSE/HTTP) + state (connected/reconnecting/error)
- Streaming indicator when agent response is streaming
- Tap indicator for connection details popover

#### 2.4 SSE Event Stream Integration
- Parse SSE text/event-stream format (~100 lines custom parser)
- Subscribe to bead updates, agent status, mode changes
- Replace DataSyncService polling with SSE for real-time data
- Keep polling as fallback when SSE disconnects

#### 2.5 WebSocket Chat Integration
- Migrate ChatViewModel from HTTP polling to WebSocket
- Optimistic message UI with delivery confirmation
- Typing indicators (send/receive)
- Streaming response rendering (token-by-token with cursor)

---

### Phase 3: iOS Mode-Aware UI

**Goal**: Make all iOS pages adapt to the current mode.

#### 3.1 Mode State Management
- Add `deploymentMode` to AppState (fetched from `/api/mode` + SSE updates)
- TabBar adapts: show/hide tabs based on mode
- Each view checks mode for content adaptation

#### 3.2 Tab Visibility
- GT Mode: all 7 tabs visible
- Single Agent: Chat, Beads, Settings only (3 tabs)
- Swarm: Chat, Crew, Beads, Settings (4 tabs)

#### 3.3 Page Content Adaptation
- Dashboard: only in GT mode (multi-rig overview)
- Crew: hierarchical in GT, flat in Swarm, hidden in Single Agent
- Beads: full Kanban in GT, simple list in Single Agent/Swarm
- Chat: recipient selector adapts to available agents per mode
- Epics: only in GT mode (rig-scoped epic hierarchy)

#### 3.4 Mode Switcher in Settings
- Visual mode selector (3 cards with icons/descriptions)
- Shows current mode with green indicator
- Tap to switch → confirmation dialog → backend call → UI reflow
- Disabled options grayed out with reason (e.g., "Requires Gas Town")

---

### Phase 4: Frontend Mode-Aware UI

**Goal**: Make the web frontend adapt to modes with the same seamlessness as iOS.

#### 4.1 Mode Context Provider
- Extend `useDeploymentMode` hook to support runtime mode changes
- Create `ModeContext` React context for app-wide mode state
- Listen for SSE `mode_changed` events

#### 4.2 Navigation Adaptation
- Sidebar tabs show/hide based on mode (same rules as iOS)
- Route guards redirect if page not available in current mode

#### 4.3 Page Content Adaptation
- Same content rules as iOS (Dashboard GT-only, Crew hidden in Single Agent, etc.)
- Components receive mode via context and render accordingly

#### 4.4 Communication Priority Selector
- Add to SettingsView component
- Same three options as iOS (Real-Time / Efficient / Polling Only)
- Frontend manages its own WebSocket/SSE connections

#### 4.5 Chat Communication Indicator
- Same indicator as iOS (WS/SSE/HTTP badge in chat header)
- Streaming response support in web chat

---

### Phase 5: Integration Testing & Polish

#### 5.1 Mode Transition Tests
- Test switching between all three modes
- Verify no data loss during transition
- Verify UI correctly shows/hides pages

#### 5.2 Communication Channel Tests
- WebSocket connect/disconnect/reconnect
- SSE event delivery and gap recovery
- Fallback from WS → SSE → HTTP polling
- Streaming response end-to-end

#### 5.3 Cross-Platform Consistency
- iOS and Frontend show same data in same mode
- Mode change on one client reflected on the other (via SSE)

---

## Communication Channel Details

### WebSocket Protocol (`/ws/chat`)

```
Client → Server:
  message     { id, to, body, replyTo? }
  typing      { to, state: started|stopped }
  stream_request { id, to, body }
  stream_cancel  { streamId }
  ack         { messageId, seq }

Server → Client:
  message     { id, clientId?, seq, from, to, body, timestamp }
  stream_token { streamId, seq, token, done: false }
  stream_end  { streamId, messageId, body, done: true }
  typing      { from, state: started|stopped|thinking }
  delivered   { messageId, clientId, timestamp }
  error       { code, message, relatedId? }
```

### SSE Event Types (`/api/events`)

```
event: bead_update     data: { id, status, title, updatedAt }
event: agent_status    data: { agent, status, activity }
event: power_state     data: { state, rigs }
event: mail_received   data: { id, from, subject, preview }
event: mode_changed    data: { mode, features, reason }
event: stream_status   data: { streamId, agent, state }
```

### APNs (Unchanged)

Existing push notification infrastructure continues to handle:
- Background app refresh
- Offline message delivery
- Badge count updates

Enhancement: suppress duplicate notifications for messages already received via
WebSocket or SSE when the app is foregrounded.

---

## Security Considerations

- WebSocket auth via message-based handshake (API key not in URL)
- SSE auth via Authorization header
- Rate limiting per channel (WS: 60 msg/min, SSE: read-only, REST: existing limits)
- Connection limits: max 2 WS + 1 SSE per client
- Idle timeout: 5 min WS, 15s SSE keepalive

---

## Migration Strategy

All changes are **additive**. No existing functionality is removed:

1. REST API remains unchanged and fully functional
2. HTTP polling continues to work as fallback
3. APNs push notifications unchanged
4. Existing beads storage unchanged
5. Mode auto-detection preserves current behavior

Users can adopt new features incrementally:
- Start with current HTTP polling (works today)
- Enable SSE for real-time events (Phase 2)
- Enable WebSocket for real-time chat (Phase 2)
- Switch between modes as needed (Phase 3-4)
