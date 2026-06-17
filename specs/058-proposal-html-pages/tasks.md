# Tasks: Proposals as Shareable Standalone HTML Pages

**Input**: Design documents from `/specs/058-proposal-html-pages/`
**Epic**: `adj-200`

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001…): Sequential authoring IDs for this document.
- **Bead IDs** (adj-200.N.M): Assigned in beads-import.md after bead creation.
- **[P]**: Can run in parallel (different files, no deps).
- **[Story]**: User story label (US1–US5).
- **TDD-shaped**: Every non-exempt task uses Shape A (Ta/Tb split) or Shape B (single task
  with explicit RED → GREEN phasing). Exemptions: `[setup]`, `[docs]`, `[scaffold]`.

---

## Phase 1: Setup

**Purpose**: Backend dependencies for HTML rendering + sanitization.

- [ ] T001 [setup] Add `sanitize-html`, `markdown-it`, `@types/sanitize-html`,
      `@types/markdown-it` to `backend/package.json` (and lockfile); confirm `npm run build`
      still compiles in `backend/`.

---

## Phase 2: Foundational — Path A (backend core, blocks Phases 3–6)

**Purpose**: Data model, composition pipeline, public sharing. Freeze the contract here.

- [ ] T002 [US1] Migration + types — write failing tests first, confirm RED, then implement until GREEN.
      Tests in `backend/tests/unit/proposal-store.test.ts` assert a fresh DB has proposal columns
      `html`, `is_public`, `share_token`, `published_at` with correct defaults and that `Proposal`
      maps them. Impl: add `backend/src/services/migrations/035-proposals-public-html.sql` and extend
      `backend/src/types/proposals.ts` (`html?`, `isPublic`, `shareToken?`, `publishedAt?`).
- [ ] T003a [US1] Write failing tests for proposal-store sharing methods in
      `backend/tests/unit/proposal-store.test.ts`: `setHtml`, `publishProposal` (generates a
      unique ≥16-char base62 token when absent, idempotent token on re-publish, sets
      `is_public`/`published_at`), `unpublishProposal` (clears `is_public`, keeps token),
      `getProposalByToken` (returns only when `is_public=1`, null otherwise/unknown). Cover
      happy, error, and token-collision edge cases. Confirm RED.
- [ ] T003b [US1] Implement those methods in `backend/src/services/proposal-store.ts`
      (collision-safe token generation) until T003a tests are GREEN.
- [ ] T004a [P] [US2] Write failing **security** tests for the sanitizer in
      `backend/tests/unit/proposal-sanitize.test.ts`: strips `<script>`, `on*=` handlers,
      `javascript:` URLs, external `<img src>`/`<a href>` to non-data/non-http, `<iframe>`/
      `<object>`/`<embed>`, and SVG-borne script; preserves semantic tags, `<style>`,
      inline `<svg>`, and `data:` image URIs. Confirm RED.
- [ ] T004b [US2] Implement `backend/src/services/proposal-sanitize.ts` (sanitize-html
      profile + `sanitizeProposalHtml()`) until T004a tests are GREEN.
- [ ] T005a [P] [US1] Write failing tests for the compose pipeline in
      `backend/tests/unit/proposal-html.test.ts`: `composeProposalDocument(proposal)`
      returns a self-contained document (inlined `<style>`, no external resource refs) for
      an html-bearing proposal; falls back to markdown→HTML for an html-null proposal;
      returns a non-empty body when sanitization empties the html; output is passed through
      the sanitizer. Confirm RED.
- [ ] T005b [US1] Implement `backend/src/services/proposal-html.ts` (markdown-it render +
      branded "document" template + self-contained assembly, delegating to
      proposal-sanitize) until T005a tests are GREEN.
- [ ] T006a [US3] Write failing tests for the public route in
      `backend/tests/integration/public-proposals.test.ts`: `GET /p/:token` with **no auth**
      returns 200 + HTML + strict CSP header for a published proposal; 404 for an unknown
      token, an unpublished proposal, and a private proposal; served document has zero
      external resource references. Confirm RED.
- [ ] T006b [US3] Implement `backend/src/routes/public-proposals.ts`, mount it before
      `apiKeyAuth` in `backend/src/index.ts`, and add `/p` to the bypass list in
      `backend/src/middleware/api-key.ts` until T006a tests are GREEN.
- [ ] T007a [US3] Write failing tests for publish REST in
      `backend/tests/integration/proposals-routes.test.ts`: `POST /api/proposals/:id/publish`
      returns the full public URL + sets public; `POST /api/proposals/:id/unpublish` revokes
      (subsequent `GET /p/:token` 404); `GET /api/proposals/:id` now includes `html`,
      `isPublic`, `shareToken`, `publishedAt`. Cover success + invalid-id error. Confirm RED.
