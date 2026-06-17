# Feature Specification: Proposals as Shareable Standalone HTML Pages

**Feature Branch**: `058-proposal-html-pages`
**Created**: 2026-06-17
**Status**: Draft
**Epic**: `adj-200`

## Problem

The proposal feature is loved, but two things hurt:

1. **Reading raw markdown is brutal.** Proposals render as a wall of markdown in a
   side panel. There is no clean information architecture, no visuals, no diagrams.
2. **Proposals cannot be shared.** A proposal lives behind the API-key wall. There is
   no way to hand a teammate a link they can open without the app or an API key.

## Vision

When an agent creates a proposal, instead of saving only markdown it produces a
**self-contained HTML page** with clean information architecture, visuals, and
occasionally architectural diagrams. A proposal can be made **public** and hosted as a
standalone page on Adjutant, shareable via a link that works with **no API key**. The
web dashboard can link to the page and view it inline in an in-frame viewer; the iOS
app opens it in an in-app browser.

## Architecture in One Line

**One sanitized, self-contained HTML artifact per proposal, two delivery paths:**
the authed JSON API feeds an embedded sandboxed viewer (web `iframe srcdoc` / iOS
`WKWebView.loadHTMLString`) for private in-app reading, and a public token route
(`GET /p/:token`) serves the same document to anyone with the link.

## User Scenarios & Testing

### User Story 1 - Read a proposal as a clean HTML page (Priority: P1, MVP)

As the General, when I open a proposal in the dashboard I can switch to a **"View as
Page"** mode that renders a clean, readable, lightly-branded HTML document — not raw
markdown — inside an in-frame viewer, with proper headings, callouts, and (when present)
architecture diagrams.

**Why this priority**: This is the core pain ("reading markdown is brutal"). It is the
minimum viable delivery: even with sharing disabled, in-app readable HTML is a win.

**Independent Test**: Create a proposal with an HTML body via MCP, open it in the web
dashboard, toggle "View as Page", confirm the sandboxed iframe renders the composed
document. Create a legacy markdown-only proposal and confirm it falls back to a clean
markdown→HTML render in the same viewer.

**Acceptance Scenarios**:

1. **Given** a proposal with an `html` body, **When** I open it and select "View as Page",
   **Then** the composed self-contained document renders in a sandboxed iframe with no
   external network requests and no script execution.
2. **Given** a legacy proposal with only a markdown `description`, **When** I view it as a
   page, **Then** the markdown is rendered to clean themed HTML in the same viewer.
3. **Given** any proposal, **When** the page renders, **Then** the document is
   self-contained (CSS inlined, images data-URI, diagrams inline SVG) and matches the
   readable "document" aesthetic, not the hard CRT-green dashboard theme.

---

### User Story 2 - Agents author rich HTML proposals (Priority: P1)

As an agent, when I create or revise a proposal I can supply a self-contained HTML body
(semantic sections, callouts, inline SVG diagrams) in addition to the markdown summary,
following a documented authoring contract.

**Why this priority**: Without the authoring path there is no rich content to render.
The markdown summary stays required (search, list previews, AI confidence scoring,
legacy fallback); HTML is additive.

**Independent Test**: Call `create_proposal` with `html` set, fetch the proposal, confirm
the html persisted and the composed/sanitized document is well-formed. Call with a
malicious `html` (script, onerror, javascript: URL, external img) and confirm the served
document is stripped of all of them.

**Acceptance Scenarios**:

1. **Given** the `create_proposal` MCP tool, **When** an agent supplies `html`, **Then**
   the html is stored and rendered into the proposal's page.
2. **Given** `revise_proposal`, **When** an agent supplies a new `html`, **Then** the page
   updates and the prior body is snapshotted into revisions like any other field.
3. **Given** an agent supplies HTML containing `<script>`, `on*=` handlers, `javascript:`
   URLs, external `<img src>`, or `<iframe>`, **When** the page is served, **Then** all of
   those are removed while semantic tags, inline `<style>`, and inline `<svg>` survive.

