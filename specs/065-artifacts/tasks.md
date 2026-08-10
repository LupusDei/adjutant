# Tasks: Adjutant Artifacts (065)

TDD-shaped. `[P]` = parallelizable (different files, no dep). `[US#]` = user story.
Exemptions: `[setup]`, `[docs]`, `[scaffold]`.

## Phase 1 — Backend artifact engine [US1]

- [ ] T101 [setup] [US1] Add migration `backend/src/services/migrations/039-artifacts.sql`
      creating the global `artifacts` table (id, title, slug, description, html, is_public,
      share_token UNIQUE, published_at, created_by, created_at, updated_at; NO project_id).
      Register it in the migration runner.

- [ ] T102a [P] [US1] Write failing tests for the artifact store in
      `backend/tests/unit/artifact-store.test.ts` — cover create, get, list (newest-first),
      update, delete, publish (generates ≥16-char base62 token; idempotent), unpublish
      (retains token; re-publish revives same link), and the not-found path. Confirm RED.
- [ ] T102b [US1] Implement `backend/src/services/artifact-store.ts` (`createArtifactStore`,
      reusing `generateShareToken`) until T102a is GREEN.

- [ ] T103a [P] [US1] Write failing tests for `composeArtifactDocument` in
      `backend/tests/unit/artifact-html.test.ts` — asserts it runs the html through
      `sanitizeProposalHtml` (script/handlers stripped), embeds the strict CSP meta, is
      self-contained (no external http(s) resource refs remain), and preserves authored
      structure (does NOT inject the proposal document shell/brand chrome). Confirm RED.
- [ ] T103b [US1] Implement `backend/src/services/artifact-html.ts` until T103a is GREEN.

- [ ] T104a [US1] Write failing tests for the artifacts REST routes in
      `backend/tests/unit/artifacts-routes.test.ts` — POST create, GET list, GET :id,
      PATCH, DELETE, POST :id/publish (returns publicUrl), POST :id/unpublish, and
      GET :id/download (200, `Content-Disposition: attachment`, self-contained body).
      Confirm RED. (Depends on T102b, T103b.)
- [ ] T104b [US1] Implement `backend/src/routes/artifacts.ts` (route → store → compose; no
      business logic in the route) and mount behind `apiKeyAuth` in `index.ts` until GREEN.

- [ ] T105a [US1] Write failing tests for the public route in
      `backend/tests/unit/public-artifacts.test.ts` — GET /a/:token serves the composed
      document for a published artifact; GET /a/:token/download sends it as an attachment;
      unknown / unpublished tokens 404 with no existence leak. Confirm RED. (Depends on T102b, T103b.)
- [ ] T105b [US1] Implement `backend/src/routes/public-artifacts.ts` and mount it BEFORE
      `apiKeyAuth` (`app.use("/a", …)` beside the `/p` mount) using `resolvePublicBaseUrl`
      for links, until T105a is GREEN.

## Phase 2 — Agent authoring via MCP [US2]

- [ ] T201a [US2] Write failing tests for the artifact MCP tools in
      `backend/tests/unit/mcp-artifacts.test.ts` — `create_artifact` (success writes an
      artifact, resolves caller as created_by; validation error on missing title/html),
      `publish_artifact`/`unpublish_artifact` (return public URL), `list_artifacts`.
      Confirm RED. (Depends on Phase 1.)
- [ ] T201b [US2] Implement `backend/src/services/mcp-tools/artifacts.ts` + register
      `registerArtifactTools(...)` in `index.ts` until T201a is GREEN.

## Phase 3 — Web Artifacts page [US3]

- [ ] T301a [P] [US3] Write failing tests for the api client artifacts block in
      `frontend/tests/unit/api-artifacts.test.ts` — list/get/create/delete/publish/unpublish
      call the right paths; `buildPublicArtifactUrl(token)` → `<origin>/a/<token>`; download
      URL is correct. Confirm RED. (Depends on Phase 1 contract.)
- [ ] T301b [US3] Implement the `artifacts` block + `buildPublicArtifactUrl` in
      `frontend/src/services/api.ts` until T301a is GREEN.

- [ ] T302a [P] [US3] Write failing tests for `ArtifactsView` in
      `frontend/tests/unit/artifacts-view.test.tsx` — renders the list from the hook,
      shows published/unpublished state, and exposes view/share/download/delete actions.
      Confirm RED.
