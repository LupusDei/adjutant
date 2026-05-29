# Spec: Adjutant Chat / Messaging Overhaul

**Feature dir**: `specs/055-chat-messaging-overhaul/`
**Root epic**: `adj-164`
**Status**: Planned
**Author**: tassadar (Squad Leader / Architect)
**Date**: 2026-05-29

---

## 1. Problem Statement

Adjutant's chat has two gaps:

1. **Direct messages are fragile.** The current 1:1 chat (web `CommandChat`, iOS `ChatView`)
   reconstructs a conversation by filtering `messages` on
   `(agent_id = ? OR (role = 'user' AND recipient = ?))`. There is **no first-class
   conversation identity** — `threadId` exists on the row but is never the enforced
   conversation key. The result is **wrong-thread message bleed**: messages leak across
   what the user perceives as separate conversations. The web UI also has unshipped
   spacing/alignment/auto-scroll glitches in `renderMessage` (root-caused by raynor).

2. **No multi-party rooms.** There is no way for the user and *multiple* agents to talk
   together in one place. Coordination today is N separate DMs. The General wants
   **Slack-style channels**: rooms where several agents + the user converse together.

## 2. North Star & Architectural Keystone

Design **DMs and channels as ONE system, not two.** Both are a single first-class
**conversation** entity with a `kind` discriminator (`dm` | `channel`) and an explicit
**membership** table. A DM is simply a conversation with `kind=dm` and exactly two
members; a channel is a conversation with `kind=channel` and N members.

This single decision:

- **Fixes the bleed at the root** — every message carries a stable `conversation_id`;
  the fragile `agentId OR recipient` reconstruction is retired.
- **Makes channels an extension, not a parallel build** — honoring Constitution Rule 9
  (Simplicity): reuse the thread/room concept, don't reinvent.
- **Unifies the surface** across web and iOS: one model, one fan-out path, one UI shell.

## 3. Scope

### In scope
- Unified `conversation` + `conversation_members` data model (backend, SQLite).
- Reversible migration that backfills existing messages into DM conversations.
- DM cleanup on **both** web and iOS: bleed fix via conversation scoping +
  spacing/alignment/auto-scroll fix.
- Slack-style channels end-to-end: backend model + MCP tools + WebSocket
  room-subscription fan-out + REST + **web UI** + **iOS UI**.
- Conversation-scoped real-time delivery, search, unread counts, and notifications.

### Out of scope (future)
- Private channels / invite-only rooms / DM-style ACLs (v1 channels are public).
- Threaded replies *within* a channel message (flat channel timeline for v1).
- Voice input / TTS inside channels (DMs keep voice; channels are text-first).
- Message editing/deletion, reactions, file attachments.

## 4. User Stories

### US1 (P0) — DM cleanup + bleed fix (Web)
**As** the General, **I want** each 1:1 conversation in the web dashboard to show only
that conversation's messages, cleanly spaced and auto-scrolled, **so that** I can trust
the DM view and never see another conversation's messages bleed in.

**Acceptance criteria**
- Opening agent A's DM shows only messages belonging to the A↔user conversation.
- Sending in A's DM never appears in B's DM (bleed regression test passes).
- Messages render with correct spacing/alignment; same-sender runs group correctly.
- New messages auto-scroll to bottom only when the user is already at the bottom.
- Real-time WS delivery is scoped to the open conversation.

### US2 (P0) — DM cleanup + bleed fix (iOS)
**As** the General on iOS, **I want** the same trustworthy, cleanly-rendered 1:1 chat.

**Acceptance criteria**
- iOS `ChatView` scopes by `conversationId`; no cross-conversation bleed.
- Bubble spacing/alignment + auto-scroll parity with web.
- Real-time WS `chat_message` filtered by conversation.
- SPM rule honored: no `.pbxproj` edits for files under `Adjutant/`.

### US3 (P1) — Channels backend
**As** an agent or the General, **I want** to create, list, join, and post to channels
via MCP/REST, **so that** multi-party rooms exist and deliver in real time.

