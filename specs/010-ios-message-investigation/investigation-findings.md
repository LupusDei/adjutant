# iOS Message Loading Investigation Findings

**Epic**: adj-012 | **Task**: adj-012.2 (US1: Root Cause Investigation)
**Investigator**: Claude Opus 4.6 (investigator agent)
**Date**: 2026-02-22

---

## Cross-Cutting Root Cause: Conversation Scoping Bug

Before diving into individual symptoms, there is a **critical cross-cutting bug** that affects all four symptoms. Understanding it is essential context for every finding below.

**The `GET /api/messages?agentId=X` endpoint only returns messages FROM agent X, not the full conversation.**

When the iOS client calls `getMessages(agentId: selectedRecipient)`:
- User-sent messages are stored with `agent_id = "user"` and `recipient = "someAgent"`
  - Source: `backend/src/services/ws-server.ts:232-236` and `backend/src/routes/messages.ts:127-132`
- The backend filters `WHERE agent_id = ?` (exact match)
  - Source: `backend/src/services/message-store.ts:176-178`
- This returns ONLY messages where `agent_id = selectedRecipient` (agent-sent messages)
- All user-sent messages (`agent_id = "user"`) are excluded from the API response

The web frontend (`frontend/src/hooks/useChatMessages.ts:63-70`) works around this by preserving optimistic messages across fetches. The iOS client does NOT have this workaround -- `refresh()` at line 310 replaces `self.messages = serverMessages`, dropping all confirmed user messages.

User messages only appear in the iOS app through:
1. Optimistic insertion (before confirmation)
2. WebSocket `chat_message` broadcast (real-time)
3. Cache (if previously cached)

Any operation that calls `refresh()` and replaces messages with the API response will lose user messages.

---

## Symptom 1: Blank Chat on Open

### Reproduction Steps
1. Force-kill the iOS app
2. Relaunch the app
3. Navigate to the Chat tab
4. Observe blank message list for several seconds, or permanently until pull-to-refresh

### Expected Behavior
Messages from last session visible immediately (from cache), then live data loads.

### Actual Behavior
Blank screen, sometimes for several seconds, sometimes permanently until manual pull-to-refresh.

### Code Path Trace

**Step 1: ChatView.onAppear triggers ViewModel lifecycle**
- `ChatView.swift:68-69`: `.onAppear { viewModel.onAppear() }`
- `ChatViewModel.swift:217-228`: `onAppear()` starts a Task that calls `await loadRecipients()` then `await refresh()`

**Step 2: Constructor loads cache (synchronous in init)**
- `ChatViewModel.swift:124`: `loadFromCache()` called in `init()`
- `ChatViewModel.swift:149-156`: `loadFromCache()` calls `ResponseCache.shared.loadPersistedChatMessages()`
- `ResponseCache.swift:185-193`: `loadPersistedChatMessages()` loads from UserDefaults only if `chatMessages.isEmpty`

**Step 3: Cache is NOT per-agent scoped**
- `ResponseCache.swift:37`: `chatMessages` is a single flat array for ALL agents
- `ResponseCache.swift:172-180`: `persistChatMessages()` saves the last 50 messages across all agents
- When `loadFromCache()` populates `messages`, it includes messages for ALL agents, not just `selectedRecipient`
- However, `handleIncomingMessage()` at line 442 filters by `selectedRecipient`, so incoming WS messages are correctly scoped

**Step 4: loadRecipients() is the gatekeeper**
- `ChatViewModel.swift:221`: `await loadRecipients()` must complete before `refresh()`
- `ChatViewModel.swift:323-333`: `loadRecipients()` calls `self.apiClient.getAgents()` inside `performAsyncAction(showLoading: false)`
- If this network call fails (timeout, no connectivity on cold start), the catch in `BaseViewModel.performAsync` at line 74-83 calls `handleError(error)` and returns `nil`
- `loadRecipients()` then calls `loadUnreadCounts()` which also awaits network
- **If `loadRecipients()` fails, `refresh()` never fires** -- the user sees blank screen permanently