- [ ] T302b [US3] Implement `frontend/src/components/artifacts/ArtifactsView.tsx` +
      `ArtifactCard.tsx` and add the **ARTIFACTS** tab to `frontend/src/App.tsx` until GREEN.

- [ ] T303a [P] [US3] Write failing tests for `ArtifactViewer` in
      `frontend/tests/unit/artifact-viewer.test.tsx` — renders a sandboxed `<iframe srcdoc>`
      (no `allow-scripts`) and the **Download** action triggers a `.html` download. Confirm RED.
- [ ] T303b [US3] Implement `frontend/src/components/artifacts/ArtifactViewer.tsx` (reuse the
      `ProposalPageViewer` sandbox pattern) + Download button until GREEN.

- [ ] T304a [US3] Write failing tests for `CreateArtifactForm` in
      `frontend/tests/unit/create-artifact-form.test.tsx` — paste HTML OR upload a `.html`
      file + title, submit calls `api.artifacts.create`, and validation blocks empty html.
      Confirm RED.
- [ ] T304b [US3] Implement `frontend/src/components/artifacts/CreateArtifactForm.tsx` until GREEN.

## Phase 4 — iOS Artifacts in Settings [US4]

- [ ] T401a [P] [US4] Write failing tests for the Artifact model + APIClient in
      `ios/AdjutantKit/Tests/AdjutantKitTests/ArtifactAPITests.swift` — decodes the
      `/api/artifacts` list shape and builds the publish/download requests. Confirm RED.
- [ ] T401b [US4] Implement `Artifact.swift` + `APIClient+Artifacts.swift` under
      `ios/AdjutantKit/Sources/AdjutantKit/` until T401a is GREEN.

- [ ] T402a [US4] Write failing tests for `ArtifactsViewModel` in
      `ios/AdjutantKit/Tests/AdjutantKitTests/ArtifactsViewModelTests.swift` — load populates
      artifacts; error path sets an error; publish/unpublish update state. Confirm RED.
- [ ] T402b [US4] Implement `ios/AdjutantKit/Sources/AdjutantKit/ViewModels/ArtifactsViewModel.swift` until GREEN.

- [ ] T403 [US4] Add `ArtifactsView.swift` (list) nested via an Artifacts row/section in
      `ios/Adjutant/Features/Settings/SettingsView.swift`, with a WKWebView viewer
      (`loadHTMLString`, reuse the ProposalSharing pattern). Phases: write a failing
      ViewModel-driven test first for the list/selection state → confirm RED → implement the
      SwiftUI view → confirm GREEN. (SwiftPM auto-discovers; do NOT edit `.pbxproj`.)

- [ ] T404 [US4] Add **Download/Save** on iOS: write the composed `.html` to a file and
      present the share sheet / save-to-Files. Phases: write failing tests first for the
      filename/slug + file-write helper in
      `ios/AdjutantKit/Tests/AdjutantKitTests/ArtifactDownloadTests.swift` → confirm RED →
      implement the helper + wire the Save action → confirm GREEN.

## Phase 5 — Security & polish [US5]

- [ ] T501a [US5] Write failing security tests in
      `backend/tests/unit/public-artifacts-security.test.ts` — run the proposal XSS/mXSS
      payload corpus through `composeArtifactDocument` / `GET /a/:token`: `<script>`, `on*`
      handlers, `javascript:`/external URLs, `<iframe>`/`<object>`/`<embed>`, and the
      `<svg><style><img onerror>` mutation vector are all neutralized. Confirm RED (if any
      leak) then GREEN after hardening.
- [ ] T501b [US5] Fix any leaks surfaced by T501a in `artifact-html.ts` until GREEN.

- [ ] T502 [docs] [US5] Write `docs/artifact-authoring.md` documenting the self-contained
      authoring contract (inline CSS/SVG, `data:` images, no external resources, no scripts)
      for agents, mirroring `docs/proposal-page-authoring.md`.

- [ ] T503 [US5] Polish: safe download filename slug (`<title>.html`, fallback
      `artifact-<id>.html`), web + iOS empty/loading/error states, a11y basics. Phases:
      write failing tests first for the slug helper → confirm RED → implement → confirm GREEN.
