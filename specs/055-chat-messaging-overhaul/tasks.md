# Tasks: Adjutant Chat / Messaging Overhaul

**Root epic**: `adj-164`
**Spec**: `specs/055-chat-messaging-overhaul/spec.md` · **Plan**: `./plan.md`

Legend: `[P]` = parallelizable (different files, no dep) · `[USn]` = user story ·
`[setup]`/`[docs]` = TDD-exempt. Every non-exempt task is TDD-shaped (RED → GREEN).
Bead IDs are in `beads-import.md`.

---

## Phase 1 — Foundational: Unified Conversation Model (backend) `adj-164.1` [P0]

> Blocks Phases 2, 3, 4. MUST merge to main before platform lanes branch.

- [ ] T001a [US-F] Write failing tests for the conversations migration in
      `backend/tests/unit/database-migration-conversations.test.ts`: `conversations` and
      `conversation_members` tables created, `messages.conversation_id` column added,
      indices present, migration idempotent on re-run. Confirm RED.
- [ ] T001b [US-F] Implement the migration in `backend/src/services/database.ts`
      (new schema version + DDL). Run until GREEN.

- [ ] T002a [P] [US-F] Write failing tests for `conversation-store.ts` in
      `backend/tests/unit/conversation-store.test.ts`: create/get/list conversations,
      add/remove/get members, `getConversationsForMember`, deterministic DM
      lookup-or-create by member pair (happy/error/edge). Confirm RED.
- [ ] T002b [US-F] Implement `backend/src/services/conversation-store.ts` until GREEN.
      No code paths beyond what tests require.

- [ ] T003a [US-F] Write failing tests in
      `backend/tests/unit/message-store-conversation.test.ts`: `insertMessage` persists
      `conversationId`; `getMessages({conversationId})` returns ONLY that conversation;
      include a **bleed regression** (two conversations, no cross-leak). Use real row
      shapes. Confirm RED.
- [ ] T003b [US-F] Extend `backend/src/services/message-store.ts`: add `conversationId`
      to insert + `getMessages` filter; conversationId takes precedence over the legacy
      agent/recipient path. Run until GREEN.

- [ ] T004a [US-F] Write failing tests in
      `backend/tests/unit/conversation-backfill.test.ts` using **real message rows**:
      existing messages group deterministically into DM conversations (one per
      agent↔user pair, reuse `thread_id` where present), backfill is idempotent and
      reversible. Confirm RED.
- [ ] T004b [US-F] Implement the reversible backfill (in `database.ts` migration path)
      until GREEN.

- [ ] T005a [US-F] Write failing tests in
      `backend/tests/integration/conversations-api.test.ts`: `GET /api/conversations`
      (list for user) and `GET /api/conversations/:id/messages` (scoped, paginated)
      success + error (unknown id). Confirm RED.
- [ ] T005b [US-F] Implement `backend/src/routes/conversations.ts` + service wiring +
      route registration. Run until GREEN.

---

## Phase 2 — US1: DM Cleanup + Bleed Fix — Web `adj-164.2` [P0] (depends: adj-164.1)

- [ ] T006a [US1] Write failing tests for `useChatMessages` conversation scoping in
      `frontend/tests/unit/useChatMessages.test.ts`: resolves the DM conversation for an
      `agentId`, fetches `/api/conversations/:id/messages`, and a **bleed regression**
      (switching agents never mixes messages). Confirm RED.
- [ ] T006b [US1] Update `frontend/src/hooks/useChatMessages.ts` (+ `services/api.ts`
      conversation calls) until GREEN.

- [ ] T007a [US1] Write regression tests FIRST for `CommandChat` rendering in
      `frontend/tests/unit/CommandChat.test.tsx`: correct message spacing/alignment,
      same-sender run grouping, and auto-scroll-to-bottom only when already at bottom.
      Confirm RED.