---

### User Story 3 - Make a proposal public and share a no-API-key link (Priority: P1)

As the General, I can publish a proposal to get a public link that anyone can open in a
browser without an API key, and I can unpublish to revoke that link.

**Why this priority**: Sharing with teammates who lack an API key is the second core pain
and the headline capability of the epic.

**Independent Test**: Publish a proposal, fetch `GET /p/:token` with **no Authorization
header**, confirm 200 + HTML. Unpublish, confirm the same token now 404s. Confirm an
unknown/guessed token 404s and that private (never-published) proposals are unreachable.

**Acceptance Scenarios**:

1. **Given** a proposal, **When** I publish it, **Then** a stable unguessable `share_token`
   is generated (if absent) and a full public URL is returned.
2. **Given** a published proposal, **When** an unauthenticated client requests
   `GET /p/:token`, **Then** the composed sanitized document is returned with strict CSP
   headers and no auth challenge.
3. **Given** a published proposal, **When** I unpublish it, **Then** `GET /p/:token`
   returns 404 and the share link is dead.
4. **Given** the web dashboard, **When** I publish, **Then** I see a copy-link control, an
   "open in new tab" control, and a visibility badge reflecting public/private state.

---

### User Story 4 - Read and share proposals on iOS in an in-app browser (Priority: P2)

As an iOS user, I can open a proposal as a page inside the app (in-app browser) and share
its public link via the system share sheet.

**Why this priority**: Extends the experience to mobile; depends on the backend contract
but is an independent surface.

**Independent Test**: In the iOS app, open a proposal, tap "Read as Page", confirm the
WKWebView renders the html via `loadHTMLString` (works for private proposals). Publish,
tap share, confirm the share sheet offers the correct public URL built from the active
server profile.

**Acceptance Scenarios**:

1. **Given** a proposal in the iOS app, **When** I tap "Read as Page", **Then** a WKWebView
   renders the proposal's html with loading and error states.
2. **Given** a published proposal, **When** I tap share, **Then** the system share sheet
   presents the public URL derived from the active `ServerProfile` (base URL minus `/api`,
   plus `/p/{token}`).
3. **Given** a private proposal, **When** I read it as a page, **Then** it still renders
   in-app (via `loadHTMLString`) without requiring it to be public.

---

### User Story 5 - Architecture diagrams in proposals (Priority: P3, Stretch)

As an agent, I can include architecture diagrams in a proposal and have them render as
self-contained inline SVG in the page.

**Why this priority**: High polish, not required for the core value. Can ship after P1/P2.

**Independent Test**: Author a proposal whose html includes a Mermaid code block; confirm
the served page contains pre-rendered inline SVG (no client-side JS) for the diagram.

**Acceptance Scenarios**:

1. **Given** a proposal html with a fenced `mermaid` block, **When** the page is composed,
   **Then** the block is pre-rendered server-side to inline SVG embedded in the document.
2. **Given** a diagram fails to render, **When** the page is composed, **Then** the raw
   diagram source is shown as a code block (graceful degradation) rather than breaking the
   page.

---

### Edge Cases

- **Token collision**: token generation must guarantee uniqueness (UNIQUE column +
  regenerate-on-collision).
- **Unpublish then re-publish**: re-publishing reuses the existing token unless explicitly
  rotated, so already-shared links keep working after a re-publish (toggling visibility,
  not the token).
- **Legacy proposals**: proposals created before this epic have `html = NULL`; the page
  view must fall back to markdown rendering.
- **Oversized html**: enforce a max html size at the MCP/REST boundary (Zod) to bound
  storage and render cost.
- **Sanitizer strips everything**: if sanitized body is empty, fall back to the markdown
  render so the page is never blank.
- **Open mode auth**: when no API keys are configured the whole server is open; the public
  route must still behave identically (no regression) and never leak that it bypasses auth.
- **CSP vs inline style/SVG**: CSP must permit inline `<style>`/SVG (needed for
  self-contained rendering) while forbidding scripts and external connects.

## Requirements

