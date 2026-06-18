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
 * The self-contained document stylesheet. Readable "document" aesthetic: light page,
 * dark text, system font stack (no @font-face / external fonts), comfortable measure.
 * No `url(...)` references → nothing to fetch.
 */
const DOCUMENT_STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.65;
    color: #1f2328;
    background: #f6f8fa;
    -webkit-text-size-adjust: 100%;
  }
  .proposal-doc {
    max-width: 46rem;
    margin: 2.5rem auto;
    padding: 2.5rem 3rem;
    background: #ffffff;
    border: 1px solid #d0d7de;
    border-radius: 10px;
    box-shadow: 0 1px 3px rgba(27, 31, 36, 0.08);
  }
  .proposal-doc h1, .proposal-doc h2, .proposal-doc h3,
  .proposal-doc h4, .proposal-doc h5, .proposal-doc h6 {
    line-height: 1.25;
    margin: 1.6em 0 0.6em;
    font-weight: 600;
    color: #11161c;
  }
  .proposal-doc h1 { font-size: 2rem; margin-top: 0; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
  .proposal-doc h2 { font-size: 1.5rem; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
  .proposal-doc p, .proposal-doc ul, .proposal-doc ol, .proposal-doc blockquote, .proposal-doc table {
    margin: 0 0 1rem;
  }
  .proposal-doc a { color: #0969da; text-decoration: none; }
  .proposal-doc a:hover { text-decoration: underline; }
  .proposal-doc code, .proposal-doc pre, .proposal-doc kbd, .proposal-doc samp {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  }
  .proposal-doc code {
    background: #eff1f3;
    padding: 0.2em 0.4em;
    border-radius: 4px;
    font-size: 0.9em;
  }
  .proposal-doc pre {
    background: #1f2328;
    color: #f6f8fa;
    padding: 1rem;
    border-radius: 8px;
    overflow: auto;
  }
  .proposal-doc pre code { background: transparent; padding: 0; color: inherit; }
  .proposal-doc blockquote {
    margin-left: 0;
    padding: 0.2em 1rem;
    color: #57606a;
    border-left: 0.25em solid #d0d7de;
  }
  .proposal-doc table { border-collapse: collapse; width: 100%; }
  .proposal-doc th, .proposal-doc td { border: 1px solid #d0d7de; padding: 0.5em 0.75em; text-align: left; }
  .proposal-doc th { background: #f6f8fa; font-weight: 600; }
  .proposal-doc img, .proposal-doc svg { max-width: 100%; height: auto; }
  .proposal-doc hr { border: none; border-top: 1px solid #d0d7de; margin: 2rem 0; }
  .proposal-doc__header { margin-bottom: 1.5rem; }
  .proposal-doc__title { font-size: 2rem; font-weight: 600; margin: 0; color: #11161c; }
  .proposal-doc__meta { color: #57606a; font-size: 0.85rem; margin-top: 0.4rem; }
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
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${safeTitle}</title>
<style>${DOCUMENT_STYLES}</style>
</head>
<body>
<main class="proposal-doc">
<header class="proposal-doc__header">
<h1 class="proposal-doc__title">${safeTitle}</h1>
<div class="proposal-doc__meta">${safeType} proposal</div>
</header>
${body}
</main>
</body>
</html>`;
}
