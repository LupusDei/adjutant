# AdjutantV2: Session Bridge Architecture

## The Problem

Adjutant V1 treats the backend as a REST/event API with beads as the data layer.
Messages flow through beads (store-and-forward), which means communication with
agents has 1-30 second latency. WebSocket and SSE were added but only relay events
_about_ work — they don't connect you _to_ the agent.

**What we actually want**: Adjutant as a **remote Claude Code multiplexer**. A tunnel
to real terminal sessions. Type on your phone, see the agent's response stream in
real-time, as if you were sitting at the terminal.

---

## Core Concept

Every Claude Code session runs in tmux. Adjutant's backend bridges between tmux
sessions and WebSocket clients:

```
iOS/Frontend ←→ WebSocket ←→ Session Bridge ←→ tmux sessions ←→ Claude Code
```

The Session Bridge:
1. Knows about all tmux sessions (discovers existing, creates new)
2. Captures output via `tmux pipe-pane` → streams to WebSocket
3. Accepts input from WebSocket → sends via `tmux send-keys`
4. Manages session lifecycle (create, attach, detach, kill)

---

## Session Bridge Service

### Architecture

```
SessionBridge (singleton)
├── SessionRegistry        — tracks all known sessions
├── SessionConnector        — attaches to tmux, captures output
├── OutputParser            — converts raw terminal → structured events
├── InputRouter             — routes WebSocket input → tmux send-keys
└── LifecycleManager        — create, kill, workspace setup
```

### Session Registry

Maintains state for every session:

```typescript
interface ManagedSession {
  id: string;                    // unique session ID
  name: string;                  // human-readable (e.g., "mayor", "polecat-obsidian", "agent-1")
  tmuxSession: string;           // tmux session name
  tmuxPane: string;              // tmux pane target (session:window.pane)
  projectPath: string;           // working directory
  mode: "standalone" | "swarm" | "gastown";
  status: "idle" | "working" | "waiting_permission" | "offline";
  workspaceType: "primary" | "worktree" | "copy";
  connectedClients: Set<string>; // WebSocket client IDs watching this session
  outputBuffer: RingBuffer;      // last N lines for replay on connect
  pipeActive: boolean;           // whether tmux pipe-pane is attached
  createdAt: Date;
  lastActivity: Date;
}
```

Persisted to `~/.adjutant/sessions.json` so sessions survive backend restarts.

### Session Discovery

On startup (and periodically), the bridge discovers sessions:

**GT Mode**:
- Read `town.json` for rig list
- Scan for tmux sessions matching GT naming conventions:
  - `mayor`, `deacon`, `witness`, `refinery` (town-level)
  - `adjutant/obsidian`, `adjutant/quartz`, etc. (polecats per rig)
- Cross-reference with `gt agents list` for status

**Standalone/Swarm Mode**:
- Scan for tmux sessions created by Adjutant (prefixed `adj-`)
- Read `~/.adjutant/sessions.json` for managed sessions

### Output Capture

For each connected session, capture output via tmux:

```bash
# Start capturing output to a FIFO
mkfifo /tmp/adjutant/session-<id>.pipe
tmux pipe-pane -o -t <session>:<pane> "cat >> /tmp/adjutant/session-<id>.pipe"
```

Backend reads the FIFO with `fs.createReadStream()` and:
1. Buffers partial lines
2. Passes complete lines to OutputParser
3. OutputParser emits structured events
4. Events broadcast to connected WebSocket clients

**When no client is connected**: Stop pipe-pane to avoid resource waste. Keep a
small snapshot buffer via periodic `tmux capture-pane` for "reconnect preview."

### Output Buffer

Ring buffer per session, capped at **1000 lines**. When exceeded, oldest lines are
dropped to make room for new output.

**On reconnect**, the client chooses:
- **Replay buffer**: Receive all buffered output since disconnect (useful for short
  disconnections where you want to see what happened)
