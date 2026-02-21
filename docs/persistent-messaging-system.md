# Persistent Messaging System for Swarm Mode

**Epic**: adj-010
**Status**: Design
**Date**: 2026-02-21

---

## 1. Problem Statement

Adjutant's swarm mode has two broken communication channels:

1. **Chat** (session pipeline) — Real-time but ephemeral. Messages vanish when sessions die. No history survives backend restarts. The user loses all context when an agent session is recreated.

2. **Mail** (beads transport) — Persistent but heavyweight. Uses dolt under the hood, which crashes with SIGSEGV under concurrent access (adj-4qz). Designed for gastown mode's rig-based addressing, not swarm mode's flat agent model. Overkill for simple agent chat.

Neither channel provides what users actually need: **persistent, real-time messaging with full history**.

### What we're building

A unified messaging system that:
- Stores all user ↔ agent messages in a local database
- Survives session restarts — chat history is permanent
- Provides real-time delivery via existing WebSocket infrastructure
- Gives agents a simple HTTP API to send structured messages back to the user
- Replaces beads-based mail for swarm mode entirely
- Extends to store sessions, projects, agents, and preferences in the database

---

## 2. Database vs Filesystem Analysis

### Comparison

| Dimension | Filesystem (JSON) | Embedded Database (SQLite) |
|-----------|-------------------|---------------------------|
| **Data integrity** | No ACID. Async writes race. `MEDIUM-5: Registry Persistence Race` is a known bug. | Full ACID with WAL. Crash recovery built in. |
| **Concurrent access** | Dangerous. bd SIGSEGV crash (adj-4qz) is exhibit A. | SQLite WAL: concurrent reads + serialized writes. Battle-tested. |
| **Query capability** | Load entire file, Array.filter in JS. Breaks at scale. | Full SQL + FTS5 full-text search. Pagination, aggregation, joins. |
| **Performance at scale** | Degrades linearly — rewrites entire file on every mutation. 50k chat messages in one JSON file is not viable. | O(log n) reads with indexes. ~50k inserts/sec. Never a bottleneck. |
| **Schema evolution** | No enforcement. Manual JSON rewriting. | Formal migrations with version tracking. ALTER TABLE. |
| **Operational complexity** | Zero setup. Human-readable with `cat`. | Single file on disk. Inspect with `sqlite3` CLI. Backup is `cp`. |
| **Developer experience** | Excellent for prototyping. Every dev knows JSON. | Requires SQL knowledge. Better for complex queries. |
| **Portability** | Maximum. No native binaries. | `better-sqlite3` has prebuilt binaries for all major platforms. |

### Verdict

For small, rarely-written config (API keys, voice config, permissions) — JSON files are fine, keep them.

For **chat message history, session lifecycle, cost tracking, and project configuration** — JSON files become a liability within weeks of real usage. A multi-day swarm session with 5 agents produces thousands of records per hour. This data needs indexed queries, pagination, and efficient append-only writes.

### Technology Recommendation: SQLite via `better-sqlite3`

1. **Solves the exact problems we have.** Eliminates the registry persistence race condition. No SIGSEGV crashes.
2. **Synchronous API matches the codebase.** Services already use `readFileSync`/`writeFileSync`. `better-sqlite3` fits naturally.
3. **FTS5 enables chat search.** Full-text search across chat history is a single indexed query.
4. **Zero-server architecture.** A library, not a process. Single file at `~/.adjutant/adjutant.db`.
5. **Prebuilt binaries.** No compilation step for users. npm install downloads the right binary.
6. **Production-grade.** The most widely deployed database engine in the world.

Why NOT the others:
- `sql.js`: Slower (2-10x), manual disk sync
- LevelDB/RocksDB: Key-value only, no SQL, reimplementing queries in JS
- LowDB: Just JSON with a wrapper, doesn't solve concurrency or query problems
- DuckDB: OLAP engine, wrong workload
- PGlite: Too new, too heavy (~15MB WASM)

---

## 3. Schema Design

