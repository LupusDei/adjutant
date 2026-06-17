# Implementation Plan: Proposals as Shareable Standalone HTML Pages

**Branch**: `058-proposal-html-pages` | **Date**: 2026-06-17
**Epic**: `adj-200` | **Priority**: P1

## Summary

Extend proposals with an optional self-contained HTML body and a publish/share mechanism.
A single backend composition pipeline turns a proposal into one sanitized, self-contained
HTML document; that document is served two ways — embedded (sandboxed `iframe srcdoc` on
web, `WKWebView.loadHTMLString` on iOS) for authenticated in-app reading, and via an
unauthenticated `GET /p/:token` public route for link sharing. The backend foundation
(Path A) is the blocking dependency; the MCP authoring contract (Path B), web UI (Path C),
and iOS UI (Path D) fan out in parallel once A's contract is frozen. Architecture diagrams
(Path E) are a stretch.

## Bead Map

- `adj-200` — Root: Proposals as Shareable Standalone HTML Pages
  - `adj-200.1` — Phase 1 Setup: backend deps (sanitize-html, markdown-it)
    - `adj-200.1.1` — Add sanitize-html + markdown-it (+ @types) to backend
  - `adj-200.2` — Phase 2 Foundational / Path A: backend core (BLOCKS 3–6)
    - `adj-200.2.1` — Migration 035 + extend Proposal types
    - `adj-200.2.2` — proposal-store: setHtml, publish, unpublish, getProposalByToken, token gen
    - `adj-200.2.3` — Sanitizer service (security/XSS suite)
    - `adj-200.2.4` — Compose/template service (self-contained doc + markdown fallback)
    - `adj-200.2.5` — Public route `GET /p/:token` + auth bypass + CSP
    - `adj-200.2.6` — REST publish/unpublish + extend proposal GET payload
  - `adj-200.3` — Phase 3 Path B: MCP agent authoring contract [P]
    - `adj-200.3.1` — Extend create_proposal/revise_proposal (html, public)
    - `adj-200.3.2` — publish_proposal / unpublish_proposal MCP tools
    - `adj-200.3.3` — Tool descriptions + agent authoring guidance
  - `adj-200.4` — Phase 4 Path C: Web in-frame viewer + sharing [P]
    - `adj-200.4.1` — api.ts publish/unpublish + extend Proposal type
    - `adj-200.4.2` — Sandboxed iframe viewer component (srcdoc)
    - `adj-200.4.3` — ProposalDetailView: View-as-Page + publish/copy-link/open + badge
    - `adj-200.4.4` — Full-page standalone route `#proposal/:id`
  - `adj-200.5` — Phase 5 Path D: iOS in-app browser + sharing [P]
    - `adj-200.5.1` — Proposal model fields + APIClient publish/unpublish
    - `adj-200.5.2` — ProposalWebView (WKWebView) + `.proposalWebView` route
    - `adj-200.5.3` — Read-as-Page button + publish toggle + share sheet
  - `adj-200.6` — Phase 6 Path E: Architecture diagrams (stretch) [P]
    - `adj-200.6.1` — Server-side Mermaid→SVG pre-render at compose time
    - `adj-200.6.2` — Richer template + agent diagram authoring examples
  - `adj-200.7` — Phase 7 Polish & cross-cutting (depends 3,4,5)
    - `adj-200.7.1` — Docs: architecture rule + CLAUDE.md proposal section
    - `adj-200.7.2` — End-to-end verification + CHANGELOG

## Technical Context

**Stack**: TypeScript 5 strict, Express, React 18 + Vite, SwiftUI/SwiftPM, Vitest.
**New backend deps**: `sanitize-html` (+ `@types/sanitize-html`), `markdown-it` (+ types).
Stretch: a server-side Mermaid renderer (`@mermaid-js/mermaid-cli` or `mermaid` + headless)
— evaluated in Phase 6, not pulled in earlier.
**Storage**: SQLite; new migration `035-proposals-public-html.sql`.
**Testing**: Vitest (backend/web), XCTest (iOS). TDD mandatory (RED→GREEN). Backend
typecheck blocking; frontend typecheck is a baseline ratchet.
**Constraints**: self-contained documents (no external resources), unauthenticated public
route, projectId (UUID) scoping, worktree isolation for parallel agents.