**Acceptance criteria**
- MCP tools: `create_channel`, `list_channels`, `join_channel`, `leave_channel`;
  `send_message` extended to target a `conversationId`/channel.
- REST: create/list/join/leave/post channel endpoints.
- WebSocket fan-out is **room-scoped** — a channel post reaches only its members'
  subscribed clients, not every authenticated client.
- Membership + `last_read_at` tracked per member.

### US4 (P1) — Channels web UI
**As** the General, **I want** a channel list and a room view in the web dashboard.

**Acceptance criteria**
- Channel list (with unread badges + create) in the chat panel, Pip-Boy themed.
- Room view renders multi-party messages with clear per-sender attribution.
- Real-time updates when subscribed; switching DM ↔ Channels is seamless.
- Built on the virtualized `CommandChat`/`MessageBubble` path (no perf regression).

### US5 (P1) — Channels iOS UI
**As** the General on iOS, **I want** channel list + room view with parity.

**Acceptance criteria**
- `ChannelListView` + `ChannelView` (multi-party bubbles with attribution).
- WS channel subscription; live updates.
- DM ↔ Channels navigation in the app shell. SPM rule honored.

### US6 (P2) — Cross-platform polish
**As** the General, **I want** conversation-scoped search, unread counts, channel
notifications, and verified end-to-end behavior.

**Acceptance criteria**
- FTS search filterable by conversation.
- Unread counts per conversation/channel on both platforms.
- APNS push for channel posts/mentions, suppressed when actively viewing.
- E2E integration tests prove DM no-bleed + channel multi-party delivery.
- Perf budgets hold; docs updated.

## 5. Functional Requirements

- **FR-001** A `conversations` table with `id`, `kind` (`dm`|`channel`), `title`,
  `archived`, timestamps.
- **FR-002** A `conversation_members` table: `conversation_id`, `member_id`,
  `member_kind` (`user`|`agent`), `role` (`member`|`owner`), `joined_at`, `last_read_at`.
- **FR-003** `messages.conversation_id` column; every new message MUST set it.
- **FR-004** A reversible migration that backfills existing messages into DM
  conversations (one per agent↔user pair; reuse `thread_id` where present); idempotent.
- **FR-005** `getMessages` MUST support a `conversationId` filter that returns ONLY that
  conversation's messages (no agent-OR-recipient widening).
- **FR-006** DM lookup-or-create by member pair is deterministic (stable conversation id
  for a given pair).
- **FR-007** WebSocket delivery MUST be room-scoped via conversation membership.
- **FR-008** MCP + REST surfaces for channel create/list/join/leave/post.
- **FR-009** Unread counts and `last_read_at` computed per conversation.
- **FR-010** Both web and iOS scope all reads/writes/real-time by `conversationId`.

## 6. Non-Functional Requirements

- **Simplicity (Rule 9)**: one conversation model serves both DMs and channels.
- **Layered architecture (Rule 4)**: routes → services (`conversation-store`) → store.
- **Test-first (Rule 1)**: every public method/endpoint/tool/hook TDD-shaped.
- **Performance**: web room/DM views keep the adj-139 virtualization; perf budgets hold.
- **Project identity (Rule)**: use `projectId` UUID for all backend ops; never `projectName`.
- **iOS SPM**: never add files under `Adjutant/` to `.pbxproj`.

## 7. Success Criteria

- Zero cross-conversation bleed (proven by regression tests on both platforms).
- A channel with the user + ≥2 agents exchanges messages in real time on web and iOS.
- All MCP/REST channel tools have ≥2 tests; all services ≥3; coverage gates hold.
- No perf-budget regression in chat views.

## 8. Risks & Mitigations

- **Migration/backfill risk** (data shape) → reversible, idempotent migration with tests
  built from **real message rows** (Rule 1), run as the first foundational task.
- **Fan-out scoping bugs** → membership-resolved broadcast with explicit subscription set;
  unit + integration tests for room isolation.
- **Stale-branch conflicts** across parallel lanes → foundational backend merges before
  platform lanes branch (see plan.md sequencing).
