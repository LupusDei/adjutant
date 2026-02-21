# Beads-Based Mail for Swarm Mode Agents

**Epic**: adj-009
**Status**: Design
**Author**: mail-planner
**Date**: 2026-02-20

---

## 1. Problem Statement

### What breaks today

In swarm mode, Adjutant communicates with tmux-based agent sessions through a **session pipeline**: `tmux pipe-pane` captures agent output, and `tmux send-keys` delivers user input. This pipeline is the sole communication channel between the dashboard and agents.

The session pipeline is fragile in practice:

1. **Pipe-pane disconnects** -- tmux pipe-pane can silently stop forwarding output when the pane is resized, restarted, or when the buffer fills up. The `SessionConnector` already has retry logic (`connectClient` retries attach up to 3 times) because this happens regularly.

2. **Pane identity drift** -- when a tmux session is killed and recreated, the pane reference stored in `SessionRegistry` becomes stale. The `LifecycleManager.isAlive()` method auto-heals stale pane references, but during the healing window, communication is broken.

3. **No offline delivery** -- if an agent's tmux session is not running when you send a message, the message is lost. There is no queue or store-and-forward mechanism.

4. **No history** -- the session pipeline is ephemeral. Once a tmux pane scrollback buffer is cleared or the session is recreated, all conversation history is gone. The `OutputParser` processes events in real time with no persistence.

5. **Race conditions** -- recent commit `e6e6d56` ("fix: session pipeline race condition -- wait for pane readiness + retry") demonstrates that the pipeline has timing-sensitive failure modes.

### The analogy

The session pipeline is **instant messaging** -- real-time, synchronous, but unreliable. What we need is **email** -- asynchronous, persistent, and guaranteed delivery. Not a replacement for chat, but a backup channel that works when chat doesn't.

### Why beads

The beads system (`bd` CLI) already provides:
- Persistent, file-based storage
- Unique IDs for every item
- Labels for metadata (threading, sender, read status)
- Type-based filtering (`--type message`)
- A proven transport for gastown mode mail (the `GasTownTransport` and `BeadsTransport` already exist)

The swarm mode `BeadsTransport` is **already implemented** and fully functional. The problem is not the transport layer -- it's that the Mail tab in the UI is not connected to agents in swarm mode in a useful way, and agents have no way to discover or respond to mail messages.

---

## 2. How Gastown Mail Works (Reference)

In gastown mode, the mail system works through a layered abstraction:

### Transport layer

```
GasTownTransport (gastown-transport.ts)
├── sendMessage()
│   ├── Try: gt mail send <to> -s <subject> -m <body>
│   │   └── gt mail handles: bead creation, thread management, tmux nudge
│   ├── Fallback: bd create --type message --assignee <to> --labels from:<from>,thread:<id>
│   └── Notifications: TmuxNotificationProvider + APNS push
├── listMail()
│   └── bd list --type message --all --json → filter by identity
├── getMessage()
│   └── bd show <id> --json
└── markRead()
    └── bd label add <id> read
```

### Data model (beads issues)

Each mail message is a beads issue with:
- **type**: `message`
- **title**: message subject
- **description**: message body
- **assignee**: recipient identity (e.g., `mayor/`, `overseer`)
- **priority**: 0-4 (maps to MessagePriority)
- **labels**: metadata encoded as label strings:
  - `from:<sender>` -- sender identity
  - `thread:<threadId>` -- thread grouping (format: `thread-<12 hex chars>`)
  - `reply-to:<messageId>` -- parent message reference
  - `msg-type:<type>` -- notification, task, scavenge, reply
  - `cc:<address>` -- additional recipients
  - `read` -- marks message as read
- **status**: `open` (unread/active), `hooked` (being processed), `closed` (archived)

### Identity system

- `overseer` -- the human user in gastown mode
- `mayor/` -- the Mayor agent
- `deacon/` -- the Deacon agent
- `<rig>/<role>` or `<rig>/<name>` -- rig-level agents (e.g., `greenplace/Toast`)

### Notification flow

