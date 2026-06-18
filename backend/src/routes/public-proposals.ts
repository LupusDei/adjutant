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

import { Router, type Response } from "express";

import type { Proposal } from "../types/proposals.js";
import type { ProposalStore } from "../services/proposal-store.js";
import { composeProposalDocument, PROPOSAL_DOCUMENT_CSP } from "../services/proposal-html.js";
import { logError } from "../utils/index.js";

// The HTTP-header CSP for the public route is the SAME policy embedded in the document
// `<meta>` (single source of truth in proposal-html.ts), so the header and meta can never
// drift. On this route the header is authoritative (`frame-ancestors` etc. take effect);
// the meta is the defense-in-depth copy for non-HTTP surfaces (iOS loadHTMLString).
const PUBLIC_DOCUMENT_CSP = PROPOSAL_DOCUMENT_CSP;

const NOT_FOUND_PAGE =
  "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
  "<title>Not found</title></head><body><p>This page is not available.</p></body></html>";

/**
 * Apply the hardened response headers used by EVERY response this route emits — the 200
 * document, the 404, and the error fallback alike (adj-200.2.5.1). Keeping them in one
 * place means the not-found / error paths can never silently drop the CSP or referrer
 * policy that the success path sets.
 */
function applySecurityHeaders(res: Response): void {
  res
    .set("Content-Type", "text/html; charset=utf-8")
    .set("Content-Security-Policy", PUBLIC_DOCUMENT_CSP)
    .set("X-Content-Type-Options", "nosniff")
    .set("Referrer-Policy", "no-referrer");
}

/**
 * @param store     proposal store (resolves the public token → published proposal).
 * @param compose   document composer; injectable so the failure path is testable. Defaults
 *                  to the real {@link composeProposalDocument}.
 */
export function createPublicProposalsRouter(
  store: ProposalStore,
  compose: (proposal: Proposal) => string = composeProposalDocument,
): Router {
  const router = Router();

  router.get("/:token", (req, res) => {
    try {
      const proposal = store.getProposalByToken(req.params.token);

      if (!proposal) {
        applySecurityHeaders(res);
        res.status(404).send(NOT_FOUND_PAGE);
        return;
      }

      const document = compose(proposal);
      applySecurityHeaders(res);
      res.status(200).send(document);
    } catch (err) {
      // Defense in depth: a store/compose failure must NOT reach Express's default error
      // handler, which leaks a stack trace when NODE_ENV !== production — contradicting
      // this route's no-leak guarantee (NFR-004). Log server-side; return a generic,
      // detail-free page with the same hardened headers and never echo the token.
      logError("public proposal route failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      if (!res.headersSent) {
        applySecurityHeaders(res);
        res.status(500).send(NOT_FOUND_PAGE);
      }
    }
  });

  return router;
}
