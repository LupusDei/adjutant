# Changelog

Notable, user-facing changes to Adjutant. Newer entries first.

## adj-202.6.6 — The Bridge is a Persistent Chat with Default History (2026-06-30)

Talking to the embodied coordinator (The Bridge) by voice now shows up as normal chat
history — the SAME conversation whether you speak or type.

### Added
- **Voice dialogue is persisted.** Each Bridge voice session's finalized turns (the
  Commander's speech and the avatar's responses) are written into the existing
  `user`↔`adjutant` DM via the real conversation + message stores (no new store), so the
  dashboard / iOS Chat show the Bridge conversation by default and `read_messages` recalls
  it — exactly like text chat with the coordinator. Turns fan out live over WebSocket as the
  conversation happens, tagged `source: "bridge-voice"`.
- **Transport-layer capture.** The transcript is captured on the EXISTING server-side LiveKit
  participant connection (no second connection) via the `lk.transcription` text-stream API;
  interim segments are buffered and only completed utterances are persisted (no partial-word
  spam), with per-segment dedup. Speaker attribution is verified/tuned during live-smoke.

## adj-201 — Per-Project Proposal Style Guide + Dark/Accessible Pages (2026-06-18)

Proposal pages are now dark-by-default, accessible, and on-brand for each project.

### Added
- **Per-project style guide.** Set a project's primary brand color (and optional secondary)
  on the project page (web + iOS), persisted via `PUT /api/projects/:id/style-guide`. Hex
  validated; empty/unset is valid. Authoring agents read it via the new `get_project_style`
  MCP tool and color the proposal page to match.
- **Dark / accessible / friendly pages.** Every composed proposal page is dark-by-default,
  honors `prefers-color-scheme`, exposes a CSS-only light/dark toggle, meets WCAG AA contrast,
  uses semantic landmarks, and shows visible focus — preserving the adj-200 self-contained /
  CSP-safe contract (no external resources, no scripts).
- **QA drift-lint.** `proposal-style-lint.ts` (`lintProposalPage`) statically checks a composed
  page for accent-color presence, dark-mode support, and a11y basics — the safety net for the
  authoring-only enforcement model. Authoring contract documented in
  `docs/proposal-page-authoring.md`.

## adj-200 — Proposals as Shareable Standalone HTML Pages (2026-06-18)

Proposals are no longer just markdown in a side panel — they can be authored as rich,
self-contained HTML pages and shared via a public link that works with no API key.

### Added
- **Self-contained HTML proposals.** Agents can supply an `html` body via
  `create_proposal`/`revise_proposal`; the server composes a branded, readable, fully
  self-contained document (inline CSS, inline SVG, `data:` images — no external resources).
  Legacy markdown-only proposals render via a markdown→HTML fallback.
- **Public sharing.** `POST /api/proposals/:id/publish` returns a public URL backed by an
  unguessable `share_token`; `GET /p/:token` serves the page to anyone, no API key. New
  `publish_proposal`/`unpublish_proposal` MCP tools. Unpublish revokes the link (token
  retained, so re-publishing revives the same URL). Public links are correct behind a
  tunnel/reverse-proxy (honors `X-Forwarded-*`).
- **Web:** "View as Page" sandboxed iframe viewer, publish/unpublish + copy-link +
  open-in-new-tab + visibility badge, and a standalone `#proposal/:id` route.
- **iOS:** in-app browser (`ProposalWebView` / `WKWebView`) with "Read as Page", a publish
  toggle, and a system share sheet for the public link.

### Security
- The proposal HTML sanitizer strips scripts, event handlers, external resources, and
  iframes while preserving styling and inline SVG. It defends **mutation-XSS** (e.g.
  `<svg><style><img onerror>`) via a parse5 re-serialize fixpoint, and embeds a CSP `<meta>`
  in the document for defense-in-depth on non-HTTP surfaces (iOS `loadHTMLString`). The
  public route sets strict CSP headers and never leaks proposal existence (uniform 404s).
