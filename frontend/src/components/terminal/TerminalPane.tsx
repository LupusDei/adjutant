/**
 * Terminal pane component for displaying polecat tmux sessions.
 * Uses xterm.js to render ANSI-colored terminal output.
 */
import { useEffect, useRef, useCallback, useState, type CSSProperties } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';
import { api, ApiError } from '../../services/api';

export interface TerminalPaneProps {
  /** Rig name (e.g., "gastown_boy") */
  rig: string;
  /** Polecat name (e.g., "jasper") */
  polecat: string;
  /** Polling interval in milliseconds. Default: 2000 */
  pollInterval?: number;
  /** Whether polling is enabled. Default: true */
  enabled?: boolean;
  /** Optional CSS class name */
  className?: string;
  /** Optional inline styles */
  style?: CSSProperties;
  /** Callback when terminal is closed */
  onClose?: () => void;
}

/**
 * Renders a polecat's tmux session in an xterm.js terminal.
 * Polls the backend for terminal content updates.
 */
export function TerminalPane({
  rig,
  polecat,
  pollInterval = 2000,
  enabled = true,
  className = '',
  style,
  onClose,
}: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastContent, setLastContent] = useState<string>('');

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      theme: {
        background: '#0a0a0a',
        foreground: '#00ff00',
        cursor: '#00ff00',
        cursorAccent: '#0a0a0a',
        selectionBackground: '#00ff0033',
        black: '#0a0a0a',
        green: '#00ff00',
        brightGreen: '#00ff66',
        yellow: '#ffb000',
        red: '#ff4444',
        cyan: '#00ffff',
        white: '#cccccc',
        brightWhite: '#ffffff',
      },
      fontFamily: '"Share Tech Mono", "Courier New", monospace',
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: false,
      cursorStyle: 'block',
      disableStdin: true, // Read-only terminal
      scrollback: 1000,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);

    // Fit terminal to container
    try {
      fitAddon.fit();
    } catch {
      // Ignore fit errors during initial render
    }

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // Ignore fit errors
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Fetch and update terminal content
  const fetchContent = useCallback(async () => {
    if (!terminalRef.current || !enabled) return;

    try {
      const result = await api.agents.getTerminal(rig, polecat);

      // Only update if content changed
      if (result.content !== lastContent) {
        const terminal = terminalRef.current;
        terminal.clear();
        terminal.write(result.content);
        setLastContent(result.content);
        setError(null);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to fetch terminal content');
      }
    }
  }, [rig, polecat, enabled, lastContent]);

  // Polling effect
  useEffect(() => {
    if (!enabled) return;

    // Immediate fetch
    void fetchContent();

    // Set up polling
    const intervalId = setInterval(() => void fetchContent(), pollInterval);

    return () => clearInterval(intervalId);
  }, [fetchContent, pollInterval, enabled]);

  return (
    <div style={{ ...styles.container, ...style }} className={className}>
      <div style={styles.header}>
        <span style={styles.sessionName}>
          {rig}/{polecat}
        </span>
        <span style={styles.indicator} />
        {onClose && (
          <button style={styles.closeButton} onClick={onClose} title="Close terminal">
            ×
          </button>
        )}
      </div>
      {error && (
        <div style={styles.errorBanner}>
          {error}
        </div>
      )}
      <div ref={containerRef} style={styles.terminal} />
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    border: '1px solid var(--crt-phosphor-dim)',
    backgroundColor: '#0a0a0a',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 10px',
    borderBottom: '1px solid var(--crt-phosphor-dim)',
    backgroundColor: '#111111',
    fontSize: '0.75rem',
    fontFamily: '"Share Tech Mono", monospace',
    color: 'var(--crt-phosphor)',
  },
  sessionName: {
    flex: 1,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
  },
  indicator: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: 'var(--crt-phosphor)',
    boxShadow: '0 0 6px var(--crt-phosphor)',
  },
  closeButton: {
    background: 'none',
    border: 'none',
    color: 'var(--crt-phosphor-dim)',
    fontSize: '1.2rem',
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1,
  },
  errorBanner: {
    padding: '6px 10px',
    backgroundColor: 'rgba(255, 68, 68, 0.1)',
    borderBottom: '1px solid #ff4444',
    color: '#ff4444',
    fontSize: '0.7rem',
    letterSpacing: '0.05em',
  },
  terminal: {
    flex: 1,
    minHeight: '200px',
    padding: '4px',
  },
} satisfies Record<string, CSSProperties>;

export default TerminalPane;
