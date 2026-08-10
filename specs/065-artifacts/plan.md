# Implementation Plan: Adjutant Artifacts (065)

## Architecture

Artifacts reuse the adj-200/201 proposal-sharing pipeline but decouple it from proposals
and drop the branded shell (pages render as authored). One composition/security boundary.

```
Author (agent MCP tool OR web upload/paste)
        │  html + title [+ description]
        ▼
routes/artifacts.ts ──► artifact-store.ts (SQLite: migration 039)
        │                       │ publish → share_token (base62 ≥16)
        ▼                       ▼
composeArtifactDocument(artifact)  ── sanitizeProposalHtml() [REUSE] + self-contained + CSP
        │  (as-authored — NO proposal document shell)
        ├──────────────► GET /a/:token            (public view, no API key)
        ├──────────────► GET /a/:token/download   (public, Content-Disposition attachment)
        └──────────────► GET /api/artifacts/:id/download (authed owner download of unpublished)

Web:  ARTIFACTS tab → ArtifactsView (list) → ArtifactViewer (sandboxed <iframe srcdoc>) + Download
iOS:  Settings → Artifacts list → WKWebView.loadHTMLString + Save/Share sheet
```

## Reused seams (do NOT re-implement)

| Need | Reuse |
|---|---|
| Sanitize authored HTML (mXSS-safe) | `sanitizeProposalHtml()` — `backend/src/services/proposal-sanitize.ts` |
| Share-token generation | `generateShareToken(len=22)` — `backend/src/services/proposal-store.ts` |
| External base URL (behind tunnel) | `resolvePublicBaseUrl(req)` — `backend/src/utils/public-url.ts` |
| Public-route shape (404 page, send doc) | `backend/src/routes/public-proposals.ts` (pattern for `public-artifacts.ts`) |
| Strict CSP meta | `PROPOSAL_DOCUMENT_CSP` — `backend/src/services/proposal-html.ts` (or a new `ARTIFACT_CSP`) |
| Store factory shape | `createProposalStore` — `backend/src/services/proposal-store.ts` |
| Web sandboxed viewer | `frontend/src/components/proposals/ProposalPageViewer.tsx` |
| iOS WKWebView + share | `ios/AdjutantKit/.../Utils/ProposalSharing.swift`, `APIClient+Proposals.swift` |

## Phases (= sub-epics; merge order 1 → then 2/3/4 in parallel → 5)

### Phase 1 — Backend artifact engine [US1, P0]  (blocks 2,3,4)
- **039-artifacts.sql** — `artifacts` table (global; no project_id). `backend/src/services/migrations/039-artifacts.sql`
- **artifact-store.ts** — CRUD + publish/unpublish + list. `backend/src/services/artifact-store.ts`
- **artifact-html.ts** — `composeArtifactDocument()` (sanitize + self-contained + CSP, as-authored). `backend/src/services/artifact-html.ts`
- **routes/artifacts.ts** — REST CRUD + publish/unpublish + `GET /:id/download`. `backend/src/routes/artifacts.ts`
- **routes/public-artifacts.ts** — `GET /a/:token` + `GET /a/:token/download`; mount before `apiKeyAuth` in `index.ts` (`app.use("/a", …)` next to the `/p` mount at index.ts:165). `backend/src/routes/public-artifacts.ts`

### Phase 2 — Agent authoring via MCP [US2, P0]  (needs Phase 1 store)
- **mcp-tools/artifacts.ts** — `create_artifact`, `publish_artifact`, `unpublish_artifact`, `list_artifacts`; register via `registerArtifactTools(...)` in `index.ts`. `backend/src/services/mcp-tools/artifacts.ts`

### Phase 3 — Web Artifacts page [US3, P0]  (needs Phase 1 contract)
- **api.ts** — `artifacts` client block + `buildPublicArtifactUrl` + download URL. `frontend/src/services/api.ts`
- **ArtifactsView.tsx / ArtifactCard.tsx** — list, publish/unpublish, share, delete + **ARTIFACTS** tab in `App.tsx`. `frontend/src/components/artifacts/`
- **ArtifactViewer.tsx** — sandboxed `<iframe srcdoc>` + **Download** button. `frontend/src/components/artifacts/`
- **CreateArtifactForm.tsx** — paste HTML / upload `.html` + title → publish. `frontend/src/components/artifacts/`

### Phase 4 — iOS Artifacts in Settings [US4, P1]  (needs Phase 1 contract)
- **Artifact.swift** model + **APIClient+Artifacts.swift**. `ios/AdjutantKit/Sources/AdjutantKit/…`
- **ArtifactsViewModel.swift**. `ios/AdjutantKit/Sources/AdjutantKit/ViewModels/`
- **ArtifactsView.swift** nested in `SettingsView` + WKWebView viewer. `ios/Adjutant/Features/Settings/`
- **Download/Save**: write `.html` → share sheet / save to Files. (extend the SwiftPM auto-discovered sources — do NOT edit `.pbxproj`)

### Phase 5 — Security & polish [US5, P2]  (needs 1; polish needs 3/4)
- XSS/mXSS regression suite against `/a/:token` (reuse proposal payload corpus). `backend/tests/unit/public-artifacts-security.test.ts`
- Download slug/filename, empty/loading/error states, a11y, `docs/artifact-authoring.md`.

## Parallelization

- Phase 1 tasks: `039` (setup) → `artifact-store` ∥ `artifact-html` → `routes/artifacts` ∥ `public-artifacts`.
- After Phase 1 merges: Phases 2, 3, 4 run as **three parallel tracks** (backend-MCP, web, iOS).
- Phase 5 last.

## Constraints

- TDD (backend blocking typecheck; run `./scripts/verify-before-push.sh` before every push).
- Layered: route → service → store; no business logic in routes.
- Security: `/a/:token` is served to UNAUTHENTICATED viewers — the sanitizer is load-bearing;
  the mXSS regression suite gates merge.
- iOS is SwiftPM (auto-discovers `Adjutant/` + `AdjutantKit/`); never edit `.pbxproj`.
- Global scope: NO `project_id` on artifacts; all queries/events/APIs are fleet-wide.

## Bead Map

- `adj-j7az6` — Root epic: Adjutant Artifacts
  - `adj-j7az6.1` — Phase 1: Backend artifact engine
    - `.1.1` Migration 039-artifacts.sql · `.1.2` artifact-store.ts · `.1.3` artifact-html.ts · `.1.4` routes/artifacts.ts · `.1.5` routes/public-artifacts.ts
  - `adj-j7az6.2` — Phase 2: Agent authoring via MCP
    - `.2.1` mcp-tools/artifacts.ts
  - `adj-j7az6.3` — Phase 3: Web Artifacts page
    - `.3.1` api client · `.3.2` ArtifactsView + tab · `.3.3` ArtifactViewer + Download · `.3.4` CreateArtifactForm
  - `adj-j7az6.4` — Phase 4: iOS Artifacts in Settings
    - `.4.1` model + APIClient · `.4.2` ViewModel · `.4.3` view in Settings + WKWebView · `.4.4` Download/Save
  - `adj-j7az6.5` — Phase 5: Security & polish
    - `.5.1` mXSS suite on /a · `.5.2` docs · `.5.3` slug + states