**Step 5: refresh() replaces messages with API results**
- `ChatViewModel.swift:278-314`: `refresh()` calls `getMessages(agentId: selectedRecipient)`
- Line 310: `self.messages = serverMessages` -- this REPLACES the cache-loaded messages
- Due to the conversation scoping bug, `serverMessages` contains only agent messages, no user messages
- If the API returns 0 messages (empty conversation, or wrong agent scope), the UI goes blank

**Step 6: Empty string selectedRecipient in non-gastown mode**
- `ChatViewModel.swift:24`: `selectedRecipient` defaults to `""` in non-gastown mode
- `loadRecipients()` at line 328-331 sets it to first agent's ID after loading
- But if `refresh()` fires before recipients load (race condition), it queries `agentId=""` which matches zero rows

### Root Cause

Three compounding bugs:

1. **Blocking dependency on network**: `loadRecipients()` failure blocks `refresh()` permanently. No retry, no fallback to cached data. (`ChatViewModel.swift:221-223`)

2. **Cache is not per-agent scoped**: `loadFromCache()` loads all agents' messages, but `refresh()` replaces them with single-agent API results. The cache content may not match the selected recipient. (`ResponseCache.swift:37`, `ChatViewModel.swift:310`)

3. **API excludes user messages**: Even when `refresh()` succeeds, only agent messages are returned (conversation scoping bug). If no agent messages exist yet, the screen is blank despite the user having sent messages. (`message-store.ts:176-178`)

### Evidence
- `ChatViewModel.swift:221-223` -- sequential dependency, no error recovery
- `ChatViewModel.swift:310` -- replaces all messages with API response
- `ResponseCache.swift:37` -- single flat array, no per-agent partitioning
- `message-store.ts:176-178` -- `WHERE agent_id = ?` excludes user messages
- `BaseViewModel.swift:74-83` -- error swallowed, returns nil, no retry

### Severity
**Critical** -- Users see blank chat on every cold start until they manually pull-to-refresh, even when cached messages exist.

