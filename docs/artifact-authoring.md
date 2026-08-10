# Artifact Authoring Contract

How an agent authors the self-contained HTML of an **Artifact** (adj-j7az6) so the page
renders and shares safely. Artifacts are a single fleet-wide library owned by the
Commander — standalone HTML pages decoupled from proposals and beads, with **no project
scoping**.

**Audience:** agents authoring artifacts via `create_artifact` / `publish_artifact`, and
anyone reviewing a composed/published artifact page.

**Related:** spec `specs/065-artifacts/`. The same contract is surfaced verbatim to agents
at tool-call time as `HTML_AUTHORING_CONTRACT` in
`backend/src/services/mcp-tools/artifacts.ts`. Artifacts reuse the proposal security
boundary (`proposal-sanitize.ts`); the authoring model differs — see "Rendered as
authored" below.

## Rendered as authored (the key difference from proposals)

A proposal page is wrapped in a branded, dark/accessible "document" shell that the server
supplies. An **artifact is different**: `composeArtifactDocument`
(`backend/src/services/artifact-html.ts`) wraps your body in a **minimal** shell
(charset + viewport + CSP + `<title>`) with **no injected theme, no stylesheet, and no
theme-toggle chrome**. Your page renders **exactly as you authored it**.

Two consequences:

- **You own the entire look.** There is no server-supplied dark mode, accent color, or
  layout. If you want dark mode, accessibility, or branding, you must author it yourself.
- **There is no drift-lint and no `get_project_style`.** Artifacts are not project-scoped,
  so there is no brand color to honor and no static style linter. The dark/accessible/
  friendly guidance below is a strong recommendation, not an enforced gate.

What the server *does* guarantee is safety: every body is sanitized before it is served.

## The contract

### 1. Self-contained, CSP-safe — no external resources, no scripts

- Style with an inline `<style>` block and inline `style=""`; draw graphics with inline
  `<svg>`. Embed any image as a `data:` URI.
- **No** external stylesheets, scripts, fonts, or images of any kind — the page must render
  offline, inside a sandboxed `<iframe srcdoc>`, and inside iOS
  `WKWebView.loadHTMLString`.
- **No** `<script>` and **no** `on*=` event handlers (`onclick`, `onload`, …). Both are
  stripped server-side, and the embedded CSP (`default-src 'none'`) forbids them anyway.
  Any interactivity must be pure CSS.
- `<iframe>`, `<object>`, and `<embed>` are removed.

The composed document embeds this Content-Security-Policy (`ARTIFACT_DOCUMENT_CSP`), and
the public `/a/:token` route also sets it as an HTTP header:

```
default-src 'none'; style-src 'unsafe-inline'; img-src data:;
base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

### 2. Everything is sanitized before it is served

Your `html` is **untrusted** and always runs through the load-bearing sanitizer
(`sanitizeProposalHtml` — the same boundary as proposal pages) before being wrapped and
served to **unauthenticated** viewers at `GET /a/:token`. The sanitizer allows semantic
tags, `<style>`, inline `<svg>`, and `data:` images, and strips `<script>`, `on*`
handlers, `javascript:`/external URLs, `<iframe>`/`<object>`/`<embed>`, and mutation-XSS
(mXSS) vectors. Anything outside the contract in section 1 is removed — author to the
contract so the sanitized output is what you intended.

### 3. Recommended: dark, accessible, friendly

Because the page renders as authored, these are on you (nothing corrects drift):

- Author **dark-by-default** with a `@media (prefers-color-scheme: light)` variant so a
  reader whose OS prefers light gets light automatically. A pure-CSS theme toggle (a
  checkbox — no JS) is a nice touch.
- Meet **WCAG AA** contrast (≥ 4.5:1 for body text) against both backgrounds. Never set
  `color` equal to its own `background-color`.
- Use **semantic structure**: real headings (`<h1>`/`<h2>`), `<section>`s, paragraphs,
  lists, tables, blockquotes, and at least one landmark (`<main>` / `<header>`). Set `lang`
  on `<html>`. Keep visible `:focus-visible` styles on interactive controls.
- Write a clean, readable **document**, not the CRT dashboard theme.

### 4. Size caps

Enforced at the Zod boundary (shared by the REST routes and the MCP tools, exported from
`backend/src/types/artifacts.ts`) so oversized input is rejected before it reaches the
store or the per-request sanitize path:

| Field         | Cap                        |
| ------------- | -------------------------- |
| `html`        | 256 KiB (`262144` chars)   |
| `title`       | 300 chars                  |
| `description` | 2000 chars                 |
| `slug`        | 200 chars                  |

The `html` cap is the important one: the `/a/:token` route sanitizes each body **per
request** on an unauthenticated surface, so an unbounded blob is a compute-amplification
DoS. `title` is required; `description` and `slug` are optional.

## Publishing, sharing, and download

- **`create_artifact`** — author an artifact (the calling agent is recorded server-side as
  `createdBy`). Pass `public: true` to publish immediately and get back a `publicUrl`.
- **`publish_artifact` / `unpublish_artifact`** — toggle the public link by id. Unpublish
  retains the share token, so a later re-publish revives the **same** URL.
- **Public link** — `GET /a/:token` serves the composed, sanitized, self-contained
  document with no API key. Unknown, unpublished, and private tokens all `404`
  indistinguishably (no existence leak).
- **Download** — the composed document downloads as an HTML file attachment. The filename
  is derived from the artifact's `slug`, falling back to a slugified `title`, and finally
  to the artifact `id` — always a filesystem-safe `<name>.html`.

## Where this is enforced (code map)

| Concern                 | Location                                                  |
| ----------------------- | -------------------------------------------------------- |
| Authoring contract text | `HTML_AUTHORING_CONTRACT` in `mcp-tools/artifacts.ts`    |
| Size caps (shared)      | `MAX_*` constants in `types/artifacts.ts`                |
| Sanitizer (security)    | `sanitizeProposalHtml` in `proposal-sanitize.ts`         |
| Compose (minimal shell) | `composeArtifactDocument` in `artifact-html.ts`          |
| Public route            | `GET /a/:token` in `routes/public-artifacts.ts`          |
| Authored REST/MCP       | `routes/artifacts.ts`, `mcp-tools/artifacts.ts`          |