- [ ] T007b [US3] Implement the publish/unpublish handlers and extend the GET payload in
      `backend/src/routes/proposals.ts` until T007a tests are GREEN.

**Checkpoint (CONTRACT FREEZE)**: DB shape, `html` semantics, `/p/:token` URL format,
sanitize/compose behavior, and publish REST + payload are frozen. Paths B/C/D may begin.

---

## Phase 3: US2 — Path B: MCP authoring contract (Priority: P1)

**Goal**: Agents author rich HTML proposals and publish via MCP.
**Independent Test**: `create_proposal` with `html` persists + composes; malicious html is
sanitized; `publish_proposal` returns a working public URL.

- [ ] T008a [P] [US2] Write failing tests for extended create/revise in
      `backend/tests/unit/mcp-proposals.test.ts`: `create_proposal` accepts optional `html`
      and `public` (auto-publishes when true, returning the URL); `revise_proposal` accepts
      `html` and snapshots the prior body; oversized html is rejected by Zod. Confirm RED.
- [ ] T008b [US2] Extend the create/revise handlers + Zod schemas in
      `backend/src/services/mcp-tools/proposals.ts` until T008a tests are GREEN.
- [ ] T009a [P] [US2] Write failing tests for `publish_proposal`/`unpublish_proposal` MCP
      tools in `backend/tests/unit/mcp-proposals.test.ts`: each resolves the proposal,
      toggles visibility, and returns the public URL (publish) / confirms revocation
      (unpublish); validation error on unknown id. Confirm RED.
- [ ] T009b [US2] Implement the two MCP tools in
      `backend/src/services/mcp-tools/proposals.ts` until T009a tests are GREEN.
- [ ] T010 [docs] [US2] Update the `create_proposal`/`revise_proposal`/`publish_proposal`
      tool descriptions and agent-facing proposal guidance with the self-contained HTML
      authoring contract (inline CSS/SVG, no external resources, no scripts, documented
      section classes) in `backend/src/services/mcp-tools/proposals.ts`.

**Checkpoint**: Agents can author + publish HTML proposals end-to-end.

---

## Phase 4: US1 + US3 — Path C: Web in-frame viewer + sharing (Priority: P1)

**Goal**: Read proposals as clean pages in-app and share public links from the dashboard.
**Independent Test**: View-as-Page renders sandboxed html; publish → copy-link opens in a
keyless incognito tab.

- [ ] T011a [P] [US3] Write failing tests for the proposals API client in
      `frontend/tests/unit/api-proposals.test.ts`: `api.proposals.publish(id)` /
      `unpublish(id)` call the right endpoints and return the updated proposal incl.
      `shareToken`/`isPublic`; the `Proposal` type carries `html`/`isPublic`/`shareToken`.
      Confirm RED.
- [ ] T011b [US3] Implement the methods + extend the `Proposal` type in
      `frontend/src/services/api.ts` until T011a tests are GREEN.
- [ ] T012a [P] [US1] Write failing tests for `ProposalPageViewer` in
      `frontend/tests/unit/proposal-page-viewer.test.tsx`: renders a sandboxed `<iframe>`
      with `srcdoc` set to the proposal html and a `sandbox` attribute WITHOUT
      `allow-scripts`; shows a fallback when html is empty. Confirm RED.
- [ ] T012b [US1] Implement `frontend/src/components/proposals/ProposalPageViewer.tsx` until
      T012a tests are GREEN.
- [ ] T013a [US3] Write failing tests for ProposalDetailView sharing controls in
      `frontend/tests/unit/proposal-detail-view.test.tsx`: a View-as-Page toggle mounts the
      viewer; Publish/Unpublish calls the api and flips a visibility badge; Copy-Link copies
      the public URL; Open-in-New-Tab targets the public URL. Confirm RED.
- [ ] T013b [US3] Implement the controls in
      `frontend/src/components/proposals/ProposalDetailView.tsx` until T013a tests are GREEN.
- [ ] T014 [US1] Full-page standalone route `#proposal/:id` — write failing tests first, confirm RED, then implement until GREEN.
      Test in `frontend/tests/unit/app-routing.test.tsx`: the hash route resolves to a `ProposalPage`
      wrapper (mirror the `#graph` pattern). Impl in `frontend/src/App.tsx` +
      `frontend/src/components/proposals/ProposalPage.tsx`.

**Checkpoint**: Web users read proposals as pages and share public links.

---

## Phase 5: US4 — Path D: iOS in-app browser + sharing (Priority: P2)

**Goal**: Open proposals in an in-app browser and share public links on iOS.
**Independent Test**: Read-as-Page renders a private proposal via `loadHTMLString`; share
sheet offers the correct public URL.

