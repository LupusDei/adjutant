/**
 * adj-200.2.4 — Compose a proposal into one self-contained, sanitized HTML document.
 *
 * This is the single composition pipeline (SC-005): the public `GET /p/:token` route,
 * the web in-frame viewer, and the iOS WebView all render the output of this function,
 * so there is exactly one rendering + security surface.
 *
 * Design:
 *   - The UNTRUSTED body (agent `html`, or the markdown `description` rendered via
 *     markdown-it) is run through {@link sanitizeProposalHtml}. If the agent html
 *     sanitizes to nothing, we fall back to the markdown render so the page is never
 *     blank (spec edge case).
 *   - The sanitized body is wrapped in a TRUSTED, static document template (inlined
 *     `<style>`, system font stack, no external CSS/JS/fonts/images). The template is
 *     code we own; only the body is sanitized. The result is self-contained (NFR-002)
 *     and uses a readable "document" aesthetic — NOT the Pip-Boy CRT theme — because it
 *     is shared with readers who lack the app.
 */

import MarkdownIt from "markdown-it";

import type { Proposal } from "../types/proposals.js";
import { sanitizeProposalHtml } from "./proposal-sanitize.js";

/**
 * The canonical Content-Security-Policy for a composed proposal document — the single
 * source of truth shared by the in-document `<meta>` (below) AND the public `/p/:token`
 * HTTP response header (`public-proposals.ts`), so the two can never drift.
 *
 * Deny everything by default, then re-permit only what a self-contained document needs:
 *   - style-src 'unsafe-inline' → inline `<style>` blocks and `style=""` attributes
 *   - img-src data:            → data: URI images only (no external / tracking pixels)
 * Scripts, external connects, framing, and base/form targets stay denied. (NFR-001/002.)
 *
 * Why also as a `<meta>` (adj-200.2.4.1): the SAME document is rendered on surfaces that
 * carry NO HTTP headers — iOS WKWebView `loadHTMLString` and web `<iframe srcdoc>` — so
 * an HTTP-header-only CSP would leave the sanitizer as the sole defense exactly where the
 * mXSS / escaped-url() vectors bite. `frame-ancestors` is a header-only directive (UAs
 * ignore it inside `<meta>`); it is retained for the HTTP path and harmlessly ignored in
 * the meta.
 */
export const PROPOSAL_DOCUMENT_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

// markdown-it with raw-HTML passthrough DISABLED (raw HTML in the markdown description
// is escaped, not injected) — the sanitizer is still applied as defense in depth.
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: false,
});

/** Minimal HTML-escape for text inserted into trusted template slots (e.g. <title>). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Render the proposal markdown `description` to sanitized HTML. */
function renderMarkdown(markdown: string): string {
  return sanitizeProposalHtml(md.render(markdown ?? ""));
}

/**
 * Resolve the sanitized body for a proposal: the agent html when present and non-empty
 * after sanitization, otherwise the markdown render of the description.
 */
function renderBody(proposal: Proposal): string {
  if (proposal.html && proposal.html.trim().length > 0) {
    const sanitized = sanitizeProposalHtml(proposal.html);
    if (sanitized.trim().length > 0) {
      return sanitized;
    }
    // Sanitizer stripped everything — fall through to the markdown render.
  }
  return renderMarkdown(proposal.description);
}

/**
 * The self-contained document stylesheet (adj-201.4.1). A friendly, readable "document"
 * aesthetic that is **dark by default**, honors `prefers-color-scheme: light`, and exposes
 * a **CSS-only** ☀/☾ light/dark toggle. System font stack (no `@font-face` / external
 * fonts) and no `url(...)` references → nothing to fetch (preserves the adj-200
 * self-contained / CSP contract).
 *
 * Theming model — everything reads CSS custom properties resolved on `.proposal-root`:
 *   1. `.proposal-root` carries the DARK token set as the baseline (dark default).
 *   2. `@media (prefers-color-scheme: light)` re-binds those tokens to the LIGHT set, so
 *      a reader whose OS prefers light gets light without touching anything.
 *   3. The manual toggle is a single hidden `<input type="checkbox">` placed BEFORE
 *      `.proposal-root`; when `:checked` it re-binds the tokens to the LIGHT set via the
 *      sibling combinator. Because that rule is authored AFTER the media query (and is no
 *      less specific), the explicit user choice wins. No JavaScript is involved — the CSP
 *      forbids scripts and the sanitizer strips them, so the toggle MUST be pure CSS.
 *
 * Accessibility: WCAG AA contrast in both token sets, semantic landmarks in the markup,
 * a visible `:focus-visible` outline on the toggle, and the toggle is keyboard-operable
 * (a real checkbox) and labelled (`aria-label`).
 */
