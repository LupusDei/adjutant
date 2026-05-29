# Quickstart: Chat / Messaging (Conversations & Channels)

How the adj-164 chat system works, for developers extending it.

## The one idea

Every message belongs to a **conversation**. A conversation is either:
- a **DM** (`kind='dm'`) — exactly two members (the `user` + one agent), or
- a **channel** (`kind='channel'`) — N members, Slack-style.

Both are the same `conversations` row + `conversation_members` rows. `messages.conversation_id`
is the single scoping key — there is no agent/recipient reconstruction (that caused bleed).

## Resolve a DM

DM ids are deterministic, so you never create duplicates:

```
GET /api/conversations/dm/:agentId      → { conversation: { id, kind:'dm', ... } }
# id === dmConversationId("user", agentId)  (order-independent sha1)
```

Backend: `conversationStore.getOrCreateDm("user", "raynor")`.

## Read a conversation (bleed-free)

```
GET /api/conversations/:id/messages?limit=50   → { items, hasMore }
```
Strictly scoped to that conversation. For search: `GET /api/messages/search?q=…&conversationId=…`.

## Channels

```
POST /api/channels                  { title }                  → { id, kind:'channel', ... }
GET  /api/channels                                              → { channels: [...] }
POST /api/channels/:id/join         { memberId, memberKind }
POST /api/channels/:id/leave        { memberId }
POST /api/channels/:id/messages     { body, senderId }         → 201 (403 if non-member)
GET  /api/channels/unread?memberId=…                           → per-channel unread
```

MCP equivalents (agents): `create_channel`, `list_channels`, `join_channel`,
`leave_channel`, and `send_message({ conversationId, body })` to post.

## Real-time

- Connect `/ws/chat`, authenticate, then `{ type:'subscribe', conversationId }` for each
  open conversation. The dashboard auto-subscribes to the user's conversations.
- DMs: broadcast to all clients; the client renders only the open conversation.
- Channels: `wsBroadcastToConversation` delivers ONLY to member + subscribed clients.
  The sync/replay path is membership-gated for channels (non-members get nothing); DMs
  replay freely.

## Notifications

A channel post sends an APNS push (`CHANNEL_MESSAGE`) to the operator when they're a
member and not the author. The iOS `NotificationService` suppresses the alert while the
operator is actively viewing that conversation.

## Frontend

- Web: `useChatMessages(agentId)` resolves the DM and scopes by `conversationId`;
  `useChannels` + `ChannelView` for rooms; `useChatWebSocket` filters/ subscribes by
  conversation. Rendering reuses the virtualized `MessageBubble` (react-virtuoso) for
  both DMs and channels — multi-party attribution is intrinsic (each message carries its
  real sender).
- iOS: `APIClient+Conversations` / `APIClient+Channels`, `ChatViewModel` /
  `ChannelViewModel`, `WebSocketClient` channel subscribe/route. SPM auto-discovers files
  under `Adjutant/` — never add app sources to `.pbxproj`.

## Tests to model after

- `backend/tests/unit/message-store-conversation.test.ts` — scoping + bleed regression
- `backend/tests/unit/ws-room-fanout.test.ts` — live + sync membership gating
- `backend/tests/integration/chat-e2e.test.ts` — DM no-bleed + channel multi-party E2E
- `backend/tests/unit/conversation-store*.test.ts`, `mcp-channels.test.ts`
