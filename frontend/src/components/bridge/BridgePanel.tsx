/**
 * BridgePanel (adj-202.3.7) — The Bridge: read-only Fleet Briefing.
 *
 * The Commander summons the Adjutant coordinator's conversational body. The
 * avatar (served same-origin at `/avatar`, embedded in a sandboxed iframe — no
 * heavy SDK pulled into the dashboard bundle) is the FACE; the structured tool
 * results in the AuthoritativeResultPanel are the source of TRUTH. The voice only
 * narrates what the readout already proves (the grounding contract).
 *
 * One session, broker-owned (adj-202.3.7.3): the panel hands the cost-guarded
 * broker creds to the iframe over postMessage (`?external=1` ⇒ the page does NOT
 * self-connect), so the meter and the 429 ceiling track the REAL stream — no
 * duplicate session, no double billing. The same channel surfaces live captions
 * (.7.1) and mic control (.7.2). Cost safety (.7.4: idle auto-disconnect +
 * expiry teardown) and ceiling clarity (.7.6) come from useBridgeSession.
 */
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';

import { useBridgeSession } from '../../hooks/useBridgeSession';
import type { BridgeToolName, BridgeToolRunResult } from '../../types/bridge';
import { AuthoritativeResultPanel } from './AuthoritativeResultPanel';
import { CreditMeter } from './CreditMeter';
import { CaptionsPanel, type CaptionLine } from './CaptionsPanel';
import { MicToggle } from './MicToggle';
import { CameraToggle } from './CameraToggle';
import { describeConnectError } from './connect-error';
import {
  applyCaption,
  parseAvatarMessage,
  type ParentToAvatarMessage,
} from './avatar-bridge';

const AZURE = '#1FB6D6';
const PURPLE = '#a118c4';

/** A quick-action fleet tool the Commander can fire from the controls bar. */
interface QuickTool {
  tool: BridgeToolName;
  label: string;
  /** Project-scoped tools need a target projectId; fleet-wide tools do not. */
  needsProject: boolean;
}

const QUICK_TOOLS: readonly QuickTool[] = [
  { tool: 'list_agents', label: 'Crew', needsProject: false },
  { tool: 'list_questions', label: 'Questions', needsProject: false },
  { tool: 'get_project_state', label: 'Project state', needsProject: true },
  { tool: 'list_beads', label: 'Beads', needsProject: true },
  { tool: 'get_auto_develop_status', label: 'Auto-develop', needsProject: true },
];

const STATE_LABEL: Record<ReturnType<typeof useBridgeSession>['state'], string> = {
  idle: 'Standby',
  connecting: 'Linking…',
  connected: 'On the Bridge',
  error: 'Link failed',
};

const STATE_COLOR: Record<ReturnType<typeof useBridgeSession>['state'], string> = {
  idle: '#9aa0a6',
  connecting: AZURE,
  connected: '#3ddc84',
  error: '#ff5c6c',
};

const END_REASON_NOTE: Record<'idle' | 'expired', string> = {
  idle: 'Session ended after inactivity to protect the budget. Open the link to resume.',
  expired: 'Session reached its time limit and closed. Open the link to resume.',
};

export interface BridgePanelProps {
  /** Optional target project for project-scoped tools (UUID — the canonical key). */
  projectId?: string;
  /** Display name for the scoped project (header context only). */
  projectName?: string;
  /**
   * Avatar page base URL. The panel appends `?external=1` so the page waits for
   * broker creds instead of self-connecting (one session). Default same-origin.
   */
  avatarSrc?: string;
}

interface LogEntry {
  at: string;
  tool: string;
  ok: boolean;
  detail: string;
}

