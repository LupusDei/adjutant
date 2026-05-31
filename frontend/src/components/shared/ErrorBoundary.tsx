import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary.
 *
 * Without this, an uncaught render error in ANY component unmounts the whole
 * React tree and the app goes blank (this has bitten us twice — a bad data
 * shape in one view took down the entire dashboard). The boundary catches the
 * error, shows a themed fault panel with a reload path, and keeps the failure
 * contained + visible instead of a silent white screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface for diagnosis — a blank screen with no console trace is the worst
    // failure mode.
    // eslint-disable-next-line no-console
    console.error('App ErrorBoundary caught:', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          style={{
            padding: 24,
            minHeight: '100vh',
            background: '#06041E',
            color: '#00FFD5',
            fontFamily: "'IBM Plex Mono', 'Share Tech Mono', monospace",
          }}
        >
          <h2 style={{ letterSpacing: 2, textTransform: 'uppercase' }}>⚠ Interface Fault</h2>
          <p style={{ color: '#00BB99' }}>
            A panel crashed. The rest of the system is intact — reload to recover.
          </p>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              color: '#80FFF0',
              fontSize: 12,
              opacity: 0.85,
              marginTop: 12,
            }}
          >
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
            style={{
              marginTop: 16,
              padding: '8px 16px',
              background: 'transparent',
              color: '#00FFD5',
              border: '1px solid #00FFD5',
              cursor: 'pointer',
              fontFamily: 'inherit',
              letterSpacing: 1,
            }}
          >
            RELOAD
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
