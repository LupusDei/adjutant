import { useState, useCallback, useEffect, type CSSProperties } from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface NgrokTunnel {
  public_url: string;
  proto: string;
  config: { addr: string };
}

interface NgrokApiResponse {
  tunnels: NgrokTunnel[];
}

type TunnelStatus = 'loading' | 'connected' | 'not-running' | 'error';

/**
 * Settings view component.
 * Displays system settings and connection info including the public URL for remote access.
 */
export function SettingsView() {
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [tunnelStatus, setTunnelStatus] = useState<TunnelStatus>('loading');
  const [ngrokUrl, setNgrokUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Check if we're already on ngrok
  const currentOrigin = window.location.origin;
  const isOnNgrok = currentOrigin.includes('ngrok');

  // Fetch ngrok tunnel info
  useEffect(() => {
    if (isOnNgrok) {
      // Already accessed via ngrok, use current URL
      setNgrokUrl(currentOrigin);
      setTunnelStatus('connected');
      return;
    }

    // Try to fetch from ngrok local API via Vite proxy (avoids CORS)
    const fetchNgrokUrl = async () => {
      try {
        const response = await fetch('/ngrok-api/api/tunnels', {
          method: 'GET',
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = (await response.json()) as NgrokApiResponse;

        // Find the https tunnel (prefer https over http)
        const httpsTunnel = data.tunnels.find((t) => t.proto === 'https');
        const httpTunnel = data.tunnels.find((t) => t.proto === 'http');
        const tunnel = httpsTunnel ?? httpTunnel;

        if (tunnel) {
          setNgrokUrl(tunnel.public_url);
          setTunnelStatus('connected');
        } else {
          setTunnelStatus('not-running');
          setErrorMsg('No tunnels found');
        }
      } catch (err) {
        // ngrok not running or not reachable
        setTunnelStatus('not-running');
        setErrorMsg(err instanceof Error ? err.message : 'Failed to connect');
      }
    };

    fetchNgrokUrl();
  }, [isOnNgrok, currentOrigin]);

  const displayUrl = ngrokUrl ?? currentOrigin;

  const handleCopy = useCallback(async () => {
    const urlToCopy = ngrokUrl ?? currentOrigin;
    try {
      await navigator.clipboard.writeText(urlToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for browsers that don't support clipboard API
      const input = document.createElement('input');
      input.value = urlToCopy;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [ngrokUrl, currentOrigin]);

  const getStatusText = () => {
    switch (tunnelStatus) {
      case 'loading':
        return '◐ CHECKING...';
      case 'connected':
        return '● TUNNEL ACTIVE';
      case 'not-running':
        return '○ TUNNEL NOT RUNNING';
      case 'error':
        return '✗ ERROR';
    }
  };

  const getStatusStyle = () => {
    switch (tunnelStatus) {
      case 'loading':
        return styles.statusLoading;
      case 'connected':
        return styles.statusConnected;
      case 'not-running':
      case 'error':
        return styles.statusDisconnected;
    }
  };

  return (
    <div style={styles.container}>
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>REMOTE ACCESS</h2>

        <div style={styles.field}>
          <span style={styles.label}>TUNNEL:</span>
          <span style={getStatusStyle()}>{getStatusText()}</span>
        </div>

        {tunnelStatus === 'connected' && ngrokUrl && (
          <>
            <div style={styles.field}>
              <span style={styles.label}>PUBLIC URL:</span>
              <div style={styles.urlField}>
                <code style={styles.urlTextInner}>{displayUrl}</code>
                <button
                  type="button"
                  style={styles.qrButtonInline}
                  onClick={() => setShowQR(true)}
                  title="Show QR Code"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm13-2h3v3h-3v-3zm-3 3h3v3h-3v-3zm3 3h3v3h-3v-3zm-3 3h3v3h-3v-3zm3 0h3v3h-3v-3z"/>
                  </svg>
                </button>
                <button
                  type="button"
                  style={styles.copyButtonInline}
                  onClick={handleCopy}
                  title={copied ? 'Copied!' : 'Copy URL'}
                >
                  {copied ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <p style={styles.hint}>
              Share this URL to access GASTOWN-BOY from other devices.
            </p>

            {showQR && (
              <div style={styles.qrOverlay} onClick={() => setShowQR(false)}>
                <div style={styles.qrModal} onClick={(e) => e.stopPropagation()}>
                  <h3 style={styles.qrTitle}>SCAN TO CONNECT</h3>
                  <div style={styles.qrContainer}>
                    <QRCodeSVG
                      value={ngrokUrl}
                      size={256}
                      bgColor="#0A0A0A"
                      fgColor="#14F07D"
                      level="M"
                    />
                  </div>
                  <code style={styles.qrUrl}>{ngrokUrl}</code>
                  <button
                    type="button"
                    style={styles.qrCloseButton}
                    onClick={() => setShowQR(false)}
                  >
                    CLOSE
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {tunnelStatus === 'not-running' && (
          <p style={styles.hint}>
            No tunnel detected. Start ngrok to enable remote access.
          </p>
        )}

        {tunnelStatus === 'loading' && (
          <p style={styles.hint}>Checking for ngrok tunnel...</p>
        )}
      </section>

    </div>
  );
}

const colors = {
  primary: '#14F07D',
  primaryDim: '#0A7A3E',
  primaryGlow: '#14F07D40',
  background: '#0A0A0A',
  amber: '#FFAA00',
  red: '#FF4444',
} as const;

const styles = {
  container: {
    padding: '1rem',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    color: colors.primary,
  },

  section: {
    marginBottom: '2rem',
    padding: '1rem',
    border: `1px solid ${colors.primaryDim}`,
    borderRadius: '2px',
  },

  sectionTitle: {
    fontSize: '1rem',
    letterSpacing: '0.2em',
    marginTop: 0,
    marginBottom: '1rem',
    paddingBottom: '0.5rem',
    borderBottom: `1px solid ${colors.primaryDim}`,
  },

  field: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '1rem',
    marginBottom: '0.75rem',
  },

  label: {
    color: colors.primaryDim,
    minWidth: '120px',
    letterSpacing: '0.1em',
  },

  value: {
    color: colors.primary,
  },

  statusLoading: {
    color: colors.primaryDim,
  },

  statusConnected: {
    color: colors.amber,
    textShadow: `0 0 8px ${colors.amber}`,
  },

  statusDisconnected: {
    color: colors.primaryDim,
  },

  urlContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    flex: 1,
  },

  urlText: {
    padding: '0.5rem 0.75rem',
    background: colors.background,
    border: `1px solid ${colors.primaryDim}`,
    borderRadius: '2px',
    fontSize: '0.85rem',
    wordBreak: 'break-all',
    flex: 1,
  } as CSSProperties,

  urlField: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem 0.75rem',
    background: colors.background,
    border: `1px solid ${colors.primaryDim}`,
    borderRadius: '2px',
    flex: 1,
  } as CSSProperties,

  urlTextInner: {
    fontSize: '0.85rem',
    wordBreak: 'break-all',
    flex: 1,
  } as CSSProperties,

  qrButtonInline: {
    padding: '0.25rem',
    background: 'transparent',
    border: 'none',
    color: colors.primary,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'color 0.1s',
    flexShrink: 0,
  } as CSSProperties,

  copyButtonInline: {
    padding: '0.25rem',
    background: 'transparent',
    border: 'none',
    color: colors.primary,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'color 0.1s',
    flexShrink: 0,
  } as CSSProperties,

  copyButton: {
    padding: '0.5rem 1rem',
    background: 'transparent',
    border: `1px solid ${colors.primaryDim}`,
    borderRadius: '2px',
    color: colors.primary,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '0.75rem',
    letterSpacing: '0.1em',
    transition: 'all 0.1s',
    whiteSpace: 'nowrap',
  } as CSSProperties,

  hint: {
    fontSize: '0.75rem',
    color: colors.primaryDim,
    marginTop: '1rem',
    marginBottom: 0,
    fontStyle: 'italic',
  },

  instructions: {
    marginTop: '1rem',
    padding: '0.75rem',
    background: colors.background,
    border: `1px dashed ${colors.primaryDim}`,
    borderRadius: '2px',
  },

  instructionText: {
    fontSize: '0.8rem',
    color: colors.primaryDim,
    margin: '0 0 0.5rem 0',
  },

  codeBlock: {
    display: 'block',
    padding: '0.5rem',
    background: '#000',
    border: `1px solid ${colors.primaryDim}`,
    borderRadius: '2px',
    fontSize: '0.85rem',
    color: colors.primary,
  },

  errorText: {
    fontSize: '0.7rem',
    color: colors.primaryDim,
    marginTop: '0.5rem',
    marginBottom: 0,
    opacity: 0.7,
  },

  qrOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.9)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  } as CSSProperties,

  qrModal: {
    background: colors.background,
    border: `2px solid ${colors.primary}`,
    borderRadius: '4px',
    padding: '2rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '1.5rem',
    boxShadow: `0 0 30px ${colors.primaryGlow}`,
  } as CSSProperties,

  qrTitle: {
    margin: 0,
    fontSize: '1.2rem',
    letterSpacing: '0.2em',
    color: colors.primary,
    textShadow: `0 0 10px ${colors.primaryGlow}`,
  },

  qrContainer: {
    padding: '1rem',
    background: colors.background,
    border: `1px solid ${colors.primaryDim}`,
    borderRadius: '4px',
  },

  qrUrl: {
    fontSize: '0.8rem',
    color: colors.primaryDim,
    wordBreak: 'break-all',
    textAlign: 'center',
    maxWidth: '280px',
  } as CSSProperties,

  qrCloseButton: {
    padding: '0.75rem 2rem',
    background: 'transparent',
    border: `1px solid ${colors.primary}`,
    borderRadius: '2px',
    color: colors.primary,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '0.85rem',
    letterSpacing: '0.15em',
    transition: 'all 0.1s',
  } as CSSProperties,
} satisfies Record<string, CSSProperties>;

export default SettingsView;