```sql
-- messages: Chat history between user and agents
CREATE TABLE messages (
  id          TEXT PRIMARY KEY,           -- UUID
  session_id  TEXT NOT NULL,              -- Links to sessions
  project_id  TEXT,                       -- Links to projects (nullable)
  role        TEXT NOT NULL,              -- 'user' | 'agent' | 'system'
  event_type  TEXT NOT NULL,              -- 'user_message' | 'agent_response' | 'status_update' | 'question' | 'completion' | 'error' | 'system' | 'permission_request' | 'permission_response'
  content     TEXT,                       -- Message body
  metadata    TEXT,                       -- JSON blob for event-specific data
  delivery_status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'delivered' | 'read' | 'failed'
  read_at     TEXT,                       -- Timestamp when read
  seq         INTEGER NOT NULL,           -- Sequence number within session
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_messages_session_time ON messages(session_id, created_at);
CREATE INDEX idx_messages_project ON messages(project_id, created_at);
CREATE INDEX idx_messages_event_type ON messages(event_type);

-- Full-text search
CREATE VIRTUAL TABLE messages_fts USING fts5(content, content=messages, content_rowid=rowid);

CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;

-- sessions: Agent session lifecycle
CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  tmux_session    TEXT NOT NULL,
  tmux_pane       TEXT NOT NULL,
  project_path    TEXT NOT NULL,
  mode            TEXT NOT NULL DEFAULT 'swarm',
  status          TEXT NOT NULL DEFAULT 'idle',
  workspace_type  TEXT NOT NULL DEFAULT 'primary',
  pipe_active     INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_activity   TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at        TEXT,
  end_reason      TEXT
);

CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_project ON sessions(project_path);

-- session_events: Lifecycle audit trail
CREATE TABLE session_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  details     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_session_events_session ON session_events(session_id, created_at);

-- projects: Project configuration and preferences
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  path        TEXT NOT NULL UNIQUE,
  git_remote  TEXT,
  mode        TEXT NOT NULL DEFAULT 'swarm',
  active      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_projects_active ON projects(active);

-- agents: Agent registry
CREATE TABLE agents (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  agent_type      TEXT NOT NULL,
  rig             TEXT,
  project_path    TEXT,
  session_id      TEXT,
  status          TEXT NOT NULL DEFAULT 'offline',
  capabilities    TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen       TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
);

CREATE INDEX idx_agents_status ON agents(status);

-- preferences: Extensible key-value store
CREATE TABLE preferences (
  key         TEXT NOT NULL,
  scope       TEXT NOT NULL DEFAULT 'global',
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (key, scope)
);

-- costs: Token usage tracking
CREATE TABLE costs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      TEXT NOT NULL,
  project_path    TEXT NOT NULL,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_read      INTEGER NOT NULL DEFAULT 0,
  cache_write     INTEGER NOT NULL DEFAULT 0,
  cost_usd        REAL NOT NULL DEFAULT 0,
  recorded_at     TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_costs_session ON costs(session_id, recorded_at);
CREATE INDEX idx_costs_project ON costs(project_path, recorded_at);

-- schema_version: Migration tracking
CREATE TABLE schema_version (
  version     INTEGER NOT NULL,
  applied_at  TEXT NOT NULL DEFAULT (datetime('now')),
  description TEXT
);
```

---

## 4. Messaging Architecture

### 4.1 Message Flow: User → Agent

```
User types message in Chat UI
  → Frontend sends via WebSocket or POST /api/messages
  → Backend receives message
  → Store in SQLite database (persistent)
  → Inject into agent's tmux pane via send-keys (existing)
  → Push confirmation to frontend via WebSocket
```

### 4.2 Message Flow: Agent → User

```
Agent decides to send a message
  → Agent calls: curl -s -X POST http://localhost:4201/api/messages \
       -H "Content-Type: application/json" \
       -d '{"sessionId":"$ADJUTANT_SESSION_ID","body":"...","type":"agent_response"}'
  → Backend receives, stores in database
  → Push to frontend via WebSocket EventBus
  → iOS push notification if no frontend connected
```

### 4.3 Why HTTP API for Agent → User