- [ ] T015a [P] [US4] Write failing tests for the iOS Proposal model + networking in
      `ios/AdjutantKit/Tests/AdjutantKitTests/ProposalSharingTests.swift`: `Proposal` decodes
      `html`, `isPublic`, `shareToken`; `APIClient.publishProposal(id:)` /
      `unpublishProposal(id:)` hit the right paths and decode the response. Confirm RED.
- [ ] T015b [US4] Implement the model fields in
      `ios/AdjutantKit/Sources/AdjutantKit/Models/Proposal.swift` and the methods in
      `ios/AdjutantKit/Sources/AdjutantKit/Networking/APIClient+Proposals.swift` until T015a
      tests are GREEN.
- [ ] T016 [US4] Public-URL builder + `ProposalWebView` — write failing tests first, confirm RED, then implement until GREEN.
      Test a pure `publicProposalURL(base:token:)` helper (strips trailing `/api`, appends `/p/{token}`)
      in `ios/AdjutantKit/Tests/AdjutantKitTests/ProposalSharingTests.swift`. Impl the helper (AdjutantKit)
      + `ios/Adjutant/Features/Proposals/ProposalWebView.swift` `WKWebView` wrapper (`loadHTMLString`,
      loading/error states).
- [ ] T017 [US4] Wire navigation + detail controls — write failing tests first, confirm RED, then implement until GREEN.
      Failing ViewModel test (publish toggles state, share URL built from the active ServerProfile)
      in `ios/AdjutantKit/Tests/AdjutantKitTests/ProposalSharingTests.swift`. Impl: add
      `.proposalWebView(id:)` to `ios/Adjutant/Core/Navigation/Coordinator.swift`, resolve it in
      `ios/Adjutant/Core/Navigation/MainTabView.swift`, and add Read-as-Page + publish toggle +
      share sheet to `ios/Adjutant/Features/Proposals/ProposalDetailView.swift`. (SPM
      auto-discovers files — NO `.pbxproj` edits.)

**Checkpoint**: iOS users read proposals as pages and share public links.

---

## Phase 6: US5 — Path E: Architecture diagrams (Priority: P3, Stretch)

**Goal**: Render architecture diagrams as self-contained inline SVG.
**Independent Test**: A proposal with a `mermaid` block serves a page containing
pre-rendered inline SVG and no client-side JS.

- [ ] T018a [P] [US5] Write failing tests for diagram pre-rendering in
      `backend/tests/unit/proposal-html.test.ts`: a fenced `mermaid` block in the html is
      replaced by inline `<svg>` in the composed document; a malformed diagram degrades to a
      code block rather than throwing. Confirm RED.
- [ ] T018b [US5] Implement server-side Mermaid→SVG pre-render inside the compose step in
      `backend/src/services/proposal-html.ts` (evaluate `@mermaid-js/mermaid-cli` vs headless
      mermaid; graceful fallback) until T018a tests are GREEN.
- [ ] T019 [docs] [US5] Add a richer template section + agent diagram authoring examples to
      the tool guidance in `backend/src/services/mcp-tools/proposals.ts` and the template in
      `backend/src/services/proposal-html.ts`.

---

## Phase 7: Polish & Cross-Cutting (depends on Phases 3, 4, 5)

- [ ] T020 [docs] Document the proposal HTML/share model (composition pipeline, public
      `/p/:token` route, sanitize contract, publish/unpublish) in
      `.claude/rules/04-architecture.md` and the proposal section of `CLAUDE.md`.
- [ ] T021 End-to-end verification + CHANGELOG — write failing tests first, confirm RED, then make tests pass (until GREEN).
      Integration test in `backend/tests/integration/proposal-share-e2e.test.ts` covering
      create(html) → publish → unauthenticated `GET /p/:token` → unpublish → 404. Then add a
      CHANGELOG entry.

---

## Dependencies

- Setup (T001) → Foundational (Phase 2) → blocks Phases 3, 4, 5, 6.
- Within Phase 2: T002 → T003a/b; T004*/T005* are [P] after T003b; T006*/T007* after the
  compose+store layer. Contract freezes at the Phase 2 checkpoint.
- Phases 3 (Path B), 4 (Path C), 5 (Path D), 6 (Path E) run in parallel after the freeze.
- Phase 7 depends on Phases 3, 4, 5 (Path E optional, not a blocker for Polish).
- For every TDD-split pair, `Tb` depends on `Ta` (RED before GREEN).

## Parallel Opportunities

- `[P]` tasks within a phase touch different files and can run simultaneously.
- After the Phase 2 contract freeze, Paths B/C/D/E run on disjoint surfaces (backend-tools /
  web / iOS / compose) — assign to separate worktree-isolated agents.
- **Stale-branch hazard**: branch Path B/C/D/E agents *after* Path A merges to main (or have
  them rebase) so they build against the frozen contract.