const DOCUMENT_STYLES = `
  :root { color-scheme: dark light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }

  /* DARK token set — the default. AA contrast against the dark surfaces below. */
  .proposal-root {
    --page-bg: #0d1117;
    --doc-bg: #161b22;
    --doc-border: #30363d;
    --text: #e6edf3;
    --heading: #f0f6fc;
    --muted: #9da7b3;
    --rule: #30363d;
    --link: #79c0ff;
    --code-bg: #1f2630;
    --code-text: #e6edf3;
    --pre-bg: #010409;
    --pre-text: #e6edf3;
    --quote-text: #b3bcc7;
    --th-bg: #1f2630;
    --toggle-bg: #21262d;
    --toggle-border: #30363d;
    --toggle-text: #e6edf3;
    --focus: #79c0ff;
  }

  /* LIGHT token set — applied when the OS prefers light, OR (below) when toggled. */
  @media (prefers-color-scheme: light) {
    .proposal-root {
      --page-bg: #f6f8fa;
      --doc-bg: #ffffff;
      --doc-border: #d0d7de;
      --text: #1f2328;
      --heading: #11161c;
      --muted: #57606a;
      --rule: #eaecef;
      --link: #0969da;
      --code-bg: #eff1f3;
      --code-text: #1f2328;
      --pre-bg: #1f2328;
      --pre-text: #f6f8fa;
      --quote-text: #57606a;
      --th-bg: #f6f8fa;
      --toggle-bg: #ffffff;
      --toggle-border: #d0d7de;
      --toggle-text: #1f2328;
      --focus: #0969da;
    }
  }

  /* Manual override: checking the toggle forces the LIGHT token set regardless of OS.
     Authored last + sibling-scoped so the explicit user choice beats the media query. */
  .proposal-doc__theme-input:checked ~ .proposal-root {
    --page-bg: #f6f8fa;
    --doc-bg: #ffffff;
    --doc-border: #d0d7de;
    --text: #1f2328;
    --heading: #11161c;
    --muted: #57606a;
    --rule: #eaecef;
    --link: #0969da;
    --code-bg: #eff1f3;
    --code-text: #1f2328;
    --pre-bg: #1f2328;
    --pre-text: #f6f8fa;
    --quote-text: #57606a;
    --th-bg: #f6f8fa;
    --toggle-bg: #ffffff;
    --toggle-border: #d0d7de;
    --toggle-text: #1f2328;
    --focus: #0969da;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.65;
    -webkit-text-size-adjust: 100%;
  }
  .proposal-root {
    min-height: 100vh;
    background: var(--page-bg);
    color: var(--text);
  }

  /* The hidden checkbox driving the CSS-only toggle. Kept off-screen (not display:none)
     so it stays reachable by keyboard/AT; the visible affordance is its <label>. */
  .proposal-doc__theme-input {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    border: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .proposal-doc__theme-toggle {
    position: fixed;
    top: 1rem;
    right: 1rem;
    z-index: 10;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.7rem;
    font-size: 0.95rem;
    line-height: 1;
    cursor: pointer;
    user-select: none;
    border: 1px solid var(--toggle-border);
    border-radius: 999px;
    background: var(--toggle-bg);
    color: var(--toggle-text);
  }
  .proposal-doc__theme-toggle .proposal-doc__theme-icon--light { display: none; }
  .proposal-doc__theme-toggle .proposal-doc__theme-icon--dark { display: inline; }
  /* When toggled to light, show the ☀ affordance (and vice-versa). */
  .proposal-doc__theme-input:checked ~ .proposal-root .proposal-doc__theme-icon--dark { display: none; }
  .proposal-doc__theme-input:checked ~ .proposal-root .proposal-doc__theme-icon--light { display: inline; }
  /* Visible focus ring for keyboard users (the toggle is the only interactive control). */
  .proposal-doc__theme-input:focus-visible ~ .proposal-root .proposal-doc__theme-toggle,
  .proposal-doc__theme-toggle:focus-visible {
    outline: 3px solid var(--focus);
    outline-offset: 2px;
  }

  .proposal-doc {
    max-width: 46rem;
    margin: 2.5rem auto;
    padding: 2.5rem 3rem;
    background: var(--doc-bg);
    border: 1px solid var(--doc-border);
    border-radius: 12px;
    box-shadow: 0 1px 3px rgba(1, 4, 9, 0.4);
  }
  .proposal-doc h1, .proposal-doc h2, .proposal-doc h3,
  .proposal-doc h4, .proposal-doc h5, .proposal-doc h6 {
    line-height: 1.25;
    margin: 1.6em 0 0.6em;
    font-weight: 600;
    color: var(--heading);
  }
  .proposal-doc h1 { font-size: 2rem; margin-top: 0; border-bottom: 1px solid var(--rule); padding-bottom: 0.3em; }
  .proposal-doc h2 { font-size: 1.5rem; border-bottom: 1px solid var(--rule); padding-bottom: 0.3em; }
  .proposal-doc p, .proposal-doc ul, .proposal-doc ol, .proposal-doc blockquote, .proposal-doc table {
    margin: 0 0 1rem;
  }
  .proposal-doc a { color: var(--link); text-decoration: none; }
  .proposal-doc a:hover { text-decoration: underline; }
  .proposal-doc a:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; border-radius: 2px; }
  .proposal-doc code, .proposal-doc pre, .proposal-doc kbd, .proposal-doc samp {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  }
  .proposal-doc code {
    background: var(--code-bg);
    color: var(--code-text);
    padding: 0.2em 0.4em;
    border-radius: 4px;
    font-size: 0.9em;
  }
  .proposal-doc pre {
    background: var(--pre-bg);
    color: var(--pre-text);
    padding: 1rem;
    border-radius: 8px;
    overflow: auto;
  }
  .proposal-doc pre code { background: transparent; padding: 0; color: inherit; }
  .proposal-doc blockquote {
    margin-left: 0;
    padding: 0.2em 1rem;
    color: var(--quote-text);
    border-left: 0.25em solid var(--doc-border);
  }
  .proposal-doc table { border-collapse: collapse; width: 100%; }
  .proposal-doc th, .proposal-doc td { border: 1px solid var(--doc-border); padding: 0.5em 0.75em; text-align: left; }
  .proposal-doc th { background: var(--th-bg); font-weight: 600; }
  .proposal-doc img, .proposal-doc svg { max-width: 100%; height: auto; }
  .proposal-doc hr { border: none; border-top: 1px solid var(--rule); margin: 2rem 0; }
  .proposal-doc__header { margin-bottom: 1.5rem; }
  .proposal-doc__title { font-size: 2rem; font-weight: 600; margin: 0; color: var(--heading); }
  .proposal-doc__meta { color: var(--muted); font-size: 0.85rem; margin-top: 0.4rem; }

  @media (prefers-reduced-motion: no-preference) {
    .proposal-doc__theme-toggle { transition: background 0.15s ease, color 0.15s ease; }
  }
`;

/**
 * Compose a self-contained, sanitized HTML document for a proposal.
 * Always returns a complete `<!DOCTYPE html>` document string.
 */
export function composeProposalDocument(proposal: Proposal): string {
  const body = renderBody(proposal);
  const safeTitle = escapeHtml(proposal.title);
  const safeType = escapeHtml(proposal.type);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${PROPOSAL_DOCUMENT_CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${safeTitle}</title>
<style>${DOCUMENT_STYLES}</style>
</head>
<body>
<input type="checkbox" id="proposal-theme-toggle" class="proposal-doc__theme-input" aria-label="Toggle light or dark theme">
<div class="proposal-root">
<label for="proposal-theme-toggle" class="proposal-doc__theme-toggle">
<span class="proposal-doc__theme-icon proposal-doc__theme-icon--dark" aria-hidden="true">☾</span>
<span class="proposal-doc__theme-icon proposal-doc__theme-icon--light" aria-hidden="true">☀</span>
<span>Theme</span>
</label>
<main class="proposal-doc">
<header class="proposal-doc__header">
<h1 class="proposal-doc__title">${safeTitle}</h1>
<div class="proposal-doc__meta">${safeType} proposal</div>
</header>
${body}
</main>
</div>
</body>
</html>`;
}