export function BridgePanel({ projectId, projectName, avatarSrc = '/avatar' }: BridgePanelProps) {
  const session = useBridgeSession();
  const {
    state,
    creds,
    error,
    errorCode,
    errorStatus,
    lastEndReason,
    meter,
    elapsedMs,
    connect,
    disconnect,
    markActivity,
    runTool,
  } = session;

  const [result, setResult] = useState<BridgeToolRunResult | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [captions, setCaptions] = useState<CaptionLine[]>([]);
  const [micEnabled, setMicEnabled] = useState(true);
  // Camera starts OFF — voice is the default; the Commander opts into video.
  const [cameraEnabled, setCameraEnabled] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const connected = state === 'connected';

  /** Post a typed command to the avatar iframe (same-origin). */
  const postToAvatar = useCallback((msg: ParentToAvatarMessage) => {
    iframeRef.current?.contentWindow?.postMessage(msg, window.location.origin);
  }, []);

  // Listen for avatar→parent events: hand off creds on ready, collect captions,
  // mirror mic state. Defensive — only same-origin, well-formed messages count.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      const msg = parseAvatarMessage(ev.data);
      if (!msg) return;

      switch (msg.type) {
        case 'bridge:ready':
          // The page is up in external mode and waiting — hand it the broker creds
          // so it streams the SAME session the meter/ceiling already track.
          if (creds) {
            postToAvatar({
              type: 'bridge:session',
              sessionId: creds.sessionId,
              sessionKey: creds.sessionKey,
              avatarId: creds.avatarId,
            });
          }
          break;
        case 'bridge:caption':
          setCaptions((prev) => applyCaption(prev, msg));
          break;
        case 'bridge:mic':
          setMicEnabled(msg.enabled);
          break;
        case 'bridge:camera':
          setCameraEnabled(msg.enabled);
          break;
        case 'bridge:status':
          // Lifecycle echo — reserved for future surfacing; ignored for now.
          break;
      }
    }

    window.addEventListener('message', onMessage);
    return () => { window.removeEventListener('message', onMessage); };
  }, [creds, postToAvatar]);

  // Reset per-session UI when a link opens; clear it when one ends.
  useEffect(() => {
    if (connected) {
      setCaptions([]);
      setMicEnabled(true);
      setCameraEnabled(false);
    } else {
      setCaptions([]);
    }
  }, [connected]);

  const toggleMic = useCallback(() => {
    const next = !micEnabled;
    setMicEnabled(next); // optimistic; the iframe echoes authoritative state
    postToAvatar({ type: 'bridge:mic', enabled: next });
    markActivity();
  }, [micEnabled, postToAvatar, markActivity]);

  const toggleCamera = useCallback(() => {
    const next = !cameraEnabled;
    setCameraEnabled(next); // optimistic; the iframe echoes authoritative state
    postToAvatar({ type: 'bridge:camera', enabled: next });
    markActivity();
  }, [cameraEnabled, postToAvatar, markActivity]);

  const fireTool = useCallback(
    async (qt: QuickTool) => {
      setRunning(true);
      const res = await runTool(qt.tool, qt.needsProject ? projectId : undefined);
      setResult(res);
      setLog((prev) =>
        [
          {
            at: new Date().toLocaleTimeString(),
            tool: qt.tool,
            ok: res.ok,
            detail: res.ok ? 'readout updated' : res.error.code,
          },
          ...prev,
        ].slice(0, 8),
      );
      setRunning(false);
    },
    [runTool, projectId],
  );

  const connectError =
    state === 'error' ? describeConnectError({ error, errorCode, errorStatus }) : null;

  return (
    <main style={rootStyle} aria-label="The Bridge — fleet briefing">
      <header style={headerStyle}>
        <div>
          <h1 style={titleStyle}>The Bridge</h1>
          <p style={subtitleStyle}>
            Fleet briefing // read-only
            {projectName ? ` // ${projectName}` : ''}
          </p>
        </div>
        <div style={headerRightStyle}>
          <span style={statusStyle}>
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: STATE_COLOR[state],
                boxShadow: `0 0 8px ${STATE_COLOR[state]}`,
              }}
            />
            <span style={{ color: STATE_COLOR[state] }}>{STATE_LABEL[state]}</span>
          </span>
          <CreditMeter meter={meter} elapsedMs={elapsedMs} />
        </div>
      </header>

      <div style={bodyStyle}>
        {/* Left column: avatar viewscreen + live captions. */}
        <div style={leftColStyle}>
          <section style={viewscreenStyle} aria-label="Adjutant avatar viewscreen">
            {connected ? (
              <iframe
                ref={iframeRef}
                title="Adjutant avatar"
                src={`${avatarSrc}?external=1`}
                style={iframeStyle}
                allow="microphone; autoplay"
                sandbox="allow-scripts allow-same-origin allow-microphone"
              />
            ) : (
              <div style={viewscreenIdleStyle}>
                {connectError ? (
                  <div style={{ textAlign: 'center', maxWidth: 320 }} role="alert">
                    <p
                      style={{
                        color: connectError.kind === 'ceiling' ? '#ffb84d' : '#ff5c6c',
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                      }}
                    >
                      {connectError.title}
                    </p>
                    {connectError.detail && (
                      <p style={{ color: '#9aa0a6', fontSize: '0.75rem', marginTop: '0.35rem' }}>
                        {connectError.detail}
                      </p>
                    )}
                  </div>
                ) : (
                  <p style={{ color: '#9aa0a6', maxWidth: 300, textAlign: 'center' }}>
                    {lastEndReason === 'idle' || lastEndReason === 'expired'
                      ? END_REASON_NOTE[lastEndReason]
                      : 'The viewscreen is dark. Open the link to summon the Adjutant.'}
                  </p>
                )}
              </div>
            )}
          </section>

          <CaptionsPanel captions={captions} />
        </div>

        {/* Right column: authoritative readout — the source of truth. */}
        <AuthoritativeResultPanel result={result} />
      </div>

      <footer style={controlsStyle}>
        <div style={controlGroupStyle}>
          {connected ? (
            <button type="button" style={primaryBtn('#ff5c6c')} onClick={disconnect}>
              End link
            </button>
          ) : (
            <button
              type="button"
              style={primaryBtn(AZURE)}
              onClick={() => void connect()}
              disabled={state === 'connecting'}
            >
              {state === 'connecting' ? 'Linking…' : 'Open link'}
            </button>
          )}
          <MicToggle enabled={micEnabled} disabled={!connected} onToggle={toggleMic} />
          <CameraToggle enabled={cameraEnabled} disabled={!connected} onToggle={toggleCamera} />
        </div>

        <div style={controlGroupStyle} role="group" aria-label="Fleet tools">
          {QUICK_TOOLS.map((qt) => {
            const blocked = qt.needsProject && !projectId;
            return (
              <button
                key={qt.tool}
                type="button"
                style={toolBtn(blocked)}
                disabled={!connected || running || blocked}
                title={blocked ? 'Select a project to scope this tool' : qt.tool}
                onClick={() => void fireTool(qt)}
              >
                {qt.label}
              </button>
            );
          })}
        </div>

        <ol style={logStyle} aria-label="Action log">
          {log.map((e, i) => (
            <li key={`${e.at}-${i}`} style={{ color: e.ok ? '#9aa0a6' : '#ff5c6c' }}>
              <span style={{ color: AZURE }}>{e.at}</span> {e.tool} · {e.detail}
            </li>
          ))}
        </ol>
      </footer>
    </main>
  );
}