| Option | Reliability | Simplicity | Latency | Error Handling | Cross-Agent |
|--------|------------|------------|---------|----------------|-------------|
| **HTTP API (curl)** | High | Medium | ~1-5ms | Excellent (HTTP status) | High |
| CLI tool | High | Very High | ~5-10ms | Good | High |
| OutputParser detection | Low | Medium | 1.5s | Poor | Very Low |
| File watcher | Medium | High | 100-500ms | Poor | High |
| Unix socket | High | Low | <1ms | Complex | Medium |

**HTTP API wins.** The backend already has Express + Zod. The agent has Bash tool access. `curl` is universal. HTTP status codes provide acknowledgment. A CLI wrapper (`adj msg send`) can be added later for ergonomics.

### 4.4 Agent Startup Instructions

Place `.claude/rules/adjutant-messaging.md` in the project directory for Claude Code to auto-load:

```markdown
# Adjutant Messaging

When you need to communicate with the user, send a message via the Adjutant API:

\`\`\`bash
curl -s -X POST http://localhost:${ADJUTANT_API_PORT:-4201}/api/messages \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"'$ADJUTANT_SESSION_ID'","body":"Your message","type":"agent_response"}'
\`\`\`

Environment variable `ADJUTANT_SESSION_ID` is set automatically.

Send messages when you:
- Complete a major task or milestone
- Encounter a blocker or need user input
- Have a question requiring human judgment
- Finish all assigned work

Do NOT send messages for every tool call or intermediate step.
```

Inject `ADJUTANT_SESSION_ID` and `ADJUTANT_API_PORT` via `tmux set-environment` in `LifecycleManager.createSession()`.

### 4.5 Session Lifecycle and Message Continuity

- **Session dies**: Messages persist in SQLite. Session marked as `ended_at = now()`.
- **History access**: `GET /api/messages?sessionId=X` works for dead sessions.
- **New session**: Gets new UUID. Old messages remain queryable.
- **Context injection**: On session recreation, inject last 5 messages from previous session as context summary.

---

## 5. Frontend UI Architecture

### 5.1 Chat View State Machine

```
                         +---------------------+
                         |   NO_SESSIONS       |
                         | (empty state)       |
                         +---------------------+
                               |  agent comes online
                               v
+-------------------+    +---------------------+    +-------------------+
|   HISTORY_VIEW    |<-->|   ACTIVE_CHAT       |<-->|  FULL_SESSION     |
| (read-only msgs)  |    | (messages+realtime) |    | (raw terminal)    |
+-------------------+    +---------------------+    +-------------------+
                               |  agent disconnects
                               v
                         +---------------------+
                         |   DISCONNECTED      |
                         | (last msgs, offline)|
                         +---------------------+
```

### 5.2 Web Component Tree

```
ChatTab                          [NEW - top-level orchestrator]
  ├── ChatHeader                 [EXTRACTED from CommandChat]
  │     ├── agent selector dropdown (existing)
  │     ├── connection status badge
  │     ├── [HISTORY] button     [NEW]
  │     └── [FULL] button        [NEW]
  ├── ChatMessages               [EXTRACTED]
  │     ├── ChatBubble           [NEW - user/agent messages]
  │     ├── SystemMessage        [NEW - session events]
  │     └── StreamingBubble      [NEW]
  ├── ChatInput                  [EXTRACTED]
  ├── HistoryPanel               [NEW - slide-over]
  │     └── HistorySessionRow    [NEW]
  ├── FullSessionOverlay         [NEW - wraps TerminalPane]
  └── SessionEndedBanner         [NEW]
```

### 5.3 iOS Component Tree

```
PersistentChatView               [NEW - replaces ChatView/UnifiedChatView]
  ├── ChatHeader                 [REFACTORED - unified]
  │     ├── AgentSelector
  │     ├── ConnectionStatusBadge
  │     ├── HistoryButton        [NEW]
  │     └── FullButton
  ├── PersistentMessagesArea     [NEW]
  │     ├── ChatBubble           [EXISTING]
  │     ├── SystemEventBubble    [NEW]
  │     └── StreamingBubble
  ├── ChatInputView              [EXISTING]
  ├── .sheet → HistorySheet      [NEW]
  ├── .fullScreenCover → SessionChatView [EXISTING]
  └── SessionEndedOverlay        [NEW]
```

