# iOS Message System Fix Plan

**Epic**: adj-012 | **Task**: adj-012.6.1
**Synthesized by**: Coordinator
**Date**: 2026-02-22
**Sources**: investigation-findings.md, staff-review-findings.md, ux-audit-findings.md

## Executive Summary

Three independent workstreams (investigation, staff code review, product UX audit) converged on the same core defects. The iOS message system has **two root-cause bugs** that explain the majority of user-reported symptoms, **four reliability gaps** that compound the root causes, and **several UX blindspots** where the app hides its own state from the user.

The fix plan is structured in three tiers: **Tier 1** (root-cause fixes that resolve multiple symptoms with minimal code changes), **Tier 2** (reliability improvements that prevent recurrence), and **Tier 3** (UX polish that communicates state to users).

## Root Cause → Symptom Map

```
Conversation Scoping Bug ──→ Blank chat on open (Symptom 1)
(message-store.ts:176)    ──→ Messages lost after background (Symptom 2)
                          ──→ Stale polling comparison (Symptom 4)

Missing Pagination Cursor ──→ Pagination broken (Symptom 3)
(ChatViewModel.swift:375) ──→ Infinite auto-trigger loop (Symptom 3)

No Background Chat Sync   ──→ Messages lost after background (Symptom 2)

Triple-Refresh Race        ──→ Messages lost after background (Symptom 2)
                          ──→ Flickering/duplicate messages

lastSeqSeen Update Bug     ──→ Unreliable reconnection replay (Symptom 4)

Scroll-to-Bottom on        ──→ Pagination feels broken (Symptom 3)
History Prepend            ──→ Frustration loop
```

## Prioritized Fix Matrix

