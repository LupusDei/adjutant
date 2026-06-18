# Proposal-Page Authoring Contract

How an agent authors the optional HTML body of a proposal (adj-200) so the shared page
renders dark, accessible, friendly, and on-brand — and how the QA drift-lint enforces it.

**Audience:** agents authoring proposals via `create_proposal` / `revise_proposal`, and
QA verifying a composed/published page.

**Related:** spec `specs/058-proposal-html-pages/` (sharing) and
`specs/059-project-style-guide/` (per-project style guide + dark/accessible baseline).
The same contract is surfaced verbatim to agents at tool-call time as
`HTML_AUTHORING_CONTRACT` in `backend/src/services/mcp-tools/proposals.ts`.

## Why a contract (the enforcement model)

Enforcement is **authoring-only**: the server does **not** inject project tokens, a theme,
or accent colors into your page. The composition pipeline
(`backend/src/services/proposal-html.ts` → `composeProposalDocument`) wraps your body in a
branded, self-contained document shell and runs your body through the sanitizer
(`proposal-sanitize.ts`), but the *content* — colors, structure, copy — is what you author.
If you drift off-brand or drop dark-mode/a11y, nothing on the server corrects it.

The **QA drift-lint** (`backend/src/services/proposal-style-lint.ts`,
`lintProposalPage(html, { expectedBrandColor })`) is the safety net: it statically inspects
a composed page and reports drift so a reviewer catches it before publish. It is a
lightweight static check, not a browser — passing the lint is necessary, not sufficient.
Author to the contract; treat the lint as a backstop.

## The contract

### 1. Self-contained, CSP-safe — no external resources, no scripts

- Style with an inline `<style>` block and inline `style=""`; draw graphics with inline
  `<svg>`. Embed any image as a `data:` URI.
- **No** external stylesheets, scripts, fonts, or images of any kind — the page must render
  offline and inside iOS `WKWebView.loadHTMLString`.
- **No** `<script>` and **no** `on*=` event handlers (`onclick`, `onload`, …). Both are
  stripped server-side, and the embedded CSP (`default-src 'none'`) forbids them anyway.
- `<iframe>`, `<object>`, and `<embed>` are removed. Any interactivity must be pure CSS
  (the shipped theme toggle is a CSS-only checkbox — no JS).

### 2. Honor the project brand color (from `get_project_style`)

- Before composing, call **`get_project_style`** for THIS project.
- If it returns a guide, use `brandColorPrimary` (and `brandColorSecondary` when present) as
  your accent for headings, links, rules, and emphasis. The color MUST actually appear in
  the page — the drift-lint flags `missing-accent-color` if the expected color is absent
  (it normalizes `#RGB` ↔ `#RRGGBB` and is case-insensitive).
- If it returns `null` (no guide set — a valid state), pick a tasteful neutral accent.

### 3. Dark by default + `prefers-color-scheme` light + a toggle

- Author **dark-by-default** with a `@media (prefers-color-scheme: light)` variant so a
  reader whose OS prefers light gets light automatically.
- Provide a manual light/dark affordance (the document shell already ships a CSS-only
  ☀/☾ toggle; if you fully replace the shell styling, keep an equivalent mechanism).
- The drift-lint flags `no-dark-mode` when a page has neither a `prefers-color-scheme`
  query nor a theme-toggle mechanism.

### 4. Accessible — WCAG AA, semantic HTML, visible focus

- Meet **WCAG AA** contrast (≥ 4.5:1 for body text) against BOTH the dark and light
  backgrounds. Never set `color` equal to its own `background-color`
  (the lint flags `contrast-red-flag`).
- Use **semantic structure**: real headings (`<h1>`/`<h2>`), `<section>`s, paragraphs,
  lists, tables, blockquotes — and at least one landmark (`<main>` / `<header>`). The lint
  flags `missing-landmark` when none is present.
- Set `lang` on `<html>` (the lint flags `missing-lang` otherwise).
- Keep visible `:focus-visible` styles on interactive controls.

### 5. Friendly, document-like tone

- Write a clean, readable DOCUMENT, not an app UI or the CRT dashboard theme. Warm,
  plain language; structure that scans.

### 6. Markdown `description` stays required

- The markdown `description` is still REQUIRED — it drives list previews, search, and
  confidence scoring. The `html` body is **additive**, never a replacement. Max HTML size
  is 256 KiB.

## Verifying with the drift-lint (QA)

```ts
import { composeProposalDocument } from "../services/proposal-html.js";
import { lintProposalPage } from "../services/proposal-style-lint.js";

const page = composeProposalDocument(proposal);
const { ok, findings } = lintProposalPage(page, { expectedBrandColor: "#ff6600" });
// ok === false when any finding has severity "error".
// Omit expectedBrandColor to skip the accent check (project has no style guide).
```

Finding codes: `missing-accent-color`, `invalid-expected-color`, `no-dark-mode`,
`missing-lang`, `missing-landmark`, `contrast-red-flag`.
