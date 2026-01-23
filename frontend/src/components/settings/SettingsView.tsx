import { useState, useCallback, useEffect, type CSSProperties } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ThemeId } from '../../App';
import { NotificationSettings, VoiceConfigPanel } from '../voice';

interface TunnelStatusData {
  state: 'stopped' | 'starting' | 'running' | 'error';
  publicUrl?: string;
  error?: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

type TunnelStatus = 'loading' | 'connected' | 'not-running' | 'starting' | 'error';

interface ThemeOption {
  id: ThemeId;
  label: string;
  color: string;
}

const THEMES: ThemeOption[] = [
  { id: 'green', label: 'GAS-BOY', color: '#20C20E' },
  { id: 'red', label: 'BLOOD-BAG', color: '#FF3333' },
  { id: 'blue', label: 'VAULT-TEC', color: '#00AAFF' },
  { id: 'tan', label: 'WASTELAND', color: '#D2B48C' },
  { id: 'pink', label: 'PINK-MIST', color: '#FF69B4' },
  { id: 'purple', label: 'RAD-STORM', color: '#BF94FF' },
];

interface SettingsViewProps {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  isActive: boolean;
}

/**
 * Settings view component.
 * Displays system settings and connection info including the public URL for remote access.
 */
export function SettingsView({ theme, setTheme, isActive }: SettingsViewProps) {
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [showCoffeeQR, setShowCoffeeQR] = useState(false);
  const [tunnelStatus, setTunnelStatus] = useState<TunnelStatus>('loading');
  const [ngrokUrl, setNgrokUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isToggling, setIsToggling] = useState(false);

  // Fetch tunnel status from backend
  const currentOrigin = window.location.origin;
  const isOnNgrok = currentOrigin.includes('ngrok');

  // Fetch tunnel status from backend
  const fetchTunnelStatus = useCallback(async () => {
    if (isOnNgrok) {
      // Already accessed via ngrok, use current URL
      setNgrokUrl(currentOrigin);
      setTunnelStatus('connected');
      return;
    }

    try {
      const response = await fetch('/api/tunnel/status');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = (await response.json()) as ApiResponse<TunnelStatusData>;

      if (result.success && result.data) {
        const { state, publicUrl, error } = result.data;
        switch (state) {
          case 'running':
            setNgrokUrl(publicUrl ?? null);
            setTunnelStatus('connected');
            break;
          case 'starting':
            setTunnelStatus('starting');
            break;
          case 'stopped':
            setTunnelStatus('not-running');
            setNgrokUrl(null);
            break;
          case 'error':
            setTunnelStatus('error');
            setErrorMsg(error ?? 'Unknown error');
            break;
        }
      } else {
        setTunnelStatus('error');
        setErrorMsg(result.error?.message ?? 'Failed to get status');
      }
    } catch (err) {
      setTunnelStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Failed to connect');
    }
  }, [isOnNgrok, currentOrigin]);

  // Fetch status when tab becomes active
  useEffect(() => {
    if (isActive) {
      fetchTunnelStatus();
    }
  }, [isActive, fetchTunnelStatus]);

  // Handle toggle
  const handleToggle = useCallback(async () => {
    if (isToggling || isOnNgrok) return;

    setIsToggling(true);
    const isCurrentlyRunning = tunnelStatus === 'connected';
    const endpoint = isCurrentlyRunning ? '/api/tunnel/stop' : '/api/tunnel/start';

    // Optimistic update
    setTunnelStatus(isCurrentlyRunning ? 'not-running' : 'starting');
    if (isCurrentlyRunning) {
      setNgrokUrl(null);
    }

    try {
      const response = await fetch(endpoint, { method: 'POST' });
      const result = (await response.json()) as ApiResponse<TunnelStatusData>;

      if (result.success && result.data) {
        const { state, publicUrl } = result.data;
        if (state === 'running') {
          setTunnelStatus('connected');
          setNgrokUrl(publicUrl ?? null);
        } else if (state === 'stopped') {
          setTunnelStatus('not-running');
          setNgrokUrl(null);
        } else if (state === 'starting') {
          setTunnelStatus('starting');
          // Poll for completion
          setTimeout(() => fetchTunnelStatus(), 1000);
        }
      } else {
        // Revert on error
        await fetchTunnelStatus();
        setErrorMsg(result.error?.message ?? 'Failed to toggle tunnel');
      }
    } catch (err) {
      await fetchTunnelStatus();
      setErrorMsg(err instanceof Error ? err.message : 'Failed to toggle tunnel');
    } finally {
      setIsToggling(false);
    }
  }, [isToggling, isOnNgrok, tunnelStatus, fetchTunnelStatus]);

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
      case 'starting':
        return '◐ STARTING...';
      case 'connected':
        return '● ACTIVE';
      case 'not-running':
        return '○ NOT RUNNING';
      case 'error':
        return '✗ ERROR';
    }
  };

  const getStatusStyle = () => {
    switch (tunnelStatus) {
      case 'loading':
      case 'starting':
        return styles.statusLoading;
      case 'connected':
        return styles.statusConnected;
      case 'not-running':
      case 'error':
        return styles.statusDisconnected;
    }
  };

  const isToggleOn = tunnelStatus === 'connected' || tunnelStatus === 'starting';
  const canToggle = !isToggling && !isOnNgrok && tunnelStatus !== 'loading';

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%', overflow: 'hidden' }}>
      <div style={styles.container}>
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>REMOTE ACCESS</h2>

          <div style={styles.field}>
            <span style={styles.label}>TUNNEL:</span>
            <div style={styles.toggleRow}>
              <button
                type="button"
                style={{
                  ...styles.toggleButton,
                  ...(isToggleOn ? styles.toggleOn : styles.toggleOff),
                  ...((!canToggle) ? styles.toggleDisabled : {}),
                }}
                onClick={handleToggle}
                disabled={!canToggle}
                title={isOnNgrok ? 'Cannot toggle while accessed via tunnel' : undefined}
              >
                <span
                  style={{
                    ...styles.toggleKnob,
                    ...(isToggleOn ? styles.toggleKnobOn : styles.toggleKnobOff),
                  }}
                />
              </button>
              <span style={getStatusStyle()}>{getStatusText()}</span>
            </div>
          </div>

          {tunnelStatus === 'connected' && ngrokUrl && (
            <>
              <div style={styles.field}>
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
                        fgColor={colors.primary}
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
              Toggle ON to enable remote access via ngrok tunnel.
            </p>
          )}

          {tunnelStatus === 'starting' && (
            <p style={styles.hint}>Starting ngrok tunnel...</p>
          )}

          {tunnelStatus === 'loading' && (
            <p style={styles.hint}>Checking tunnel status...</p>
          )}

          {tunnelStatus === 'error' && errorMsg && (
            <p style={styles.errorHint}>Error: {errorMsg}</p>
          )}
        </section>

        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>SYSTEM THEME</h2>
          <div style={styles.themeGrid}>
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                style={{
                  ...styles.themeButton,
                  borderColor: theme === t.id ? 'var(--crt-phosphor)' : 'var(--crt-phosphor-dim)',
                  borderWidth: theme === t.id ? '2px' : '1px',
                  padding: theme === t.id ? '7px' : '8px',
                  backgroundColor: 'transparent',
                  boxShadow: theme === t.id ? '0 0 8px var(--crt-phosphor-glow)' : 'none',
                }}
                onClick={() => setTheme(t.id)}
              >
                <div style={{ ...styles.themePreview, backgroundColor: t.color }} />
                <span style={{
                  ...styles.themeLabel,
                  color: theme === t.id ? 'var(--crt-phosphor)' : 'var(--crt-phosphor-dim)'
                }}>
                  {t.label}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* T052: Voice Settings Section */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>AUDIO SETTINGS</h2>
          <NotificationSettings />
        </section>

        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>VOICE CONFIGURATION</h2>
          <VoiceConfigPanel />
        </section>
      </div>

      <button
        type="button"
        style={styles.coffeeButton}
        onClick={() => setShowCoffeeQR(true)}
        title="Fuel the Developer"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8h1a4 4 0 0 1 0 8h-1"></path>
          <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path>
          <line x1="6" y1="1" x2="6" y2="4"></line>
          <line x1="10" y1="1" x2="10" y2="4"></line>
          <line x1="14" y1="1" x2="14" y2="4"></line>
        </svg>
      </button>

      {showCoffeeQR && (
        <div style={styles.qrOverlay} onClick={() => setShowCoffeeQR(false)}>
          <div style={styles.qrModal} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ ...styles.qrTitle, fontSize: '1.8rem' }}>WITNESS THE CAFFEINE</h3>
            <div style={styles.qrContainer}>
              <QRCodeSVG
                value="https://buymeacoffee.com/wsaults"
                size={280}
                bgColor="#0A0A0A"
                fgColor={colors.primary}
                level="M"
              />
            </div>
            <code style={{ ...styles.qrUrl, fontSize: '1.1rem', maxWidth: '320px' }}>buymeacoffee.com/wsaults</code>
            <p style={{ ...styles.hint, fontSize: '1rem', textAlign: 'center', marginTop: '0.5rem', fontStyle: 'italic', color: colors.primary }}>
              "FUEL FOR THE GREAT JOURNEY"
            </p>
            <button
              type="button"
              style={{ ...styles.qrCloseButton, fontSize: '1.2rem', padding: '1rem 3rem' }}
              onClick={() => setShowCoffeeQR(false)}
            >
              VALHALLA!
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const colors = {
  primary: 'var(--crt-phosphor)',
  primaryDim: 'var(--crt-phosphor-dim)',
  primaryGlow: 'var(--crt-phosphor-glow)',
  background: '#0A0A0A',
  amber: 'var(--crt-amber)',
  red: '#FF4444',
} as const;

