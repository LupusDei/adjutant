/**
 * ArtifactViewer (adj-j7az6.3.3) — a full-surface reader for a single Artifact.
 *
 * It fetches the COMPOSED, server-sanitized, self-contained document (via the
 * authenticated download endpoint) and renders it inside a SANDBOXED iframe. The
 * html is authored by agents/the Commander and only server-sanitized, so the
 * `sandbox` NEVER includes `allow-scripts` (and never pairs `allow-scripts` with
 * `allow-same-origin`, which would let a frame drop its own sandbox). The single
 * download fetch doubles as the preview source AND the exact bytes the DOWNLOAD
 * button saves to disk — the critical requirement of the epic.
 *
 * Mirrors the ProposalPageViewer sandbox pattern; framed as a printout under
 * glass inside the green-phosphor chrome.
 */

import { type CSSProperties, useCallback, useEffect, useState } from "react";

import type { Artifact } from "../../types";
import { api } from "../../services/api";
import { triggerBlobDownload } from "./artifact-download";

export interface ArtifactViewerProps {
  artifact: Artifact;
  onClose: () => void;
}

/**
 * Sandbox tokens for the embedded document.
 *
 * `allow-scripts` is GRANTED (adj-artifact-js): artifacts are interactive pages — charts,
 * toggles, simulations — and a static-only viewer made them impossible.
 *
 * `allow-same-origin` is still withheld, which is the important half. Without it the document
 * runs in an OPAQUE origin: no access to this app's DOM, cookies, localStorage, or its
 * same-origin API surface. Granting both together is the combination that defeats the sandbox
 * entirely, so they are never both present.
 *
 * `allow-popups-to-escape-sandbox` is also withheld now. It let a popup break OUT of the sandbox
 * and run with the opener's privileges — harmless while nothing could script, a privilege
 * escalation the moment scripts are allowed.
 *
 * Defence in depth beyond the sandbox: the composed document carries `connect-src 'none'`, so
 * even in its opaque origin a script cannot fetch, XHR, or WebSocket anywhere. That matters
 * because the backend serves wildcard CORS in open mode — an opaque origin alone would NOT stop
 * a script from reading the fleet API.
 */
const SANDBOX = "allow-scripts allow-popups";

export function ArtifactViewer({ artifact, onClose }: ArtifactViewerProps) {
  const [doc, setDoc] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [filename, setFilename] = useState<string>(`artifact-${artifact.id}.html`);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const result = await api.artifacts.download(artifact.id);
        const text = await result.blob.text();
        if (cancelled) return;
        setBlob(result.blob);
        setFilename(result.filename);
        setDoc(text);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load artifact");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [artifact.id]);

  const handleDownload = useCallback(() => {
    if (blob) {
      // We already hold the exact composed bytes — save them directly.
      triggerBlobDownload(blob, filename);
    }
  }, [blob, filename]);

  const label = `Artifact render — ${artifact.title}`;

  return (
    <div style={styles.overlay} role="dialog" aria-modal="true" aria-label={label}>
      <div style={styles.panel}>
        <div style={styles.header}>
          <span style={styles.headerTitle}>{artifact.title.toUpperCase()}</span>
          <div style={styles.headerActions}>
            <button
              style={{ ...styles.btn, ...styles.downloadBtn }}
              onClick={handleDownload}
              disabled={!blob}
              title="Save this page as an .html file"
            >
              ⭳ DOWNLOAD
            </button>
            <button style={styles.btn} onClick={onClose} aria-label="Close">
              ✕ CLOSE
            </button>
          </div>
        </div>

        <div style={styles.body}>
          {loading && <div style={styles.status}>LOADING ARTIFACT…</div>}

          {error && !loading && (
            <div style={styles.error}>
              FAILED TO LOAD ARTIFACT: {error}
            </div>
          )}

          {doc !== null && !error && (
            <div style={styles.frameInset}>
              <iframe
                title={label}
                srcDoc={doc}
                sandbox={SANDBOX}
                style={styles.iframe}
                referrerPolicy="no-referrer"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
    background: "rgba(0, 0, 0, 0.8)",
  },
  panel: {
    display: "flex",
    flexDirection: "column",
    width: "min(1100px, 100%)",
    height: "min(90vh, 100%)",
    border: "1px solid var(--pipboy-green, #00ff00)",
    background: "var(--pipboy-bg-panel, #111111)",
    fontFamily: "var(--font-mono, monospace)",
    boxShadow: "0 0 24px var(--pipboy-green-glow, #00ff0066)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    padding: "8px 12px",
    borderBottom: "1px solid var(--pipboy-green-dim, #00aa00)",
  },
  headerTitle: {
    color: "var(--pipboy-green, #00ff00)",
    fontSize: "13px",
    fontWeight: "bold",
    letterSpacing: "0.5px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  headerActions: {
    display: "flex",
    gap: "8px",
    flexShrink: 0,
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
  body: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  },
  status: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--pipboy-green-dim, #00aa00)",
    fontSize: "13px",
    letterSpacing: "0.15em",
  },
  error: {
    margin: "12px",
    padding: "12px",
    color: "#ff4444",
    border: "1px solid #ff4444",
    fontSize: "12px",
  },
  frameInset: {
    flex: 1,
    minHeight: 0,
    padding: "10px",
    background: "#1a1a1a",
  },
  iframe: {
    width: "100%",
    height: "100%",
    border: "none",
    background: "#ffffff",
    boxShadow: "0 0 12px rgba(0, 255, 0, 0.08)",
    display: "block",
  },
} satisfies Record<string, CSSProperties>;
