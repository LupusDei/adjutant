/**
 * CreateArtifactForm (adj-j7az6.3.4) — author a new artifact from authored HTML.
 *
 * Two ways in: paste HTML into the textarea, or upload a `.html` file (its text
 * fills the textarea, so the Commander can still review/edit before creating).
 * A title is required and empty HTML is blocked BEFORE any network call. On
 * success the created artifact is handed back via `onCreated`; on failure the
 * draft is preserved so nothing is lost on retry.
 */

import { type CSSProperties, useCallback, useState } from "react";

import type { Artifact } from "../../types";
import { api } from "../../services/api";

export interface CreateArtifactFormProps {
  onCreated: (artifact: Artifact) => void;
  onClose: () => void;
}

export function CreateArtifactForm({ onCreated, onClose }: CreateArtifactFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [html, setHtml] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      setHtml(text);
      setFileName(file.name);
      setError(null);
    } catch {
      setError("Could not read that file. Paste the HTML instead.");
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Title is required.");
      return;
    }
    if (!html.trim()) {
      setError("HTML is required — paste or upload a page.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const artifact = await api.artifacts.create({
        title: trimmedTitle,
        html,
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      onCreated(artifact);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create artifact.");
    } finally {
      setSubmitting(false);
    }
  }, [title, description, html, onCreated]);

  return (
    <div style={styles.overlay} role="dialog" aria-modal="true" aria-label="Create artifact">
      <div style={styles.panel}>
        <div style={styles.header}>
          <span style={styles.headerTitle}>NEW ARTIFACT</span>
          <button style={styles.iconBtn} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div style={styles.body}>
          <label style={styles.label} htmlFor="artifact-title">
            TITLE
          </label>
          <input
            id="artifact-title"
            style={styles.input}
            value={title}
            onChange={(e) => { setTitle(e.target.value); }}
            placeholder="My standalone page"
            autoComplete="off"
          />

          <label style={styles.label} htmlFor="artifact-description">
            DESCRIPTION (OPTIONAL)
          </label>
          <input
            id="artifact-description"
            style={styles.input}
            value={description}
            onChange={(e) => { setDescription(e.target.value); }}
            placeholder="One-line summary"
            autoComplete="off"
          />

          <div style={styles.htmlHeader}>
            <label style={styles.label} htmlFor="artifact-html">
              HTML
            </label>
            <label style={styles.uploadBtn} htmlFor="artifact-file">
              ⭱ UPLOAD FILE
              <input
                id="artifact-file"
                type="file"
                accept=".html,text/html"
                aria-label="Upload file"
                style={styles.hiddenFile}
                onChange={(e) => { void handleFile(e.target.files?.[0]); }}
              />
            </label>
          </div>
          {fileName && <div style={styles.fileHint}>LOADED: {fileName}</div>}
          <textarea
            id="artifact-html"
            style={styles.textarea}
            value={html}
            onChange={(e) => { setHtml(e.target.value); }}
            placeholder="<!doctype html> … self-contained HTML (inline CSS/SVG, no scripts)"
            spellCheck={false}
          />

          {error && <div style={styles.error}>{error}</div>}
        </div>

        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={onClose}>
            CANCEL
          </button>
          <button
            style={styles.createBtn}
            onClick={() => { void handleSubmit(); }}
            disabled={submitting}
          >
            {submitting ? "CREATING…" : "CREATE"}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 1001,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
    background: "rgba(0, 0, 0, 0.8)",
  },
  panel: {
    display: "flex",
    flexDirection: "column",
    width: "min(760px, 100%)",
    maxHeight: "90vh",
    border: "1px solid var(--pipboy-green, #00ff00)",
    background: "var(--pipboy-bg-panel, #111111)",
    fontFamily: "var(--font-mono, monospace)",
    boxShadow: "0 0 24px var(--pipboy-green-glow, #00ff0066)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 12px",
    borderBottom: "1px solid var(--pipboy-green-dim, #00aa00)",
  },
  headerTitle: {
    color: "var(--pipboy-green, #00ff00)",
    fontSize: "13px",
    fontWeight: "bold",
    letterSpacing: "0.5px",
  },
  iconBtn: {
    background: "transparent",
    border: "none",
    color: "var(--pipboy-green-dim, #00aa00)",
    fontSize: "14px",
    cursor: "pointer",
  },
  body: {
    padding: "12px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  label: {
    color: "var(--pipboy-green-dim, #00aa00)",
    fontSize: "11px",
    fontWeight: "bold",
    letterSpacing: "0.5px",
    marginTop: "6px",
  },
  input: {
    background: "var(--pipboy-bg, #0a0a0a)",
    border: "1px solid var(--pipboy-green-dim, #00aa00)",
    color: "var(--pipboy-green, #00ff00)",
    padding: "6px 8px",
    fontSize: "13px",
    fontFamily: "var(--font-mono, monospace)",
    outline: "none",
  },
  htmlHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: "6px",
  },
  uploadBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    border: "1px solid var(--pipboy-green-dim, #00aa00)",
    color: "var(--pipboy-green-dim, #00aa00)",
    padding: "3px 8px",
    fontSize: "10px",
    cursor: "pointer",
    letterSpacing: "0.5px",
  },
  hiddenFile: {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: 0,
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    border: 0,
  },
  fileHint: {
    color: "var(--pipboy-green, #00ff00)",
    fontSize: "10px",
    letterSpacing: "0.5px",
  },
  textarea: {
    background: "var(--pipboy-bg, #0a0a0a)",
    border: "1px solid var(--pipboy-green-dim, #00aa00)",
    color: "var(--pipboy-green, #00ff00)",
    padding: "8px",
    fontSize: "12px",
    fontFamily: "var(--font-mono, monospace)",
    minHeight: "220px",
    resize: "vertical",
    outline: "none",
    whiteSpace: "pre",
    overflowWrap: "normal",
    overflowX: "auto",
  },
  error: {
    color: "#ff4444",
    fontSize: "12px",
    border: "1px solid #ff4444",
    padding: "6px 8px",
    marginTop: "6px",
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
    padding: "10px 12px",
    borderTop: "1px solid var(--pipboy-green-dim, #00aa00)",
  },
  cancelBtn: {
    background: "transparent",
    border: "1px solid #666",
    color: "#999",
    padding: "5px 14px",
    fontSize: "11px",
    fontFamily: "var(--font-mono, monospace)",
    cursor: "pointer",
  },
  createBtn: {
    background: "transparent",
    border: "1px solid var(--pipboy-green, #00ff00)",
    color: "var(--pipboy-green, #00ff00)",
    padding: "5px 16px",
    fontSize: "11px",
    fontFamily: "var(--font-mono, monospace)",
    fontWeight: "bold",
    cursor: "pointer",
    boxShadow: "0 0 4px var(--pipboy-green-glow, #00ff0066)",
  },
} satisfies Record<string, CSSProperties>;