| # | Fix | Severity | Frequency | Complexity | Symptoms Resolved | Sources |
|---|-----|----------|-----------|------------|-------------------|---------|
| 1 | Conversation scoping SQL | P0 | Always | Trivial | 1, 2, 4 | INV, SR |
| 2 | Pagination cursor (add `before` timestamp) | P0 | Always | Trivial | 3 | INV, SR |
| 3 | Stop scroll-to-bottom on history prepend | P0 | Always | Low | 3 (UX) | UX |
| 4 | `lastSeqSeen` update for all message types | P0 | Always | Trivial | 4 | SR |
| 5 | Merge refresh (don't replace messages) | P1 | Always | Medium | 1, 2 | INV |
| 6 | Deduplicate triple-refresh on foreground | P1 | Often | Low | 2 | INV, UX |
| 7 | Reset `hasMoreHistory` on recipient switch | P1 | Often | Trivial | 3 | SR |
| 8 | Per-agent message cache | P1 | Always | Medium | 1, UX | UX, SR |
| 9 | Session output listener cleanup | P1 | Always | Low | Memory leak | SR |
| 10 | Reconnection banner (prominent indicator) | P1 | Often | Low | UX | UX |
| 11 | Per-message failure UI (retry button) | P1 | Sometimes | Medium | UX | UX |
| 12 | WS reconnect on network restoration | P2 | Sometimes | Medium | 4 | UX, SR |
| 13 | Notification tap when already on Chat tab | P2 | Often | Low | UX | UX |
| 14 | WebSocketClient thread safety (@MainActor) | P2 | Rare | Medium | 4 | SR |
| 15 | APNS handler fetches message (not just notify) | P2 | Sometimes | Low | 2 | INV |
| 16 | Limit/body validation on REST endpoints | P2 | Rare | Trivial | Security | SR |
| 17 | Real-time unread count updates | P3 | Often | Medium | UX | UX |
| 18 | Agent status indicators | P3 | Always | Medium | UX | UX |
| 19 | Notification grouping + inline reply | P3 | Sometimes | Low | UX | UX |
| 20 | Debounce UserDefaults persistence | P3 | Always | Low | Performance | SR |
| 21 | Static ISO8601DateFormatter | P3 | Always | Trivial | Performance | SR |
| 22 | Connection state: "DEGRADED" not "OFFLINE" | P3 | Sometimes | Trivial | UX | UX |

**Sources**: INV = investigation, SR = staff review, UX = UX audit

---

## Tier 1: Root-Cause Fixes (P0)

These four fixes resolve the core bugs. They should be deployed first, ideally in a single release.

### Fix 1: Conversation Scoping SQL Query
**File**: `backend/src/services/message-store.ts:176-178`
**Change**: Replace agent-only filter with conversation filter
```typescript
// BEFORE
if (opts.agentId !== undefined) {
  conditions.push("agent_id = ?");
  params.push(opts.agentId);
}

// AFTER
if (opts.agentId !== undefined) {
  conditions.push("(agent_id = ? OR (role = 'user' AND recipient = ?))");
  params.push(opts.agentId, opts.agentId);
}
```
**Also update**: `backend/src/routes/messages.ts` (pass agentId correctly), MCP `read_messages` tool
**Impact**: Resolves blank chat, messages lost after background, stale polling comparison
**Risk**: Low — additive change to SQL WHERE clause, no schema changes
**Test**: `backend/tests/unit/message-store.test.ts` — add conversation-mode test

### Fix 2: Pagination Cursor — Add `before` Timestamp
**File**: `ios/Adjutant/Sources/Features/Chat/ViewModels/ChatViewModel.swift:374-379`
**Change**: Pass both `before` (timestamp) and `beforeId` (ID)
```swift
// BEFORE
let oldestId = self.messages.filter { !$0.id.hasPrefix("local-") }.first?.id
let response = try await self.apiClient.getMessages(
    agentId: self.selectedRecipient, beforeId: oldestId, limit: 50)

// AFTER
let oldest = self.messages.filter { !$0.id.hasPrefix("local-") }.first
let response = try await self.apiClient.getMessages(
    agentId: self.selectedRecipient,
    before: oldest?.createdAt,
    beforeId: oldest?.id,
    limit: 50)
```
**Also update**: `ios/AdjutantKit/.../APIClient+Messages.swift` — add `before` parameter to query string
**Backend fallback**: Also fix `message-store.ts:197-205` to resolve `beforeId` when `before` is missing:
```typescript
if (opts.beforeId !== undefined && opts.before === undefined) {
  const ref = getByIdStmt.get(opts.beforeId) as MessageRow | undefined;
  if (ref) opts.before = ref.created_at;
}
```
**Impact**: Fixes pagination completely — users can scroll through full history
**Risk**: Low — additive parameter, backend fallback is defensive

### Fix 3: Stop Scroll-to-Bottom on History Prepend
**File**: `ios/Adjutant/Sources/Features/Chat/Views/ChatView.swift:81-83`
**Change**: Only scroll to bottom for NEW messages (appended), not history (prepended)
```swift
// BEFORE
.onChange(of: viewModel.messages.count) { _, _ in scrollToBottom() }

// AFTER
.onChange(of: viewModel.messages.last?.id) { oldId, newId in
    if newId != oldId { scrollToBottom() }
}
```
**Impact**: Eliminates the scroll frustration loop during pagination
**Risk**: Low — behavioral change to scroll trigger, easily testable

### Fix 4: Update `lastSeqSeen` for All Message Types
**File**: `ios/AdjutantKit/.../WebSocketClient.swift:~430` (top of `handleRawMessage`)
**Change**: Move seq update before the type switch
```swift
// ADD at top of handleRawMessage, before the switch statement:
if let seq = msg.seq {
    lastSeqSeen = max(lastSeqSeen, seq)
}
```
**Remove**: The duplicate `lastSeqSeen` update in the `default` case (~line 516)
**Impact**: Reconnection replay now accurately requests only truly-missed messages
**Risk**: Low — moves existing logic earlier in the function

---

## Tier 2: Reliability Improvements (P1–P2)

These fixes harden the system against edge cases and improve the user's ability to understand what's happening.

### Fix 5: Merge Refresh (Don't Replace Messages)
**File**: `ChatViewModel.swift:~310`
**Change**: Merge server messages with existing local messages instead of replacing
```swift
// BEFORE
self.messages = serverMessages

// AFTER
let serverIds = Set(serverMessages.map { $0.id })
let localOnly = self.messages.filter { msg in
    msg.id.hasPrefix("local-") || !serverIds.contains(msg.id)
}
self.messages = (serverMessages + localOnly)
    .sorted { ($0.date ?? .distantPast) < ($1.date ?? .distantPast) }
```

### Fix 6: Deduplicate Triple-Refresh
**File**: `ChatViewModel.swift`
**Change**: Add a `refreshInProgress` guard
```swift
private var refreshTask: Task<Void, Never>?

func refresh() async {
    refreshTask?.cancel()
    refreshTask = Task { await performRefresh() }
    await refreshTask?.value
}
```

### Fix 7: Reset `hasMoreHistory` on Recipient Switch
**File**: `ChatViewModel.swift:~352` (in `setRecipient()`)
**Change**: Add `hasMoreHistory = true` before calling refresh

### Fix 8: Per-Agent Message Cache
**File**: `ChatViewModel.swift` + `ResponseCache.swift`
**Change**: Key cache by agentId. Store/restore per-agent message arrays and scroll positions.

### Fix 9: Session Output Listener Cleanup
**File**: `backend/src/services/ws-server.ts:337-355`
**Change**: Store the listener unsubscribe function and call it on disconnect/session_disconnect

### Fix 10: Reconnection Banner
**File**: `ios/.../ChatView.swift`
**Change**: Add a prominent banner below the header when `connectionState != .connected`

### Fix 11: Per-Message Failure UI
**File**: `ChatViewModel.swift`, `ChatBubble.swift`
**Change**: Add 15-second timeout on pending messages, mark as failed, add retry button

### Fix 12: WS Reconnect on Network Restoration
**File**: `WebSocketClient.swift`
**Change**: Reset `reconnectAttempt` and trigger new connection on network reachability change

### Fix 13: Notification Tap When Already on Chat Tab
**File**: `ChatView.swift`
**Change**: Add `onChange(of: coordinator.pendingChatAgentId)` handler

### Fix 14: WebSocketClient Thread Safety
**File**: `WebSocketClient.swift`
**Change**: Add `@MainActor` annotation or dispatch all state mutations to a serial queue

### Fix 15: APNS Handler Fetches Message
**File**: `AppDelegate.swift:handleChatMessageNotification`
**Change**: Fetch the message via API and update cache, not just schedule local notification

### Fix 16: Input Validation
**File**: `backend/src/routes/messages.ts`
**Change**: Clamp `limit` to 1-200, add `.max(10000)` on body

---

## Tier 3: UX Polish (P3)

These improve the experience but don't fix functional bugs.

### Fix 17–22
- Real-time unread count updates via WS events
- Agent status indicators (online/offline/idle dots)
- Notification grouping with `threadIdentifier` + inline reply
- Debounce UserDefaults persistence to once per 5 seconds
- Static shared `ISO8601DateFormatter` instances
- "DEGRADED" connection state label instead of "OFFLINE" for polling fallback

---

## Implementation Recommendation

### Sprint 1: Root Causes (Tier 1)
Fixes 1-4. Estimated: 4 tasks, can be done in parallel by 2 engineers.
- Backend engineer: Fix 1 (conversation scoping) + Fix 2 backend fallback + Fix 16 (validation)
- iOS engineer: Fix 2 iOS side + Fix 3 (scroll) + Fix 4 (lastSeqSeen)

### Sprint 2: Reliability (Tier 2, P1)
Fixes 5-11. Estimated: 7 tasks, some parallelizable.
- Backend: Fix 9 (listener cleanup)
- iOS: Fix 5 (merge refresh) + Fix 6 (dedup refresh) + Fix 7 (hasMore reset) + Fix 8 (per-agent cache) + Fix 10 (banner) + Fix 11 (failure UI)

### Sprint 3: Hardening (Tier 2, P2) + Polish (Tier 3)
Fixes 12-22. Lower urgency, can be spread across releases.

---

## Test Coverage Summary

The test-engineer produced 118 new tests (60 backend, 58 frontend) that cover:
- Message store pagination edge cases (10 tests)
- WebSocket reconnection, replay, rate limiting (23 tests)
- useChatMessages lifecycle, dedup, optimistic UI (9 new tests, 31 total)
- CommunicationContext fallback chain (8 new tests, 27 total)

**Coverage gaps for Tier 1 fixes** (need new tests):
- Conversation-mode query (Fix 1): test that `getMessages(agentId: X)` returns BOTH directions
- Pagination with `before` + `beforeId` composite cursor (Fix 2): test iOS-style beforeId-only call
- Scroll behavior tests: manual/visual — not automatable with Vitest
- `lastSeqSeen` update coverage: verify seq advances for all message types

---

## Appendix: Source Cross-Reference

| Finding | Investigation | Staff Review | UX Audit |
|---------|:---:|:---:|:---:|
| Conversation scoping SQL | Critical | Critical | Observed (1.1, 1.5) |
| Missing pagination cursor | High | Critical | Observed (1.3) |
| Scroll-to-bottom on prepend | — | — | Critical (1.3) |
| `lastSeqSeen` update bug | — | Critical (cross-cutting) | — |
| No background chat sync | Critical | — | — |
| Triple-refresh race | Critical | High | Medium (1.5) |
| `hasMoreHistory` stale | — | High | — |
| Session listener leak | — | High | — |
| Per-agent cache missing | — | Medium | Critical (3.1) |
| Silent send failures | — | — | Critical (2.2) |
| No reconnection banner | — | — | Critical (2.1) |
| WS permanent death | High | Medium | High (2.4) |
| Notification tap on active tab | — | — | High (4.3) |
| Thread safety (`@unchecked Sendable`) | — | High | — |
| Stale polling ID | High | — | — |
| Zombie sockets | High | — | — |
