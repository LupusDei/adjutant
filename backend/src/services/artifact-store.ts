/**
 * adj-j7az6.1.2 — Global/personal Artifacts store.
 *
 * Backs the Adjutant Artifacts library: self-contained standalone HTML pages that are
 * decoupled from proposals and beads. There is NO project scoping — one fleet-wide
 * library owned by the Commander.
 *
 * Reuses the adj-200 proposal sharing primitives:
 *   - {@link generateShareToken} for the unguessable base62 public handle (>=16 chars).
 *   - The publish/unpublish contract: publish is idempotent (re-publish reuses the
 *     existing token so already-shared links keep working); unpublish retains the token
 *     so a later re-publish revives the same link.
 *
 * The factory shape mirrors {@link createProposalStore}.
 */

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

import type { Artifact, ArtifactRow } from "../types/artifacts.js";
import { generateShareToken } from "./proposal-store.js";

/** Detect a SQLite UNIQUE-constraint violation (used for token collision retry). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}

function rowToArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug ?? undefined,
    description: row.description ?? undefined,
    html: row.html,
    isPublic: (row.is_public ?? 0) === 1,
    shareToken: row.share_token ?? undefined,
    publishedAt: row.published_at ?? undefined,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateArtifactInput {
  title: string;
  html: string;
  description?: string | undefined;
  slug?: string | undefined;
  createdBy?: string | undefined;
}

export interface UpdateArtifactInput {
  title?: string | undefined;
  html?: string | undefined;
  description?: string | undefined;
  slug?: string | undefined;
}

export interface ArtifactStore {
  createArtifact(input: CreateArtifactInput): Artifact;
  getArtifact(id: string): Artifact | null;
  /** All artifacts, newest-first. */
  listArtifacts(): Artifact[];
  /** Update provided fields only; returns null if id not found. */
  updateArtifact(id: string, input: UpdateArtifactInput): Artifact | null;
  /** Delete an artifact; returns true if a row was removed. */
  deleteArtifact(id: string): boolean;
  /**
   * Publish: generate a collision-safe share token if absent (reusing the existing
   * token on re-publish so already-shared links keep working), set is_public=1 and
   * published_at. Returns null if id not found.
   */
  publishArtifact(id: string): Artifact | null;
  /** Unpublish: set is_public=0 but KEEP the token so a re-publish revives the same link. */
  unpublishArtifact(id: string): Artifact | null;
  /** Resolve an artifact by its public share token — ONLY when published; else null. */
  getArtifactByToken(token: string): Artifact | null;
}

/** Options for {@link createArtifactStore}. */
export interface CreateArtifactStoreOptions {
  /** Override the share-token generator (used by tests to force collisions). */
  generateToken?: () => string;
}

export function createArtifactStore(
  db: Database.Database,
  options: CreateArtifactStoreOptions = {},
): ArtifactStore {
  const genToken = options.generateToken ?? generateShareToken;

  const insertStmt = db.prepare(`
    INSERT INTO artifacts (id, title, slug, description, html, is_public, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, datetime('now'), datetime('now'))
  `);
  const getByIdStmt = db.prepare("SELECT * FROM artifacts WHERE id = ?");
  const listStmt = db.prepare("SELECT * FROM artifacts ORDER BY created_at DESC, rowid DESC");
  const deleteStmt = db.prepare("DELETE FROM artifacts WHERE id = ?");
  const publishWithTokenStmt = db.prepare(`
    UPDATE artifacts SET share_token = ?, is_public = 1, published_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
  `);
  const republishStmt = db.prepare(`
    UPDATE artifacts SET is_public = 1, published_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
  `);
  const unpublishStmt = db.prepare(`
    UPDATE artifacts SET is_public = 0, updated_at = datetime('now') WHERE id = ?
  `);
  const getByTokenStmt = db.prepare(
    "SELECT * FROM artifacts WHERE share_token = ? AND is_public = 1",
  );

  return {
    createArtifact(input: CreateArtifactInput): Artifact {
      const id = randomUUID();
      insertStmt.run(
        id,
        input.title,
        input.slug ?? null,
        input.description ?? null,
        input.html,
        input.createdBy ?? null,
      );
      return rowToArtifact(getByIdStmt.get(id) as ArtifactRow);
    },

    getArtifact(id: string): Artifact | null {
      const row = getByIdStmt.get(id) as ArtifactRow | undefined;
      return row !== undefined ? rowToArtifact(row) : null;
    },

    listArtifacts(): Artifact[] {
      const rows = listStmt.all() as ArtifactRow[];
      return rows.map(rowToArtifact);
    },

    updateArtifact(id: string, input: UpdateArtifactInput): Artifact | null {
      const row = getByIdStmt.get(id) as ArtifactRow | undefined;
      if (row === undefined) return null;

      const sets: string[] = [];
      const params: unknown[] = [];
      if (input.title !== undefined) {
        sets.push("title = ?");
        params.push(input.title);
      }
      if (input.html !== undefined) {
        sets.push("html = ?");
        params.push(input.html);
      }
      if (input.description !== undefined) {
        sets.push("description = ?");
        params.push(input.description);
      }
      if (input.slug !== undefined) {
        sets.push("slug = ?");
        params.push(input.slug);
      }

      // Always bump updated_at, even when only touching one column.
      sets.push("updated_at = datetime('now')");
      params.push(id);
      db.prepare(`UPDATE artifacts SET ${sets.join(", ")} WHERE id = ?`).run(...params);

      return rowToArtifact(getByIdStmt.get(id) as ArtifactRow);
    },

    deleteArtifact(id: string): boolean {
      return deleteStmt.run(id).changes > 0;
    },

    publishArtifact(id: string): Artifact | null {
      const row = getByIdStmt.get(id) as ArtifactRow | undefined;
      if (row === undefined) return null;

      if (row.share_token) {
        // Re-publish: reuse the existing token so already-shared links keep working.
        republishStmt.run(id);
      } else {
        // First publish: generate a collision-safe token, retrying on the (vanishingly
        // rare) UNIQUE-index collision.
        const MAX_ATTEMPTS = 5;
        let published = false;
        for (let attempt = 0; attempt < MAX_ATTEMPTS && !published; attempt++) {
          const candidate = genToken();
          try {
            publishWithTokenStmt.run(candidate, id);
            published = true;
          } catch (err) {
            if (isUniqueViolation(err)) continue; // collision — regenerate
            throw err;
          }
        }
        if (!published) {
          throw new Error(`Failed to generate a unique share token for artifact ${id}`);
        }
      }

      return rowToArtifact(getByIdStmt.get(id) as ArtifactRow);
    },

    unpublishArtifact(id: string): Artifact | null {
      const result = unpublishStmt.run(id);
      if (result.changes === 0) return null;
      return rowToArtifact(getByIdStmt.get(id) as ArtifactRow);
    },

    getArtifactByToken(token: string): Artifact | null {
      if (!token) return null;
      const row = getByTokenStmt.get(token) as ArtifactRow | undefined;
      return row !== undefined ? rowToArtifact(row) : null;
    },
  };
}