When a message is sent via `gt mail send`:
1. A bead is created with type=message
2. `TmuxNotificationProvider` injects a nudge into the recipient's tmux session
3. APNS push notification is sent for mobile clients
4. The `EventBus` emits `mail:received` for SSE consumers

### Frontend consumption

The `useMail` hook polls `GET /api/mail?all=true` every 60 seconds. Messages are grouped by `threadId` for conversation view. The `MailView` component renders a split-pane inbox with message list on the left and detail/compose on the right.

---

## 3. Proposed Architecture

### Key insight: BeadsTransport already exists

The `BeadsTransport` class in `backend/src/services/transport/beads-transport.ts` already implements the full `MailTransport` interface for swarm mode. It:
- Creates beads with `type=message` via `bd create`
- Lists mail via `bd list --type message --all --json`
- Gets single messages via `bd show <id> --json`
- Marks messages as read via `bd label add <id> read`
- Manages threads with `thread:<id>` labels
- Tracks sender with `from:<identity>` labels

**The transport layer is done.** What's missing is:

### 3.1 Agent-side mail checking

Agents in tmux sessions need a way to:
1. **Discover** that they have new mail
2. **Read** their mail
3. **Reply** to mail

In gastown mode, the `TmuxNotificationProvider` nudges agents by injecting text into their tmux session. In swarm mode, we need an equivalent mechanism.

**Proposed approach: Tmux notification for swarm agents**

When a message is sent to a swarm agent, inject a notification into their tmux pane:

```
You have new mail. Subject: "<subject>" from <sender>. To read: bd list --type message --assignee <agent-name> --json
```

This reuses the same `tmux send-keys` mechanism that gastown's `TmuxNotificationProvider` uses, but adapted for swarm agent identities.

### 3.2 SwarmMailNotificationProvider

A new notification provider that maps agent names to tmux sessions:

```typescript
class SwarmMailNotificationProvider implements NotificationProvider {
  readonly name = "swarm-tmux";

  async notifyNewMail(to: string, from: string, subject: string): Promise<void> {
    // 1. Look up the agent's tmux session via SessionRegistry
    const bridge = getSessionBridge();
    const sessions = bridge.listSessions();
    const agentSession = sessions.find(s => s.name === to || s.id === to);

    if (!agentSession) return; // Agent not found or offline

    // 2. Inject notification into the tmux pane
    const message = `You have new mail from ${from}. Subject: "${subject}". Check with: bd list --type message --assignee ${to} --json`;
    await nudgeSession(`${agentSession.tmuxSession}:${agentSession.tmuxPane}`, message);
  }
}
```

### 3.3 Updated BeadsTransport with notifications

The current `BeadsTransport.sendMessage()` has a comment: "In swarm mode, no tmux notifications." We update it to use `SwarmMailNotificationProvider`:

```typescript
// In BeadsTransport.sendMessage(), after successful bd create:
if (notificationProvider) {
  void notificationProvider.notifyNewMail(
    options.to,
    fromIdentity,
    options.subject
  );
}
```

### 3.4 Agent addressing in swarm mode

In swarm mode, agents are identified by their session name (e.g., `adjutant`, `researcher`, `coder`). The addressing scheme:

| Address | Meaning |
|---------|---------|
| `user` | The human operator |
| `<session-name>` | An agent in a tmux session |

This maps cleanly to the existing `BeadsTransport.getSenderIdentity()` which returns `MAIL_IDENTITY` env var or defaults to `"user"`.

### 3.5 Message flow

#### User sends message to agent (via Mail tab)

```
User clicks SEND in ComposeMessage
  → POST /api/mail { to: "researcher", subject: "...", body: "..." }
  → mail-service.sendMail()
  → BeadsTransport.sendMessage()
    → bd create "subject" --type message --assignee researcher -d "body" --labels from:user,thread:thread-xxx
    → SwarmMailNotificationProvider.notifyNewMail()
      → tmux send-keys -t researcher:0 -l "You have new mail..."
      → tmux send-keys -t researcher:0 Enter
  → EventBus.emit("mail:received")
```

#### Agent reads and replies to mail

The agent (Claude Code or similar) receives the tmux nudge and can:

