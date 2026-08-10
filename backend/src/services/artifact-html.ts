/**
 * adj-j7az6.1.3 — Compose an Artifact into one self-contained, sanitized HTML document.
 *
 * Unlike {@link composeProposalDocument}, this preserves the page AS AUTHORED: the
 * sanitized body is wrapped in a MINIMAL document shell (charset + CSP + viewport + the
 * authored content) with NO branded "document" theme, no injected stylesheet, and no
 * theme-toggle chrome. An arbitrary standalone webpage therefore renders exactly as its
 * author intended, while still going through the load-bearing sanitizer so the content is
 * safe to serve to UNAUTHENTICATED viewers (GET /a/:token).
 *
 * Security invariants (identical trust model to proposal pages):
 *   - The UNTRUSTED authored html is ALWAYS run through {@link sanitizeProposalHtml}
 *     (strips <script>, on* handlers, javascript:/external URLs, mXSS vectors, and
 *     external CSS resource references) — the single security boundary.
 *   - The result is self-contained: the sanitizer removes external http(s) resource
 *     references, so nothing is fetched at render time.
 *   - A strict CSP `<meta>` is embedded for defense-in-depth on non-HTTP surfaces
 *     (iOS WKWebView loadHTMLString, sandboxed <iframe srcdoc>). The public /a route
 *     additionally sets the same policy as an HTTP header.
 */

import type { Artifact } from "../types/artifacts.js";
import { sanitizeProposalHtml } from "./proposal-sanitize.js";

/**
 * The Content-Security-Policy for a composed artifact document. Artifacts are arbitrary
 * self-contained pages with the SAME contract as proposal pages — inline styles and
 * data: images only, no scripts, no external fetch/connect/framing — so the policy is
 * identical. Kept as a distinct exported constant (not re-exported) so the two surfaces
 * can diverge later without silently coupling.
 *
 * Deny everything by default, then re-permit only what a self-contained document needs:
 *   - style-src 'unsafe-inline' → inline `<style>` blocks and `style=""` attributes
 *   - img-src data:            → data: URI images only (no external / tracking pixels)
 * Scripts, external connects, framing, and base/form targets stay denied.
 */
export const ARTIFACT_DOCUMENT_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** Minimal HTML-escape for text inserted into trusted template slots (e.g. <title>). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Compose a self-contained, sanitized HTML document for an artifact, preserving the page
 * as authored (NO branded shell). Always returns a complete `<!DOCTYPE html>` document.
 */
export function composeArtifactDocument(artifact: Artifact): string {
  // ALWAYS sanitize — the load-bearing security boundary. The sanitizer strips the
  // authored document's own <html>/<head>/<body>/<meta> wrappers down to a safe body
  // fragment (keeping its inline <style> blocks and content), which we then re-wrap in
  // our own minimal, trusted shell carrying the CSP.
  const body = sanitizeProposalHtml(artifact.html);
  const safeTitle = escapeHtml(artifact.title);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_DOCUMENT_CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${safeTitle}</title>
</head>
<body>
${body}
</body>
</html>`;
}
