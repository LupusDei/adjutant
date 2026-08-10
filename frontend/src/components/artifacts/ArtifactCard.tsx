/**
 * ArtifactCard (adj-j7az6.3.2) — one row in the Artifacts library.
 *
 * Presentational: shows the title, created date, author, and publish state, and
 * surfaces the per-artifact actions (view, download, publish/unpublish, share,
 * delete). All behaviour is delegated to the parent ArtifactsView via callbacks.
 * Download is intentionally prominent — saving the standalone `.html` is the
 * headline capability of the feature.
 */

import type { CSSProperties } from "react";

import type { Artifact } from "../../types";

export interface ArtifactCardProps {
  artifact: Artifact;
  onView: (artifact: Artifact) => void;
  onDownload: (artifact: Artifact) => void;
  onShare: (artifact: Artifact) => void;
  onTogglePublish: (artifact: Artifact) => void;
  onDelete: (artifact: Artifact) => void;
  /** Transient "COPIED" affordance after a successful share-link copy. */
  justCopied?: boolean;
}

export function ArtifactCard({
  artifact,
  onView,
  onDownload,
  onShare,
  onTogglePublish,
  onDelete,
  justCopied,
}: ArtifactCardProps) {
  const published = artifact.isPublic;

  return (
    <div style={styles.card} data-artifact-card data-artifact-id={artifact.id}>
      <div style={styles.header}>
        <span style={styles.title}>{artifact.title}</span>
        <span
          style={{
            ...styles.badge,
            ...(published ? styles.badgePublished : styles.badgePrivate),
          }}
        >
          {published ? "PUBLISHED" : "PRIVATE"}
        </span>
      </div>

      <div style={styles.meta}>
        {artifact.createdBy && (
          <span style={styles.author}>BY {artifact.createdBy.toUpperCase()}</span>
        )}
        <span style={styles.date}>
          {new Date(artifact.createdAt).toLocaleDateString()}
        </span>
      </div>

      <div style={styles.actions}>
        <button style={styles.btn} onClick={() => { onView(artifact); }}>
          VIEW
        </button>
        <button
          style={{ ...styles.btn, ...styles.downloadBtn }}
          onClick={() => { onDownload(artifact); }}
          title="Save this page as an .html file"
        >
          ⭳ DOWNLOAD
        </button>
        <button style={styles.btn} onClick={() => { onTogglePublish(artifact); }}>
          {published ? "UNPUBLISH" : "PUBLISH"}
        </button>
        {published && (
          <button style={styles.btn} onClick={() => { onShare(artifact); }}>
            {justCopied ? "COPIED ✓" : "SHARE"}
          </button>
        )}
        <button
          style={{ ...styles.btn, ...styles.deleteBtn }}
          onClick={() => { onDelete(artifact); }}
        >
          DELETE
        </button>
      </div>
    </div>
  );
}

const styles = {
  card: {
    border: "1px solid var(--pipboy-green-dim, #00aa00)",
    padding: "12px 16px",
    marginBottom: "8px",
    background: "var(--pipboy-bg-panel, #111111)",
    fontFamily: "var(--font-mono, monospace)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "8px",
    marginBottom: "6px",
  },
  title: {
    color: "var(--pipboy-green, #00ff00)",
    fontSize: "14px",
    fontWeight: "bold",
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  badge: {
    fontSize: "10px",
    padding: "2px 6px",
    fontWeight: "bold",
    letterSpacing: "0.5px",
    flexShrink: 0,
  },
  badgePublished: {
    color: "var(--pipboy-green, #00ff00)",
    border: "1px solid var(--pipboy-green, #00ff00)",
  },
  badgePrivate: {
    color: "#888",
    border: "1px solid #888",
  },
  meta: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
    marginBottom: "10px",
    fontSize: "11px",
    color: "var(--pipboy-green-dim, #00aa00)",
  },
  author: {
    letterSpacing: "0.5px",
  },
  date: {},
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
  },
  btn: {
    background: "transparent",
    border: "1px solid var(--pipboy-green-dim, #00aa00)",
    color: "var(--pipboy-green-dim, #00aa00)",
    padding: "4px 12px",
    fontSize: "11px",
    fontFamily: "var(--font-mono, monospace)",
    cursor: "pointer",
    textTransform: "uppercase" as const,
  },
  downloadBtn: {
    border: "1px solid var(--pipboy-green, #00ff00)",
    color: "var(--pipboy-green, #00ff00)",
    fontWeight: "bold",
    boxShadow: "0 0 4px var(--pipboy-green-glow, #00ff0066)",
  },
  deleteBtn: {
    border: "1px solid #666",
    color: "#888",
    marginLeft: "auto",
  },
} satisfies Record<string, CSSProperties>;
