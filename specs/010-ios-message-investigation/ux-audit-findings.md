# iOS Chat UX Audit Findings

**Epic**: adj-012 | **User Story**: US3 (Product UX Audit)
**Auditor**: UX Auditor Agent
**Date**: 2026-02-22
**Scope**: End-to-end chat messaging UX on iOS native app (SwiftUI)

## Executive Summary

The Adjutant iOS chat experience has a solid architectural foundation -- WebSocket
with HTTP polling fallback, optimistic UI for sends, streaming token display -- but
the moment-to-moment user experience is riddled with rough edges that erode trust.
The app systematically fails to communicate what is happening during transitions,
leaves the user staring at blank screens when they should see cached data, and
provides no feedback when things go wrong silently. A user switching between agents,
backgrounding the app, or tapping a notification will regularly encounter states
that feel broken, even when the underlying system is working correctly.

The core problem is not missing features but missing **state communication**. The
app knows its connection state, its loading state, its error state -- but it hides
most of this from the user behind blank screens and silent failures.

## Summary Table

| Area | Critical | High | Medium | Low | Total |
|------|----------|------|--------|-----|-------|
| Loading States & Transitions | 2 | 2 | 2 | 0 | 6 |
| Reconnection & Failure UX | 2 | 3 | 1 | 0 | 6 |
| Agent Switching & Scroll | 1 | 2 | 2 | 1 | 6 |
| Notification-to-Chat Flow | 1 | 2 | 1 | 1 | 5 |
| **Total** | **6** | **9** | **6** | **2** | **23** |

---

## Area 1: Loading States and Transitions

### 1.1 State Transition: App Cold Start -> Chat Tab

#### What the User Sees
The user opens the app after it was killed. They navigate to the Chat tab.
`ChatView.onAppear()` fires, which calls `viewModel.onAppear()`. This triggers
an async chain: `loadRecipients()` (network call), then `refresh()` (another network
call). Meanwhile, `loadFromCache()` was called in `init()` and loaded whatever
was in UserDefaults -- but this cache is **global, not per-agent**. If the
auto-selected recipient differs from whoever was cached, the user sees either:

1. **Nothing** -- the cache was empty or for a different agent, so `messages` is `[]`.
   The `isLoading` flag is only true when `messages.isEmpty` (line 278:
   `showLoading: messages.isEmpty`), so the user sees a centered `LoadingIndicator`
   at the bottom of an otherwise blank scroll view.
2. **Wrong messages** -- the cache contains messages from a previous agent. These
   flash briefly until `refresh()` completes and replaces them with the correct
   agent's messages.

During a slow network (cellular, tunnel), the blank/wrong state can persist for
3-10 seconds.

#### What the User Expects
Instant display of the last conversation they were having, like Messages or WhatsApp.
On first launch, a clear "Loading..." skeleton or placeholder. Never wrong data.

#### Gap Analysis
- **No skeleton screen**: The chat area is an empty `ScrollView` with a small
  spinner tucked at the bottom. On a phone screen, the spinner may not even be
  visible if the scroll view is short.
- **Cache not agent-scoped**: `ResponseCache.chatMessages` stores ALL messages
  globally, persists only the last 50, and `loadFromCache()` loads them all
  regardless of which agent is selected. This means cold start will show
  cross-agent messages until the first `refresh()` completes.
- **Two sequential network calls before any data**: `loadRecipients()` must
  complete before `refresh()` fires. If the agents endpoint is slow, the user
  waits for both round-trips before seeing anything.

#### Impact Rating
- **Severity**: Critical
- **Frequency**: Always (on every cold start)
- **User Feeling**: Confused -- "Is the app broken? Where are my messages?"

#### Recommendation
1. Scope the UserDefaults cache per-agent so cold start loads the right conversation.
2. Show a skeleton/placeholder with the agent name header immediately, not a blank
   scroll view.
3. Fire `loadRecipients()` and `refresh()` concurrently (or cache the last-selected
   recipient locally so `refresh()` can start immediately).

---

### 1.2 State Transition: Pull-to-Refresh

#### What the User Sees
The user pulls down on the message list. SwiftUI's native `.refreshable` modifier
activates, showing the system pull-to-refresh spinner. Under the hood, this calls
`viewModel.refresh()`, which calls `performAsyncAction(showLoading: messages.isEmpty)`.
Because messages are usually not empty during a pull-to-refresh, `showLoading` is
`false` -- meaning the `isLoading` flag is NOT set. The only feedback is the system
spinner, which disappears when the async call completes.

If the network call fails, `performAsync` catches the error and calls
`handleError()`, which sets `errorMessage`. An `ErrorBanner` appears at the bottom
of the scroll view (line 224-232). But the error banner is inside the scroll view,
below all messages -- the user has to scroll to the bottom to see it.

#### What the User Expects
Pull-to-refresh should feel snappy. If it fails, the error should be visible
immediately (like a toast at the top, not buried at the bottom of a long list).

#### Gap Analysis
- The pull-to-refresh itself works mechanically, but errors are invisible.
- The error banner is positionally at the bottom of the LazyVStack, below all
  messages and the loading indicator. After pulling to refresh, the user's
  scroll position is at the top -- the error is off-screen.

#### Impact Rating
- **Severity**: Medium
- **Frequency**: Sometimes (only when refresh fails)
- **User Feeling**: Confused -- pulls to refresh, nothing visibly changes, doesn't
  know it failed