## Architecture Decision

**Why one composition pipeline, two delivery paths** (over per-surface rendering or a
stored pre-rendered blob):

- A single `composeProposalDocument(proposal)` is the only place markdown→HTML, template
  wrapping, and sanitization happen. Web, iOS, and the public route all consume its output,
  so there is exactly one security surface to audit (SC-005, NFR-001).
- **Store the source, compose on demand** (`html` source + markdown), rather than storing a
  pre-rendered document, so improving the template/sanitizer does not require re-storing
  every proposal. Cache the composed output if profiling demands it (Simplicity: measure
  first).
- **Embedded via `srcdoc`/`loadHTMLString`, not an authed HTML route**: private in-app
  reading reuses the existing authed JSON API to fetch `html`, then renders locally in a
  sandbox. This avoids injecting auth headers into web views and keeps the only
  HTML-serving HTTP endpoint the *public* one — smaller attack surface.
- **Token, not UUID, in the public URL**: decouples sharing from internal IDs, lets
  unpublish revoke without deleting data, and avoids enumerating proposals.
- **"Document" aesthetic for shared pages**: shared with people who lack the app; legibility
  beats the hard CRT-green dashboard theme. The dashboard chrome stays Pip-Boy; only the
  composed document uses the readable theme.

## Files Changed

| File | Change |
|------|--------|
| `backend/package.json` | Add sanitize-html, markdown-it (+ @types) |
| `backend/src/services/migrations/035-proposals-public-html.sql` | **New** — html, is_public, share_token, published_at |
| `backend/src/types/proposals.ts` | Add html?, isPublic, shareToken?, publishedAt? |
| `backend/src/services/proposal-store.ts` | setHtml, publishProposal, unpublishProposal, getProposalByToken, token gen; include new fields in row mapping |
| `backend/src/services/proposal-html.ts` | **New** — markdown→HTML, template compose, self-contained assembly |
| `backend/src/services/proposal-sanitize.ts` | **New** — sanitize-html profile + sanitize() |
| `backend/src/routes/public-proposals.ts` | **New** — `GET /p/:token` (mounted pre-auth) |
| `backend/src/routes/proposals.ts` | Add POST `/:id/publish`, POST `/:id/unpublish`; include new fields in GET |
| `backend/src/middleware/api-key.ts` | Add `/p` to bypass list |
| `backend/src/index.ts` | Mount public-proposals router before apiKeyAuth |
| `backend/src/services/mcp-tools/proposals.ts` | html+public on create/revise; publish/unpublish tools; updated descriptions |
| `frontend/src/services/api.ts` | proposals.publish/unpublish; extend Proposal type |
| `frontend/src/components/proposals/ProposalPageViewer.tsx` | **New** — sandboxed iframe srcdoc |
| `frontend/src/components/proposals/ProposalDetailView.tsx` | View-as-Page toggle, publish/copy-link/open, badge |
| `frontend/src/App.tsx` | `#proposal/:id` full-page route (mirror `#graph`) |
| `frontend/src/components/proposals/ProposalPage.tsx` | **New** — full-page standalone wrapper |
| `ios/AdjutantKit/Sources/AdjutantKit/Models/Proposal.swift` | html, isPublic, shareToken |
| `ios/AdjutantKit/Sources/AdjutantKit/Networking/APIClient+Proposals.swift` | publish/unpublish |
| `ios/Adjutant/Features/Proposals/ProposalWebView.swift` | **New** — WKWebView UIViewRepresentable |
| `ios/Adjutant/Core/Navigation/Coordinator.swift` | `.proposalWebView(id:)` route |
| `ios/Adjutant/Core/Navigation/MainTabView.swift` | Resolve new route |
| `ios/Adjutant/Features/Proposals/ProposalDetailView.swift` | Read-as-Page + publish toggle + share sheet |
| `.claude/rules/04-architecture.md`, `CLAUDE.md` | Document the proposal HTML/share model |

