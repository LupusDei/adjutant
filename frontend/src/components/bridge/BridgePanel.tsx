/**
 * BridgePanel (adj-202.3.7) — The Bridge: read-only Fleet Briefing.
 *
 * The Commander summons the Adjutant coordinator's conversational body. The
 * avatar (served same-origin at `/avatar`, embedded in a sandboxed iframe — no
 * heavy SDK pulled into the dashboard bundle) is the FACE; the structured tool
 * results in the AuthoritativeResultPanel are the source of TRUTH. The voice only
 * narrates what the readout already proves (the grounding contract).
 *
 * This component wires the session lifecycle (`useBridgeSession`) to the avatar
 * viewport, the live credit meter, the read-only fleet tools, and an action log.
 * The logic-bearing pieces (meter math, verbatim readout) are unit-tested in
 * their own modules; this is the composition + presentation shell.
 */
import { type CSSProperties, useCallback, useState } from 'react';

import { useBridgeSession } from '../../hooks/useBridgeSession';
import type { BridgeToolName, BridgeToolRunResult } from '../../types/bridge';
import { AuthoritativeResultPanel } from './AuthoritativeResultPanel';
import { CreditMeter } from './CreditMeter';

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

export interface BridgePanelProps {
  /** Optional target project for project-scoped tools (UUID — the canonical key). */
  projectId?: string;
  /** Display name for the scoped project (header context only). */
  projectName?: string;
  /** Avatar page URL — same-origin `/avatar` by default (proxied in dev). */
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
  const { state, error, meter, elapsedMs, connect, disconnect, runTool } = session;

  const [result, setResult] = useState<BridgeToolRunResult | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);

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

  const connected = state === 'connected';

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
        {/* Avatar viewscreen — the narrating face. */}
        <section style={viewscreenStyle} aria-label="Adjutant avatar viewscreen">
          {connected ? (
            <iframe
              title="Adjutant avatar"
              src={avatarSrc}
              style={iframeStyle}
              allow="microphone; autoplay"
              sandbox="allow-scripts allow-same-origin allow-microphone"
            />
          ) : (
            <div style={viewscreenIdleStyle}>
              <p style={{ color: '#9aa0a6', maxWidth: 280, textAlign: 'center' }}>
                {state === 'error'
                  ? (error ?? 'The link to the Adjutant failed.')
                  : 'The viewscreen is dark. Open the link to summon the Adjutant.'}
              </p>
            </div>
          )}
        </section>

        {/* Authoritative readout — the source of truth. */}
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

const viewscreenStyle: CSSProperties = {
  position: 'relative',
  border: `1px solid ${PURPLE}55`,
  borderRadius: 4,
  background: '#000',
  overflow: 'hidden',
  minHeight: 240,
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