### 5.4 API Contracts

```
GET    /api/messages?sessionId=X&limit=50&before=<cursor>  -- Paginated messages
GET    /api/messages/sessions?status=all                    -- Session list with previews
POST   /api/messages                                        -- Send message
PATCH  /api/messages/:id/read                               -- Mark read
GET    /api/sessions/:id/unread                             -- Unread count
GET    /api/messages/search?q=<text>                        -- Full-text search (FTS5)
```

WebSocket events (new):
- Server → Client: `chat_message`, `session_event`
- Client → Server: `message_send`, `chat_subscribe`, `chat_unsubscribe`

---

## 6. Migration Strategy

### Phase 0: Database Infrastructure (Week 1)
- Create `database.ts` singleton (open/migrate `~/.adjutant/adjutant.db`)
- Create migration runner + `001-initial.sql`
- Add `better-sqlite3` dependency
- WAL mode, PRAGMA tuning

### Phase 1: Message Persistence (Week 1-2)
- Create `message-store.ts` service
- Create `/api/messages` routes
- Bridge OutputParser events → MessageStore (write-behind)
- Bridge `sendInput` → MessageStore
- WebSocket `chat_message` broadcasting

### Phase 2: Agent Communication (Week 2)
- Inject `ADJUTANT_SESSION_ID` env var in session creation
- Create `.claude/rules/adjutant-messaging.md`
- POST /api/messages endpoint for agent-originated messages
- APNS push for offline delivery

### Phase 3: Frontend (Week 2-3)
- Extract ChatBubble, ChatMessages, ChatHeader, ChatInput components
- Create ChatTab with view state machine
- Create useChatMessages hook
- Create HistoryPanel + useChatHistory
- Create FullSessionOverlay

### Phase 4: iOS (Week 3)
- Create PersistentChatView + PersistentChatViewModel
- Create HistorySheet + HistoryViewModel
- Wire to /api/messages endpoints
- APNS integration for agent responses

### Phase 5: Session & Cost Migration (Week 3-4)
- Migrate session-registry.ts from JSON to database
- Migrate cost-tracker.ts from JSON to database
- Migrate projects-service.ts from JSON to database
- Old JSON files renamed to `.migrated`, not deleted

### Phase 6: Cleanup (Week 4)
- Remove beads-based mail for swarm mode
- Remove JSON fallback code paths
- Add backup command
- Update tests to use in-memory SQLite

### Rollback Safety

Each phase maintains backward compatibility:
- Phase 0-1: JSON files still exist and are still written
- Phase 2-3: Database is write-behind secondary store
- Phase 4-5: `ADJUTANT_USE_JSON=1` env var forces old code path
- Phase 6: JSON fallback removed only after one stable release cycle

---

## 7. What This Replaces

| Current System | Replacement | When |
|---------------|-------------|------|
| Beads-based mail (adj-009) for swarm mode | Database-backed messaging | Phase 1-2 |
| Ephemeral chat (session pipeline only) | Persistent chat + session pipeline | Phase 1 |
| sessions.json | SQLite sessions table | Phase 5 |
| costs.json | SQLite costs table | Phase 5 |
| projects.json | SQLite projects table | Phase 5 |

The session pipeline (capture-pane, OutputParser, raw terminal output) **continues unchanged**. The "FULL SESSION" view still uses it. The new messaging system is an additional persistence layer, not a replacement for real-time terminal streaming.

---

## 8. Open Questions

### Q1: Should we keep beads-mail as a fallback?
**Recommendation**: No. The new messaging system fully replaces it for swarm mode. Gastown mode continues using GasTownTransport/BeadsTransport unchanged.

### Q2: Database location?
**Recommendation**: `~/.adjutant/adjutant.db`. Single file, easy to backup, same directory as existing JSON files.

### Q3: Message retention policy?
**Recommendation**: Keep everything. SQLite handles millions of rows efficiently. Add a manual cleanup command later if needed.

### Q4: Should agents auto-check for messages?
**Recommendation**: Not needed. The HTTP API provides acknowledgment. The tmux nudge mechanism (from adj-009.1) can be repurposed to notify agents of incoming messages if needed later.