## Phase 1: Setup

Add backend dependencies (`sanitize-html`, `markdown-it`, types). No behavior — `[setup]`.

## Phase 2: Foundational (Path A — blocks everything)

The backend core. Build in dependency order:
`2.1` migration + types → `2.2` store methods → (`2.3` sanitizer, `2.4` compose) →
(`2.5` public route, `2.6` REST publish). The sanitizer (2.3) is the security keystone and
gets the XSS suite. **Freeze the contract** at the end of this phase: DB shape, `html`
field semantics, public URL format (`/p/:token`), composed-document/sanitize behavior, and
publish/unpublish REST + payload shape. Paths B/C/D build against this frozen contract.

## Phase 3: US2 / Path B — MCP authoring contract

Extend create/revise tools with `html` + `public`; add publish/unpublish tools; rewrite
tool descriptions with the self-contained authoring contract (inline CSS/SVG, no external
resources, no scripts, documented section classes). Backend-only; no overlap with web/iOS.

## Phase 4: US1+US3 / Path C — Web in-frame viewer + sharing

api.ts methods → sandboxed `ProposalPageViewer` (srcdoc) → ProposalDetailView controls
(View-as-Page, publish/unpublish, copy-link, open-in-new-tab, visibility badge) → full-page
`#proposal/:id` route. Frontend-only.

## Phase 5: US4 / Path D — iOS in-app browser + sharing

Proposal model + APIClient publish/unpublish → `ProposalWebView` (WKWebView) + route →
Read-as-Page button + publish toggle + share sheet (public URL from active ServerProfile).
iOS-only (SwiftPM auto-discovers files — no `.pbxproj` edits).

## Phase 6: US5 / Path E — Architecture diagrams (stretch)

Server-side Mermaid→SVG pre-render inside the compose step (graceful fallback to a code
block on failure); richer template; agent diagram authoring examples. Optional; depends on
Path A only.

## Phase 7: Polish & Cross-Cutting

Architecture-rule + CLAUDE.md documentation of the model; end-to-end verification
(create → publish → unauthenticated fetch → unpublish revoke) and CHANGELOG.

## Parallel Execution

```
Phase 1 Setup
      |
Phase 2 Path A (backend foundation, contract freeze)
      |
      +---------------+---------------+---------------+
      |               |               |               |
Phase 3 Path B   Phase 4 Path C   Phase 5 Path D   Phase 6 Path E
 (MCP)            (web)            (iOS)            (diagrams, stretch)
      |               |               |
      +-------+-------+---------------+
              |
        Phase 7 Polish (depends B, C, D)
```

- Within Phase 2, `2.3` and `2.4` are `[P]`; `2.5` and `2.6` are `[P]` after them.
- Phases 3/4/5/6 run on different surfaces (backend-tools / web / iOS / compose) with
  effectively no shared files → assign to separate worktree-isolated agents.
- **Stale-branch hazard**: Path B/C/D agents must branch *after* Path A merges to main (or
  rebase) so they build against the frozen contract, not a moving target.

## Verification Steps

- [ ] Create a proposal with rich `html` via MCP; `GET /p/:token` (no auth) renders it.
- [ ] XSS payloads (script, onerror, javascript:, external img, svg/script) are neutralized.
- [ ] Served document references zero external resources (offline-capable).
- [ ] Unpublish → next `GET /p/:token` is 404; unknown token is 404.
- [ ] Legacy markdown-only proposal renders cleanly in web iframe and iOS WebView.
- [ ] Web: publish → copy-link → open in fresh incognito tab (no key) → renders.
- [ ] iOS: Read-as-Page renders private proposal; share sheet offers correct public URL.
- [ ] `npm run build` + `npm test` green; `scripts/verify-before-push.sh` passes.