#### Recommendation
1. Show error banners as a floating overlay or at the top of the view (outside the
   scroll view), not inside the message list.
2. Provide haptic feedback on refresh completion (success or failure).

---

### 1.3 State Transition: Scrolling Up to Load History (Pagination)

#### What the User Sees
When `hasMoreHistory` is true, a "LOAD EARLIER MESSAGES" button appears at the
top of the message list. It has an `onAppear` modifier that auto-triggers
`loadMoreHistory()` when the button scrolls into view (line 277-280). While loading,
it shows a small `LoadingIndicator` with "LOADING..." text.

The problems:
1. **Scroll position jumps**: When older messages are prepended to the array,
   `messages` changes. The `onChange(of: viewModel.messages.count)` handler
   calls `scrollToBottom()` (line 81-83). This means every time history loads,
   the view forcibly scrolls to the bottom, losing the user's position entirely.
2. **Auto-trigger can loop**: The `onAppear` on the load-more button fires
   whenever it enters the viewport. After loading, if the new messages don't
   push the button off-screen, it fires again immediately.
3. **`hasMore` stale across agents**: The behavior-baseline notes that `hasMore`
   is not reset properly when switching recipients.

#### What the User Expects
Scrolling up loads older messages seamlessly. Scroll position stays where it was
(anchored to the message they were reading). This is how every modern chat app works.

#### Gap Analysis
The `scrollToBottom()` call on `messages.count` change is the most damaging UX bug
in the chat flow. The user scrolls up to read old messages, history loads, and they
are yanked to the bottom. They have to scroll up again, which triggers another load,
which yanks them down again. This is a frustration loop.

#### Impact Rating
- **Severity**: Critical
- **Frequency**: Always (every pagination load)
- **User Feeling**: Frustrated -- "I keep getting pulled to the bottom, I can't
  read old messages"

#### Recommendation
1. Do NOT call `scrollToBottom()` when messages are prepended (history load). Only
   scroll to bottom when a NEW message arrives at the end.
2. Use `ScrollView`'s `scrollPosition` (iOS 17+) or anchor the scroll to the
   first previously-visible message after prepending.
3. Guard the `onAppear` auto-trigger with a debounce or "already loading" check.

---

### 1.4 State Transition: Agent Switch (Loading Moment)

#### What the User Sees
User taps the recipient selector, picks a different agent. `setRecipient()` fires:
it sets `messages = []` immediately (line 352), then calls `refresh()`. Between the
array clear and the refresh response, the user sees:

