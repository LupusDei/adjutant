/**
 * Public, UNAUTHENTICATED proposal page route (adj-200.2.5).
 *
 * GET /p/:token — serves the composed, sanitized, self-contained HTML document for a
 * PUBLISHED proposal to anyone with the link (no API key). Mounted BEFORE the API-key
 * middleware in index.ts, and `/p` is on the middleware bypass list (defense in depth).
 *
 * Security:
 *  - The body comes from {@link composeProposalDocument}, which always runs untrusted
 *    content through the sanitizer (the single security surface, SC-005).
 *  - Strict CSP: deny-by-default; allow only inline styles and data: images (needed for
 *    self-contained rendering). No script execution, no external fetch/connect.
 *  - Unknown / unpublished / private proposals all resolve to null and return an
 *    identical minimal 404 — the route never reveals whether a token exists, and never
 *    echoes the requested token or any internal identifier (NFR-004).
 */

import { Router } from "express";

import type { ProposalStore } from "../services/proposal-store.js";
import { composeProposalDocument } from "../services/proposal-html.js";

/**
 * Strict Content-Security-Policy for the public document. `default-src 'none'` denies
 * everything; we then re-permit only what a self-contained document needs:
 *  - style-src 'unsafe-inline' → inline <style> blocks and style="" attributes
 *  - img-src data:            → data: URI images only (no external/tracking pixels)
 * Scripts, external connects, framing, and base/form targets stay denied.
 */
const PUBLIC_DOCUMENT_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const NOT_FOUND_PAGE =
  "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
  "<title>Not found</title></head><body><p>This page is not available.</p></body></html>";

export function createPublicProposalsRouter(store: ProposalStore): Router {
  const router = Router();

  router.get("/:token", (req, res) => {
    const proposal = store.getProposalByToken(req.params.token);

    if (!proposal) {
      res
        .status(404)
        .set("Content-Type", "text/html; charset=utf-8")
        .set("X-Content-Type-Options", "nosniff")
        .send(NOT_FOUND_PAGE);
      return;
    }

    const document = composeProposalDocument(proposal);
    res
      .status(200)
      .set("Content-Type", "text/html; charset=utf-8")
      .set("Content-Security-Policy", PUBLIC_DOCUMENT_CSP)
      .set("X-Content-Type-Options", "nosniff")
      .set("Referrer-Policy", "no-referrer")
      .send(document);
  });

  return router;
}
