/**
 * avatar-bridge (adj-202.3.7.1 / .7.2 / .7.3) — the parent↔/avatar postMessage
 * contract.
 *
 * BridgePanel and the backend `/avatar` page exchange a small, typed set of
 * same-origin messages so there is exactly ONE broker-owned avatar session
 * (no iframe self-connect), plus captions and mic control surfaced in the
 * dashboard chrome:
 *
 *   parent → iframe:  bridge:session (hand off broker creds), bridge:mic (command)
 *   iframe → parent:  bridge:ready, bridge:status, bridge:caption, bridge:mic (echo)
 *
 * The parser is intentionally defensive — the channel is reachable from the
 * iframe, so unknown/foreign shapes are dropped rather than trusted.
 */
import type { CaptionLine } from './CaptionsPanel';

// ── Parent → iframe (commands) ───────────────────────────────────────────────

export interface BridgeSessionHandoff {
  type: 'bridge:session';
  sessionId: string;
  sessionKey: string;
  avatarId: string;
}

export interface BridgeMicCommand {
  type: 'bridge:mic';
  enabled: boolean;
}

export interface BridgeCameraCommand {
  type: 'bridge:camera';
  enabled: boolean;
}

export interface BridgeScreenShareCommand {
  type: 'bridge:screenshare';
  enabled: boolean;
}

/**
 * The Commander's decision on a pending spawn read-back (adj-202.5.3). Sent from
 * the dashboard chrome to the avatar page when the visible "Confirm spawn" /
 * "Cancel" button is pressed — so assent is NOT voice-only. `requestId` correlates
 * the decision with the read-back the avatar surfaced.
 */
export interface BridgeSpawnDecisionCommand {
  type: 'bridge:spawn-decision';
  confirmed: boolean;
  requestId?: string;
}

export type ParentToAvatarMessage =
  | BridgeSessionHandoff
  | BridgeMicCommand
  | BridgeCameraCommand
  | BridgeScreenShareCommand
  | BridgeSpawnDecisionCommand;

// ── iframe → parent (events) ─────────────────────────────────────────────────

export interface AvatarReadyMessage {
  type: 'bridge:ready';
}

export type AvatarStatus = 'connecting' | 'connected' | 'ended' | 'error';

export interface AvatarStatusMessage {
  type: 'bridge:status';
  status: AvatarStatus;
  detail?: string;
}

export interface AvatarCaptionMessage {
  type: 'bridge:caption';
  id: string;
  role: CaptionLine['role'];
  text: string;
  final: boolean;
}

export interface AvatarMicMessage {
  type: 'bridge:mic';
  enabled: boolean;
}

export interface AvatarCameraMessage {
  type: 'bridge:camera';
  enabled: boolean;
}

export interface AvatarScreenShareMessage {
  type: 'bridge:screenshare';
  enabled: boolean;
}

/**
 * A pending spawn read-back surfaced from the avatar (adj-202.5.3). spawn_worker is
 * confirm-gated: the avatar's first (un-confirmed) call returns a read-back summary
 * and spawns NOTHING. The avatar page relays that read-back here so the dashboard can
 * show a VISIBLE "Confirm spawn" button (voice assent alone is too easy to mis-hear).
 * `summary` is the spoken read-back; the optional fields mirror the gate's plan.
 */
export interface AvatarSpawnConfirmMessage {
  type: 'bridge:spawn-confirm';
  summary: string;
  requestId?: string;
  agentType?: string;
  projectRef?: string;
  task?: string;
}

export type AvatarToParentMessage =
  | AvatarReadyMessage
  | AvatarStatusMessage
  | AvatarCaptionMessage
  | AvatarMicMessage
  | AvatarCameraMessage
  | AvatarScreenShareMessage
  | AvatarSpawnConfirmMessage;

const AVATAR_STATUSES: ReadonlySet<string> = new Set(['connecting', 'connected', 'ended', 'error']);
const CAPTION_ROLES: ReadonlySet<string> = new Set(['assistant', 'user']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Parse an inbound postMessage payload into a known avatar→parent message, or
 * null if it is foreign / malformed. Never throws.
 */
export function parseAvatarMessage(data: unknown): AvatarToParentMessage | null {
  // Bracket access throughout — `data` is an index-signature record
  // (noPropertyAccessFromIndexSignature).
  if (!isRecord(data) || typeof data['type'] !== 'string') return null;

  switch (data['type']) {
    case 'bridge:ready':
      return { type: 'bridge:ready' };

    case 'bridge:status': {
      const status = data['status'];
      if (typeof status !== 'string' || !AVATAR_STATUSES.has(status)) return null;
      const msg: AvatarStatusMessage = { type: 'bridge:status', status: status as AvatarStatus };
      const detail = data['detail'];
      if (typeof detail === 'string') msg.detail = detail;
      return msg;
    }

    case 'bridge:caption': {
      const id = data['id'];
      const text = data['text'];
      const final = data['final'];
      const role = data['role'];
      if (
        typeof id !== 'string' ||
        typeof text !== 'string' ||
        typeof final !== 'boolean' ||
        typeof role !== 'string' ||
        !CAPTION_ROLES.has(role)
      ) {
        return null;
      }
      return { type: 'bridge:caption', id, role: role as CaptionLine['role'], text, final };
    }

    case 'bridge:mic': {
      const enabled = data['enabled'];
      if (typeof enabled !== 'boolean') return null;
      return { type: 'bridge:mic', enabled };
    }

    case 'bridge:camera': {
      const enabled = data['enabled'];
      if (typeof enabled !== 'boolean') return null;
      return { type: 'bridge:camera', enabled };
    }

    case 'bridge:screenshare': {
      const enabled = data['enabled'];
      if (typeof enabled !== 'boolean') return null;
      return { type: 'bridge:screenshare', enabled };
    }

    case 'bridge:spawn-confirm': {
      const summary = data['summary'];
      if (typeof summary !== 'string') return null;
      const msg: AvatarSpawnConfirmMessage = { type: 'bridge:spawn-confirm', summary };
      // Optional structured fields — copied only when they are strings (don't trust the rest).
      const requestId = data['requestId'];
      const agentType = data['agentType'];
      const projectRef = data['projectRef'];
      const task = data['task'];
      if (typeof requestId === 'string') msg.requestId = requestId;
      if (typeof agentType === 'string') msg.agentType = agentType;
      if (typeof projectRef === 'string') msg.projectRef = projectRef;
      if (typeof task === 'string') msg.task = task;
      return msg;
    }

    default:
      return null;
  }
}

/** Default max caption lines retained in the live buffer. */
export const MAX_CAPTIONS = 50;

/**
 * Merge an incoming caption into the buffer. A line with an id already present is
 * replaced in place (interim → final updates); otherwise it is appended. The
 * buffer is capped to `max` (oldest dropped).
 */
export function applyCaption(
  lines: CaptionLine[],
  msg: AvatarCaptionMessage,
  max: number = MAX_CAPTIONS,
): CaptionLine[] {
  const next: CaptionLine = { id: msg.id, role: msg.role, text: msg.text, final: msg.final };
  const idx = lines.findIndex((l) => l.id === msg.id);

  let merged: CaptionLine[];
  if (idx >= 0) {
    merged = lines.slice();
    merged[idx] = next;
  } else {
    merged = [...lines, next];
  }

  return merged.length > max ? merged.slice(merged.length - max) : merged;
}
