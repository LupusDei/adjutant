/**
 * Public, UNAUTHENTICATED artifact page route (adj-j7az6.1.5).
 *
 * GET /a/:token          — serves the composed, sanitized, self-contained HTML document
 *                          for a PUBLISHED artifact to anyone with the link (no API key).
 * GET /a/:token/download — serves the same document as a file attachment.
 *
 * Mounted BEFORE the API-key middleware in index.ts (beside `/p`), and `/a` is on the
 * middleware bypass list.
 *
 * Security (identical trust model to public-proposals):
 *  - The body comes from {@link composeArtifactDocument}, which always runs untrusted
 *    content through the sanitizer (the single security surface).
 *  - Strict CSP: deny-by-default; allow only inline styles and data: images. No script
 *    execution, no external fetch/connect.
 *  - Unknown / unpublished / private artifacts all resolve to null and return an identical
 *    minimal 404 — the route never reveals whether a token exists, and never echoes the
 *    requested token or any internal identifier.
 */

import { Router, type Response } from "express";

import type { Artifact } from "../types/artifacts.js";
import type { ArtifactStore } from "../services/artifact-store.js";
import { composeArtifactDocument, ARTIFACT_DOCUMENT_CSP } from "../services/artifact-html.js";
import { artifactFilename } from "./artifacts.js";
import { logError } from "../utils/index.js";

// The HTTP-header CSP for the public route is the SAME policy embedded in the document
// `<meta>` (single source of truth in artifact-html.ts), so the header and meta can never
// drift. On this route the header is authoritative (`frame-ancestors` etc. take effect);
// the meta is the defense-in-depth copy for non-HTTP surfaces (iOS loadHTMLString).
const PUBLIC_DOCUMENT_CSP = ARTIFACT_DOCUMENT_CSP;

const NOT_FOUND_PAGE =
  "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
  "<title>Not found</title></head><body><p>This page is not available.</p></body></html>";

/**
 * Apply the hardened response headers used by EVERY response this route emits — the 200
 * document, the 404, and the error fallback alike. Keeping them in one place means the
 * not-found / error paths can never silently drop the CSP or referrer policy.
 */
function applySecurityHeaders(res: Response): void {
  res
    .set("Content-Type", "text/html; charset=utf-8")
    .set("Content-Security-Policy", PUBLIC_DOCUMENT_CSP)
    .set("X-Content-Type-Options", "nosniff")
    .set("Referrer-Policy", "no-referrer");
}

/**
 * @param store     artifact store (resolves the public token → published artifact).
 * @param compose   document composer; injectable so the failure path is testable. Defaults
 *                  to the real {@link composeArtifactDocument}.
 */
export function createPublicArtifactsRouter(
  store: ArtifactStore,
  compose: (artifact: Artifact) => string = composeArtifactDocument,
): Router {
  const router = Router();

  // GET /a/:token/download — attachment download of the public artifact.
  router.get("/:token/download", (req, res) => {
    try {
      const artifact = store.getArtifactByToken(req.params.token);
      if (!artifact) {
        applySecurityHeaders(res);
        res.status(404).send(NOT_FOUND_PAGE);
        return;
      }

      const document = compose(artifact);
      applySecurityHeaders(res);
      res
        .status(200)
        .set("Content-Disposition", `attachment; filename="${artifactFilename(artifact)}"`)
        .send(document);
    } catch (err) {
      logError("public artifact download route failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      if (!res.headersSent) {
        applySecurityHeaders(res);
        res.status(500).send(NOT_FOUND_PAGE);
      }
    }
  });

  // GET /a/:token — view the composed public artifact document.
  router.get("/:token", (req, res) => {
    try {
      const artifact = store.getArtifactByToken(req.params.token);
      if (!artifact) {
        applySecurityHeaders(res);
        res.status(404).send(NOT_FOUND_PAGE);
        return;
      }

      const document = compose(artifact);
      applySecurityHeaders(res);
      res.status(200).send(document);
    } catch (err) {
      // Defense in depth: a store/compose failure must NOT reach Express's default error
      // handler, which leaks a stack trace when NODE_ENV !== production — contradicting
      // this route's no-leak guarantee. Log server-side; return a generic, detail-free
      // page with the same hardened headers and never echo the token.
      logError("public artifact route failed", {
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
