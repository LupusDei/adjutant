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
import { composeProposalDocument, PROPOSAL_DOCUMENT_CSP } from "../services/proposal-html.js";

// The HTTP-header CSP for the public route is the SAME policy embedded in the document
// `<meta>` (single source of truth in proposal-html.ts), so the header and meta can never
// drift. On this route the header is authoritative (`frame-ancestors` etc. take effect);
// the meta is the defense-in-depth copy for non-HTTP surfaces (iOS loadHTMLString).
const PUBLIC_DOCUMENT_CSP = PROPOSAL_DOCUMENT_CSP;

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