// ── styles ──────────────────────────────────────────────────────────────────

const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  gap: '0.75rem',
  padding: '1rem',
  background: '#06060a',
  color: '#e6e6ee',
  fontFamily: 'var(--font-mono, monospace)',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '1rem',
  flexWrap: 'wrap',
  paddingBottom: '0.5rem',
  borderBottom: `1px solid ${PURPLE}44`,
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: '1.25rem',
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: AZURE,
  textShadow: `0 0 12px ${AZURE}66`,
};

const subtitleStyle: CSSProperties = {
  margin: '0.25rem 0 0',
  fontSize: '0.6875rem',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#9aa0a6',
};

const headerRightStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '1.5rem',
  flexWrap: 'wrap',
};

const statusStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  fontSize: '0.75rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const bodyStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
  gap: '0.75rem',
  flex: 1,
  minHeight: 0,
};

const leftColStyle: CSSProperties = {
  display: 'grid',
  gridTemplateRows: 'minmax(0, 1.6fr) minmax(0, 1fr)',
  gap: '0.75rem',
  minHeight: 0,
};

const viewscreenStyle: CSSProperties = {
  position: 'relative',
  border: `1px solid ${PURPLE}55`,
  borderRadius: 4,
  background: '#000',
  overflow: 'hidden',
  minHeight: 200,
};

const iframeStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  border: 0,
  display: 'block',
};

const viewscreenIdleStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1rem',
};

const controlsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '1rem',
  flexWrap: 'wrap',
  paddingTop: '0.5rem',
  borderTop: `1px solid ${PURPLE}44`,
};

const controlGroupStyle: CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  flexWrap: 'wrap',
  alignItems: 'center',
};

function primaryBtn(color: string): CSSProperties {
  return {
    padding: '0.5rem 1rem',
    background: 'transparent',
    border: `1px solid ${color}`,
    borderRadius: 3,
    color,
    fontFamily: 'inherit',
    fontSize: '0.8125rem',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    cursor: 'pointer',
  };
}

function toolBtn(blocked: boolean): CSSProperties {
  return {
    padding: '0.4rem 0.75rem',
    background: 'transparent',
    border: `1px solid ${blocked ? '#33343a' : `${AZURE}88`}`,
    borderRadius: 3,
    color: blocked ? '#55565c' : '#cfd2d6',
    fontFamily: 'inherit',
    fontSize: '0.75rem',
    letterSpacing: '0.04em',
    cursor: blocked ? 'not-allowed' : 'pointer',
  };
}

const logStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  marginLeft: 'auto',
  fontSize: '0.6875rem',
  lineHeight: 1.6,
  maxHeight: '4.5rem',
  overflow: 'auto',
  minWidth: 200,
};