- **Skip to present**: Clear the buffer for this session and start streaming from
  now (useful when session ran for hours and there's a huge backlog)

```
// Client sends on reconnect:
{ type: "session_connect", sessionId: "abc", replay: true }   // replay buffer
{ type: "session_connect", sessionId: "abc", replay: false }  // skip, clear buffer
```

Default: `replay: false` (skip to present) — protects against overwhelming the
client with stale output.

### Output Parser

Converts raw terminal output to structured events. Claude Code has recognizable
output patterns:

```
Raw terminal line                    →  Structured event
─────────────────────────────────────────────────────────
"⏺ Read file: /path/to/file"        →  { type: "tool_use", tool: "read", path: "..." }
"⏺ Edit file: /path/to/file"        →  { type: "tool_use", tool: "edit", path: "..." }
"⏺ Bash(command here)"              →  { type: "tool_use", tool: "bash", command: "..." }
Agent text output                    →  { type: "message", content: "..." }
"Allow? (y/n)"                       →  { type: "permission_request", action: "..." }
"── thinking ──"                     →  { type: "status", state: "thinking" }
```

**Two output modes** (user toggles in iOS):
1. **Chat mode**: Only structured events rendered as chat bubbles + collapsible tool cards
2. **Terminal mode**: Raw terminal output rendered in a terminal emulator widget

The parser doesn't need to be perfect — it's a best-effort enhancement. Terminal
mode is always available as the ground truth.

### Input Router

When a user sends a message from iOS:

```typescript
// WebSocket message from client
{ type: "session_input", sessionId: "abc", text: "Fix the login bug" }
```

Backend routes to tmux:
```bash
# Clear any existing input, type the message, press Enter
tmux send-keys -t <session>:<pane> "Fix the login bug" Enter
```

**For permission responses**:
```bash
# Send 'y' or 'n' to the permission prompt
tmux send-keys -t <session>:<pane> "y" Enter
```

**Input queuing**: By default, if the agent is mid-response, user input is queued
until the agent finishes its current turn. The queue is FIFO — messages are delivered
in order when the agent becomes idle.

**Interrupt (Ctrl-C)**: The user also has an explicit "halt" action — equivalent to
pressing Ctrl-C in the terminal. This:
1. Sends SIGINT to the Claude Code process via `tmux send-keys -t <session> C-c`
2. Interrupts the current agent turn
3. Agent stops what it's doing and returns to the prompt
4. Queued input (if any) is delivered, or the user can type a new prompt

```
// Client sends interrupt:
{ type: "session_interrupt", sessionId: "abc" }
```

The iOS UI should have a visible "Stop" button (like a stop-generation button)
that appears while the agent is working.

---

## WebSocket Protocol v2

Extended message types for session-based communication:

### Client → Server

```
session_list        { }                                    // list all sessions
session_create      { projectPath, mode, name?,            // create new session
                      workspaceType?, cloneUrl? }
session_connect     { sessionId, replay?: boolean }         // start watching (replay: false = skip buffer)
session_disconnect  { sessionId }                          // stop watching
session_input       { sessionId, text }                    // send prompt/message
session_interrupt   { sessionId }                          // Ctrl-C: halt current work
session_kill        { sessionId }                          // terminate session
session_permission  { sessionId, requestId, approved }     // respond to permission prompt

// Existing (kept for backward compat)
message             { id, to, body, subject? }
typing              { to, state }
```

### Server → Client

```
session_list        { sessions: ManagedSession[] }
session_created     { session: ManagedSession }
session_output      { sessionId, events: OutputEvent[] }   // structured output
session_raw         { sessionId, data: string }            // raw terminal bytes
session_status      { sessionId, status, activity? }
session_permission  { sessionId, requestId, action, details }
session_ended       { sessionId, reason }

// Existing (kept)
message, delivered, error, typing, etc.
```

### Output Events

```typescript
type OutputEvent =
  | { type: "message"; content: string }              // agent's text response
  | { type: "tool_use"; tool: string; input: any }     // tool being called
  | { type: "tool_result"; tool: string; output: string; truncated?: boolean }
  | { type: "status"; state: "thinking" | "working" | "idle" }
  | { type: "permission_request"; requestId: string; action: string; details: string }
  | { type: "error"; message: string }
  | { type: "raw"; data: string }                      // unparsed terminal output
```

---

## Project Management

### Project Model

```typescript
interface Project {
  id: string;
  name: string;
  path: string;               // absolute path on host
  gitRemote?: string;          // origin URL if git repo
  mode: "standalone" | "swarm" | "gastown";
  sessions: string[];          // active session IDs
  createdAt: Date;
}
```

Persisted to `~/.adjutant/projects.json`.

### Project Operations

**Create from existing directory**:
```
POST /api/projects { path: "/Users/me/code/myapp" }
```
- Validates path exists
- Detects if git repo
- Registers in projects.json

**Create by cloning**:
```
POST /api/projects { cloneUrl: "git@github.com:user/repo.git", name: "myapp" }
```
- Clones to `~/projects/<name>/` (configurable base dir)
- Registers in projects.json

**Create empty**:
```
POST /api/projects { name: "new-project", empty: true }
```
- Creates `~/projects/<name>/`
- `git init`
- Registers in projects.json

**List / Switch / Delete**:
```
GET /api/projects
POST /api/projects/:id/activate
DELETE /api/projects/:id          // only removes registration, not files
```

### Workspace Strategies

When creating multiple agent sessions for one project:

**Worktree** (default for swarm):
```bash
cd /path/to/project
git worktree add ../project-agent-1 -b agent-1
git worktree add ../project-agent-2 -b agent-2
```
- Lightweight, shared git history
- Agents see each other's committed work
- Easy merge via git

**Copy** (for isolated work):
```bash
cp -r /path/to/project /path/to/project-copy-1
cd /path/to/project-copy-1 && git checkout -b agent-1
```
- Full isolation
- Need coordinator/refinery to merge results
- Use when agents might make conflicting changes

**Primary** (single agent):
- Agent works directly in the project directory
- No workspace setup needed

---

## Mode Integration

### Standalone Mode

```
User opens Adjutant → selects/creates project → "Start Agent"
                                                      ↓
Backend creates tmux session: adj-<project>-agent
Backend starts Claude Code: claude --dangerously-skip-permissions (or configured)
Session Bridge attaches pipe-pane
iOS connects to session via WebSocket
User chats directly with the agent
```

Session lifecycle:
- Created when user taps "Start Agent"
- Runs until user taps "Stop Agent" or agent exits
- Session persists if iOS disconnects (tmux keeps it alive)
- iOS reconnects → replays buffer → live stream resumes

### Swarm Mode

```
User opens Adjutant → selects project → "Start Team"
                                              ↓
Backend creates N tmux sessions: adj-<project>-agent-1, agent-2, ...
Backend creates worktrees (or copies) for each
Each session gets Claude Code with its workspace
iOS shows agent list → tap to focus one agent
User can create/kill agents dynamically
```

Agent management:
- "Add Agent" → creates new worktree + tmux session
- "Remove Agent" → kills session, optionally removes worktree
- "Merge Results" → git merge agent branches back to main

Optional coordinator:
- One agent designated as coordinator
- Reviews and merges other agents' work
- Like a lightweight refinery

### Gas Town Mode

```
User opens Adjutant → connects to GT → sees crew list
                                              ↓
Backend discovers existing tmux sessions (mayor, polecats, etc.)
Registers them in SessionRegistry
iOS shows crew list → tap mayor to connect
Session Bridge attaches pipe-pane to mayor's tmux
User sees mayor's live output stream
User can type messages that go to mayor's stdin
```

GT-specific features:
- Auto-discover sessions via `gt agents list` + tmux ls
- Connect/disconnect without disrupting the agent's work
- Observe mode: watch without sending input
- Inject mode: type prompts into the agent's session
- Switch between agents (mayor → polecat → witness)
- Create new polecats via `gt sling`

---

## iOS/Frontend Changes

### Session-Based Chat View

Replace the current "mail-based" chat with a session-connected view:

```
┌──────────────────────────────────┐
│  AGENT: mayor           ◉ LIVE  │  ← connected to mayor's tmux
│──────────────────────────────────│
│                                  │
│  ⏺ Reading file: src/index.ts   │  ← tool use card (collapsible)
│  ┌──────────────────────────┐    │
│  │ 1: import express...     │    │
│  │ 2: const app = ...       │    │
│  └──────────────────────────┘    │
│                                  │
│  I see the issue. The route      │  ← agent message bubble
│  handler isn't awaiting the      │
│  async call on line 42.          │
│                                  │
│  ⏺ Editing: src/index.ts        │  ← another tool card
│  │ -  handler(req, res)          │
│  │ +  await handler(req, res)    │
│                                  │
│  Fixed. The handler is now       │
│  properly awaited.               │
│                                  │
│  ┌─────────────────┐            │
│  │ 📟 Terminal View │            │  ← toggle to raw terminal
│  └─────────────────┘            │
│──────────────────────────────────│
│  [Type a message...]        ⬆   │
└──────────────────────────────────┘
```

### Terminal Widget

When toggled to terminal view, render raw terminal output:
- Use a terminal emulator library (SwiftTerm for iOS, xterm.js for web)
- Shows exactly what you'd see in the tmux pane
- Input goes directly to tmux send-keys
- Full ANSI color support

### Agent Switcher

Sidebar or bottom sheet listing all active sessions:

```
┌─────────────────────┐
│  SESSIONS           │
│                     │
│  ◉ mayor     IDLE   │  ← tap to switch
│  ○ obsidian  WORK   │
│  ○ quartz    WORK   │
│  ○ jasper    IDLE   │
│                     │
│  [+ New Agent]      │
└─────────────────────┘
```

### Permission Handling

When an agent hits a permission prompt (configurable per-agent):

```
┌──────────────────────────────────┐
│  ⚠ PERMISSION REQUEST           │
│                                  │
│  agent-1 wants to:               │
│  Run: rm -rf node_modules/       │
│                                  │
│  [Deny]              [Allow]     │
└──────────────────────────────────┘
```

Backend detects the permission prompt in the output stream, pauses relay,
sends `session_permission` to iOS. iOS shows dialog. User responds. Backend
sends `y` or `n` via `tmux send-keys`.

### Project Management View

New top-level tab (or section in Settings):

```
┌──────────────────────────────────┐
│  PROJECTS                        │
│                                  │
│  📁 adjutant          3 agents   │
│  📁 my-app            1 agent    │
│  📁 api-server        stopped    │
│                                  │
│  [+ Clone Repo]                  │
│  [+ Open Directory]              │
│  [+ New Project]                 │
└──────────────────────────────────┘
```

Tap a project → see its agents, start/stop/add agents, switch modes.

---

## Implementation Phases

### Phase 1: Session Bridge Core

**Backend only. Get tmux ↔ WebSocket working.**

1. `SessionRegistry` — in-memory + file persistence
2. `SessionConnector` — `tmux pipe-pane` attachment, output streaming
3. `InputRouter` — `tmux send-keys` for input
4. `LifecycleManager` — create/kill tmux sessions with Claude Code
5. WebSocket protocol v2 — session_* message types
6. Basic output relay — raw terminal bytes, no parsing yet

**Deliverable**: Connect to an existing tmux session from a WebSocket client
(e.g., `websocat`) and see live output, send input.

### Phase 2: Output Parser

**Make the raw stream usable for a chat UI.**

1. ANSI escape code stripper
2. Claude Code output pattern recognizer:
   - Agent messages (text between tool calls)
   - Tool use markers (`⏺ Read`, `⏺ Edit`, `⏺ Bash`, etc.)
   - Tool results (indented output blocks)
   - Permission prompts
   - Status indicators (thinking, working)
3. Dual emission: structured events + raw bytes (client chooses)

**Deliverable**: WebSocket clients receive both `session_output` (structured)
and `session_raw` (terminal bytes) for the same session.

### Phase 3: iOS Chat Overhaul

**Replace mail-based chat with session-connected chat.**

1. New `SessionChatView` — connects to a session via WebSocket
2. Hybrid renderer — chat bubbles + collapsible tool cards
3. Terminal toggle — SwiftTerm widget for raw view
4. Input bar — sends to session, not to mail
5. Connection indicator — LIVE/BUFFERED/OFFLINE
6. Output replay on reconnect (from ring buffer)

**Deliverable**: Open Adjutant, tap an agent, see its live output, type prompts.

### Phase 4: Session Lifecycle

**Create, manage, and kill sessions from iOS.**

1. Project management API (`/api/projects`)
2. Session creation API — spawns tmux + claude
3. Workspace setup — worktrees, copies
4. iOS Project management view
5. Agent switcher sidebar
6. Start/stop agent controls

**Deliverable**: Create a project, start an agent, chat with it, stop it.
All from iOS.

### Phase 5: GT Integration

**Connect the Session Bridge to Gas Town.**

1. GT session discovery — scan tmux, cross-ref with `gt agents list`
2. Auto-register GT sessions in SessionRegistry
3. Attach/detach pipe-pane without disrupting running agents
4. Observe mode — read-only session connection
5. Inject mode — send input to GT agents
6. Polecat creation via `gt sling` from iOS
7. Crew view shows live session status

**Deliverable**: Connect to GT, see mayor's live stream, switch between agents.

### Phase 6: Swarm Mode

**Multi-agent orchestration without GT infrastructure.**

1. Swarm creation — N agents in worktrees for one project
2. Agent-to-agent communication (shared beads or file-based)
3. Coordinator pattern — designated merge agent
4. Dynamic scaling — add/remove agents from iOS
5. Branch merge UI — see agent branches, trigger merges

**Deliverable**: Spin up 3 agents on one project, watch them work in parallel,
merge results.

### Phase 7: Permission System & Polish

1. Per-agent permission configuration (auto-accept / manual)
2. Permission prompt detection in output parser
3. iOS permission dialog
4. Permission response routing
5. Session persistence across backend restarts
6. Bandwidth optimization (throttle raw output, delta compression)
7. Frontend (web) parity with iOS

---

## Technical Considerations

### tmux pipe-pane Performance
- `pipe-pane` captures all bytes written to the pane
- On a busy agent, this can be 10-100 KB/s of terminal output
- Backend should throttle/buffer for slow WebSocket clients
- Ring buffer (last 10,000 lines) for replay on reconnect

### ANSI Parsing
- Use a library like `ansi-to-html` or `strip-ansi` for chat mode
- For terminal mode, send raw bytes — let the terminal widget handle them
- Claude Code uses relatively simple ANSI (colors, bold) — no complex cursor movement

### Multiple Clients
- Multiple iOS devices can connect to the same session
- All clients see the same output (broadcast)
- Only one client can send input at a time (first-come lock, with steal option)
- "Observer" role for additional clients (read-only)

### Session Persistence
- tmux sessions survive iOS disconnect, backend restart, network drop
- Backend reconnects to tmux sessions on startup
- Output is lost during disconnection (tmux scrollback has some, but limited)
- Consider: `tmux pipe-pane` to a persistent log file for full history

### Resource Management
- Each Claude Code session uses ~100-500 MB RAM + API costs
- Set configurable max sessions (default: 10)
- Warn when approaching limit
- Idle timeout: optionally kill sessions after N minutes of no interaction

### Security
- All tmux operations use the backend's OS user
- API key auth still required for WebSocket
- Input sanitization: prevent tmux escape sequences in user input
- Rate limiting on session creation

---

## Migration from V1

V2 is **additive** — all V1 functionality continues to work:

- REST API unchanged
- Beads system unchanged
- Mail system unchanged
- SSE events unchanged
- Mode switching unchanged

New features layer on top:
- Session Bridge is a new service alongside existing ones
- WebSocket v2 messages coexist with v1 messages
- iOS gets new views but existing views still work
- GT mode gains session streaming without changing how GT operates

The old "mail-based chat" becomes a fallback for when session streaming
isn't available (e.g., agent not in tmux, or network constraints).

---

## Decisions

1. **No `stream-json` for now**: Parse raw terminal output directly. `stream-json`
   can be revisited later if terminal parsing proves too fragile. Terminal parsing
   is more universal and doesn't require special CLI flags.

2. **No Claude Code hooks for now**: Hooks could write structured events to a
   sidecar file (clean JSON, no ANSI parsing needed, no breakage if output format
   changes). However, they add per-session config, may not capture everything
   (thinking indicators, progress), and couple us to the hook API. Terminal
   parsing is simpler for V2. Hooks are a candidate for a later optimization pass.

3. **SwiftTerm for iOS terminal**: Use SwiftTerm for the terminal widget on first
   attempt. Verify it handles Claude Code's output volume and ANSI sequences.

4. **Input queued by default + interrupt**: User input is queued while agent is
   working. User has a "Stop" button (Ctrl-C) to interrupt the agent and reclaim
   the prompt. See Input Router section above.

5. **Cost/token tracking included**: See section below.

---

## Cost & Token Tracking

Each Claude Code session consumes API tokens. With multiple concurrent sessions,
costs can spike fast. Adjutant tracks and displays usage.

### Data Collection

Claude Code outputs cost/token info at the end of each session and periodically
during long sessions. The output parser captures these:

```
Raw terminal line                              →  Structured event
──────────────────────────────────────────────────────────────────
"Total tokens: 45,231 (input: 30,120...)"     →  { type: "cost_update", tokens: {...} }
"Cost: $0.42"                                  →  { type: "cost_update", cost: 0.42 }
```

Additionally, the backend can read Claude Code's cost data from:
- `~/.claude/usage.json` (if available)
- Session-level cost files
- Parsing the session summary output when a session ends

### Storage

```typescript
interface SessionCost {
  sessionId: string;
  projectId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCost: number;       // USD
  lastUpdated: Date;
}
```

Persisted to `~/.adjutant/costs.json`, aggregated per session and per project.

### Display

**Per-session**: Small cost badge next to the session name in the agent switcher.
```
◉ agent-1    WORKING    $0.42 | 45K tokens
```

**Per-project**: Total cost across all sessions in the project view.
```
📁 my-app    3 agents    $3.21 today | $14.50 total
```

**Cost alerts**: Configurable threshold. When a session or project exceeds the
threshold, show a warning notification on iOS.

### API

```
GET /api/costs                              // all costs
GET /api/costs?projectId=xxx                // per project
GET /api/costs?sessionId=xxx                // per session
GET /api/sessions/:id/cost                  // single session cost
```

Cost updates also stream via WebSocket:
```
{ type: "session_cost", sessionId: "abc", inputTokens: 30120, outputTokens: 15111, estimatedCost: 0.42 }
```
