/**
 * REST routes for Artifact management (adj-j7az6.1.4). Authenticated (mounted BEHIND
 * apiKeyAuth in index.ts) — the Commander/dashboard surface.
 *
 * POST   /api/artifacts               - Create an artifact ({ title, html, description?, slug?, createdBy? })
 * GET    /api/artifacts               - List artifacts (newest-first)
 * GET    /api/artifacts/:id           - Get a single artifact
 * PATCH  /api/artifacts/:id           - Update an artifact
 * DELETE /api/artifacts/:id           - Delete an artifact
 * POST   /api/artifacts/:id/publish   - Publish; returns { artifact, publicUrl } (<base>/a/<token>)
 * POST   /api/artifacts/:id/unpublish - Unpublish (retains the token)
 * GET    /api/artifacts/:id/download  - Download the composed doc as an attachment (<slug>.html)
 *
 * Layered: route → store → compose. No business logic lives here.
 */

import { Router } from "express";

import { CreateArtifactSchema, UpdateArtifactSchema } from "../types/artifacts.js";
import type { Artifact } from "../types/artifacts.js";
import type { ArtifactStore } from "../services/artifact-store.js";
import { composeArtifactDocument } from "../services/artifact-html.js";
import { success, notFound, validationError } from "../utils/responses.js";
import { resolvePublicBaseUrl } from "../utils/public-url.js";

/**
 * Derive a filesystem-safe download filename base from an artifact. Prefers the explicit
 * slug, else slugifies the title; when neither yields any sluggable characters it falls
 * back to `artifact-<id>.html` — so the download always has a sensible, safe `<name>.html`
 * filename (no path traversal / header-injection chars). The `artifact-<id>` fallback is
 * kept identical to the iOS (`artifactDownloadFilename`) and web (`api.artifacts.download`)
 * clients so every layer names the same artifact the same way (adj-j7az6.5.3).
 */
export function artifactFilename(artifact: Artifact): string {
  for (const source of [artifact.slug, artifact.title]) {
    const slug = (source ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/g, "");
    if (slug) return `${slug}.html`;
  }
  return `artifact-${artifact.id}.html`;
}

export function createArtifactsRouter(
  store: ArtifactStore,
  compose: (artifact: Artifact) => string = composeArtifactDocument,
): Router {
  const router = Router();

  // POST /api/artifacts
  router.post("/", (req, res) => {
    const parsed = CreateArtifactSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(validationError("Invalid artifact", parsed.error.message));
      return;
    }

    const createdBy = (req.body as Record<string, unknown>)["createdBy"];
    const artifact = store.createArtifact({
      title: parsed.data.title,
      html: parsed.data.html,
      description: parsed.data.description,
      slug: parsed.data.slug,
      createdBy: typeof createdBy === "string" ? createdBy : undefined,
    });

    res.status(201).json(success(artifact));
  });

  // GET /api/artifacts
  router.get("/", (_req, res) => {
    res.json(success(store.listArtifacts()));
  });

  // GET /api/artifacts/:id
  router.get("/:id", (req, res) => {
    const artifact = store.getArtifact(req.params.id);
    if (!artifact) {
      res.status(404).json(notFound("Artifact", req.params.id));
      return;
    }
    res.json(success(artifact));
  });

  // PATCH /api/artifacts/:id
  router.patch("/:id", (req, res) => {
    const parsed = UpdateArtifactSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(validationError("Invalid artifact update", parsed.error.message));
      return;
    }

    const artifact = store.updateArtifact(req.params.id, {
      title: parsed.data.title,
      html: parsed.data.html,
      description: parsed.data.description,
      slug: parsed.data.slug,
    });
    if (!artifact) {
      res.status(404).json(notFound("Artifact", req.params.id));
      return;
    }
    res.json(success(artifact));
  });

  // DELETE /api/artifacts/:id
  router.delete("/:id", (req, res) => {
    const deleted = store.deleteArtifact(req.params.id);
    if (!deleted) {
      res.status(404).json(notFound("Artifact", req.params.id));
      return;
    }
    res.json(success({ id: req.params.id, deleted: true }));
  });

  // POST /api/artifacts/:id/publish — returns the full no-API-key public URL. The base
  // origin is resolved from the EXTERNAL request context (X-Forwarded-*) so the link is
  // correct behind a reverse proxy / tunnel.
  router.post("/:id/publish", (req, res) => {
    const artifact = store.publishArtifact(req.params.id);
    if (!artifact) {
      res.status(404).json(notFound("Artifact", req.params.id));
      return;
    }
    const publicUrl = `${resolvePublicBaseUrl(req)}/a/${artifact.shareToken}`;
    res.json(success({ artifact, publicUrl }));
  });

  // POST /api/artifacts/:id/unpublish — revokes public access; the token is retained so a
  // later re-publish revives the same link.
  router.post("/:id/unpublish", (req, res) => {
    const artifact = store.unpublishArtifact(req.params.id);
    if (!artifact) {
      res.status(404).json(notFound("Artifact", req.params.id));
      return;
    }
    res.json(success({ artifact }));
  });

  // GET /api/artifacts/:id/download — authed owner download of the composed, sanitized,
  // self-contained document as a file attachment.
  router.get("/:id/download", (req, res) => {
    const artifact = store.getArtifact(req.params.id);
    if (!artifact) {
      res.status(404).json(notFound("Artifact", req.params.id));
      return;
    }
    const document = compose(artifact);
    res
      .status(200)
      .set("Content-Type", "text/html; charset=utf-8")
      .set("Content-Disposition", `attachment; filename="${artifactFilename(artifact)}"`)
      .set("X-Content-Type-Options", "nosniff")
      .send(document);
  });

  return router;
}