```bash
# List unread mail
bd list --type message --assignee researcher --json

# Read a specific message
bd show <message-id> --json

# Reply
bd create "RE: subject" --type message --assignee user -d "reply body" \
  --labels from:researcher,thread:<thread-id>,reply-to:<original-id>,msg-type:reply \
  --actor researcher
```

#### User sees agent's reply (via Mail tab polling)

```
useMail polling (every 60s)
  → GET /api/mail?all=true
  → mail-service.listMail()
  → BeadsTransport.listMail()
    → bd list --type message --all --json
    → Filter by identity "user"
  → Response includes agent's reply
  → UI groups by threadId, shows conversation
```

---

## 4. Data Model

### 4.1 Message bead structure

```
BeadsIssue {
  id: "adj-m-<hash>"          // Auto-generated bead ID
  title: "Subject line"        // Message subject
  description: "Message body"  // Full message content
  status: "open"               // open = unread/active, closed = archived
  priority: 2                  // 0=urgent, 1=high, 2=normal, 3=low, 4=lowest
  issue_type: "message"        // Always "message" for mail
  created_at: "2026-02-20T..."  // Timestamp
  assignee: "researcher"       // Recipient identity
  labels: [
    "from:user",               // Sender
    "thread:thread-a1b2c3d4e5f6", // Thread grouping
    "msg-type:task",           // Message type
    // Optional:
    "reply-to:adj-m-<hash>",   // Parent message ID
    "cc:coder",                // Additional recipient
    "read",                    // Read marker
  ]
}
```

### 4.2 Threading and conversation tracking

Threads are tracked via the `thread:<id>` label. The existing implementation:

1. **New conversation**: `generateThreadId()` creates `thread-<12 random hex chars>`
2. **Reply**: `resolveThreadId()` looks up the parent message's thread ID and reuses it
3. **Thread view**: `useMail` groups messages by `threadId` for conversation display

This is already implemented in both `GasTownTransport` and `BeadsTransport`. No changes needed.

### 4.3 Agent addressing

In swarm mode, agent addresses are flat strings (no rig hierarchy):

```typescript
// Swarm addressing
"user"         // Human operator (default sender from UI)
"researcher"   // Agent session named "researcher"
"coder"        // Agent session named "coder"
"adjutant"     // The project's primary session

// vs. Gastown addressing
"overseer"     // Human operator
"mayor/"       // Mayor agent
"greenplace/Toast" // Rig crew member
```

The `BeadsTransport` already handles this correctly. The `addressToIdentity()` function in `gastown-utils.ts` passes through simple identifiers unchanged.

---

## 5. Integration Points

### 5.1 Backend changes

#### New file: `SwarmMailNotificationProvider`

Add to `backend/src/services/transport/notification-providers.ts`:

```typescript
export class SwarmMailNotificationProvider implements NotificationProvider {
  readonly name = "swarm-tmux";

  async notifyNewMail(to: string, from: string, subject: string): Promise<void> {
    // Import SessionBridge lazily to avoid circular deps
    const { getSessionBridge } = await import("../session-bridge.js");
    const bridge = getSessionBridge();
    const sessions = bridge.listSessions();
    const agentSession = sessions.find(
      s => s.name === to || s.name.endsWith(`-${to}`)
    );

    if (!agentSession || agentSession.status === "offline") return;

    const target = `${agentSession.tmuxSession}:${agentSession.tmuxPane}`;
    const message = `You have new mail from ${from}. Subject: "${subject}". ` +
                    `To read: bd list --type message --assignee ${to} --json`;

    await nudgeSession(target, message);
  }
}
```

#### Modify: `BeadsTransport.sendMessage()`

Add notification after successful send:

```typescript
// After successful bd create in sendMessage():
const provider = new SwarmMailNotificationProvider();
void provider.notifyNewMail(options.to, fromIdentity, options.subject);
```

#### No changes needed to:

- `mail-service.ts` -- already delegates to transport
- `mail-transport.ts` -- interface unchanged
- `mail.ts` (routes) -- API unchanged
- `bd-client.ts` -- bead operations unchanged
- `gastown-utils.ts` -- identity/label parsing unchanged
- `mail-data.ts` -- mail listing unchanged

