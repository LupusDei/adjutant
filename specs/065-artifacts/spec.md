# Feature: Adjutant Artifacts — Publish, Share & Download Standalone HTML Pages

**Status:** ✅ Implemented & shipped (iOS 2.34 build 67; web live)
**Root epic:** adj-j7az6 (closed)
**Owner:** Justin Martin (the General)

## Summary

A first-class **Artifacts** system: publish standalone single-page HTML documents that
are decoupled from proposals/beads. Each artifact can be **viewed**, **shared** via a
public no-API-key link, and — the **critical** requirement — **downloaded** as a
self-contained `.html` file onto a computer or phone. Artifacts are listed on a dedicated
**Artifacts page** on web and on mobile (nested under Settings).

Artifacts are **global / personal** — one library across the whole fleet, owned by the
Commander, not tied to any project. They can be created **both** by agents (via an MCP
tool, the same way proposals are authored today) and by the Commander (upload/paste HTML
in the web UI). The published/downloaded HTML preserves the page **as authored** — it is
sanitized and guaranteed self-contained, but NOT re-wrapped in the branded proposal
"document" shell, so arbitrary standalone webpages render exactly as intended.

## Design decisions (locked with the General)

- **Authoring:** BOTH — agents publish via MCP + the Commander uploads/pastes HTML in the web UI.
- **Rendering:** AS-AUTHORED — run through the proposal **sanitizer** (`sanitizeProposalHtml`)
  + self-containment guarantee + strict CSP. No branded shell. Download = the exact page.
- **Scope:** GLOBAL / personal — no `project_id`; one fleet-wide artifacts library.
- **Reuse:** the adj-200/201 proposal sharing pipeline (sanitizer, share-token generation,
  `resolvePublicBaseUrl`, public-route pattern, sandboxed iframe / WKWebView viewers).

## User Stories

### US1 — Backend artifact engine (Priority: P0)
As the system, I can store an HTML artifact, publish it to a public no-API-key link, serve
it sanitized + self-contained, and expose it for **download** as an attachment.

**Acceptance:**
- `artifacts` table (migration 039) stores id, title, slug, description, html, is_public,
  share_token (unique, nullable until publish), published_at, created_by, timestamps. No project_id.
- `createArtifactStore` — create/get/list/update/delete; publish (generate ≥16-char base62
  token) / unpublish (retain token so re-publish revives the link). Idempotent publish.
- `composeArtifactDocument(artifact)` sanitizes the authored HTML via `sanitizeProposalHtml`,
  guarantees self-contained (no external resource refs), embeds a strict CSP `<meta>`, and
  preserves the page as authored (no proposal document shell).
- REST: `POST/GET/GET :id/PATCH/DELETE /api/artifacts`; `POST /api/artifacts/:id/publish`
  + `/unpublish` (returns full `publicUrl`); `GET /api/artifacts/:id/download` (authenticated
  owner download, `Content-Disposition: attachment`).
- Public: `GET /a/:token` (view) and `GET /a/:token/download` (attachment). Mounted BEFORE
  `apiKeyAuth`; unknown/unpublished tokens 404 with no existence leak.

### US2 — Agent authoring via MCP (Priority: P0)
As an agent, I can publish an HTML page as an artifact so the Commander can view/share/download it.

**Acceptance:**
- MCP tools (`mcp-tools/artifacts.ts`): `create_artifact` (title + html [+ description],
  optional `public` to publish immediately), `publish_artifact`/`unpublish_artifact`
  (return the public URL), `list_artifacts`.
- Tool descriptions document the self-contained authoring contract (inline CSS/SVG, no
  external resources, no scripts — same contract as proposal pages).
- Server resolves the calling agent as `created_by`.

### US3 — Web Artifacts page (Priority: P0)
As the Commander, on the web dashboard I can see all artifacts, view one, share its link,
**download** it, and create a new one by uploading/pasting HTML.

**Acceptance:**
- New **ARTIFACTS** tab (`App.tsx`) → `ArtifactsView` lists artifacts (title, created,
  published badge, share link).
- View: sandboxed `<iframe srcdoc>` (no `allow-scripts`) rendering the composed document.
- **Download** button → saves the `.html` file to the computer (attachment endpoint / blob).
- Share: copy the public URL (published artifacts); publish/unpublish toggle.
- Create: a form to paste HTML or upload a `.html` file, set a title, and publish.
- Delete an artifact.

### US4 — iOS Artifacts (in Settings) (Priority: P1)
As the Commander, on mobile I can open Artifacts from Settings, view one, share it, and
**download/save** it to my phone.

**Acceptance:**
- An **Artifacts** row/section in `SettingsView` → an artifacts list screen.
- View via `WKWebView.loadHTMLString` (composed document).
- **Download/Save**: write the `.html` to a file and present the iOS share sheet / save to Files.
- Share: the public URL via the share sheet (published artifacts).

### US5 — Security & polish (Priority: P2)
As the system, the public artifact surface is safe for unauthenticated viewers and the UX is clean.

**Acceptance:**
- XSS/mXSS regression suite runs against `/a/:token` (reuse the proposal payload corpus):
  `<script>`, `on*` handlers, `javascript:`/external URLs, `<iframe>`/`<object>`, and the
  `<svg><style><img onerror>` mutation vector are all neutralized.
- Download filenames use a safe slug (`<title>.html`), fall back to `artifact-<id>.html`.
- Empty states on web + iOS; loading/error states; a11y basics.
- `docs/artifact-authoring.md` documents the self-contained contract for agents.

## Out of scope (this pass)

- Versioning / edit history of artifacts.
- Access controls beyond public/unpublished (no per-viewer auth, no expiry).
- Rich in-app WYSIWYG editing (paste/upload only on web; agents author programmatically).
- Per-project scoping (explicitly global this pass).

## Success criteria

- The Commander can publish an HTML page (via an agent or the web UI), open its public link
  in any browser with no API key, and **download the exact self-contained `.html`** on both
  computer and phone.
- The public surface passes the XSS/mXSS regression suite.
- All new backend units are TDD-covered; backend typecheck + `verify-before-push.sh` clean.
