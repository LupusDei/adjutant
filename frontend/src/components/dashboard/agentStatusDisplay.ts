/**
 * Display mappers for an agent's status in the Overview/crew panels.
 *
 * `booting` is a LIVE state (agent has a tmux session but its MCP connection is
 * still (re)initializing — e.g. right after a backend hot-reload wiped the
 * in-memory connection/status maps). It must NOT render as OFFLINE: the agent
 * is alive and reconnecting. Only a genuinely-unknown/absent status falls
 * through to OFFLINE.
 */

/** CSS-suffix class for the status dot + text color. */
export function statusIndicatorClass(status: string): string {
  switch (status) {
    case 'working': return 'working';
    case 'idle': return 'idle';
    case 'blocked': return 'stuck';
    case 'booting': return 'booting';
    default: return 'offline';
  }
}

/** Human label shown next to the agent. */
export function statusLabel(status: string): string {
  switch (status) {
    case 'working': return 'WORKING';
    case 'idle': return 'IDLE';
    case 'blocked': return 'BLOCKED';
    case 'booting': return 'BOOTING';
    default: return 'OFFLINE';
  }
}