### 5.2 Frontend changes

#### Mail tab: Already works

The Mail tab (`MailView.tsx`, `MailList.tsx`, `MailDetail.tsx`, `ComposeMessage.tsx`) is mode-agnostic. It calls `useMail()` which calls `api.mail.list()` / `api.mail.send()` which hits the backend `/api/mail` endpoints. The backend routes delegate to `mail-service.ts` which uses `getTransport()` to get the mode-appropriate transport.

In swarm mode, `getTransport()` returns `BeadsTransport`. The Mail tab already works.

#### RecipientSelector: Minor enhancement

The `RecipientSelector` already handles swarm mode by adding a `"user"` special recipient. It fetches agents via `api.agents.list()` which in swarm mode returns tmux session agents. Each agent's `id` (session name) is used as the mail address.

**No frontend changes required** for the mail flow itself.

#### Chat tab: No changes

The Chat tab (`CommandChat.tsx`) uses the session pipeline (WebSocket + SessionBridge). It is completely separate from the Mail tab and is not affected.

### 5.3 iOS changes

#### MailListView / MailListViewModel: Already works

The iOS `MailListViewModel` fetches from the same `/api/mail` endpoint. Since the backend handles mode switching transparently, the iOS mail views work in both modes without changes.

The `MailDetailView` displays message headers (FROM, TO, DATE, PRIORITY, TYPE), thread history, message body, and action buttons (REPLY, PLAY audio). All of these work with the existing `Message` type returned by the API.

**No iOS changes required.**

### 5.4 EventBus integration

The `mail-service.ts` already emits `mail:received` on the EventBus after a successful send. This triggers SSE updates for connected clients. This works in both modes since `sendMail()` calls `getEventBus().emit("mail:received", ...)` regardless of transport.

---

## 6. What Stays the Same

### Chat feature (UNCHANGED)

- `SessionBridge` + `SessionConnector` + `InputRouter` continue to handle real-time chat
- WebSocket streaming via `pipe-pane` and `capture-pane` polling is unaffected
- `CommandChat.tsx` / `MayorChat.tsx` frontends are not modified
- The session pipeline remains the primary communication channel for interactive work

### Session feature (UNCHANGED)

- `SessionRegistry` + `LifecycleManager` continue managing tmux sessions
- Session creation, listing, killing are not modified
- Session persistence and auto-healing are not modified

### This is ONLY about the Mail tab

The Mail tab becomes a reliable backup channel. If the session pipeline is broken:
1. User opens Mail tab, composes a message to the agent
2. Message is stored as a bead (persistent, never lost)
3. Agent receives tmux notification about new mail
4. Agent reads mail via `bd list`/`bd show`, replies via `bd create`
5. User sees reply in Mail tab on next poll

Even if the tmux notification fails (because the session is momentarily unavailable), the bead persists. The agent can discover it later when checking mail.

---

## 7. Beads Hierarchy

### Epic structure

```
adj-009 [EPIC] Beads-based mail for swarm agent communication
├── adj-009.1 [TASK] Add SwarmMailNotificationProvider
│   - Implement NotificationProvider that maps agent names to tmux sessions
│   - Uses SessionBridge.listSessions() for session lookup
│   - Injects bd CLI instructions into tmux pane
│   - Tests: mock SessionBridge, verify tmux send-keys args
│
├── adj-009.2 [TASK] Wire notifications into BeadsTransport
│   - Update BeadsTransport.sendMessage() to use SwarmMailNotificationProvider
│   - Lazy import to avoid circular dependencies
│   - Tests: verify notification is called after successful send
│
├── adj-009.3 [TASK] Agent mail reply instructions
│   - Add reply instructions to swarm agent notifications
│   - Include bd create command template with correct labels/threading
│   - Document agent-side mail workflow
│   - Tests: verify notification message format
│
├── adj-009.4 [TASK] RecipientSelector swarm agent discovery
│   - Verify RecipientSelector shows all active tmux agents
│   - Ensure session names map correctly to mail addresses
│   - Test: compose message to discovered agent
│
├── adj-009.5 [TASK] End-to-end integration test
│   - Test: send mail from UI to agent, agent reads via bd, agent replies, UI sees reply
│   - Test: mail works when session pipeline is disconnected
│   - Test: mail persists across session restarts
│
└── adj-009.6 [TASK] Documentation
    - Update CLAUDE.md or relevant docs with swarm mail usage
    - Document agent-side bd commands for mail
    - Add troubleshooting guide for mail delivery
```

