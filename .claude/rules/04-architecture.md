# Architecture Rules

## Layered Architecture

### Backend Layers

1. **Routes** (`backend/src/routes/`)
   - HTTP request/response handling
   - Input validation (Zod)
   - Call services, return responses

2. **Services** (`backend/src/services/`)
   - Business logic
   - Orchestrate beads operations via bd-client
   - Transform data for API responses

3. **MCP Server** (`backend/src/services/mcp-server.ts`)
   - SSE-based MCP server agents connect to
   - Tracks agent connections (session ID to agent ID)
   - Server-side identity resolution via `getAgentBySession`

4. **MCP Tools** (`backend/src/services/mcp-tools/`)
   - `messaging.ts` - send_message, read_messages, list_threads, mark_read
   - `status.ts` - set_status, report_progress, announce
   - `beads.ts` - create_bead, update_bead, close_bead, list_beads, show_bead
   - `queries.ts` - query tools for agent context

5. **Message Store** (`backend/src/services/message-store.ts`)
   - SQLite-backed persistent message storage
   - Full-text search via FTS5
   - Cursor-based pagination

6. **WebSocket Server** (`backend/src/services/ws-server.ts`)
   - Real-time chat at `/ws/chat`
   - Auth handshake, sequence numbering, replay buffer
   - Session terminal streaming (v2)

### Frontend Layers

1. **Components** (`frontend/src/components/`)
   - UI rendering
   - Event handling
   - Use hooks for data

2. **Hooks** (`frontend/src/hooks/`)
   - State management
   - API calls via api service
   - Polling logic

3. **API Service** (`frontend/src/services/api.ts`)
   - HTTP requests to backend
   - Response typing

## Data Flow

### Agent Messaging (MCP)
```
Agent → MCP SSE Transport → MCP Tool Handler → Message Store (SQLite)
                                                      ↓
Frontend  ←  WebSocket broadcast  ←  wsBroadcast  ←  chat_message event
```

### User Messaging (REST + WS)
```
User → POST /api/messages → Message Store (SQLite) → wsBroadcast → WebSocket clients
```

### Conversation Model & Channels (adj-164)

The unified chat model. One first-class `conversation` entity backs BOTH 1:1 DMs and
multi-party channels — never build them as two systems (Rule 9).

**Schema** (migration `033-conversations.sql`):
- `conversations(id, kind['dm'|'channel'], title, archived, created_at, updated_at)`
- `conversation_members(conversation_id, member_id, member_kind['user'|'agent'], role, joined_at, last_read_at)` — PK `(conversation_id, member_id)`
- `messages.conversation_id` — every new message sets it; the single scoping key.

**Service**: `backend/src/services/conversation-store.ts`
- `getOrCreateDm(a, b)` / `dmConversationId(a, b)` — deterministic `dm_<sha1(sorted pair)>`
  id (order-independent), so a pair maps to the same conversation across REST/WS/MCP.
- Channel methods: `createChannel`, `listChannels`, `joinChannel`, `leaveChannel`,
  `postToChannel` (enforces membership), unread via `last_read_at` watermark.

**Routes**: `routes/conversations.ts` (`GET /api/conversations`, `/dm/:agentId`,
`/:id/messages`) and `routes/channels.ts` (`POST /api/channels`, `GET /api/channels`,
`/:id/join`, `/:id/leave`, `/:id/messages`).

**MCP tools**: `mcp-tools/channels.ts` (`create_channel`, `list_channels`, `join_channel`,
`leave_channel`); `send_message` accepts `conversationId` to post to a channel.

**Real-time fan-out** (`ws-server.ts`):
```
DM:      wsBroadcast → ALL authenticated clients (scoped client-side by conversationId)
Channel: wsBroadcastToConversation(id) → subscribed members + the subscribed OPERATOR
         (agents fail-closed on membership; operator "user" exempt — adj-egziw)
```
- WS sync/replay (`clientMayReceive`) gates ONLY channel-kind conversations on membership;
  DMs replay freely (they are broadcast + client-scoped). This closes the channel
  sync-replay leak (adj-2jy4u) without dropping DM history.
- `wsBroadcastToConversation` resolves membership via the conversation store and delivers
  to member + subscribed clients. Non-member AGENTS never receive channel traffic.
- **Operator exemption** (adj-egziw): the operator (`identity: "user"`) receives channel
  fan-out and sync replay for channels they are subscribed to even when not a member.
  Rationale: agent-created channels (MCP `create_channel`) seed only the creating agent
  as a member, and every REST read surface already serves the operator full channel
  history — membership-gating only the live path made open iOS/web channel views
  silently stale (pull-to-refresh worked, live updates never arrived). The subscribe
  opt-in still applies; posting still requires membership.