- [ ] T007b [US1] Fix `renderMessage` + the scroll effect in
      `frontend/src/components/chat/CommandChat.tsx` (raynor's ~20-line fix) and
      `chat.css` as needed. Run until GREEN. (UI work: use the `frontend-design` skill.)

- [ ] T008 [US1] Bleed regression test first (confirm RED) → fix until GREEN. Remove the
      stale agent-scoped filtering path in the web data layer. Test file:
      `frontend/tests/unit/chat-bleed.test.tsx`; delete the legacy path once green.

- [ ] T009a [US1] Write failing tests in `frontend/tests/unit/useChatWebSocket.test.ts`:
      incoming `chat_message` is applied only when its `conversationId` matches the open
      conversation. Confirm RED.
- [ ] T009b [US1] Scope WS delivery by `conversationId` in
      `frontend/src/hooks/useChatWebSocket.ts` (and CommandChat wiring) until GREEN.

---

## Phase 3 — US2: DM Cleanup + Bleed Fix — iOS `adj-164.3` [P0] (depends: adj-164.1)

> SPM rule: all new files under `ios/Adjutant/` and `ios/AdjutantKit/` are
> auto-discovered. NEVER add them to `.pbxproj`.

- [ ] T010a [US2] Write failing tests in
      `ios/AdjutantKit/Tests/AdjutantKitTests/APIClientConversationsTests.swift`:
      `getConversations()` and `getConversationMessages(conversationId:)` decode real API
      shapes; `conversationId` present on `PersistentMessage`. Confirm RED.
- [ ] T010b [US2] Add `APIClient+Conversations.swift` + `conversationId` on models in
      `ios/AdjutantKit/Sources/AdjutantKit/`. Run until GREEN.

- [ ] T011a [US2] Write failing tests for `ChatViewModel` conversation scoping in
      `ios/AdjutantTests/ChatViewModelTests.swift`: messages scoped by `conversationId`,
      dedup/merge by conversation, **bleed regression** across two conversations.
      Confirm RED.
- [ ] T011b [US2] Update `ios/Adjutant/Sources/Features/Chat/ViewModels/ChatViewModel.swift`
      until GREEN.

- [ ] T012a [US2] Write failing tests for bubble grouping + auto-scroll logic in
      `ios/AdjutantTests/ChatViewLayoutTests.swift` (behavior, not pure styling):
      same-sender grouping flags + should-auto-scroll predicate. Confirm RED.
- [ ] T012b [US2] Update `ChatView.swift` / `ChatBubble.swift` spacing/alignment +
      auto-scroll to parity with web until GREEN.

- [ ] T013a [US2] Write failing tests in
      `ios/AdjutantKit/Tests/AdjutantKitTests/WebSocketConversationTests.swift`:
      `chat_message` routed only to the matching conversation. Confirm RED.
- [ ] T013b [US2] Filter real-time delivery by `conversationId` in
      `ios/AdjutantKit/Sources/AdjutantKit/Networking/WebSocketClient.swift` until GREEN.

---

## Phase 4 — US3: Channels Backend `adj-164.4` [P1] (depends: adj-164.1)

> Blocks Phases 5, 6.

- [ ] T014a [US3] Write failing tests in
      `backend/tests/unit/conversation-store-channels.test.ts`: `createChannel`,
      `listChannels`, `joinChannel`, `leaveChannel`, `postToChannel` (happy/error/edge),
      reusing the conversation model. Confirm RED.
- [ ] T014b [US3] Add channel methods to `backend/src/services/conversation-store.ts`
      until GREEN.

- [ ] T015a [US3] Write failing tests in `backend/tests/unit/mcp-channels.test.ts`:
      ≥2 tests each for `create_channel`, `list_channels`, `join_channel`,
      `leave_channel`, and `send_message` extended with `conversationId` (success +
      validation error). Confirm RED.
- [ ] T015b [US3] Implement `backend/src/services/mcp-tools/channels.ts` and extend
      `mcp-tools/messaging.ts` `send_message` with `conversationId`. Register tools.
      Run until GREEN.

- [ ] T016a [US3] Write failing tests in `backend/tests/unit/ws-room-fanout.test.ts`:
      `wsBroadcastToConversation` sends only to member+subscribed clients; non-members
      receive nothing; subscribe/unsubscribe client messages update the subscription set.
      Confirm RED.
- [ ] T016b [US3] Add `subscriptions: Set<string>` to `WsClient`, subscribe/unsubscribe
      handlers, and `wsBroadcastToConversation` in
      `backend/src/services/ws-server.ts`; route chat broadcasts through it. Run until GREEN.

- [ ] T017a [US3] Write failing tests in
      `backend/tests/integration/channels-api.test.ts`: `POST /api/channels`,
      `GET /api/channels`, `POST /api/channels/:id/join`, `/leave`,
      `POST /api/channels/:id/messages` (success + error). Confirm RED.
- [ ] T017b [US3] Implement channel REST endpoints in
      `backend/src/routes/conversations.ts` (or `routes/channels.ts`) + wiring. GREEN.

- [ ] T018a [US3] Write failing tests in
      `backend/tests/unit/conversation-unread.test.ts`: per-member `last_read_at` updates
      and per-conversation unread counts (happy/error/edge). Confirm RED.
- [ ] T018b [US3] Implement unread + `last_read_at` tracking in `conversation-store.ts`
      until GREEN.

---

## Phase 5 — US4: Channels — Web UI `adj-164.5` [P1] (depends: adj-164.4)

> UI work: use the `frontend-design` skill. Pip-Boy retro-terminal theme.

- [ ] T019a [US4] Write failing tests for `useChannels` in
      `frontend/tests/unit/useChannels.test.ts`: list/create/join channels, unread per
      channel, error state (initial/state-change/error). Confirm RED.
- [ ] T019b [US4] Implement `frontend/src/hooks/useChannels.ts` (+ api.ts) until GREEN.

- [ ] T020a [P] [US4] Write failing tests for `ChannelList` in
      `frontend/tests/unit/ChannelList.test.tsx`: renders channels, unread badges,
      create action, selection callback. Confirm RED.
- [ ] T020b [US4] Implement `frontend/src/components/chat/ChannelList.tsx` until GREEN.

- [ ] T021a [US4] Write failing tests for `ChannelView` in
      `frontend/tests/unit/ChannelView.test.tsx`: multi-party messages render with
      per-sender attribution; reuses `MessageBubble`; virtualized list. Confirm RED.
- [ ] T021b [US4] Implement `frontend/src/components/chat/ChannelView.tsx` (build on the
      `CommandChat`/`MessageBubble` path) until GREEN.

- [ ] T022a [US4] Write failing tests in `frontend/tests/unit/channel-realtime.test.ts`:
      opening a channel subscribes via WS; incoming channel messages render live.
      Confirm RED.
- [ ] T022b [US4] Wire channel WS subscription in `ChannelView`/`useChannels` until GREEN.

- [ ] T023a [US4] Write failing tests in
      `frontend/tests/unit/chat-navigation.test.tsx`: DM ↔ Channels switching preserves
      state and scopes correctly. Confirm RED.
- [ ] T023b [US4] Implement the DM ↔ Channels switcher in the chat panel container until
      GREEN.

---

## Phase 6 — US5: Channels — iOS UI `adj-164.6` [P1] (depends: adj-164.4)

> SPM rule: new files auto-discovered — NO `.pbxproj` edits for files under `Adjutant/`.

- [ ] T024a [US5] Write failing tests in
      `ios/AdjutantKit/Tests/AdjutantKitTests/APIClientChannelsTests.swift`:
      list/create/join/leave/post + `Channel` model decode from real API shapes.
      Confirm RED.
- [ ] T024b [US5] Add `APIClient+Channels.swift` + `Channel` model in
      `ios/AdjutantKit/Sources/AdjutantKit/`. Run until GREEN.

- [ ] T025a [US5] Write failing tests for `ChannelViewModel` in
      `ios/AdjutantTests/ChannelViewModelTests.swift`: list/membership/unread state
      transitions (initial/change/error). Confirm RED.
- [ ] T025b [US5] Implement
      `ios/Adjutant/Sources/Features/Chat/ViewModels/ChannelViewModel.swift` until GREEN.

- [ ] T026a [US5] Write failing tests for channel bubble attribution + grouping logic in
      `ios/AdjutantTests/ChannelViewLayoutTests.swift`. Confirm RED.
- [ ] T026b [US5] Implement `ChannelListView.swift` + `ChannelView.swift` (multi-party
      bubbles with attribution) in `ios/Adjutant/Sources/Features/Chat/Views/` until GREEN.

- [ ] T027a [US5] Write failing tests in
      `ios/AdjutantKit/Tests/AdjutantKitTests/WebSocketChannelTests.swift`: channel
      subscribe/unsubscribe + routing of channel messages. Confirm RED.
- [ ] T027b [US5] Add channel subscription to `WebSocketClient.swift` until GREEN.

- [ ] T028a [US5] Write failing tests for app-shell DM ↔ Channels navigation in
      `ios/AdjutantTests/ChatNavigationTests.swift`. Confirm RED.
- [ ] T028b [US5] Wire DM ↔ Channels navigation in the app shell until GREEN.

---

## Phase 7 — US6: Cross-platform Polish `adj-164.7` [P2] (depends: adj-164.2, .3, .5, .6)

- [ ] T029a [US6] Write failing tests in
      `backend/tests/unit/message-store-search-conversation.test.ts`: FTS search
      filterable by `conversationId`. Confirm RED.
- [ ] T029b [US6] Extend `searchMessages` + search route/api for conversation scoping
      (backend + both clients' search calls) until GREEN.

- [ ] T030a [US6] Write failing tests for per-conversation unread counts in
      `backend/tests/unit/unread-by-conversation.test.ts` and the matching frontend hook
      test. Confirm RED.
- [ ] T030b [US6] Implement per-conversation/channel unread aggregation (backend) and
      surface in web + iOS unread UIs until GREEN.

- [ ] T031a [US6] Write failing tests in `backend/tests/unit/apns-channel.test.ts`:
      channel post/mention triggers APNS; suppressed when the recipient is actively
      viewing that conversation. Confirm RED.
- [ ] T031b [US6] Implement channel APNS in `apns-service.ts` + send path + iOS
      `NotificationService` category/deep-link until GREEN.

- [ ] T032a [US6] Write failing E2E integration tests in
      `backend/tests/integration/chat-e2e.test.ts`: DM no-bleed across two conversations
      AND a channel with user + ≥2 agents delivering to all members. Confirm RED.
- [ ] T032b [US6] Close any gaps surfaced by the E2E tests until GREEN.

- [ ] T033 [US6] Perf budget check — write tests first (RED) → run until GREEN.
      Confirm it measures ChannelView + DM virtualization keystroke latency via
      `RUN_PERF=1 npm run test:perf` against a production preview build; budgets must hold.
      Record results in `frontend/perf-budgets.md`.

- [ ] T034 [docs] Update `CLAUDE.md`, `.claude/rules/04-architecture.md`, and
      `specs/055-chat-messaging-overhaul/quickstart.md` to document the unified
      conversation model (DMs + channels), MCP channel tools, and WS room fan-out.

---

## Audit

Run before considering this file complete:

```bash
npx --prefix backend tsx ../scripts/audit-tasks-md.ts --json
```
