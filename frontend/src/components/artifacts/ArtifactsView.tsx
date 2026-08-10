/**
 * ArtifactsView (adj-j7az6.3.2) — the ARTIFACTS tab.
 *
 * Lists the global/personal artifact library and orchestrates the per-artifact
 * actions: view (sandboxed ArtifactViewer), download the standalone `.html`,
 * publish/unpublish, copy the public share link, delete, and create a new
 * artifact (CreateArtifactForm). Artifacts are NOT project-scoped — this is one
 * fleet-wide library, so there is no project filter here.
 */

import { type CSSProperties, useCallback, useEffect, useState } from "react";

import type { Artifact } from "../../types";
import { api, buildPublicArtifactUrl } from "../../services/api";
import { ArtifactCard } from "./ArtifactCard";
import { ArtifactViewer } from "./ArtifactViewer";
import { CreateArtifactForm } from "./CreateArtifactForm";
import { saveArtifactToDisk } from "./artifact-download";

export interface ArtifactsViewProps {
  isActive?: boolean;
}

export function ArtifactsView(_props: ArtifactsViewProps) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Artifact | null>(null);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.artifacts.list();
      setArtifacts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load artifacts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleDownload = useCallback(async (artifact: Artifact) => {
    setActionError(null);
    try {
      await saveArtifactToDisk(artifact.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Download failed.");
    }
  }, []);

  const handleDelete = useCallback(async (artifact: Artifact) => {
    setActionError(null);
    try {
      await api.artifacts.delete(artifact.id);
      setArtifacts((prev) => prev.filter((a) => a.id !== artifact.id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed.");
    }
  }, []);

  const handleTogglePublish = useCallback(async (artifact: Artifact) => {
    setActionError(null);
    try {
      const updated = artifact.isPublic
        ? (await api.artifacts.unpublish(artifact.id)).artifact
        : (await api.artifacts.publish(artifact.id)).artifact;
      setArtifacts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Publish toggle failed.");
    }
  }, []);

  const handleShare = useCallback(async (artifact: Artifact) => {
    if (!artifact.shareToken) return;
    setActionError(null);
    const url = buildPublicArtifactUrl(artifact.shareToken);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(artifact.id);
      window.setTimeout(() => {
        setCopiedId((cur) => (cur === artifact.id ? null : cur));
      }, 1800);
    } catch {
      // Clipboard blocked (permissions / insecure context) — surface the URL so
      // the Commander can copy it manually rather than failing silently.
      setActionError(`Copy failed. Public link: ${url}`);
    }
  }, []);

  const handleCreated = useCallback((artifact: Artifact) => {
    setArtifacts((prev) => [artifact, ...prev]);
    setCreating(false);
  }, []);

  return (
    <div style={styles.container}>
      <div style={styles.toolbar}>
        <span style={styles.heading}>ARTIFACTS</span>
        <span style={styles.subheading}>STANDALONE HTML PAGES · PUBLISH · SHARE · DOWNLOAD</span>
        <button
          style={styles.newBtn}
          onClick={() => { setCreating(true); }}
        >
          + NEW ARTIFACT
        </button>
        <button style={styles.refreshBtn} onClick={() => { void refresh(); }}>
          REFRESH
        </button>
      </div>

      {actionError && <div style={styles.error}>{actionError}</div>}
      {error && <div style={styles.error}>ERROR: {error}</div>}

      {loading && artifacts.length === 0 && (
        <div style={styles.empty}>LOADING…</div>
      )}

      {!loading && !error && artifacts.length === 0 && (
        <div style={styles.empty}>
          NO ARTIFACTS YET. CREATE ONE FROM HTML, OR HAVE AN AGENT PUBLISH ONE.
        </div>
      )}

      <div style={styles.list}>
        {artifacts.map((a) => (
          <ArtifactCard
            key={a.id}
            artifact={a}
            onView={setViewing}
            onDownload={(art) => { void handleDownload(art); }}
            onShare={(art) => { void handleShare(art); }}
            onTogglePublish={(art) => { void handleTogglePublish(art); }}
            onDelete={(art) => { void handleDelete(art); }}
            justCopied={copiedId === a.id}
          />
        ))}
      </div>

      <div style={styles.footer}>
        {artifacts.length} ARTIFACT{artifacts.length !== 1 ? "S" : ""}
      </div>

      {viewing && (
        <ArtifactViewer artifact={viewing} onClose={() => { setViewing(null); }} />
      )}

      {creating && (
        <CreateArtifactForm
          onCreated={handleCreated}
          onClose={() => { setCreating(false); }}
        />
      )}
    </div>
  );
}

const styles = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    fontFamily: "var(--font-mono, monospace)",
  },
  toolbar: {
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
    alignItems: "center",
    padding: "8px 0",
    borderBottom: "1px solid var(--pipboy-green-dim, #00aa00)",
    marginBottom: "8px",
  },
  heading: {
    color: "var(--pipboy-green, #00ff00)",
    fontSize: "14px",
    fontWeight: "bold",
    letterSpacing: "0.1em",
  },
  subheading: {
    color: "var(--pipboy-green-dim, #00aa00)",
    fontSize: "10px",
    letterSpacing: "0.1em",
  },
  newBtn: {
    background: "transparent",
    border: "1px solid var(--pipboy-green, #00ff00)",
    color: "var(--pipboy-green, #00ff00)",
    padding: "4px 12px",
    fontSize: "11px",
    fontFamily: "var(--font-mono, monospace)",
    fontWeight: "bold",
    cursor: "pointer",
    marginLeft: "auto",
    boxShadow: "0 0 4px var(--pipboy-green-glow, #00ff0066)",
  },
  refreshBtn: {
    background: "transparent",
    border: "1px solid var(--pipboy-green-dim, #00aa00)",
    color: "var(--pipboy-green-dim, #00aa00)",
    padding: "4px 10px",
    fontSize: "11px",
    fontFamily: "var(--font-mono, monospace)",
    cursor: "pointer",
  },
  error: {
    color: "#ff4444",
    fontSize: "12px",
    padding: "8px",
    border: "1px solid #ff4444",
    marginBottom: "8px",
  },
  empty: {
    color: "var(--pipboy-green-dim, #00aa00)",
    fontSize: "13px",
    textAlign: "center" as const,
    padding: "40px 20px",
  },
  list: {
    flex: 1,
    overflowY: "auto" as const,
  },
  footer: {
    borderTop: "1px solid var(--pipboy-green-dim, #00aa00)",
    padding: "6px 0",
    fontSize: "11px",
    color: "var(--pipboy-green-dim, #00aa00)",
    textAlign: "right" as const,
  },
} satisfies Record<string, CSSProperties>;