**Bleed-free contract**: `getMessages({conversationId})` and `searchMessages({conversationId})`
scope STRICTLY to one conversation — no agent/recipient widening. Both web and iOS scope
all reads/writes/real-time by `conversationId`.

### Question Triage (adj-181)

A first-class, triageable agent question/answer system. Agents file anything they need
from the General — both questions that require a decision/answer AND blocking
tasks/actions only the General can complete — via `file_question` (Rule 5 mandate).

**Data model** (migration `034-agent-questions.sql`):
- `agent_questions(id, project_id, agent_id, body, context, category, suggested_options,
  urgency, status, answer_body, chosen_option, answered_by, bead_id, conversation_id,
  created_at, answered_at, updated_at)`
- `category`: `decision|clarification|approval|action_required|other`
  — `action_required` marks a blocking task the General must DO (not just answer).
- `urgency`: `blocking|high|normal|low` — sort order for the triage view.
- `suggested_options`: JSON string array of agent-proposed answer choices (nullable).
- `conversation_id`: set after DM mirror (adj-i8epe fix); links the question row to the
  asker's existing DM conversation so nothing about today's flow is lost.

**Service**: `backend/src/services/question-service.ts` — the single orchestration point
so BOTH REST (Phase 3) and MCP (Phase 2) trigger identical broadcast + push behaviour.
Routes and MCP tools NEVER call the store, ws-server, or apns-service directly.

**Orchestration per operation**:
```
fileQuestion:
  1. questionStore.fileQuestion — persist the record
  2. conversationStore.getOrCreateDm(asker, "user") — reuse existing DM (Rule 9)
  3. messageStore.insertMessage — mirror question into the DM conversation
  4. questionStore.setConversationId — persist conversationId back to the row (adj-i8epe)
  5. wsBroadcast({ type: "question:new", ... })
  6. sendNotificationToAll — APNS push (blocking/high always; normal/low suppressed, adj-96rtr)

answerQuestion:
  1. questionStore.answerQuestion — persist answer (chosenOption XOR/AND answerBody, ≥1 required)
  2. messageStore.insertMessage — mirror answer into asker's DM
  3. wsBroadcast({ type: "question:answered", ... })
  (no APNS push on answer)

dismissQuestion:
  1. questionStore.dismissQuestion — update status
  2. wsBroadcast({ type: "question:dismissed", ... })
  (no APNS push on dismiss)
```

**Key design decisions**:
- **Reuse DM delivery** (Rule 9): filing a question also writes a normal message into
  the existing DM conversation — the triage system adds structure without replacing chat.
- **single orchestration point**: `question-service.ts` is the only caller of the store,
  WS broadcast, and APNS. This ensures REST and MCP paths are always identical.
- **projectId scoping**: every row stores `project_id` (UUID). All queries, events, and
  API filters use `projectId` — never `projectName` or `projectPath`.
- **Server-side asker identity**: `file_question` resolves the calling agent from the MCP
  session via `getAgentBySession` — never client-supplied.
- **answer-contract**: at least one of `answerBody` or `chosenOption` required. When
  `chosenOption` is present and `suggested_options` are stored, the option MUST be in
  the stored list (validated at the store layer).
- **APNS urgency gating** (adj-96rtr): `blocking` and `high` always push when APNS is
  configured; `normal` and `low` do NOT push (suppressed until a user-pref API exists).
- **file_question mandate** (Constitution Rule 5): `file_question` is the REQUIRED channel
  for ANYTHING an agent needs from the General — both questions AND blocking actions.
  `send_message` is for general comms; it is NOT a substitute for the question queue.

**Routes**: `GET /api/questions` (list with `status|projectId|category|agentId|urgency` filters,
default `status=open`), `POST /api/questions/:id/answer`, `POST /api/questions/:id/dismiss`.
Sort: blocking → high → normal → low, then oldest-first within each tier.

**MCP tools** (`mcp-tools/questions.ts`): `file_question`, `answer_question`, `list_questions`.
Cross-project override via the adj-146 `resolveToolProjectContext` pattern.

**WS events**: `question:new`, `question:answered`, `question:dismissed` — part of the
`WsServerMessage` union in `ws-server.ts`. Broadcast to ALL authenticated clients (same
pattern as DM broadcasts).

**APNS push payload** on `question:new`: title `[URGENCY] Question from <agentId>`,
truncated body, `data.screen = "open_questions"` for iOS deep-link.

### Proposal Sharing — Standalone HTML Pages (adj-200)

Proposals are authored as (optionally) rich, self-contained HTML and can be **published**
to a public, no-API-key link. **One composition pipeline, two delivery paths** — there is a
single security surface to audit. Spec: `specs/058-proposal-html-pages/`.

**Data model** (migration `035-proposals-public-html.sql`): proposals gain `html` (nullable
agent-authored body source), `is_public`, `share_token` (UNIQUE, nullable until first
publish), `published_at`. Markdown `description` stays REQUIRED — it drives list previews,
search, and confidence scoring; `html` is additive.

