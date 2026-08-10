import { z } from "zod";

// =============================================================================
// Zod Schemas — API boundary validation (adj-j7az6)
// =============================================================================

export const CreateArtifactSchema = z.object({
  title: z.string().min(1, "Title is required"),
  html: z.string().min(1, "HTML is required"),
  description: z.string().optional(),
  slug: z.string().optional(),
});

export const UpdateArtifactSchema = z
  .object({
    title: z.string().min(1).optional(),
    html: z.string().min(1).optional(),
    description: z.string().optional(),
    slug: z.string().optional(),
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
