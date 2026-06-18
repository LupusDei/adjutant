/**
 * ProposalPageViewer (adj-200) — renders an agent-authored, server-sanitized
 * self-contained HTML proposal document inside a SANDBOXED iframe.
 *
 * Security: the html is agent-authored and only server-sanitized, so the iframe
 * runs with a locked-down `sandbox` that NEVER includes `allow-scripts`. We do
 * not pair `allow-scripts` with `allow-same-origin` (that combination lets a
 * frame remove its own sandbox). The document is self-contained (inline CSS/SVG,
 * data-URI images) so it needs no script or network access to render.
 *
 * The composed document is server-styled with a clean "document" aesthetic; the
 * viewer frames it like a printout under glass inside the green-phosphor chrome,
 * rather than restyling it to the CRT theme.
 */

import { type CSSProperties } from 'react';

export interface ProposalPageViewerProps {
  /** Self-contained, server-sanitized HTML document. Absent on legacy proposals. */
  html?: string | undefined;
  /** Proposal title — used for the iframe accessible name and the status strip. */
  title?: string | undefined;
}

/**
 * Sandbox tokens for the embedded document. Deliberately omits `allow-scripts`
 * and `allow-same-origin` — the document is static and self-contained, so it
 * needs neither, and withholding both removes every sandbox-escape vector.
 */
const SANDBOX = 'allow-popups allow-popups-to-escape-sandbox';

export function ProposalPageViewer({ html, title }: ProposalPageViewerProps) {
  const hasContent = typeof html === 'string' && html.trim().length > 0;
  const label = title ? `Page render — ${title}` : 'Page render';

  if (!hasContent) {
    return (
      <div style={styles.container}>
        <div style={styles.statusStrip}>
          <span style={styles.statusTick}>▌</span>
          PAGE RENDER · NO CONTENT
        </div>
        <div style={styles.emptyState}>
          <div style={styles.emptyGlyph}>▔▔▔▔▔</div>
          <div style={styles.emptyTitle}>NO PAGE FOR THIS PROPOSAL</div>
          <div style={styles.emptyHint}>
            This proposal has no HTML page yet. Read the summary in the detail
            view, or ask the author to add a rich page.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.statusStrip}>
        <span style={styles.statusTick}>▌</span>
        PAGE RENDER · SANDBOXED
      </div>
      <div style={styles.frameInset}>
        <iframe
          title={label}
          srcDoc={html}
          sandbox={SANDBOX}
          style={styles.iframe}
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
    minHeight: 0,
    border: '1px solid var(--crt-phosphor-dim, #00aa00)',
    backgroundColor: 'var(--theme-bg-screen, #0a0a0a)',
    fontFamily: '"Share Tech Mono", monospace',
  } satisfies CSSProperties,
  statusStrip: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '5px 10px',
    fontSize: '0.65rem',
    letterSpacing: '0.18em',
    color: 'var(--crt-phosphor-dim, #00aa00)',
    borderBottom: '1px solid var(--crt-phosphor-dim, #00aa00)',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    textTransform: 'uppercase',
    flexShrink: 0,
  } satisfies CSSProperties,
  statusTick: {
    color: 'var(--crt-phosphor, #00ff00)',
    textShadow: '0 0 6px var(--pipboy-green-glow, #00ff0066)',
  } satisfies CSSProperties,
  // The light "printout under glass" inset — a quiet white surround so the
  // server-styled document reads as a contained artifact, not CRT chrome.
  frameInset: {
    flex: 1,
    minHeight: 0,
    padding: '10px',
    backgroundColor: '#1a1a1a',
  } satisfies CSSProperties,
  iframe: {
    width: '100%',
    height: '100%',
    border: 'none',
    backgroundColor: '#ffffff',
    boxShadow: '0 0 12px rgba(0, 255, 0, 0.08)',
    display: 'block',
  } satisfies CSSProperties,
  emptyState: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    padding: '32px',
    textAlign: 'center',
  } satisfies CSSProperties,
  emptyGlyph: {
    fontSize: '1.2rem',
    color: 'var(--crt-phosphor-dim, #00aa00)',
    letterSpacing: '0.2em',
    opacity: 0.6,
  } satisfies CSSProperties,
  emptyTitle: {
    fontSize: '0.85rem',
    letterSpacing: '0.15em',
    color: 'var(--crt-phosphor, #00ff00)',
  } satisfies CSSProperties,
  emptyHint: {
    fontSize: '0.75rem',
    lineHeight: 1.6,
    color: 'var(--crt-phosphor-dim, #00aa00)',
    maxWidth: '46ch',
  } satisfies CSSProperties,
} satisfies Record<string, CSSProperties>;