**Composition** (`backend/src/services/proposal-html.ts` → `composeProposalDocument`): wraps
the agent `html` (or, if null, the markdown `description` rendered via markdown-it) in a
branded, readable **"document" aesthetic** (NOT the CRT-green dashboard theme — these pages
are shared with outsiders) and assembles a **self-contained** document: CSS inlined, inline
SVG, `data:` images — zero external resource references, so it renders offline and inside
iOS `loadHTMLString`. A `<meta http-equiv="Content-Security-Policy">` is embedded for
defense-in-depth on non-HTTP surfaces.

**Sanitizer** (`backend/src/services/proposal-sanitize.ts` — the load-bearing security
boundary, served to UNAUTHENTICATED viewers): allows semantic tags, `<style>`, inline
`<svg>`, and `data:` images; strips `<script>`, `on*` handlers, `javascript:`/external
URLs, and `<iframe>`/`<object>`/`<embed>`. sanitize-html (htmlparser2) alone is insufficient
against **mutation-XSS** (e.g. `<svg><style><img onerror>` re-parsing to a live handler in a
spec-compliant browser), so the output is passed through a **parse5 re-serialize fixpoint**
and re-sanitized until stable. The XSS-payload + mXSS regression suite gates merge (adj-200.2.3).

**Public route** (`backend/src/routes/public-proposals.ts`): `GET /p/:token` serves the
composed document with strict CSP and `404`s for unknown / unpublished / private tokens
(indistinguishable — no existence leak). It is mounted BEFORE `apiKeyAuth` and `/p` is in the
middleware bypass list. Publish/unpublish: `POST /api/proposals/:id/publish` (generates a
collision-safe ≥16-char base62 `share_token`, returns the full `publicUrl`) and
`/unpublish` (revokes; the token is retained so a later re-publish revives the same link).
The public base URL is derived honoring `X-Forwarded-*` (`backend/src/utils/public-url.ts`)
so share links are correct behind a tunnel/reverse-proxy.

**Authoring** (`mcp-tools/proposals.ts`): `create_proposal`/`revise_proposal` accept `html`
and `public`; `publish_proposal`/`unpublish_proposal` return the public URL. Tool
descriptions document the self-contained contract (inline CSS/SVG, no external resources, no
scripts).

**Delivery paths**: (1) public link — `GET /p/:token`, shared with anyone; (2) embedded
in-app reading of PRIVATE proposals — web renders the html in a **sandboxed `<iframe srcdoc>`**
(no `allow-scripts`), iOS via `WKWebView.loadHTMLString`. Both consume the same composed
document, so there is no per-surface rendering logic.

### Artifacts run JavaScript — "may run, may not talk" (adj-artifact-js)

Artifacts (`/a/:token`, the in-app `ArtifactViewer`, and the `.html` download) are **interactive
pages**: inline `<script>` and `on*` handlers are permitted and encouraged. Proposals are NOT —
they stay static documents on the original strip-everything contract. Both share
`proposal-sanitize.ts`, which now exposes two entry points:

- `sanitizeProposalHtml()` — unchanged; strips `<script>`, `on*`, `javascript:`.
- `sanitizeArtifactHtml()` — same tag/attribute allow-list, same CSS neutralization, same mXSS
  re-parse fixpoint, **plus** inline scripts, `on*` handlers, and interactive elements
  (`<button>`, `<input>`, `<select>`, `<textarea>`, `<canvas>`, …). Every attribute is dropped
  from `<script>`, so an external `src` is still impossible.

**The containment is the CSP, not the sanitizer.** `ARTIFACT_DOCUMENT_CSP` allows
`script-src 'unsafe-inline' 'unsafe-eval'` but sets `default-src 'none'`, **`connect-src 'none'`**,
`img-src data: blob:`, `form-action 'none'`, `base-uri 'none'`, `object-src`/`frame-src 'none'`.
A script may run; it may not fetch, XHR, WebSocket, beacon, or load a remote image.

**Why the CSP and not origin isolation.** Origin isolation does not hold on this deployment:
`app.use(cors())` serves wildcard CORS and `apiKeyAuth` runs in open mode with zero keys
configured, so *any* script that can call `fetch()` — including one in an opaque-origin sandboxed
iframe — could read the fleet's messages, agents, and beads. Closing the outbound channels is
what actually contains it. If keys are ever provisioned and CORS tightened, this stays correct;
it just stops being the only thing standing between an artifact and the API.

The in-app viewer adds defence in depth: `sandbox="allow-scripts allow-popups"` — **never**
`allow-same-origin` (that pairing defeats the sandbox), and no
`allow-popups-to-escape-sandbox` (a privilege escalation once scripts run).

