# Changelog

Notable, user-facing changes to Adjutant. Newer entries first.

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
