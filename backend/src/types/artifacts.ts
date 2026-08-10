import { z } from "zod";

// =============================================================================
// Size caps — shared by the REST schemas (below) AND the MCP create_artifact /
// publish tools (adj-j7az6.5.7). The /a/:token public route sanitizes each html
// body per request on an UNAUTHENTICATED surface, so an unbounded blob is a
// compute-amplification DoS. Caps are enforced at the Zod boundary before the
// document reaches the store or the compose pipeline. Exported from ONE place so
// REST and MCP share the exact same numbers (no duplication).
// =============================================================================

/**
 * Maximum size (in characters / UTF-16 code units) of a self-contained `html` body.
 * 256 KiB — mirrors the adj-200 proposal cap.
 */
export const MAX_HTML_CHARS = 256 * 1024;
/** Maximum artifact title length. */
export const MAX_TITLE_CHARS = 300;
/** Maximum artifact description (summary) length. */
export const MAX_DESCRIPTION_CHARS = 2000;
/** Maximum artifact slug length (the download-filename source; sliced further at compose). */
export const MAX_SLUG_CHARS = 200;

// =============================================================================
// Zod Schemas — API boundary validation (adj-j7az6)
// =============================================================================

export const CreateArtifactSchema = z.object({
  title: z.string().min(1, "Title is required").max(MAX_TITLE_CHARS),
  html: z.string().min(1, "HTML is required").max(MAX_HTML_CHARS),
  description: z.string().max(MAX_DESCRIPTION_CHARS).optional(),
  slug: z.string().max(MAX_SLUG_CHARS).optional(),
});

export const UpdateArtifactSchema = z
  .object({
    title: z.string().min(1).max(MAX_TITLE_CHARS).optional(),
    html: z.string().min(1).max(MAX_HTML_CHARS).optional(),
    description: z.string().max(MAX_DESCRIPTION_CHARS).optional(),
    slug: z.string().max(MAX_SLUG_CHARS).optional(),
  })
  .refine(
    (data) =>
      data.title !== undefined ||
      data.html !== undefined ||
      data.description !== undefined ||
      data.slug !== undefined,
    { message: "At least one of title, html, description, or slug must be provided" },
  );

// =============================================================================
// TypeScript Types
// =============================================================================

/**
 * A global/personal Artifact — a self-contained, standalone HTML page decoupled
 * from proposals and beads (adj-j7az6). One fleet-wide library owned by the
 * Commander; there is NO project scoping.
 */
export interface Artifact {
  id: string;
  title: string;
  /** Optional URL/download-friendly slug (drives the download filename). */
  slug?: string | undefined;
  /** Optional summary. */
  description?: string | undefined;
  /** Required self-contained HTML body (authored source; sanitized at compose time). */
  html: string;
  /** Whether this artifact is published (reachable via the public GET /a/:token route). */
  isPublic: boolean;
  /** Unguessable base62 handle for the public route; undefined until first publish. */
  shareToken?: string | undefined;
  /** ISO timestamp of publish; undefined while private. */
  publishedAt?: string | undefined;
  /** Agent id or user who authored the artifact; undefined if unknown. */
  createdBy?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

/** Raw row shape from SQLite before camelCase mapping. */
export interface ArtifactRow {
  id: string;
  title: string;
  slug: string | null;
  description: string | null;
  html: string;
  is_public: number;
  share_token: string | null;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