**Residual risk, accepted and documented**: CSP cannot block top-level/popup *navigation*, so a
determined artifact could still put data in a URL it navigates to. Self-containment (no external
refs survive sanitization) is what keeps that from being trivial, which makes those
external-reference tests more load-bearing now than before, not less.

### Per-Project Style Guide + Dark/Accessible Baseline (adj-201)

Extends proposal sharing with a per-project **style guide** and a baked-in
**dark-by-default, WCAG-AA, friendly** page baseline. Spec: `specs/059-project-style-guide/`.
**Enforcement is AUTHORING-ONLY** — the server never injects project tokens into the page;
agents read the guide via MCP and author the HTML to match. A QA drift-lint is the safety net.

- **Style guide** (v1 = accent/brand color only): a project carries `brandColorPrimary`
  (required when a guide is set) + optional `brandColorSecondary`, both hex-validated via
  `isValidHexColor` (`projects-service.ts`). Set on web + iOS, persisted via
  `PUT /api/projects/:id/style-guide`. Empty/unset is a valid state. Agents read it with the
  **`get_project_style`** MCP tool (resolves by projectId, honors adj-146 cross-project
  context), which returns `{ brandColorPrimary, brandColorSecondary } | null`.
- **Baseline** (`composeProposalDocument`): the document shell is dark-by-default with a
  `@media (prefers-color-scheme: light)` variant and a **CSS-only** ☀/☾ toggle (no JS — the
  CSP forbids scripts), AA contrast in both token sets, semantic landmarks, and visible
  `:focus-visible`. Self-contained / CSP guarantees from adj-200 are unchanged.
- **Drift-lint** (`backend/src/services/proposal-style-lint.ts` → `lintProposalPage(html,
  { expectedBrandColor? })`): static safety net for the authoring-only model. Reports
  accent-color presence (when `expectedBrandColor` is given — normalizes `#RGB`↔`#RRGGBB`,
  case-insensitive; skipped when omitted), dark-mode support (`prefers-color-scheme` OR a
  theme toggle), and a11y basics (`lang` attr, `<main>`/`<header>` landmark, a same-color/
  background contrast red-flag). Codes: `missing-accent-color`, `invalid-expected-color`,
  `no-dark-mode`, `missing-lang`, `missing-landmark`, `contrast-red-flag`. `ok` is false on
  any `error`-severity finding. It is a lightweight static check, not a browser.
- **Authoring contract**: documented for agents in `docs/proposal-page-authoring.md` and
  surfaced verbatim at tool-call time via `HTML_AUTHORING_CONTRACT` in
  `mcp-tools/proposals.ts` (self-contained/CSP-safe, honor the brand color from
  `get_project_style`, dark/accessible/friendly).

## Key Decisions

1. **MCP for Agent Communication**: Agents connect via MCP SSE and use tools for messaging, status, and beads
   - Server-side identity resolution (not client-supplied)
   - SQLite message store for persistent agent chat
   - Real-time delivery via WebSocket broadcast

2. **Multi-Channel Frontend**: WebSocket with SSE and polling fallbacks
   - WebSocket `/ws/chat` preferred for real-time
   - SSE `/api/events` as fallback
   - Polling as last resort
   - Exponential backoff retry between channels

3. **SQLite for Messages**: Persistent message storage with full-text search
   - Cursor-based pagination for history
   - Unread counts per agent

4. **bd CLI for Beads**: Issue tracking via `bd` CLI wrapper
   - Serialized through mutex to prevent concurrent access
   - Supports epics, tasks, bugs with hierarchical dependencies

## Project Identity

The system uses three project identifiers with distinct roles:

1. **projectId** (UUID) — The canonical identifier for all backend operations
   - Store in databases, emit in events, pass in API calls, use in filters
   - Example: `"a1b2c3d4-e5f6-7890-abcd-ef1234567890"`
   - All MCP tools, services, and event emissions MUST use projectId

2. **projectName** (string) — Display-only, for frontend and iOS
   - Never use as a database key, filter value, or event field
   - Never store as a foreign reference in other tables
   - Example: `"adjutant"`

3. **projectPath** (filesystem path) — Agent CWD and beads resolution only
   - Used to set working directory when spawning agents
   - Used to locate `.beads/` directory for bd CLI operations
   - Never use to query project information

### Don't Do

- Don't pass `projectName` where `projectId` is expected
- Don't use `[projectId, projectName]` arrays for dual-matching (legacy shim, being removed)
- Don't store `projectName` in proposal, event, or bead records — always store UUID
- Don't use `projectPath` to identify a project — use `projectId`

## Don't Do

- Don't create complex state management (Redux, etc.)
- Don't use client-supplied metadata for agent identity (use server-side session resolution)
- Don't add `as any` casts for WebSocket message types (extend the union instead)