### Dependencies

```
adj-009.2 depends on adj-009.1 (transport needs provider)
adj-009.3 depends on adj-009.1 (notification format)
adj-009.4 is independent (can run in parallel)
adj-009.5 depends on adj-009.1, adj-009.2, adj-009.3 (needs full stack)
adj-009.6 depends on adj-009.5 (document tested behavior)
```

---

## 8. Open Questions

### Q1: Should agents auto-check mail on a schedule?

Currently, agents only learn about mail when nudged via tmux notification. Should we provide a `bd` wrapper or cron-like mechanism for agents to periodically check their inbox?

**Recommendation**: Start with notification-only. Agents (Claude Code instances) are responsive to tmux input. If notifications prove unreliable, add a mail-check hook to agent startup scripts.

### Q2: Mail identity for swarm agents

How do agents know their own identity for the `from:` label when replying? Options:
- **Environment variable**: Set `MAIL_IDENTITY=researcher` in the tmux session environment
- **Session name**: Derive from tmux session name (the SessionBridge already has this)
- **Bead actor**: Use `BD_ACTOR` env var (already used by BeadsTransport)

**Recommendation**: Use `BD_ACTOR` or `MAIL_IDENTITY` environment variable, set when the tmux session is created by `LifecycleManager`.

### Q3: Shared beads database location

In gastown mode, beads live in `~/gt/.beads/` (the town beads dir). In swarm mode, where should mail beads live?

**Current behavior**: `resolveWorkspaceRoot()` returns the project root. `resolveBeadsDir()` looks for `.beads/` in that root and follows any `redirect` file. The `SwarmProvider` resolves to the project's `.beads/` directory.

**Recommendation**: Keep current behavior. All agents in a swarm share the same project root and therefore the same `.beads/` directory. This is exactly what we want -- shared mailbox.

### Q4: Message cleanup / archival

Mail beads accumulate over time. Should we auto-close messages after a period?

**Recommendation**: Defer. The existing `listMailIssues()` filters for `open` and `hooked` status, so closed messages are already excluded from listings. Manual archival (close bead) works fine for now.

### Q5: Notification deduplication

If a user sends multiple messages quickly, the agent might receive a storm of tmux notifications. Should we debounce?

**Recommendation**: Not for v1. The existing gastown mode doesn't debounce either. If it becomes a problem, add a simple timestamp check (don't nudge same session within 5 seconds).

### Q6: How does this interact with the APNS push notification path?

The `BeadsTransport` currently doesn't send APNS push notifications. Should swarm mail trigger push?

**Recommendation**: Yes, add `sendNewMailNotification()` to the swarm send path. This ensures iOS users get notified about agent replies even when not actively viewing the dashboard. The `apns-service.ts` is already imported by `GasTownTransport` -- just add the same call to `BeadsTransport`.

---

## Summary of Required Changes

| Component | Change | Effort |
|-----------|--------|--------|
| `notification-providers.ts` | Add `SwarmMailNotificationProvider` | Small |
| `beads-transport.ts` | Wire notification provider after send | Small |
| `beads-transport.ts` | Add APNS push notification | Small |
| Frontend | None (already works) | None |
| iOS | None (already works) | None |
| Routes | None (already works) | None |
| Mail service | None (already works) | None |

**Total estimated effort**: 1-2 days of implementation + testing.

The architecture is intentionally minimal because the existing abstractions (`MailTransport`, `BeadsTransport`, `NotificationProvider`) already handle 90% of the work. The only gap is notification delivery to swarm agents.