1. The empty state view ("NO MESSAGES / Send a message to start a conversation
   with [AGENT]") flashes briefly if `isLoading` is false.
2. Then a loading spinner appears (if `messages.isEmpty` triggers `showLoading`).
3. Then messages populate.

This entire sequence takes 0.5-3 seconds depending on network latency.

#### What the User Expects
Tapping an agent should feel like switching a conversation in Messages -- instant
switch with cached data, then quiet background refresh.

#### Gap Analysis
- Messages are wiped to `[]` immediately, guaranteeing a blank flash.
- No per-agent message cache means there's nothing to show during the transition.
- The empty state ("NO MESSAGES") appearing during a loading transition is
  misleading -- it implies there are no messages when the user knows there are.

#### Impact Rating
- **Severity**: High
- **Frequency**: Always (every agent switch)
- **User Feeling**: Annoyed -- brief flash of "NO MESSAGES" is confusing

#### Recommendation
1. Cache messages per-agent so switching back shows cached data immediately.
2. Don't show the empty state while `isLoading` is true -- show a loading
   skeleton instead.
3. Consider keeping old messages visible (dimmed) while loading the new agent's
   messages, similar to how web apps handle tab switches.

---

### 1.5 State Transition: Return from Background

#### What the User Sees
User backgrounds the app for 60+ seconds, then returns. The sequence:

1. `AdjutantApp.onChange(scenePhase: .active)` calls `DataSyncService.shared.startEventStream()`
   -- this restarts the SSE stream for system events (not chat).
2. `ChatViewModel.observeForegroundTransitions()` is listening for
   `UIApplication.didBecomeActiveNotification`, which calls `refresh()`.
3. The WebSocket was disconnected by iOS during background (after ~30s).
   `ChatWebSocketService` will be in a `disconnected` or `reconnecting` state.
4. Reconnection happens asynchronously via `handleWebSocketStateChange`.

The user sees: their old messages (from in-memory cache, which survives
backgrounding), then after `refresh()` completes, messages update. If the WebSocket
reconnects, `handleWebSocketStateChange(.connected)` triggers another `refresh()`.
So there may be two sequential refreshes on foreground return.

If the user was away for a while and new messages arrived, they appear after the
refresh -- but without any animation or indication that new messages just loaded.
The view silently scrolls to bottom (via `onChange(of: messages.count)`).

#### What the User Expects
Smooth return to the exact state they left, plus any new messages clearly indicated
(e.g., a "New messages" divider or count badge within the conversation).

#### Gap Analysis
- Return from background usually works but can produce a brief stale-data flash.
- No "X new messages" indicator after catching up.
- Double-refresh (from foreground notification + WS reconnect) is wasteful.
- If `refresh()` fails silently (network still reconnecting), messages remain
  stale with no indication.

#### Impact Rating
- **Severity**: Medium
- **Frequency**: Often (every background/foreground cycle > 30s)
- **User Feeling**: Mildly confused -- no clear indication of what changed

#### Recommendation
1. Deduplicate the foreground-return refresh (gate it so only one fires).
2. Add a "New messages" separator line when messages arrive after a background gap.
3. If refresh fails on foreground return, show a brief inline banner.

---

### 1.6 State Transition: First Load with No Messages (Empty State)

#### What the User Sees
When selecting an agent with no message history, after loading completes, the user
sees a centered icon (speech bubbles), "NO MESSAGES" header, and "Send a message to
start a conversation with [AGENT]." in dimmed text.

#### What the User Expects
The empty state should feel inviting, not dead. Modern apps use empty states as
onboarding moments.

#### Gap Analysis
- The empty state is functional but spartan. No suggested actions, no example
  messages, no personality.
- The copy "Send a message to start a conversation" is generic. For a retro
  terminal-themed app, something more thematic would fit.
- The same empty state flashes during loading transitions (see 1.4), which is
  the real problem.

#### Impact Rating
- **Severity**: High
- **Frequency**: Sometimes (new agents, first use)
- **User Feeling**: Uncertain -- "Is this working? What should I do?"

#### Recommendation
1. Add a thematic empty state: "CHANNEL CLEAR. TRANSMIT WHEN READY." or similar.
2. Conditionally show: if `isLoading`, show skeleton; if `!isLoading && messages.isEmpty`,
   show the empty state. Never show empty state during transitions.

---

## Area 2: Reconnection and Failure UX

### 2.1 State Transition: WebSocket Connected -> Disconnected

#### What the User Sees
The `ConnectionStatusBadge` in the top-right corner of the chat header changes from
a green "WS" badge to a yellow "HTTP CONNECTING" badge, then to a red "HTTP OFFLINE"
badge if reconnection fails entirely. The badge is small (roughly 40x20 points) and
uses a 6px status dot with 10pt text.

However, **there is no banner, toast, or prominent indicator** that the connection
dropped. The user has to notice a tiny badge color change from green to yellow in the
corner of the header. On a phone, with the user focused on reading messages, this is
effectively invisible.

Meanwhile, the app silently falls back to HTTP polling at 30-second intervals. The
user has no idea their real-time experience has degraded to checking every 30 seconds.

#### What the User Expects
Every modern messaging app handles this prominently:
- **Slack**: Yellow bar at the top: "Reconnecting..."
- **WhatsApp**: Gray bar: "Connecting..."
- **iMessage**: Silently reconnects but shows "Not Delivered" on individual messages

The user expects a clear, impossible-to-miss indicator when real-time messaging is
disrupted.

#### Gap Analysis
The `ConnectionStatusBadge` exists and technically shows the right state. But its
size and position make it an expert-only feature. A regular user will never notice
the connection dropped until they realize messages aren't arriving in real-time.

The fallback to 30-second polling means the user could wait up to 30 seconds to see
a reply they're actively waiting for, with zero indication of the delay.

#### Impact Rating
- **Severity**: Critical
- **Frequency**: Often (WebSocket drops on WiFi/cellular transitions, backgrounding,
  server deploys)
- **User Feeling**: Confused -- "Why did they stop responding?" when the message is
  sitting in a 30-second poll queue

#### Recommendation
1. Add a prominent reconnection banner at the top of the chat view (below the header,
   above messages) when `connectionState != .connected`. Yellow background, pulsing
   animation: "RECONNECTING... MESSAGES MAY BE DELAYED."
2. When in polling fallback, show: "REAL-TIME UNAVAILABLE. CHECKING EVERY 30S."
3. Make the banner dismissible but auto-reappear if state doesn't improve.

---

### 2.2 State Transition: Message Send Succeeds -> Message Send Fails

#### What the User Sees
User types a message and taps send. The message appears immediately in the chat
(optimistic UI) with a clock icon showing pending delivery status (line 118-122 of
ChatBubble.swift). If the WebSocket is connected, the message is sent via WS and
delivery confirmation comes back, replacing the clock with nothing (delivered state
has no indicator).

**If the send fails:**
- **WebSocket path**: The message is sent via `wsService.sendMessage()`. The
  `WebSocketClient.send()` method has a completion handler that ignores errors
  (line 527: `webSocketTask?.send(.string(text)) { _ in }`). The message stays
  in `pendingLocalMessages` forever. The clock icon persists indefinitely. There
  is no retry mechanism, no failure state, no way for the user to resend.
- **HTTP fallback path**: `apiClient.sendChatMessage()` is called inside
  `performAsyncAction(showLoading: false)`. If it throws, `handleError` sets
  `errorMessage`, which shows an error banner at the bottom of the scroll view.
  But the optimistic message is still displayed -- now the user sees their
  message (looking sent) AND an error banner (saying it failed). Confusing.

In neither path does the message bubble turn red, show a retry button, or give
any clear per-message failure indication.

#### What the User Expects
- **iMessage**: Failed messages turn red with an exclamation mark and "Not Delivered"
  text. Tapping shows a retry option.
- **WhatsApp**: Single gray checkmark stays, no double-blue-check. Long-press to retry.
- **Slack**: Red warning icon with "Message not sent. Click to retry."

The user expects **per-message failure indication** with a clear retry action.

#### Gap Analysis
The optimistic UI is well-implemented for the happy path (message appears instantly,
clock icon, then confirmed). But the failure path is completely unhandled:
- WS send errors are silently swallowed
- No timeout on pending confirmation (clock icon persists forever)
- No retry queue or mechanism
- No per-message failure UI (red bubble, exclamation mark, retry button)
- The generic error banner is disconnected from the specific message that failed

#### Impact Rating
- **Severity**: Critical
- **Frequency**: Sometimes (network transitions, WS disconnect during send)
- **User Feeling**: Frustrated -- "Did my message send? Why is the clock still
  showing? Should I resend? Will that create a duplicate?"

#### Recommendation
1. Add a timeout on pending messages (e.g., 15 seconds). If no delivery confirmation,
   mark as failed.
2. Add a `failed` delivery status with red styling and a retry button on the bubble.
3. Implement a retry queue that attempts to resend failed messages on reconnection.
4. Show the clock icon with a subtle animation (pulsing) so it's clear the app is
   still waiting, not frozen.

---

### 2.3 State Transition: SSE/Polling Fallback Activation

#### What the User Sees
When WebSocket reconnection fails (after 10 attempts), the app falls back to HTTP
polling. `handleWebSocketStateChange(.disconnected)` calls `startPolling()`, which
polls every 30 seconds. The `communicationMethod` changes from `.websocket` to `.http`,
and `connectionState` goes to `.disconnected`. The `ConnectionStatusBadge` shows
"HTTP OFFLINE".

The word "OFFLINE" is misleading -- the app IS online (HTTP polling works), it just
lost its real-time channel. But the badge says "OFFLINE" in red, which implies no
connectivity at all.

#### What the User Expects
If the app can still send and receive messages (via HTTP), it should say "Connected"
or "Degraded" -- not "OFFLINE". Offline means airplane mode, no internet. This is
a protocol downgrade, not an outage.

#### Gap Analysis
- The `ConnectionState.disconnected` label is "OFFLINE" with an `.offline` status
  type (line 43-44 of ConnectionStatusBadge.swift). This is semantically wrong for
  the HTTP-polling-active case.
- No differentiation between "WebSocket down, polling active" and "no network at all"
- The user gets a scary red "OFFLINE" when messages are still flowing (just with 30s
  latency)

#### Impact Rating
- **Severity**: High
- **Frequency**: Sometimes (after WS failure, during polling)
- **User Feeling**: Anxious -- "Am I offline? Is anything working?"

#### Recommendation
1. Add a `ConnectionState.degraded` case for "HTTP polling active but WebSocket unavailable."
   Label it "DEGRADED" or "POLLING" with a yellow/amber color.
2. Reserve "OFFLINE" for when `NetworkMonitor.shared.isConnected` is actually false.
3. Show the polling interval in the degraded state: "POLLING (30S)".

---

### 2.4 State Transition: Offline -> Online (Network Restored)

#### What the User Sees
The phone loses network (airplane mode, dead zone) and then regains it.
`observeNetworkChanges()` watches `NetworkMonitor.shared.$isConnected`. When it goes
false, `connectionState = .disconnected`. When it goes true, `connectionState = .connecting`.

But here's the gap: nothing else happens. The WebSocket is still disconnected. If it
already exhausted its 10 reconnect attempts, it stays dead. No new reconnection
attempt is triggered by network restoration. The user has to kill and restart the app
to get WebSocket back.

The polling fallback may still be running (it was started when WS failed), but if the
polling task was also cancelled (via `onDisappear` or app lifecycle), then the user is
in a state where the badge says "CONNECTING" (because network is back) but nothing is
actually connecting.

#### What the User Expects
Network comes back -> app reconnects automatically -> real-time messaging resumes.
This should happen within seconds, transparently.

#### Gap Analysis
- Network restoration doesn't trigger WebSocket reconnection if attempts are exhausted
- `observeNetworkChanges()` only updates the `connectionState` UI label -- it doesn't
  actually trigger any reconnection logic
- There's no "reset and retry" mechanism after network transitions
- The `connecting` label with no actual connection activity is a lie to the user

#### Impact Rating
- **Severity**: High
- **Frequency**: Sometimes (WiFi/cellular transitions, dead zones)
- **User Feeling**: Frustrated -- "I have internet back, why isn't the app working?"

#### Recommendation
1. When `NetworkMonitor` transitions from disconnected to connected, reset the
   WebSocket reconnection counter and trigger a new connection attempt.
2. If in polling mode, immediately trigger a poll (don't wait 30 seconds).
3. Log the network transition for debugging.

---

### 2.5 State Transition: Server Restart / Deploy

#### What the User Sees
The backend restarts (deploy, crash, etc.). The WebSocket drops immediately. The
client enters reconnection mode (up to 10 attempts with exponential backoff
1s -> 2s -> 4s -> ... -> 30s). If the server comes back within the reconnection
window (~2.5 minutes total), the client reconnects successfully.

On reconnection, the client sends a `sync` request with `lastSeqSeen`. The server
replies with any missed messages from its replay buffer (up to 1000 messages or 1
hour). The `handleWebSocketStateChange(.connected)` also triggers `refresh()`, which
fetches all messages from the API.

**The gap**: During the reconnection window, the user sees "HTTP CONNECTING" (yellow),
which is correct but uninformative. There's no indication that the server restarted.
If the replay buffer doesn't cover the gap (messages sent during the ~2.5 minutes
of reconnection), those messages arrive via the `refresh()` call but with no "you
missed X messages" indicator.

#### What the User Expects
Server restarts should be invisible. Messages should never be lost.

#### Gap Analysis
- The reconnection + sync mechanism is actually well-designed technically.
- The user experience during the gap is fine (yellow badge, then green).
- The only issue is no indication of how many messages were missed.
- Edge case: if server restart takes longer than the 10-attempt window, the client
  gives up and falls to polling. The user then sees "OFFLINE" for a server-side issue.

#### Impact Rating
- **Severity**: Medium
- **Frequency**: Rarely (server deploys)
- **User Feeling**: Mildly concerned during the yellow badge phase

#### Recommendation
1. After sync recovery, show a brief toast: "Reconnected. X messages synced."
2. Consider extending the max reconnection attempts for known-server-restart scenarios.

---

### 2.6 State Transition: Rate Limited

#### What the User Sees
The backend rate limits at 60 messages per minute per client. If the user exceeds
this (unlikely in manual chat but possible with automated tools), the server sends
an error message. The `ChatWebSocketService.handleServerMessage` receives the error
type but does nothing with it (line 124-125: `case "error": break`).

The user gets no feedback that they're rate limited.

#### What the User Expects
A clear message: "Slow down. Message rate limit exceeded."

#### Gap Analysis
- Rate limit errors from the WebSocket are silently swallowed.
- No user-facing feedback for rate limiting.

#### Impact Rating
- **Severity**: High
- **Frequency**: Rarely (mostly affects testing/automation)
- **User Feeling**: Confused -- messages silently fail

#### Recommendation
1. Parse WS error messages in `handleServerMessage` and surface rate-limit errors
   to the user via an inline banner or toast.

---

## Area 3: Agent Switching and Scroll Preservation

### 3.1 State Transition: Agent A Chat -> Switch to Agent B -> Switch Back to Agent A

#### What the User Sees
1. User is chatting with Agent A, scrolled to a specific point in the conversation.
2. User taps the recipient selector, picks Agent B.
3. `setRecipient(B)` clears `messages = []`, clears pending state, calls `refresh()`.
4. Agent B's messages load.
5. User switches back to Agent A.
6. `setRecipient(A)` clears `messages = []` again, calls `refresh()`.
7. Agent A's messages load fresh from the server. Scroll position is at the bottom.

The user's scroll position in Agent A's conversation is completely lost. Every
switch wipes state and starts fresh.

#### What the User Expects
Switching back to an agent should restore the exact scroll position and conversation
state, like switching tabs in a browser or conversations in Messages.

#### Gap Analysis
- No per-agent state preservation. `selectedRecipient` changes, messages are wiped,
  fresh fetch happens.
- No scroll position caching per-agent.
- No in-memory per-agent message cache -- every switch triggers a full API fetch.
- This means switching between two agents during an active conversation requires
  2 network round-trips and loses context every time.

#### Impact Rating
- **Severity**: Critical
- **Frequency**: Always (every agent switch)
- **User Feeling**: Frustrated -- "I was reading something and now I can't find it"

#### Recommendation
1. Implement a per-agent message cache (in-memory dictionary: `[String: [PersistentMessage]]`).
   On switch, store current messages and scroll position. On return, restore from cache
   and do a quiet background refresh.
2. Persist scroll position per-agent (store the ID of the first visible message).
3. Only wipe state when the agent is genuinely new (no cached data).

---

### 3.2 State Transition: Unread Badge -> Tap Agent -> Badge Clear

#### What the User Sees
In the `RecipientSelectorSheet`, each agent row shows an unread count badge
(green capsule with white number). When the user taps an agent:

1. `onSelect` is called, which calls `viewModel.setRecipient(agentId)`.
2. Inside `setRecipient()`, `unreadCounts[recipient] = 0` is set immediately (line 359).
3. A background task calls `apiClient.markAllMessagesRead(agentId: recipient)` (line 361).
4. The sheet is dismissed.

The badge clears **immediately on selection**, before the user has actually read any
messages. This is technically correct (the intent to read is established) but differs
from apps like Slack where badges clear as you scroll through unread messages.

Also: `loadUnreadCounts()` is only called during `loadRecipients()`, which happens
on `onAppear`. There is no periodic refresh of unread counts while the chat view is
open. If new messages arrive for other agents while the user is chatting with one
agent, the unread badges in the selector won't update until the user closes and
reopens the selector.

#### What the User Expects
- Badges update in real-time as new messages arrive from other agents.
- Badges clear when messages are actually viewed, not just when the agent is selected.

#### Gap Analysis
- Unread counts are stale: fetched once on appear, never refreshed.
- Badge clearing is eager (on select, not on view/scroll).
- Real-time WS `chat_message` events could update unread counts for non-selected
  agents, but this isn't implemented. `handleIncomingMessage` filters to only the
  selected agent (line 442: `guard message.agentId == selectedRecipient`).

#### Impact Rating
- **Severity**: High
- **Frequency**: Often (every time multiple agents are active)
- **User Feeling**: Annoyed -- "I don't know which agents have new messages unless
  I manually check"

#### Recommendation
1. When a WS `chat_message` arrives for a non-selected agent, increment that agent's
   unread count in the local `unreadCounts` dictionary.
2. Refresh unread counts periodically (or on recipient selector open).
3. Consider clearing badges when the user scrolls past unread messages, not on select.

---

### 3.3 State Transition: Context Switching Between Agents

#### What the User Sees
The chat view feels like a single-channel view that reloads its content on agent
switch. There's no sense of "conversation continuity" -- no breadcrumb of where you
were, no visual transition between agents, no indication of which agent you were
previously talking to.

The header updates the agent name and "DIRECT CHANNEL" subtitle. The messages area
flashes blank then repopulates. There's no slide animation, no cross-fade, no
visual continuity.

#### What the User Expects
A feeling of switching between persistent conversations, like:
- **iMessage**: Conversations are persistent, switching is instant, there's a list
  of conversations with previews.
- **Slack**: Channel sidebar shows where you were, switching preserves scroll.

#### Gap Analysis
- No transition animation between agents.
- The single-view-reloading pattern feels like a page refresh, not a conversation switch.
- No conversation list view showing last message preview per agent.

#### Impact Rating
- **Severity**: Medium
- **Frequency**: Always (multi-agent workflow is the primary use case)
- **User Feeling**: The experience feels utilitarian rather than conversational

#### Recommendation
1. Add a slide-left/slide-right transition when switching agents.
2. Consider a conversation list view (like Messages) as the primary navigation,
   with chat as a drill-down.
3. Show last message preview in the agent selector for context.

---

### 3.4 State Transition: Select Agent with No History (Empty Conversation)

#### What the User Sees
User selects an agent they've never messaged. After loading completes, they see:
- A large speech bubble icon (48pt, dimmed)
- "NO MESSAGES" in subheader style
- "Send a message to start a conversation with [AGENT_NAME]." in body text

The empty state is centered in the scroll view, looks clean, and communicates the
situation. The input area below is ready for typing.

#### What the User Expects
Functional empty state with clear call to action.

#### Gap Analysis
- The empty state works well functionally.
- For the retro terminal theme, the copy could be more thematic.
- Missing: agent status info (online/offline/idle), last seen time, or any context
  about who this agent is and what they do.

#### Impact Rating
- **Severity**: Medium
- **Frequency**: Sometimes (first conversation with a new agent)
- **User Feeling**: Uncertain about whether the agent is available or what they do

#### Recommendation
1. Add agent status/description to the empty state.
2. Theme the copy: "CHANNEL OPEN. NO TRANSMISSIONS LOGGED." or similar.

---

### 3.5 State Transition: Agent Status Visibility

#### What the User Sees
The agent selector shows agent name, ID, type icon, and unread count. There is NO
online/offline/typing/idle status indicator for agents -- neither in the selector
nor in the chat header.

The chat header shows the agent name, "DIRECT CHANNEL" label, and the connection
badge. But the connection badge shows the CLIENT's connection state, not the AGENT's
availability. The user cannot tell if the agent is online, processing, idle, or
crashed.

#### What the User Expects
- **Slack**: Green dot for online, gray for offline, with a status message.
- **Teams**: Colored presence indicator (green/yellow/red/gray).
- The user expects to know: "Is this agent going to see my message?"

#### Gap Analysis
- Agent status (online, processing, idle) is tracked server-side via MCP tools
  (`set_status`, `report_progress`), but this data is never surfaced in the iOS
  chat UI.
- The `CrewMember` model likely has status data, but the `RecipientSelectorSheet`
  doesn't display it.
- No typing indicator for the selected agent in the header (the typing indicator
  is in the message area, which is good, but the header could also show it).

#### Impact Rating
- **Severity**: High
- **Frequency**: Always (users always want to know agent availability)
- **User Feeling**: Uncertain -- "Is this agent even running? Will it respond?"

#### Recommendation
1. Add a colored status dot next to the agent name in both the header and the
   agent selector (green = online, yellow = busy, gray = offline).
2. Show agent status text in the header subtitle (replace "DIRECT CHANNEL" with
   the agent's current status when available).
3. Poll or subscribe to agent status updates.

---

### 3.6 State Transition: Rapid Agent Switching

#### What the User Sees
If the user rapidly switches between agents (taps A, immediately taps B, immediately
taps C), multiple `setRecipient()` calls fire. Each one sets `messages = []` and
calls `refresh()`. But `refresh()` is async -- the responses may arrive out of order.
Because `refresh()` sets `self.messages = serverMessages` unconditionally, the last
response to arrive wins, which may not be the response for the currently selected
agent.

Example: User selects A, selects B, selects C quickly. Refresh for C returns first,
then B, then A. The user sees C's messages briefly, then B's messages (wrong!), then
A's messages (wrong!). They end up looking at Agent A's messages while the header
says Agent C.

#### What the User Expects
Only the final selection matters. Previous requests should be cancelled.

#### Gap Analysis
- No cancellation of in-flight requests when `setRecipient` is called.
- No guard in `refresh()` to check that the response matches the current recipient.
- Classic race condition in concurrent async operations.

#### Impact Rating
- **Severity**: Low (rapid switching is uncommon in practice)
- **Frequency**: Rarely
- **User Feeling**: Confused if they hit the race condition

#### Recommendation
1. In `refresh()`, capture `selectedRecipient` at call start and verify it matches
   before applying results.
2. Or cancel the previous refresh task when `setRecipient` is called.

---

## Area 4: Notification-to-Chat Flow

### 4.1 State Transition: Push Notification Arrives -> User Taps Notification

#### What the User Sees
A push notification arrives (via APNS). The backend sends the notification with
`type: "chat_message"`, `agentId`, `body`, and `messageId`. The `AppDelegate.handleChatMessageNotification()`
schedules a LOCAL notification via `NotificationService.scheduleChatMessageNotification()`.

The notification shows: "Message from [agentId]" as the title, with the message body
(truncated to 100 chars) as the content. The `agentId` is the raw identifier
(e.g., "stukov/adjutant"), not a friendly display name.

When the user taps the notification, `NotificationService.userNotificationCenter(didReceive:)`
fires, which posts a `.navigateToChat` notification with the `agentId`. The
`AppCoordinator` receives this, sets `pendingChatAgentId = agentId`, and calls
`selectTab(.chat)`.

In `ChatView.onAppear()`, the `pendingChatAgentId` is checked. If set, it calls
`viewModel.setRecipient(agentId)`, which clears messages and refreshes.

#### What the User Expects
Tap notification -> instantly see the message that triggered the notification,
in the right conversation, scrolled to the right position.

#### Gap Analysis
- **Agent name is raw ID**: The notification shows "stukov/adjutant" instead of
  "Stukov" or a friendly name. This is an ugly user-facing string.
- **No scroll to message**: After navigation, the chat loads and scrolls to the
  bottom. There's no attempt to scroll to the specific message from the notification.
- **No message highlighting**: The message that triggered the notification isn't
  visually distinguished from other messages.

#### Impact Rating
- **Severity**: High
- **Frequency**: Often (every notification tap)
- **User Feeling**: Annoyed by the raw agent ID, mildly frustrated by no scroll-to-message

#### Recommendation
1. Map `agentId` to a friendly display name in the notification title.
2. Store the `messageId` from the notification and scroll to it after loading.
3. Highlight the target message with a brief glow animation.

---

### 4.2 State Transition: Cold Start from Notification Tap

#### What the User Sees
The app was force-killed. User taps a chat notification. The app launches fresh:
`AppDelegate.didFinishLaunchingWithOptions` runs, registering push and background
tasks. The notification delegate fires `didReceive`, posting `.navigateToChat`.
`AppCoordinator.init()` sets up the notification observer. `pendingChatAgentId` is set.

Then `ContentView` renders, eventually showing the Chat tab (because `selectTab(.chat)`
was called). `ChatView.onAppear()` checks `coordinator.pendingChatAgentId`, finds it,
clears it, and calls `viewModel.setRecipient(agentId)`.

The problem: this is a cold start. `ChatViewModel.init()` calls `loadFromCache()`,
which may load stale/empty/wrong-agent data from UserDefaults. `onAppear()` calls
`loadRecipients()` then `refresh()`. But `setRecipient()` is called from the `onAppear`
block's deep-link handler, which runs concurrently with `onAppear`'s own
`loadRecipients() + refresh()` chain.

Race condition: `setRecipient()` calls `refresh()` while `onAppear()`'s
`loadRecipients() + refresh()` is also running. Two concurrent refreshes for
potentially different recipients.

#### What the User Expects
Cold start from notification should open the right conversation within 2-3 seconds.

#### Gap Analysis
- Race condition between `onAppear`'s lifecycle refresh and the deep-link's
  `setRecipient` call.
- Cold start delay (2-5 seconds) before any messages appear.
- No special loading state for "opening from notification."

#### Impact Rating
- **Severity**: Critical
- **Frequency**: Sometimes (cold start from notification)
- **User Feeling**: Frustrated -- long delay, possible wrong conversation briefly shown

#### Recommendation
1. If `pendingChatAgentId` is set, skip the default `onAppear` refresh and let
   `setRecipient` handle everything.
2. Show a clear "Loading conversation with [Agent Name]..." state during cold start
   from notification.
3. Ensure `setRecipient` cancels any in-flight refresh from `onAppear`.

---

### 4.3 State Transition: Background App -> Notification Tap

#### What the User Sees
The app is backgrounded. A notification arrives and the user taps it. The app returns
to foreground. The flow is similar to the cold start case, but the app is already
initialized. `pendingChatAgentId` is set, `selectTab(.chat)` fires.

If the user was already on the Chat tab with a different agent, the `onAppear` won't
fire (the view never disappeared). The `pendingChatAgentId` check in `onAppear` won't
execute. The user stays on the wrong agent's conversation.

**Wait** -- re-reading the code: `ChatView.onAppear()` does fire when the view appears,
but if the Chat tab was already selected and the view was never removed from the
hierarchy, `onAppear` may not fire again. The `pendingChatAgentId` change is not
observed reactively -- it's only checked in `onAppear`.

#### What the User Expects
Tap notification -> immediately switch to the right agent's conversation, even if
already on the Chat tab.

#### Gap Analysis
- `pendingChatAgentId` is a write-once/read-once value consumed in `onAppear`.
  If the view is already appeared, the pending ID is never consumed.
- No reactive observation of `coordinator.pendingChatAgentId` changes.
- The user taps a notification for Agent B while viewing Agent A's chat, and
  nothing happens.

#### Impact Rating
- **Severity**: High
- **Frequency**: Often (user is on Chat tab, gets notification for different agent)
- **User Feeling**: Frustrated -- "I tapped the notification and nothing happened"

#### Recommendation
1. Add an `onChange(of: coordinator.pendingChatAgentId)` handler in ChatView that
   calls `viewModel.setRecipient()` when the pending ID changes.
2. Or use a Combine publisher from `AppCoordinator` that `ChatViewModel` subscribes to.
3. Clear `pendingChatAgentId` after consumption in either path.

---

### 4.4 State Transition: Stale Notification Tap (Old Message)

#### What the User Sees
The user receives a notification 30 minutes ago but didn't tap it. Now they tap it.
The `messageId` in the notification payload points to a message that's already in
the conversation history. The app navigates to the chat, loads messages (or shows
cached), and scrolls to the bottom.

The specific message from the notification is somewhere in the history, not
highlighted, not scrolled to. The user has to manually scroll to find it.

#### What the User Expects
Tapping any notification (even a stale one) should take them to the specific message.

#### Gap Analysis
- The `messageId` is available in the notification `userInfo` but is never used
  for scroll targeting.
- No concept of "target message" in the chat flow.
- Stale notifications are functionally identical to "open chat" -- they just
  change the agent, not the scroll position.

#### Impact Rating
- **Severity**: Medium
- **Frequency**: Sometimes (depends on notification hygiene habits)
- **User Feeling**: Mildly annoyed -- has to scroll to find the relevant message

#### Recommendation
1. Pass the `messageId` through the deep link flow to `ChatViewModel`.
2. After messages load, scroll to the target message ID and briefly highlight it.
3. If the message is too old to be in the loaded page, load history until found.

---

### 4.5 State Transition: Multiple Notifications from Same Agent

#### What the User Sees
5 messages arrive from the same agent in quick succession. Each generates a separate
local notification via `scheduleChatMessageNotification`. iOS shows them individually
in the notification center. They are NOT grouped by default because the notification
`identifier` is `"chat-\(messageId)"` -- each is unique.

iOS can group notifications by `threadIdentifier`, but `scheduleChatMessageNotification`
does not set this field. The result: 5 individual notifications instead of a grouped
stack like "5 messages from Stukov."

There is no inline reply action. The notification category `CHAT_MESSAGE` has only
"View" and "Dismiss" actions -- no reply text input.

#### What the User Expects
- **iMessage**: Notifications group by conversation. Inline reply available.
- **Slack**: Notifications group by channel. Inline reply available.
- **WhatsApp**: Notifications group by chat. Inline reply available.

#### Gap Analysis
- No `threadIdentifier` set on notifications, preventing OS-level grouping.
- No `UNTextInputNotificationAction` for inline reply.
- Notification title uses raw `agentId`, not friendly name (same as 4.1).

#### Impact Rating
- **Severity**: Low
- **Frequency**: Sometimes (burst of messages from one agent)
- **User Feeling**: Mildly annoyed by notification spam

#### Recommendation
1. Set `content.threadIdentifier = agentId` to enable notification grouping.
2. Add a `UNTextInputNotificationAction` for inline reply.
3. Use `summaryArgument` for grouped notification summary: "5 messages from Stukov."

---

## Cross-Cutting Concerns

### Error Communication Philosophy

The app's error handling follows a pattern of **silent absorption**. Errors are
caught, logged (sometimes), and either set to an `errorMessage` property that's
rendered at the bottom of a scroll view, or simply ignored. This is the most
consistent UX problem across all four audit areas.

**Principle**: Every error that affects the user's ability to communicate should
produce a visible, actionable indicator within 1 second. Silent failures are the
worst UX outcome because they teach the user not to trust the app.

### Connection State as Second-Class Citizen

The connection infrastructure is sophisticated (WebSocket with auth handshake,
sequence tracking, replay buffer, exponential backoff, HTTP polling fallback). But
this sophistication is invisible to the user. The `ConnectionStatusBadge` is the
only surface for all of this complexity, and it's a tiny badge that most users will
never notice.

**Principle**: Connection state should be as prominent as the message input area.
When the user can't send or receive in real-time, they need to know immediately
and unambiguously.

### Cache Architecture Mismatch

The cache is designed for a single-agent conversation, but the app supports multiple
agents. Every agent switch is a full state reset + network fetch. This is the root
cause of most loading-related UX issues (blank flashes, lost scroll position, slow
switches).

**Principle**: Multi-agent support requires multi-conversation state management.
The data architecture needs to match the interaction model.

---

## Priority Ranking (Top 10 Recommendations)

| Priority | Issue | Area | Fix Complexity |
|----------|-------|------|----------------|
| 1 | Per-message send failure UI (retry button) | 2.2 | Medium |
| 2 | Fix scroll-to-bottom on history load | 1.3 | Low |
| 3 | Prominent reconnection banner | 2.1 | Low |
| 4 | Per-agent message cache | 3.1, 1.4 | High |
| 5 | Fix notification tap when already on Chat tab | 4.3 | Low |
| 6 | WS reconnect on network restoration | 2.4 | Medium |
| 7 | Real-time unread count updates | 3.2 | Medium |
| 8 | Notification grouping + inline reply | 4.5 | Low |
| 9 | Agent status indicators | 3.5 | Medium |
| 10 | Friendly agent names in notifications | 4.1 | Low |
