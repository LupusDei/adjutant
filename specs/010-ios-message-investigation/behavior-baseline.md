# iOS App Behavior Baseline

**Epic**: adj-012 | **Task**: adj-012.1.2
**Generated**: 2026-02-21

## Platform

- **App**: Adjutant iOS (native Swift/SwiftUI)
- **Target**: iOS 17+
- **Transport**: WebSocket primary → SSE fallback → HTTP polling fallback
- **Backend**: Node.js/Express + SQLite message store
- **Recent fix**: adj-nqu (2026-02-21) — iOS chat history lost on background/kill

## Known Working Behaviors

| Feature | Status | Notes |
|---------|--------|-------|
| Send message (HTTP fallback) | Works | POST /api/messages when WS unavailable |
| Send message (WebSocket) | Works | Real-time delivery when connected |
| Receive message (WebSocket) | Works | When WS active and stable |
| Agent selector | Works | RecipientSelector shows available agents |
| Unread badges | Partial | Initial load works, real-time update unreliable |
| Voice input/output | Works | Speech recognition + TTS synthesis |
| APNS push notifications | Works | Notifications arrive, content correct |
| Pull-to-refresh | Works | Manual refresh fetches latest messages |

## Known Failing Behaviors

### Symptom 1: Blank Chat on Open
**Frequency**: Intermittent — more common on cold start, less after warm start
**Reproduction**: Open app → navigate to Chat tab → see empty message list
**Expected**: Messages from last session visible immediately (from cache), then live data loads
**Actual**: Blank screen, sometimes for several seconds, sometimes permanently until pull-to-refresh
**Suspected Cause Chain**:
1. `onAppear()` calls `loadRecipients()` first, which is async
2. `refresh()` doesn't fire until recipients load
3. `loadFromCache()` returns empty array if:
   - First launch (no UserDefaults data)
   - UserDefaults data corrupted or evicted by iOS
   - Cache was for a different agent than the auto-selected one
4. If `loadRecipients()` fails (network timeout), `refresh()` never fires

### Symptom 2: Messages Lost After Backgrounding
**Frequency**: Consistent — especially after >30 seconds in background
**Reproduction**: Have active chat with messages → background app for 60+ seconds → return to app
**Expected**: All previous messages visible + any new messages that arrived while backgrounded
**Actual**: Messages may disappear, or new messages not shown until manual refresh
**Suspected Cause Chain**:
1. `onDisappear()` cancels polling task
2. `AdjutantApp.onChange(scenePhase: .background)` stops EventStream (SSE)
3. WebSocket disconnects (iOS kills background network connections after ~30s)
4. While backgrounded: no chat sync — `BackgroundTaskService` only refreshes mail/beads
5. On return: `observeForegroundTransitions()` calls `refresh()` but:
   - WebSocket reconnection may not be complete yet
   - Polling doesn't restart until WS reconnection fails enough times
   - If cache was updated with empty/stale data, UI flashes blank

### Symptom 3: Pagination Broken
**Frequency**: Intermittent — depends on conversation length and timing
**Reproduction**: Long conversation (50+ messages) → scroll to top → tap "Load More" or auto-trigger
**Expected**: Older messages prepend to list, scroll position preserved, no gaps or duplicates
**Actual**: One or more of: no messages load, duplicate messages appear, scroll jumps to bottom, loading spinner never clears
**Suspected Cause Chain**:
1. `loadMoreHistory()` takes oldest message's `id` as `beforeId` cursor
2. If that message was removed by deduplication or cache eviction, cursor is invalid
3. Backend returns 0 results for invalid cursor (no fallback to timestamp)
4. `hasMore` not reset when switching recipients — stale flag from previous agent
5. Deduplication may remove messages that pagination just fetched (same IDs from cache + API)

### Symptom 4: Intermittent/Unreliable Loading
**Frequency**: Sporadic — correlated with network transitions, backgrounding, concurrent operations
**Reproduction**: Use app normally across WiFi→cellular transitions, or during server-side deployments
**Expected**: Messages load reliably regardless of transport changes
**Actual**: Messages sometimes don't appear, sends silently fail, connection state indicator may not reflect actual state
**Suspected Cause Chain**:
1. WebSocket reconnection: max 10 attempts with exponential backoff (1s→30s)
2. After 10 failed reconnects, falls back to polling at fixed 30s interval — no backoff
3. Polling checks `newest.id != lastMessageId` — if that ID is stale, poll never triggers refresh
4. `performAsync()` swallows network errors — `markConnectionFailure()` only updates UI state
5. No retry queue for failed sends — fire-and-forget
6. Network transition (WiFi→cellular) may not trigger WebSocket close event immediately

## Architecture Observations

### Message Flow (Happy Path)
```
User sends → WS message → Server persists (SQLite) → Server broadcasts (WS)
                                                    → Server sends APNS
                                                    → Server delivers to tmux

Agent sends → MCP tool → Server persists (SQLite) → Server broadcasts (WS)
                                                   → Server sends APNS
```

### Cache Strategy
- **In-memory**: `ResponseCache.chatMessages` — unlimited, lost on app kill
- **UserDefaults**: Last 50 messages — survives app kill, slow writes
- **No per-agent scoping**: Cache stores messages for all agents, filtered client-side

### Real-time Channels
1. WebSocket `/ws/chat` — bidirectional, auth handshake, sequence numbering
2. SSE `/api/events` — system events only (not chat), stopped on background
3. HTTP polling — 30s fixed interval, full message fetch each time

### Known Gaps
- No offline message queue (sends fail silently when disconnected)
- No background chat sync (only mail/beads refreshed in background)
- No per-agent cache partitioning (agent switch shows wrong cached messages briefly)
- No connection state indicator in chat UI (user doesn't know when disconnected)
- No exponential backoff on polling failures
- UserDefaults write on every WS message (performance concern)