### Recommended Fix
1. Scope cache per-agent (keyed by agentId)
2. Add retry logic to `loadRecipients()` or decouple it from `refresh()`
3. Fix conversation scoping: backend should filter `WHERE agent_id = ? OR (agent_id = 'user' AND recipient = ?)`
4. Keep cached messages visible until API response arrives (merge, don't replace)

---

## Symptom 2: Messages Lost After Backgrounding

### Reproduction Steps
1. Have active chat with visible messages (both user and agent messages)
2. Background the app for 60+ seconds
3. Return to the app
4. Observe: messages may disappear, or new messages not shown

### Expected Behavior
All previous messages visible + any new messages that arrived while backgrounded.

### Actual Behavior
Messages may disappear on return. New messages not shown until manual refresh.

### Code Path Trace

**Step 1: App backgrounds -- connections stop**
- `AdjutantApp.swift:29`: `.background` phase stops SSE via `DataSyncService.shared.stopEventStream()`
- `ChatViewModel.swift:230-235`: `onDisappear()` calls `wsService.disconnect()` and cancels polling
- `ChatWebSocketService.swift:82-89`: `disconnect()` sets `connectionState = .disconnected`, clears `activeStream`
- iOS kills the WebSocket ~30s after backgrounding (OS-level network teardown)

**Step 2: No chat sync while backgrounded**
- `BackgroundTaskService.swift:190-215`: `performRefresh()` only checks mail and beads -- NO chat message fetch
- `AppDelegate.swift:204-219`: `handleChatMessageNotification()` only schedules a local notification -- it does NOT fetch or cache the message
- Messages arriving while backgrounded are completely lost to the app's local state

**Step 3: App returns to foreground**
- `ChatViewModel.swift:766-773`: `observeForegroundTransitions()` subscribes to `UIApplication.didBecomeActiveNotification`
- On activation, it calls `Task { await self.refresh() }`
- Meanwhile, `ChatView.swift:68-69`: `onAppear` also fires `viewModel.onAppear()` which calls `loadRecipients()` then `refresh()` again
- `handleWebSocketStateChange(.connected)` at line 254 ALSO calls `Task { await refresh() }`
- **Three concurrent `refresh()` calls may race**

**Step 4: refresh() replaces messages with incomplete API data**
- `ChatViewModel.swift:310`: `self.messages = serverMessages`
- Due to conversation scoping bug, only agent messages are returned
- All user-sent messages that were previously visible (from cache + optimistic) are wiped
- If WebSocket hasn't reconnected yet, no real-time user messages arrive to restore them

**Step 5: WebSocket reconnection is slow**
- `WebSocketClient.swift:263`: `maxReconnectAttempts = 10`
- `WebSocketClient.swift:562`: Exponential backoff `min(1 * pow(2, attempt-1), 30)` = 1s, 2s, 4s, 8s, 16s, 30s...
- Full reconnection cycle can take up to ~91 seconds
- `ChatViewModel.swift:259-265`: During reconnection, polling starts -- but polling also calls `refresh()` which has the same scoping bug

**Step 6: Cache update on refresh overwrites good cache with bad data**
- `ChatViewModel.swift:313`: `ResponseCache.shared.updateChatMessages(self.messages)` after refresh
- Since `messages` now only contains agent messages (user messages lost), the cache is overwritten with incomplete data
- Next cold start will load this incomplete cache

### Root Cause

Four compounding bugs:

1. **No background chat sync**: `BackgroundTaskService` refreshes mail and beads but NOT chat messages. APNS handler only posts local notification, doesn't fetch the message. (`BackgroundTaskService.swift:190-215`, `AppDelegate.swift:204-219`)

2. **`onDisappear()` destroys state that `onAppear()` rebuilds slowly**: WebSocket disconnect + polling cancel means zero data channels on resume until reconnection completes. (`ChatViewModel.swift:230-235`)

3. **Conversation scoping bug causes data loss on refresh**: `refresh()` replaces all messages with agent-only API results, losing user messages. Cache is then overwritten with incomplete data. (`ChatViewModel.swift:310,313`)

4. **Triple concurrent refresh race**: `didBecomeActiveNotification`, `onAppear`, and WS `.connected` handler all trigger `refresh()` simultaneously, potentially causing state corruption. (`ChatViewModel.swift:254,222,771`)

### Evidence
- `BackgroundTaskService.swift:190-215` -- `performRefresh()` has no chat fetch
- `AppDelegate.swift:204-219` -- APNS handler only schedules local notification
- `ChatViewModel.swift:230-235` -- `onDisappear()` disconnects WS and cancels polling
- `ChatViewModel.swift:766-773` -- foreground transition handler
- `ChatViewModel.swift:254` -- WS connected handler also refreshes
- `ChatViewModel.swift:310,313` -- refresh replaces messages and overwrites cache

### Severity
**Critical** -- Consistent data loss after any backgrounding longer than ~30 seconds. User messages vanish. Cache corruption compounds the problem across sessions.

### Recommended Fix
1. Add chat message fetch to `BackgroundTaskService.performRefresh()`
2. APNS `chat_message` handler should fetch and cache the message, not just notify
3. Fix conversation scoping to include user messages in API response
4. Don't replace messages on refresh -- merge API results with existing state
5. Deduplicate the triple-refresh on foreground resume

---

## Symptom 3: Pagination Broken

### Reproduction Steps
1. Have a long conversation (50+ messages) with an agent
2. Scroll to the top of the message list
3. Tap "Load Earlier Messages" or let it auto-trigger
4. Observe: no messages load, duplicates appear, or loading spinner never clears

### Expected Behavior
Older messages prepend to list, scroll position preserved, no gaps or duplicates.

### Actual Behavior
One or more of: no messages load, duplicate messages appear, scroll jumps to bottom, loading spinner never clears.

### Code Path Trace

**Step 1: Load more button triggers pagination**
- `ChatView.swift:276-282`: `loadMoreButton.onAppear` auto-triggers `await viewModel.loadMoreHistory()`
- `ChatViewModel.swift:366-395`: `loadMoreHistory()` checks `!isLoadingHistory && hasMoreHistory`

**Step 2: Cursor calculation is wrong**
- `ChatViewModel.swift:374`: `let oldestId = self.messages.filter { !$0.id.hasPrefix("local-") }.first?.id`
- This gets the oldest non-local message's ID
- `ChatViewModel.swift:375-379`: Calls `self.apiClient.getMessages(agentId: ..., beforeId: oldestId, limit: 50)`
- **CRITICAL BUG**: `beforeId` is passed WITHOUT `before` (timestamp)

**Step 3: Backend ignores `beforeId` without `before`**
- `APIClient+Messages.swift:16-40`: Only `beforeId` is in the query params, NOT `before`
- `backend/src/routes/messages.ts:70-71`: Backend reads `before` and `beforeId` from query params
- `backend/src/services/message-store.ts:197-205`: The composite cursor block is:
  ```js
  if (opts.before !== undefined) {  // <-- THIS IS UNDEFINED, so entire block skipped
      const beforeId = opts.beforeId;
      if (beforeId !== undefined) {
          conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
      } else {
          conditions.push("created_at < ?");
      }
  }
  ```
- Since `before` is `undefined`, the ENTIRE pagination block is skipped
- **The `beforeId` param alone has NO effect** -- the query returns the latest N messages again

**Step 4: Duplicate results from re-fetching same page**
- Without pagination working, the API returns the same newest messages again
- `ChatViewModel.swift:388-390`: Deduplication removes duplicates by ID:
  ```swift
  var seen = Set<String>()
  combined = combined.filter { seen.insert($0.id).inserted }
  ```
- So duplicates are removed, but NO new older messages appear
- The user sees no change

**Step 5: `hasMore` never resets to false**
- `ChatViewModel.swift:381-382`: `if response.items.isEmpty { self.hasMoreHistory = false }`
- But the response is NOT empty -- it returns the same latest messages again (because pagination was ignored)
- `ChatViewModel.swift:392`: `self.hasMoreHistory = response.hasMore` -- backend says `hasMore = true` if `messages.length === limit`
- So `hasMoreHistory` stays `true`, and the auto-trigger at `ChatView.swift:277` fires again, creating an infinite loop

**Step 6: `hasMoreHistory` not reset on recipient switch**
- `ChatViewModel.swift:349-363`: `setRecipient()` clears messages but does NOT reset `hasMoreHistory`
- Line 39: `@Published private(set) var hasMoreHistory: Bool = true` -- initialized to `true`
- After switching agents, `refresh()` at line 311 sets `self.hasMoreHistory = response.hasMore`
- But if `refresh()` returns few messages (no limit param in default refresh), `hasMore = false` because `limit` is undefined:
  - Backend: `hasMore: limit !== undefined && messages.length === limit` -- when limit is undefined, `hasMore = false`
- So `hasMoreHistory` becomes `false` after initial load, which is correct
- However, `loadMoreHistory` passes `limit: 50`, which would return `hasMore = true` if there are exactly 50 results

### Root Cause

Two compounding bugs:

1. **Missing `before` timestamp in pagination call**: `loadMoreHistory()` passes `beforeId` but not `before` (the created_at timestamp of the oldest message). The backend's composite cursor pagination requires BOTH `before` AND `beforeId` to work. Without `before`, the entire cursor is ignored and the query returns the latest messages. (`ChatViewModel.swift:374-379`, `message-store.ts:197-205`)

2. **Infinite re-trigger loop**: Since the same messages are returned, `hasMoreHistory` stays `true`, and the auto-trigger `onAppear` at `ChatView.swift:277` fires `loadMoreHistory()` again in an infinite loop. (`ChatView.swift:276-282`, `ChatViewModel.swift:381-392`)

### Evidence
- `ChatViewModel.swift:374-379` -- passes `beforeId` without `before`
- `APIClient+Messages.swift:28-30` -- only adds `beforeId` to query, not `before`
- `message-store.ts:197-205` -- `before` undefined means entire cursor block skipped
- `ChatView.swift:276-282` -- auto-trigger on `onAppear` creates infinite loop
- `message-store.ts:225` -- `ORDER BY created_at DESC, id DESC` with no cursor returns latest

### Severity
**High** -- Pagination is completely non-functional. Users cannot access message history beyond the most recent page. May cause infinite API calls and battery drain from the auto-trigger loop.

### Recommended Fix
1. Pass BOTH `before` (timestamp) AND `beforeId` from the oldest message:
   ```swift
   let oldest = self.messages.filter { !$0.id.hasPrefix("local-") }.first
   let response = try await self.apiClient.getMessages(
       agentId: self.selectedRecipient,
       before: oldest?.createdAt,  // ADD THIS
       beforeId: oldest?.id,
       limit: 50
   )
   ```
2. Add a debounce or cooldown on auto-trigger to prevent infinite loop
3. Reset `hasMoreHistory` in `setRecipient()`

---

## Symptom 4: Intermittent/Unreliable Loading

### Reproduction Steps
1. Use app normally across WiFi to cellular transitions
2. Or: use app during server-side deployments
3. Observe: messages sometimes don't appear, sends silently fail, connection indicator may not match actual state

### Expected Behavior
Messages load reliably regardless of transport changes.

### Actual Behavior
Messages sometimes don't appear, sends silently fail, connection state indicator may be wrong.

### Code Path Trace

**Step 1: WebSocket reconnection exhaustion**
- `WebSocketClient.swift:263`: `maxReconnectAttempts = 10`
- `WebSocketClient.swift:546-549`: After 10 attempts, state becomes `.disconnected` permanently:
  ```swift
  guard reconnectAttempt < maxReconnectAttempts else {
      connectionStateSubject.send(.disconnected)
      isHandlingDisconnect = false
      return
  }
  ```
- **No recovery after 10 failures** -- WebSocket never reconnects until the next `onAppear`/`onDisappear` cycle
- `ChatViewModel.swift:267-271`: `.disconnected` state starts polling, but...

**Step 2: Polling fallback has stale ID check**
- `ChatViewModel.swift:709-728`: Polling loop:
  ```swift
  if let newest = response.items.last, newest.id != lastMessageId {
      await refresh()
  }
  ```
- `lastMessageId` is set at line 312: `self.lastMessageId = serverMessages.filter { !$0.id.hasPrefix("local-") }.last?.id`
- Due to conversation scoping bug, `lastMessageId` is the ID of the newest AGENT message
- If a new USER message arrives (which isn't returned by the API), `newest.id` stays the same
- Polling never detects new user messages
- Also: if no messages exist, `response.items.last` is nil, and the `if let` fails silently -- polling never triggers refresh for empty conversations

**Step 3: Error swallowing in performAsync**
- `BaseViewModel.swift:74-83`: `performAsync` catches all errors:
  ```swift
  } catch is CancellationError {
      return nil  // Silently swallowed
  } catch {
      if showLoading { isLoading = false }
      handleError(error)
      return nil
  }
  ```
- `handleError` sets `errorMessage` but does not trigger retry
- `ChatViewModel.swift:720-725`: Polling error path:
  ```swift
  } else {
      markConnectionFailure()
  }
  ```
- `markConnectionFailure()` at line 800-805 only updates `connectionState` -- no retry, no escalation
- **Network errors are silently absorbed** with no path to recovery

**Step 4: WiFi to cellular transition**
- iOS `URLSession` may not immediately close the WebSocket during network transitions
- `WebSocketClient.swift:381`: `config.waitsForConnectivity = true` -- this means URLSession will wait for connectivity instead of failing fast
- But the existing WebSocket task may become a zombie -- connected according to `readyState` but actually dead
- `WebSocketClient.swift:131`: `send()` checks `client.ws.readyState === WebSocket.OPEN` but this may be stale
- Messages sent to a zombie socket are silently dropped

**Step 5: Connection state indicator can be wrong**
- `ChatViewModel.swift:245-272`: `handleWebSocketStateChange()` maps WS states to UI states
- Line 249: `.connected` sets `connectionState = .connected` and stops polling
- But the WS may be a zombie (Step 4) -- UI says "connected" but messages aren't flowing
- No heartbeat/health check mechanism on the iOS side (server pings at 30s, but client doesn't track pong timing)

**Step 6: No retry queue for failed sends**
- `ChatViewModel.swift:513-515`: WS send is fire-and-forget:
  ```swift
  wsService.sendMessage(to: selectedRecipient, body: text, clientId: clientId)
  ```
- `WebSocketClient.swift:527`: `webSocketTask?.send(.string(text)) { _ in }` -- error callback is ignored
- If the socket is actually dead, the message is lost
- No retry queue, no fallback to HTTP on WS send failure
- The optimistic message stays as `deliveryStatus: .pending` forever (no timeout to mark as failed)

**Step 7: Polling doesn't backoff on failure**
- `ChatViewModel.swift:709-728`: Polling is a fixed 30s loop with no backoff
- If the server is down, polling hammers it every 30s
- No circuit breaker, no exponential backoff
- Conversely, when recovering, 30s is a long time to wait for first recovery check

### Root Cause

Six compounding issues:

1. **Permanent WebSocket death after 10 reconnects**: No recovery mechanism. WS stays dead until view lifecycle resets it. (`WebSocketClient.swift:546-549`)

2. **Polling stale ID comparison**: `lastMessageId` based on agent-only messages, so new user messages don't trigger refresh. Empty conversations never trigger refresh. (`ChatViewModel.swift:720`)

3. **Silent error absorption**: `performAsync` catches errors and sets `errorMessage` but provides no retry path. Network failures are logged and forgotten. (`BaseViewModel.swift:74-83`)

4. **Zombie socket on network transitions**: `waitsForConnectivity = true` plus no client-side heartbeat means the WS can appear connected but actually be dead. (`WebSocketClient.swift:381`)

5. **Fire-and-forget sends**: WS send errors are ignored, no retry queue, no HTTP fallback for individual messages. Pending messages have no timeout. (`ChatViewModel.swift:513-515`, `WebSocketClient.swift:527`)

6. **Fixed polling interval**: No backoff on failure, no faster initial recovery check. (`ChatViewModel.swift:712-713`)

### Evidence
- `WebSocketClient.swift:546-549` -- permanent disconnection after 10 attempts
- `ChatViewModel.swift:709-728` -- polling loop with stale ID check
- `BaseViewModel.swift:74-83` -- error swallowing, no retry
- `WebSocketClient.swift:381` -- `waitsForConnectivity = true`
- `WebSocketClient.swift:527` -- send error callback ignored
- `ChatViewModel.swift:513-515` -- fire-and-forget WS send
- `ChatViewModel.swift:712-713` -- fixed 30s polling, no backoff

### Severity
**High** -- Multiple failure modes compound to make the app unreliable during any network instability. Silent failures mean users don't know their messages aren't being delivered.

### Recommended Fix
1. Add recovery mechanism after WS exhaustion (periodic re-try every 5 min, or on network change)
2. Fix polling comparison to detect any new message (not just agent messages)
3. Add client-side heartbeat tracking (detect zombie sockets)
4. Add retry queue for failed sends with exponential backoff
5. Fall back to HTTP send when WS send fails
6. Add exponential backoff to polling failures, faster interval on recovery

---

## Summary Table

| Symptom | Severity | Root Causes | Key Files |
|---------|----------|-------------|-----------|
| Blank chat on open | Critical | Blocking loadRecipients, unscoped cache, conversation scoping bug | ChatViewModel:217-228, ResponseCache:37, message-store:176-178 |
| Messages lost after background | Critical | No background sync, refresh replaces messages, triple-refresh race | BackgroundTaskService:190-215, ChatViewModel:310,766-773 |
| Pagination broken | High | Missing `before` timestamp, infinite re-trigger loop | ChatViewModel:374-379, message-store:197-205, ChatView:276-282 |
| Intermittent/unreliable | High | WS death permanent, stale poll ID, zombie sockets, fire-and-forget sends | WebSocketClient:546-549, ChatViewModel:709-728, BaseViewModel:74-83 |

## Cross-Cutting Fix Priority

The **conversation scoping bug** (`message-store.ts:176-178`) affects Symptoms 1, 2, and 4. Fixing the backend query to include both sides of a conversation would resolve the most issues with a single change:

```sql
WHERE (agent_id = ? OR (agent_id = 'user' AND recipient = ?))
```

The **pagination bug** (missing `before` timestamp in `loadMoreHistory`) is the simplest fix with the highest impact-to-effort ratio.
