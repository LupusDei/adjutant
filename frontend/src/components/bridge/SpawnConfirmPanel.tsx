/**
 * SpawnConfirmPanel (adj-202.5.3) — the VISIBLE confirm gate for a spawn read-back.
 *
 * spawn_worker is a HEAVY action (consumes a session slot + real money) and is NOT
 * in the avatar's reversible "act decisively" class. The avatar must read the plan
 * back and WAIT for assent — but voice-only assent is error-prone (mis-hearing "no"
 * vs "go", or treating musing as a yes). So when the avatar surfaces a pending
 * read-back, the dashboard shows this panel with an explicit "Confirm spawn" button.
 * It is the grounding contract for spawns: the voice proposes, the panel proves, and
 * the Commander's tap is the authoritative assent.
 *
 * Pure presentation over an {@link AvatarSpawnConfirmMessage}; the parent owns the
 * decision relay back to the avatar/backend.
 */
import { type CSSProperties } from 'react';

import type { AvatarSpawnConfirmMessage } from './avatar-bridge';

const AMBER = '#ffab4d';
const AZURE = '#1FB6D6';
const PURPLE = '#a118c4';

export interface SpawnConfirmPanelProps {
  /** The pending read-back the avatar surfaced (nothing has spawned yet). */
  pending: AvatarSpawnConfirmMessage;
  /** Commander confirms — the parent relays an affirmative decision. */
  onConfirm: () => void;
  /** Commander declines — the parent relays a negative decision. */
  onCancel: () => void;
}

/** One labeled plan field (role / project / task), shown only when present. */
function PlanRow({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null;
  return (
    <div style={rowStyle}>
      <span style={rowLabelStyle}>{label}</span>
      <span style={rowValueStyle}>{value}</span>
    </div>
  );
}

export function SpawnConfirmPanel({ pending, onConfirm, onCancel }: SpawnConfirmPanelProps) {
  return (
    <section
      style={panelStyle}
      role="alertdialog"
      aria-label="Confirm spawn"
      aria-describedby="spawn-confirm-summary"
    >
      <div style={eyebrowStyle}>Spawn confirmation // heavy action — your assent required</div>

      <p id="spawn-confirm-summary" style={summaryStyle}>
        {pending.summary}
      </p>

      <div style={planStyle}>
        <PlanRow label="Role" value={pending.agentType} />
        <PlanRow label="Project" value={pending.projectRef} />
        <PlanRow label="Task" value={pending.task} />
      </div>

      <div style={actionsStyle}>
        <button type="button" style={confirmBtnStyle} onClick={onConfirm}>
          Confirm spawn
        </button>
        <button type="button" style={cancelBtnStyle} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}

// ── styles ──────────────────────────────────────────────────────────────────

const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.6rem',
  padding: '0.85rem',
  border: `1px solid ${AMBER}aa`,
  borderRadius: 4,
  background: '#140d05',
  fontFamily: 'var(--font-mono, monospace)',
};

const eyebrowStyle: CSSProperties = {
  fontSize: '0.5625rem',
  textTransform: 'uppercase',
  letterSpacing: '0.16em',
  color: AMBER,
};

const summaryStyle: CSSProperties = {
  margin: 0,
  fontSize: '0.8125rem',
  lineHeight: 1.5,
  color: '#f4ead9',
};

const planStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  fontSize: '0.6875rem',
};

const rowLabelStyle: CSSProperties = {
  minWidth: '3.5rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: '#9aa0a6',
};

const rowValueStyle: CSSProperties = {
  color: PURPLE,
};

const actionsStyle: CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  flexWrap: 'wrap',
};

const confirmBtnStyle: CSSProperties = {
  padding: '0.5rem 1rem',
  background: AMBER,
  border: `1px solid ${AMBER}`,
  borderRadius: 3,
  color: '#1a1205',
  fontFamily: 'inherit',
  fontSize: '0.8125rem',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  cursor: 'pointer',
};

const cancelBtnStyle: CSSProperties = {
  padding: '0.5rem 1rem',
  background: 'transparent',
  border: `1px solid ${AZURE}66`,
  borderRadius: 3,
  color: '#cfd2d6',
  fontFamily: 'inherit',
  fontSize: '0.8125rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  cursor: 'pointer',
};
