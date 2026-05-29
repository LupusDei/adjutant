# Plan: Adjutant Chat / Messaging Overhaul

**Root epic**: `adj-164`
**Spec**: `specs/055-chat-messaging-overhaul/spec.md`

---

## 1. Architecture Overview

### The unified conversation model (keystone)

```
conversations
  id            TEXT PK           -- uuid; DM ids derived deterministically from member pair
  kind          TEXT              -- 'dm' | 'channel'
  title         TEXT              -- channel name; null/derived for dm
  archived      INTEGER DEFAULT 0
  created_at    TEXT
  updated_at    TEXT

conversation_members
  conversation_id TEXT FK
  member_id       TEXT            -- 'user' or agent name (agent id resolved server-side)
  member_kind     TEXT            -- 'user' | 'agent'
  role            TEXT            -- 'member' | 'owner'
  joined_at       TEXT
  last_read_at    TEXT
  PRIMARY KEY (conversation_id, member_id)

messages
  + conversation_id TEXT FK       -- NEW; every new message sets it
  (existing columns unchanged; thread_id retained for back-compat/backfill)
```

- **DM** = `kind='dm'`, exactly two members (`user` + one agent). Deterministic id so a
  given pair always maps to the same conversation (lookup-or-create).
- **Channel** = `kind='channel'`, title, N members.
- `messages.conversation_id` is the single source of conversation scoping. The legacy
  `(agent_id OR recipient)` query path is retired for reads (kept only behind the
  backfill).

### Layered backend (Rule 4)

```
routes/conversations.ts        HTTP for conversations + channels
   ↓
services/conversation-store.ts business logic: conversations, members, channels
services/message-store.ts      extended: conversation_id insert + conversationId filter
   ↓
services/database.ts           migration + backfill
services/ws-server.ts          room-scoped fan-out (membership-resolved)
services/mcp-tools/channels.ts MCP tools for channels (+ send_message extension)
```

### Real-time fan-out

`wsBroadcast(msg)` (blasts all authenticated clients) is replaced for chat by
`wsBroadcastToConversation(conversationId, msg)`:
1. resolve conversation members via `conversation-store`,
2. send only to clients whose authenticated identity is a member AND who have an active
   subscription to that conversation (`WsClient.subscriptions: Set<string>`),
3. user client auto-subscribes to all its conversations on connect.

### Frontend (web)

- `useChatMessages(agentId)` → resolves the DM conversation id, fetches
  `/api/conversations/:id/messages`, scopes WS by `conversationId`.