const styles = {
  container: {
    padding: '0.75rem',
    fontFamily: '"Share Tech Mono", "Courier New", monospace',
    color: colors.primary,
    maxWidth: '100%',
    boxSizing: 'border-box',
    height: '100%',
    overflowY: 'auto',
  } as CSSProperties,

  section: {
    marginBottom: '1.5rem',
    padding: '0.75rem',
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

  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
  },

  toggleButton: {
    width: '44px',
    height: '24px',
    borderRadius: '12px',
    border: 'none',
    cursor: 'pointer',
    position: 'relative',
    transition: 'background-color 0.2s',
    flexShrink: 0,
  } as CSSProperties,

  toggleOn: {
    backgroundColor: colors.primary,
  },

  toggleOff: {
    backgroundColor: colors.primaryDim,
  },

  toggleDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },

  toggleKnob: {
    position: 'absolute',
    top: '2px',
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    backgroundColor: colors.background,
    transition: 'left 0.2s',
  } as CSSProperties,

  toggleKnobOn: {
    left: '22px',
  },

  toggleKnobOff: {
    left: '2px',
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
    flexWrap: 'wrap',
    gap: '0.5rem',
    padding: '0.5rem',
    background: colors.background,
    border: `1px solid ${colors.primaryDim}`,
    borderRadius: '2px',
    flex: 1,
    width: '100%',
    boxSizing: 'border-box',
  } as CSSProperties,

  urlTextInner: {
    fontSize: '0.8rem',
    wordBreak: 'break-all',
    flex: 1,
    minWidth: 0,
    lineHeight: 1.4,
  } as CSSProperties,

  coffeeButton: {
    position: 'absolute',
    bottom: '12px',
    left: '12px',
    background: 'transparent',
    border: 'none',
    color: colors.primary,
    cursor: 'pointer',
    opacity: 0.6,
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '8px',
    zIndex: 5,
    filter: `drop-shadow(0 0 2px ${colors.primaryGlow})`,
  } as CSSProperties,

  qrButtonInline: {
    padding: '0.5rem',
    background: 'transparent',
    border: 'none',
    color: colors.primary,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'color 0.1s',
    flexShrink: 0,
    minWidth: '44px',
    minHeight: '44px',
  } as CSSProperties,

  copyButtonInline: {
    padding: '0.5rem',
    background: 'transparent',
    border: 'none',
    color: colors.primary,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'color 0.1s',
    flexShrink: 0,
    minWidth: '44px',
    minHeight: '44px',
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

  errorHint: {
    fontSize: '0.75rem',
    color: colors.red,
    marginTop: '1rem',
    marginBottom: 0,
    fontStyle: 'italic',
  },

  themeGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
    gap: '12px',
  },

  themeButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px',
    border: '1px solid',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    background: 'transparent',
  } as CSSProperties,

  themePreview: {
    width: '20px',
    height: '20px',
    borderRadius: '2px',
    border: '1px solid rgba(255, 255, 255, 0.1)',
  },

  themeLabel: {
    fontSize: '0.8rem',
    fontWeight: 'bold',
    letterSpacing: '0.05em',
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
    padding: '1.5rem',
    margin: '1rem',
    maxWidth: '90vw',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '1rem',
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
    minHeight: '44px',
  } as CSSProperties,
} satisfies Record<string, CSSProperties>;

export default SettingsView;