### Functional Requirements

- **FR-001**: A proposal MUST be able to store an optional self-contained HTML body
  (`html`) alongside its existing markdown `description`.
- **FR-002**: The system MUST compose a self-contained HTML **document** from a proposal:
  branded template (inlined CSS, "document" aesthetic) + the agent html body, or, if html
  is absent, the markdown `description` rendered to HTML.
- **FR-003**: The composed document MUST be sanitized: strip `<script>`, `on*` event
  handlers, `javascript:`/external resource URLs, `<iframe>`/`<object>`/`<embed>`; allow
  semantic tags, `<style>`, inline `<svg>`, and `data:` image URIs.
- **FR-004**: A proposal MUST be publishable, generating a stable unguessable `share_token`
  and exposing `GET /p/:token` that serves the document **without authentication**.
- **FR-005**: Unpublishing MUST make `GET /p/:token` return 404; unknown tokens and
  never-published proposals MUST be unreachable via the public route.
- **FR-006**: The public route MUST set strict CSP headers and MUST be added to the auth
  middleware bypass list (mounted before the API-key middleware).
- **FR-007**: MCP `create_proposal` and `revise_proposal` MUST accept optional `html` and
  `public` parameters; new `publish_proposal`/`unpublish_proposal` MCP tools MUST return
  the public URL. Tool descriptions MUST document the self-contained authoring contract.
- **FR-008**: The web dashboard MUST render a proposal's html in a **sandboxed** iframe
  (srcdoc, no `allow-scripts`) for in-app reading, expose publish/unpublish, copy-link,
  open-in-new-tab, and a visibility badge, and provide a full-page standalone route.
- **FR-009**: The iOS app MUST render a proposal's html in a `WKWebView`
  (`loadHTMLString`, works for private proposals) and offer a system share sheet with the
  public URL built from the active server profile.
- **FR-010**: The markdown `description` MUST remain required and continue to drive list
  previews, search, and confidence scoring (HTML is additive, never a replacement).

### Non-Functional / Security Requirements

- **NFR-001 (Security)**: The sanitizer is load-bearing — these documents are served to
  unauthenticated viewers. A dedicated XSS-payload regression suite MUST cover script
  injection, event-handler injection, `javascript:` URLs, external-img exfiltration, and
  SVG-borne script vectors, and MUST be part of the merge gate.
- **NFR-002 (Self-contained)**: A composed document MUST NOT reference external CSS, JS,
  fonts, or images — everything inlined — so it renders offline and inside `loadHTMLString`.
- **NFR-003 (Isolation)**: The embedded web viewer MUST use the iframe `sandbox` attribute
  without `allow-scripts`; the public route MUST not allow the page to script the parent.
- **NFR-004 (No leak)**: The public route MUST NOT expose internal proposal UUIDs,
  project IDs, confidence internals, or any field beyond what the page intentionally shows.

### Key Entities

- **Proposal (extended)**: existing row + `html TEXT` (nullable), `is_public INTEGER
  DEFAULT 0`, `share_token TEXT UNIQUE` (nullable until first publish), `published_at TEXT`.
- **Composed Document**: derived (not stored as the source of truth) — the sanitized,
  self-contained HTML served to viewers. May be cached.
- **Share Token**: unguessable base62 string (≥16 chars), the public handle for a proposal.

## Success Criteria

- **SC-001**: 100% of XSS-payload regression cases produce a document with the payload
  neutralized (no script execution, no external fetch) — verified in CI.
- **SC-002**: A published proposal opens in a fresh browser with no API key and renders
  fully offline-capable (no external network requests) — verified by an integration test
  asserting zero external resource references in the served document.
- **SC-003**: Unpublish revokes access within one request (next `GET /p/:token` is 404).
- **SC-004**: A legacy markdown-only proposal renders cleanly in the page viewer on web and
  iOS with no agent action required.
- **SC-005**: The three surfaces (public link, web iframe, iOS WebView) all render from the
  single composition pipeline — no duplicate rendering logic per surface.