- `CommandChat.tsx` `renderMessage` spacing/alignment/auto-scroll fix (raynor's ~20 lines).
- New `useChannels`, `ChannelList`, `ChannelView` reuse `MessageBubble` + virtualization.

### iOS

- `APIClient+Conversations.swift` / `APIClient+Channels.swift`; `conversationId` on models.
- `ChatViewModel` scopes by conversation; `WebSocketClient` filters/subscribes by conversation.
- New `ChannelListView`, `ChannelView`, `ChannelViewModel`.
- **SPM**: all new files auto-discovered — NO `.pbxproj` edits for files under `Adjutant/`.

## 2. Phases (= sub-epics)

| Phase | Sub-epic | Title | Priority | Depends on |
|---|---|---|---|---|
| 1 | adj-164.1 | Foundational: Unified Conversation Model (backend) | P0 | — |
| 2 | adj-164.2 | US1: DM Cleanup + Bleed Fix — Web | P0 | .1 |
| 3 | adj-164.3 | US2: DM Cleanup + Bleed Fix — iOS | P0 | .1 |
| 4 | adj-164.4 | US3: Channels Backend | P1 | .1 |
| 5 | adj-164.5 | US4: Channels — Web UI | P1 | .4 |
| 6 | adj-164.6 | US5: Channels — iOS UI | P1 | .4 |
| 7 | adj-164.7 | US6: Cross-platform Polish | P2 | .2, .3, .5, .6 |

## 3. Parallelization & Sequencing

```
        ┌─────────────── adj-164.1 (Foundational backend) ───────────────┐
        │  MUST merge to main before platform lanes branch (stale-branch  │
        │  conflict avoidance — see MEMORY adj-yzvk)                      │
        └────────────────────────────────────────────────────────────────┘
                 │                    │                    │
        ┌────────┴───────┐   ┌────────┴───────┐   ┌────────┴─────────┐
        │ adj-164.2 Web  │   │ adj-164.3 iOS  │   │ adj-164.4        │
        │ DM cleanup     │   │ DM cleanup     │   │ Channels backend │
        └────────────────┘   └────────────────┘   └────────┬─────────┘
                                                  ┌──────────┴──────────┐
                                          ┌───────┴──────┐   ┌──────────┴───────┐
                                          │ adj-164.5    │   │ adj-164.6        │
                                          │ Channels Web │   │ Channels iOS     │
                                          └───────┬──────┘   └──────────┬───────┘
                                                  └──────────┬──────────┘
                                                    ┌────────┴────────┐
                                                    │ adj-164.7 Polish │
                                                    └──────────────────┘
```

- **Lane A (backend)**: .1 → .4 → (.5/.6 are UI, see below).
- **Lane B (web)**: DM cleanup (.2) after .1; channels web (.5) after .4.
- **Lane C (iOS)**: DM cleanup (.3) after .1; channels iOS (.6) after .4.
- After .1 merges: .2, .3, .4 run **in parallel** (3 agents).
- After .4 merges: .5, .6 run **in parallel** (2 agents).
- Worktree isolation MANDATORY for all teammate spawns (Rule 7).

## 4. Suggested Squad

- 1× **backend engineer** — owns .1 then .4 (the spine).
- 1× **web engineer** — owns .2 then .5 (uses `frontend-design` skill).
- 1× **iOS engineer** — owns .3 then .6 (SPM-aware).
- 1× **QA sentinel** — bleed regression + room-isolation + E2E (.7 cross-cutting).
- Squad leader (coordinator) merges from main repo, sequences lanes per the diagram.

## 5. Bead Map

*(Populated in Phase 4 after beads are created — see beads-import.md for the authoritative
T-ID ↔ bead-ID table.)*

- `adj-164` — Root epic: Adjutant Chat / Messaging Overhaul
  - `adj-164.1` — Foundational: Unified Conversation Model (backend)
    - `adj-164.1.1` — Migration: conversations + conversation_members + messages.conversation_id
    - `adj-164.1.2` — conversation-store.ts (conversations + members + dm lookup-or-create)
    - `adj-164.1.3` — message-store conversationId insert + filter (retire bleed path)
    - `adj-164.1.4` — Reversible backfill of existing messages → DM conversations
    - `adj-164.1.5` — REST: GET /api/conversations, GET /api/conversations/:id/messages
  - `adj-164.2` — US1: DM Cleanup + Bleed Fix — Web
    - `adj-164.2.1` — useChatMessages scoped by conversationId
    - `adj-164.2.2` — renderMessage spacing/alignment/auto-scroll fix
    - `adj-164.2.3` — Bleed regression + remove stale agent-scoped filtering
    - `adj-164.2.4` — WS real-time scoped to conversation
  - `adj-164.3` — US2: DM Cleanup + Bleed Fix — iOS
    - `adj-164.3.1` — APIClient conversations + conversationId on models
    - `adj-164.3.2` — ChatViewModel conversation scoping + dedup (bleed fix)
    - `adj-164.3.3` — ChatView/ChatBubble spacing/alignment + auto-scroll
    - `adj-164.3.4` — WebSocketClient conversation-filtered delivery
  - `adj-164.4` — US3: Channels Backend
    - `adj-164.4.1` — conversation-store channel methods (create/list/join/leave/post)
    - `adj-164.4.2` — MCP tools: create/list/join/leave_channel + send_message conversationId
    - `adj-164.4.3` — WS room-subscription fan-out (subscriptions + wsBroadcastToConversation)
    - `adj-164.4.4` — REST channel endpoints
    - `adj-164.4.5` — Channel unread + last_read tracking
  - `adj-164.5` — US4: Channels — Web UI
    - `adj-164.5.1` — useChannels hook
    - `adj-164.5.2` — ChannelList sidebar component
    - `adj-164.5.3` — ChannelView room component (multi-party attribution)
    - `adj-164.5.4` — Channel real-time subscription wiring
    - `adj-164.5.5` — DM ↔ Channels navigation in chat panel
  - `adj-164.6` — US5: Channels — iOS UI
    - `adj-164.6.1` — APIClient+Channels (Swift) + Channel model
    - `adj-164.6.2` — ChannelViewModel
    - `adj-164.6.3` — ChannelListView + ChannelView (SwiftUI)
    - `adj-164.6.4` — WebSocketClient channel subscription (iOS)
    - `adj-164.6.5` — DM ↔ Channels navigation in app shell
  - `adj-164.7` — US6: Cross-platform Polish
    - `adj-164.7.1` — Conversation-scoped FTS search
    - `adj-164.7.2` — Unread counts per conversation/channel (both platforms)
    - `adj-164.7.3` — APNS notifications for channel posts/mentions
    - `adj-164.7.4` — E2E integration tests (DM no-bleed + channel multi-party)
    - `adj-164.7.5` — Perf budget verification for chat views
    - `adj-164.7.6` — Docs: CLAUDE.md + architecture rules + quickstart
