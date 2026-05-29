# Beads Import: Adjutant Chat / Messaging Overhaul

**Root epic**: `adj-164` · **Spec**: `./spec.md` · **Plan**: `./plan.md`

Hierarchy: root epic → 7 sub-epics (phases) → tasks. Tasks Ta/Tb (RED/GREEN) are
tracked as a single bead each (the bead represents the test-first unit of work).

## Root & Sub-epics

| Bead | Type | Title | Priority | Depends on |
|---|---|---|---|---|
| adj-164 | epic | Adjutant Chat / Messaging Overhaul | 0 | — |
| adj-164.1 | epic | Foundational: Unified Conversation Model (backend) | 0 | — |
| adj-164.2 | epic | US1: DM Cleanup + Bleed Fix — Web | 0 | adj-164.1 |
| adj-164.3 | epic | US2: DM Cleanup + Bleed Fix — iOS | 0 | adj-164.1 |
| adj-164.4 | epic | US3: Channels Backend | 1 | adj-164.1 |
| adj-164.5 | epic | US4: Channels — Web UI | 1 | adj-164.4 |
| adj-164.6 | epic | US5: Channels — iOS UI | 1 | adj-164.4 |
| adj-164.7 | epic | US6: Cross-platform Polish | 2 | adj-164.2, adj-164.3, adj-164.5, adj-164.6 |

## Tasks

| Bead | T-IDs | Title | Pri | Parent |
|---|---|---|---|---|
| adj-164.1.1 | T001a/b | Migration: conversations + conversation_members + messages.conversation_id | 0 | adj-164.1 |
| adj-164.1.2 | T002a/b | conversation-store.ts (conversations + members + dm lookup-or-create) | 0 | adj-164.1 |
| adj-164.1.3 | T003a/b | message-store conversationId insert + filter (retire bleed path) | 0 | adj-164.1 |
| adj-164.1.4 | T004a/b | Reversible backfill of existing messages → DM conversations | 0 | adj-164.1 |
| adj-164.1.5 | T005a/b | REST: GET /api/conversations + /:id/messages | 0 | adj-164.1 |
| adj-164.2.1 | T006a/b | useChatMessages scoped by conversationId | 0 | adj-164.2 |
| adj-164.2.2 | T007a/b | renderMessage spacing/alignment/auto-scroll fix | 0 | adj-164.2 |
| adj-164.2.3 | T008 | Bleed regression + remove stale agent-scoped filtering | 0 | adj-164.2 |
| adj-164.2.4 | T009a/b | WS real-time scoped to conversation | 0 | adj-164.2 |
| adj-164.3.1 | T010a/b | APIClient conversations + conversationId on models (iOS) | 0 | adj-164.3 |
| adj-164.3.2 | T011a/b | ChatViewModel conversation scoping + dedup (bleed fix) | 0 | adj-164.3 |
| adj-164.3.3 | T012a/b | ChatView/ChatBubble spacing/alignment + auto-scroll | 0 | adj-164.3 |
| adj-164.3.4 | T013a/b | WebSocketClient conversation-filtered delivery (iOS) | 0 | adj-164.3 |
| adj-164.4.1 | T014a/b | conversation-store channel methods | 1 | adj-164.4 |
| adj-164.4.2 | T015a/b | MCP tools: create/list/join/leave_channel + send_message conversationId | 1 | adj-164.4 |
| adj-164.4.3 | T016a/b | WS room-subscription fan-out | 1 | adj-164.4 |
| adj-164.4.4 | T017a/b | REST channel endpoints | 1 | adj-164.4 |
| adj-164.4.5 | T018a/b | Channel unread + last_read tracking | 1 | adj-164.4 |
| adj-164.5.1 | T019a/b | useChannels hook | 1 | adj-164.5 |
| adj-164.5.2 | T020a/b | ChannelList sidebar component | 1 | adj-164.5 |
| adj-164.5.3 | T021a/b | ChannelView room component (multi-party attribution) | 1 | adj-164.5 |
| adj-164.5.4 | T022a/b | Channel real-time subscription wiring | 1 | adj-164.5 |
| adj-164.5.5 | T023a/b | DM ↔ Channels navigation (web) | 1 | adj-164.5 |
| adj-164.6.1 | T024a/b | APIClient+Channels (Swift) + Channel model | 1 | adj-164.6 |
| adj-164.6.2 | T025a/b | ChannelViewModel | 1 | adj-164.6 |
| adj-164.6.3 | T026a/b | ChannelListView + ChannelView (SwiftUI) | 1 | adj-164.6 |
| adj-164.6.4 | T027a/b | WebSocketClient channel subscription (iOS) | 1 | adj-164.6 |
| adj-164.6.5 | T028a/b | DM ↔ Channels navigation (iOS) | 1 | adj-164.6 |
| adj-164.7.1 | T029a/b | Conversation-scoped FTS search | 2 | adj-164.7 |
| adj-164.7.2 | T030a/b | Unread counts per conversation/channel (both platforms) | 2 | adj-164.7 |
| adj-164.7.3 | T031a/b | APNS notifications for channel posts/mentions | 2 | adj-164.7 |
| adj-164.7.4 | T032a/b | E2E integration tests (DM no-bleed + channel multi-party) | 2 | adj-164.7 |
| adj-164.7.5 | T033 | Perf budget verification for chat views | 2 | adj-164.7 |
| adj-164.7.6 | T034 | Docs: CLAUDE.md + architecture rules + quickstart | 2 | adj-164.7 |

**Totals**: 1 root + 7 sub-epics + 34 tasks = 42 beads.

## Dependency wiring (sub-epic level)

```
adj-164.1 → adj-164.2, adj-164.3, adj-164.4   (foundational unblocks DM lanes + channels backend)
adj-164.4 → adj-164.5, adj-164.6              (channels backend unblocks channel UIs)
adj-164.2, adj-164.3, adj-164.5, adj-164.6 → adj-164.7  (polish last)
```

Within each sub-epic, tasks are children of the sub-epic (parent-child deps). Cross-task
ordering inside a phase is mostly independent; the sub-epic gate enforces phase ordering.
